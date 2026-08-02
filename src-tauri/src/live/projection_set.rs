//! Concrete, statically routed live projections.

use crate::database::commands::{EncounterSummaryDto, PlayerSummaryDto};
use crate::database::event_journal::{FinalizeEncounterMetadata, RecordingEncounter};
use crate::live::bootstrap_snapshot::MonitorRuntimeSnapshot;
use crate::live::counter::engine::{CounterEngine, CounterNamespace};
use crate::live::history_writer::HistoryWriterHandle;
use crate::live::ipc::models::{
    LiveBuffsPayload, LiveCombatPayload, LiveFantasyPayload, LiveMonsterPayload, LiveStatusPayload,
    MinimapUpdatePayload,
};
use crate::live::ipc::topic::{Topic, TopicMask};
use crate::live::projections::combat::accumulator::CombatHitFact;
use crate::live::projections::combat::projection::CombatProjection;
use crate::live::projections::death::DeathProjection;
use crate::live::projections::entity_monitor::EntityMonitorProjection;
use crate::live::projections::history::HistoryProjection;
use crate::live::projections::minimap::MinimapProjection;
use crate::live::projections::presentation::PresentationProjection;
use crate::live::projections::timeline::TimelineProjection;
use crate::live::projections::voice::VoiceProjection;
use crate::live::runtime::entity_context::EntityContext;
use crate::live::runtime::events::{
    AttributeValue, DomainEnvelope, DomainEvent, MonoTimeMs, SegmentReason,
};
use crate::live::runtime::scheduler::{DeadlineScheduler, DueTimer};
use crate::live::runtime::segment::SegmentState;
use crate::voice::models::VoiceCueIntent;

/// Topics served by [`EntityMonitorProjection::snapshot`].
const MONITORED_TOPICS: TopicMask = TopicMask::STATUS
    .union(TopicMask::BUFFS)
    .union(TopicMask::MONSTER)
    .union(TopicMask::FANTASY);
/// Everything except the minimap, which keeps its own incremental payload.
const SEGMENT_TOPICS: TopicMask = MONITORED_TOPICS.union(TopicMask::COMBAT);
const ALL_TOPICS: TopicMask = SEGMENT_TOPICS.union(TopicMask::MINIMAP);

/// One replace-only payload for a single dirty topic.
#[derive(Debug)]
pub enum TopicPublication {
    Combat(LiveCombatPayload),
    Status(LiveStatusPayload),
    Buffs(LiveBuffsPayload),
    Monster(LiveMonsterPayload),
    Fantasy(LiveFantasyPayload),
    Minimap(MinimapUpdatePayload),
}

impl TopicPublication {
    #[must_use]
    pub const fn topic(&self) -> Topic {
        match self {
            Self::Combat(_) => Topic::Combat,
            Self::Status(_) => Topic::Status,
            Self::Buffs(_) => Topic::Buffs,
            Self::Monster(_) => Topic::Monster,
            Self::Fantasy(_) => Topic::Fantasy,
            Self::Minimap(_) => Topic::Minimap,
        }
    }
}

#[derive(Debug)]
pub struct ProjectionSet {
    combat: CombatProjection,
    counter: CounterEngine,
    entity_monitor: EntityMonitorProjection,
    death: DeathProjection,
    minimap: MinimapProjection,
    timeline: TimelineProjection,
    voice: VoiceProjection,
    history: HistoryProjection,
    presentation: PresentationProjection,
    counter_side_effect_dirty: bool,
    dirty: TopicMask,
}

impl ProjectionSet {
    pub fn new(history_writer: HistoryWriterHandle) -> Self {
        Self {
            combat: CombatProjection::default(),
            counter: CounterEngine::new(),
            entity_monitor: EntityMonitorProjection::default(),
            death: DeathProjection::default(),
            minimap: MinimapProjection::default(),
            timeline: TimelineProjection::default(),
            voice: VoiceProjection::default(),
            history: HistoryProjection::new(history_writer),
            presentation: PresentationProjection::default(),
            counter_side_effect_dirty: false,
            dirty: ALL_TOPICS,
        }
    }

    pub fn apply_config(
        &mut self,
        config: std::sync::Arc<MonitorRuntimeSnapshot>,
        entities: &EntityContext,
        now_mono: MonoTimeMs,
        scheduler: &mut DeadlineScheduler,
    ) -> Result<(), String> {
        self.counter
            .apply_config(
                CounterNamespace::Normal,
                config.skill.buff_counter_rules.clone(),
                scheduler,
            )
            .map_err(|error| error.to_string())?;
        self.counter
            .apply_factor_templates(
                config.skill.season_cultivate_factor_templates.clone(),
                scheduler,
            )
            .map_err(|error| error.to_string())?;
        self.entity_monitor
            .apply_config(std::sync::Arc::clone(&config), entities);
        self.voice
            .apply_config(&config, entities, now_mono, scheduler);
        self.counter_side_effect_dirty = true;
        self.dirty |= SEGMENT_TOPICS;
        Ok(())
    }

    pub fn begin_batch(&mut self, batch_id: crate::live::runtime::events::BatchId) {
        let changed = self.counter.begin_batch(batch_id);
        self.mark_counter_change(changed);
    }

    pub fn apply(
        &mut self,
        envelope: &DomainEnvelope,
        entities: &EntityContext,
        scheduler: &mut DeadlineScheduler,
    ) -> Result<(), String> {
        match &envelope.event {
            DomainEvent::SegmentStarted {
                segment_id,
                started_at_mono_ms,
                started_at_wall_ms,
                ..
            } => {
                self.start_segment(
                    *segment_id,
                    *started_at_mono_ms,
                    *started_at_wall_ms,
                    entities,
                )?;
                return Ok(());
            }
            DomainEvent::SegmentEnded {
                segment_id,
                reason,
                ended_at_wall_ms,
                ..
            } => {
                self.end_segment(*segment_id, *reason, *ended_at_wall_ms)?;
                return Ok(());
            }
            _ => {}
        }

        let counter_changed = self
            .counter
            .apply_event(envelope, scheduler)
            .map_err(|error| error.to_string())?;
        self.mark_counter_change(counter_changed);

        // Each projection reports the topics its own state actually changed;
        // their OR replaces the old static routing table. Combat/minimap
        // observers return `bool`, so their bits are accumulated separately
        // and ORed in at the end (avoids overlapping mutable borrows).
        let mut reported = TopicMask::EMPTY;
        let mut combat_changed = false;
        let mut minimap_changed = false;

        match &envelope.event {
            DomainEvent::ContainerReset => {
                self.reset_runtime(scheduler);
                return Ok(());
            }
            DomainEvent::EntityAppeared { .. } => {
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
                minimap_changed |= self.minimap.apply(envelope);
            }
            DomainEvent::EntityDisappeared { entity } => {
                combat_changed |= self.combat.remove_entity(*entity);
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.death.apply(envelope);
                self.voice.apply(envelope, entities, scheduler);
                minimap_changed |= self.minimap.apply(envelope);
            }
            DomainEvent::IdentityChanged {
                entity, current, ..
            } => {
                combat_changed |= self.combat.observe_identity(*entity, current, entities);
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
                minimap_changed |= self.minimap.apply(envelope);
                self.history.apply(
                    envelope,
                    entities,
                    self.combat.segment_offset_ms(envelope.meta.mono_ms()),
                    None,
                )?;
            }
            DomainEvent::AttributeChanged {
                entity,
                attr_id,
                current,
                ..
            } => {
                if let AttributeValue::Int(value) = current {
                    combat_changed |= self.combat.observe_attribute(*entity, *attr_id, *value);
                }
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.history.apply(
                    envelope,
                    entities,
                    self.combat.segment_offset_ms(envelope.meta.mono_ms()),
                    None,
                )?;
                minimap_changed |= self.minimap.apply(envelope);
            }
            DomainEvent::PositionChanged { .. }
            | DomainEvent::TeamMembershipChanged { .. }
            | DomainEvent::TeamChanged { .. }
            | DomainEvent::LocalPlayerChanged { .. }
            | DomainEvent::BuffChanged(_)
            | DomainEvent::SkillLifecycleChanged { .. }
            | DomainEvent::PassiveSkillObserved { .. } => {
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                minimap_changed |= self.minimap.apply(envelope);
                if matches!(
                    envelope.event,
                    DomainEvent::BuffChanged(_)
                        | DomainEvent::LocalPlayerChanged { .. }
                        | DomainEvent::SkillLifecycleChanged { .. }
                ) {
                    self.voice.apply(envelope, entities, scheduler);
                }
                if let DomainEvent::LocalPlayerChanged { current, .. } = &envelope.event {
                    combat_changed |= self.combat.set_local_player(*current);
                }
            }
            DomainEvent::HateListUpdated { .. }
            | DomainEvent::SkillCooldownUpdated { .. }
            | DomainEvent::ShieldDetailsUpdated { .. }
            | DomainEvent::TempAttributeChanged { .. }
            | DomainEvent::FightResourceLayoutChanged { .. }
            | DomainEvent::FightResourceChanged { .. }
            | DomainEvent::FantasyChanged { .. }
            | DomainEvent::GameTimerSnapshot { .. }
            | DomainEvent::GameTimerChanged(_) => {
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                if matches!(envelope.event, DomainEvent::FantasyChanged { .. }) {
                    minimap_changed |= self.minimap.apply(envelope);
                }
            }
            DomainEvent::BossMechanicStarted(_) => {
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
            }
            DomainEvent::DeathOccurred { victim, .. } => {
                combat_changed |= self.combat.observe_death(*victim);
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
                let replay = self.death.apply(envelope);
                minimap_changed |= self.minimap.apply(envelope);
                self.history.apply(
                    envelope,
                    entities,
                    self.combat.segment_offset_ms(envelope.meta.mono_ms()),
                    replay,
                )?;
            }
            DomainEvent::Revived { .. } => {
                minimap_changed |= self.minimap.apply(envelope);
            }
            DomainEvent::CombatHitAccepted(hit) => {
                let fact = CombatHitFact::from_domain(hit);
                let outcome = self.combat.apply_hit(
                    hit,
                    fact.as_ref(),
                    envelope.occurred_at_ms,
                    envelope.meta.mono_ms(),
                    entities,
                );
                combat_changed |= outcome.had_combat;
                combat_changed |= self.death.apply_hit(envelope, hit, fact.as_ref());
                self.history.apply_hit(
                    envelope,
                    fact.as_ref(),
                    entities,
                    self.combat.segment_offset_ms(envelope.meta.mono_ms()),
                )?;
            }
            DomainEvent::SceneChanged {
                scene_id,
                difficulty,
                ..
            } => {
                combat_changed |= self.combat.set_scene(*scene_id, *difficulty);
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
                minimap_changed |= self.minimap.apply(envelope);
            }
            DomainEvent::PauseChanged { is_paused } => {
                combat_changed |= self.combat.set_paused(*is_paused, envelope.meta.mono_ms());
            }
            DomainEvent::DeadlineReached { .. } => {
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
            }
            DomainEvent::DataQualityIssue(_) => {
                self.history.apply(
                    envelope,
                    entities,
                    self.combat.segment_offset_ms(envelope.meta.mono_ms()),
                    None,
                )?;
            }
            DomainEvent::AttackTargetChanged { .. } => {
                reported |= self.entity_monitor.apply(envelope, entities, scheduler);
                self.voice.apply(envelope, entities, scheduler);
            }
            DomainEvent::HitResolved(_)
            | DomainEvent::WipeDetected { .. }
            | DomainEvent::DungeonFlowChanged { .. }
            | DomainEvent::DungeonObjectiveChanged { .. }
            | DomainEvent::SeasonCultivateChanged { .. } => {}
            DomainEvent::SegmentStarted { .. } | DomainEvent::SegmentEnded { .. } => {
                unreachable!("segment events returned above")
            }
        }

        if combat_changed {
            reported |= TopicMask::COMBAT;
        }
        if minimap_changed {
            reported |= TopicMask::MINIMAP;
        }
        self.dirty |= reported;
        Ok(())
    }

    pub fn apply_marker(
        &mut self,
        envelope: &DomainEnvelope,
        entities: &EntityContext,
    ) -> Result<(), String> {
        let Some(marker) = self.timeline.classify(envelope, entities) else {
            return Ok(());
        };
        self.history.apply_marker(
            envelope,
            marker,
            entities,
            self.combat.segment_offset_ms(envelope.meta.mono_ms()),
        )?;
        self.dirty |= TopicMask::COMBAT;
        Ok(())
    }

    pub fn on_due(
        &mut self,
        due: DueTimer,
        fired_at: MonoTimeMs,
        scheduler: &mut DeadlineScheduler,
    ) {
        let changed = self.counter.on_due(due, fired_at, scheduler);
        self.mark_counter_change(changed);
    }

    pub fn end_batch(
        &mut self,
        now_wall_ms: i64,
        now_mono: MonoTimeMs,
        scheduler: &mut DeadlineScheduler,
    ) {
        let changed = self.counter.end_batch();
        self.mark_counter_change(changed);
        self.flush_counter_side_effects(now_wall_ms, now_mono, scheduler);
    }

    /// Removes the voice cues matched since the last drain, for the caller to
    /// hand to `VoiceService`. Keeping playback out of the projections is what
    /// lets every projection stay a pure function of the domain events.
    pub fn take_voice_cues(&mut self) -> Vec<VoiceCueIntent> {
        self.voice.take_cues()
    }

    pub fn clear_display(&mut self) {
        self.presentation.clear_display();
        self.entity_monitor.clear_segment_display();
        self.combat.clear_segment();
        self.death.start_segment();
        self.counter_side_effect_dirty = false;
        self.dirty |= SEGMENT_TOPICS;
    }

    fn reset_runtime(&mut self, scheduler: &mut DeadlineScheduler) {
        self.combat.clear_segment();
        self.combat.set_local_player(None);
        self.entity_monitor.reset_runtime(scheduler);
        self.death.start_segment();
        self.minimap.reset_runtime();
        self.timeline.reset_runtime();
        self.voice.reset_runtime(scheduler);
        self.presentation.clear_display();
        self.counter_side_effect_dirty = true;
        self.dirty = ALL_TOPICS;
    }

    #[must_use]
    pub fn peek_combat(&self, segment_state: &SegmentState) -> LiveCombatPayload {
        self.presentation.peek_combat_payload(
            self.combat.scene_id(),
            self.combat.dungeon_difficulty(),
            self.combat.segment_id().map(|_| self.combat.payload()),
            self.death.snapshot(),
            segment_state,
        )
    }

    #[must_use]
    pub fn peek_status(&self, entities: &EntityContext) -> LiveStatusPayload {
        self.presentation.peek_status_payload(
            &self.entity_monitor.snapshot(entities),
            self.counter.snapshot(),
        )
    }

    #[must_use]
    pub fn peek_buffs(&self, entities: &EntityContext) -> LiveBuffsPayload {
        self.presentation
            .peek_buffs_payload(&self.entity_monitor.snapshot(entities))
    }

    #[must_use]
    pub fn peek_monster(&self, entities: &EntityContext) -> LiveMonsterPayload {
        self.presentation
            .peek_monster_payload(&self.entity_monitor.snapshot(entities))
    }

    #[must_use]
    pub fn peek_fantasy(&self, entities: &EntityContext) -> LiveFantasyPayload {
        self.presentation
            .peek_fantasy_payload(&self.entity_monitor.snapshot(entities))
    }

    /// Builds one payload per topic that is both requested and dirty, clearing
    /// only the taken bits so topics on a slower cadence stay pending.
    pub fn take_publications(
        &mut self,
        entities: &EntityContext,
        segment_state: &SegmentState,
        topics: TopicMask,
    ) -> Vec<TopicPublication> {
        let due = self.dirty.intersection(topics);
        if due.is_empty() {
            return Vec::new();
        }
        // Only pay for the monitor snapshot when a topic sourced from it is due.
        let monitor_snapshot = due
            .intersects(MONITORED_TOPICS)
            .then(|| self.entity_monitor.snapshot(entities));
        let monitored = || {
            monitor_snapshot
                .as_ref()
                .expect("monitored topics prepared an entity monitor snapshot")
        };

        let mut publications = Vec::new();
        for topic in due.iter() {
            publications.push(match topic {
                Topic::Combat => TopicPublication::Combat(self.presentation.take_combat_payload(
                    self.combat.scene_id(),
                    self.combat.dungeon_difficulty(),
                    self.combat.segment_id().map(|_| self.combat.payload()),
                    self.death.snapshot(),
                    segment_state,
                )),
                Topic::Status => TopicPublication::Status(
                    self.presentation
                        .take_status_payload(monitored(), self.counter.snapshot()),
                ),
                Topic::Buffs => {
                    TopicPublication::Buffs(self.presentation.take_buffs_payload(monitored()))
                }
                Topic::Monster => {
                    TopicPublication::Monster(self.presentation.take_monster_payload(monitored()))
                }
                Topic::Fantasy => {
                    TopicPublication::Fantasy(self.presentation.take_fantasy_payload(monitored()))
                }
                Topic::Minimap => TopicPublication::Minimap(self.minimap.take_payload()),
            });
        }

        self.dirty.remove(due);
        publications
    }

    /// True when any topic in `mask` is pending publication.
    #[cfg(test)]
    pub const fn is_dirty(&self, mask: TopicMask) -> bool {
        self.dirty.intersects(mask)
    }

    #[must_use]
    pub const fn dirty_mask(&self) -> TopicMask {
        self.dirty
    }

    fn start_segment(
        &mut self,
        segment_id: crate::live::runtime::events::SegmentId,
        started_at_mono_ms: MonoTimeMs,
        started_at_wall_ms: i64,
        entities: &EntityContext,
    ) -> Result<(), String> {
        self.combat
            .start_segment(segment_id, started_at_mono_ms, started_at_wall_ms);
        self.combat.set_local_player(entities.local_player());
        if let Some(scene_id) = entities.current_scene_id() {
            self.combat
                .set_scene(scene_id, entities.current_difficulty());
        }
        self.entity_monitor.start_segment(started_at_wall_ms);
        self.death.start_segment();
        self.history.start_segment(
            segment_id,
            RecordingEncounter {
                started_at_ms: started_at_wall_ms,
                local_player_id: entities.local_player().map(|entity| entity.uuid.0),
                scene_id: entities.current_scene_id(),
                dungeon_difficulty: entities.current_difficulty(),
            },
        )?;
        self.presentation.segment_started(segment_id);
        self.counter_side_effect_dirty = true;
        self.dirty |= SEGMENT_TOPICS;
        Ok(())
    }

    fn end_segment(
        &mut self,
        segment_id: crate::live::runtime::events::SegmentId,
        reason: SegmentReason,
        ended_at_wall_ms: i64,
    ) -> Result<(), String> {
        if reason == SegmentReason::Manual {
            self.presentation.clear_display();
        } else {
            self.presentation
                .freeze_segment(segment_id, self.combat.payload());
        }

        let duration_ms = self.combat.observed_duration_ms();
        let active_ms = self.combat.active_combat_time_ms().min(duration_ms);
        let total_damage_exact = self.combat.total_damage();
        let total_healing_exact = self.combat.total_healing();
        let total_damage = clamp_u128_to_i64(total_damage_exact);
        let total_healing = clamp_u128_to_i64(total_healing_exact);
        let boss_ids = self.combat.boss_monster_ids();
        let player_names = self.combat.player_names();
        let players = player_names
            .iter()
            .map(|player| PlayerSummaryDto {
                name: player.name.clone(),
                class_id: player.class_id,
            })
            .collect();
        let metadata = FinalizeEncounterMetadata {
            ended_at_ms: ended_at_wall_ms,
            local_player_id: self.combat.local_player_id(),
            total_damage,
            total_healing,
            scene_id: self.combat.scene_id(),
            dungeon_difficulty: self.combat.dungeon_difficulty(),
            duration_seconds: duration_ms as f64 / 1_000.0,
            active_combat_duration_seconds: Some(active_ms as f64 / 1_000.0),
            is_manually_reset: reason == SegmentReason::Manual,
            boss_monster_ids_json: serde_json::to_string(&boss_ids)
                .map_err(|error| error.to_string())?,
            player_names_json: serde_json::to_string(&player_names)
                .map_err(|error| error.to_string())?,
            quality_flags: 0,
        };
        self.history.finalize(
            segment_id,
            self.combat.accumulator(),
            metadata,
            EncounterSummaryDto {
                id: 0,
                started_at_ms: self.combat.started_at_wall_ms(),
                ended_at_ms: Some(ended_at_wall_ms),
                total_dmg: total_damage_exact.to_string(),
                total_heal: total_healing_exact.to_string(),
                scene_id: self.combat.scene_id(),
                dungeon_difficulty: self.combat.dungeon_difficulty(),
                duration: duration_ms as f64 / 1_000.0,
                active_combat_duration: Some(active_ms as f64 / 1_000.0),
                local_player_id: self.combat.local_player_id(),
                bosses: self.combat.boss_summaries(),
                players,
                remote_encounter_id: None,
                is_favorite: false,
                detail_available: true,
            },
        )?;

        self.combat.clear_segment();
        self.counter_side_effect_dirty = false;
        self.dirty |= TopicMask::COMBAT | TopicMask::STATUS;
        Ok(())
    }

    fn mark_counter_change(&mut self, changed: bool) {
        if !changed {
            return;
        }
        self.counter_side_effect_dirty = true;
        self.dirty |= TopicMask::STATUS;
    }

    fn flush_counter_side_effects(
        &mut self,
        now_wall_ms: i64,
        now_mono: MonoTimeMs,
        scheduler: &mut DeadlineScheduler,
    ) {
        if !self.counter_side_effect_dirty {
            return;
        }
        self.voice
            .apply_counters(&self.counter, now_wall_ms, now_mono, scheduler);
        self.counter_side_effect_dirty = false;
        self.dirty |= TopicMask::STATUS;
    }
}

fn clamp_u128_to_i64(value: u128) -> i64 {
    value.min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::runtime::segment::IdleMode;

    #[test]
    fn command_peek_does_not_consume_pending_publication() {
        let (writer, join) = HistoryWriterHandle::start().expect("history writer starts");
        let mut projections = ProjectionSet::new(writer);
        let entities = EntityContext::new();
        let state = SegmentState::Idle {
            mode: IdleMode::Standard,
        };

        let command_peek = projections.peek_combat(&state);
        assert!(projections.is_dirty(TopicMask::COMBAT));

        let publications = projections.take_publications(&entities, &state, TopicMask::COMBAT);
        let [TopicPublication::Combat(publication)] = publications.as_slice() else {
            panic!("pending combat publication remains available");
        };
        assert!(publication.revision > command_peek.revision);
        assert!(!projections.is_dirty(TopicMask::COMBAT));
        assert!(
            projections
                .take_publications(&entities, &state, TopicMask::COMBAT)
                .is_empty()
        );

        drop(projections);
        join.join().expect("history writer stops after disconnect");
    }

    #[test]
    fn taking_one_topic_leaves_the_others_pending() {
        let (writer, join) = HistoryWriterHandle::start().expect("history writer starts");
        let mut projections = ProjectionSet::new(writer);
        let entities = EntityContext::new();
        let state = SegmentState::Idle {
            mode: IdleMode::Standard,
        };

        assert_eq!(projections.dirty_mask(), ALL_TOPICS);
        let publications = projections.take_publications(&entities, &state, TopicMask::MINIMAP);
        assert!(matches!(
            publications.as_slice(),
            [TopicPublication::Minimap(_)]
        ));
        assert_eq!(projections.dirty_mask(), SEGMENT_TOPICS);

        assert_eq!(
            projections
                .take_publications(&entities, &state, ALL_TOPICS)
                .len(),
            SEGMENT_TOPICS.iter().count()
        );
        assert!(projections.dirty_mask().is_empty());

        drop(projections);
        join.join().expect("history writer stops after disconnect");
    }

    #[test]
    fn monitor_attribute_reports_the_topics_of_its_consumers() {
        use crate::live::protocol::attrs as attr_type;
        use crate::live::runtime::events::{EntityRef, EntityUuid};

        // Local-player attributes feed panel/skill-CD display and the shield
        // bar, both on STATUS.
        let mut local_projection = EntityMonitorProjection::default();
        let entities = EntityContext::new();
        let local = EntityRef {
            uuid: EntityUuid(1),
            generation: 0,
        };
        local_projection.set_local_player_for_test(local);
        local_projection.monitor_panel_attr_for_test(attr_type::ATTR_CURRENT_HP);
        assert_eq!(
            local_projection.apply_integer_attribute(
                local,
                attr_type::ATTR_CURRENT_HP,
                50,
                &entities,
            ),
            TopicMask::STATUS
        );
        assert_eq!(
            local_projection.apply_integer_attribute(
                local,
                attr_type::ATTR_SKILL_CD,
                50,
                &entities,
            ),
            TopicMask::STATUS
        );
        // A local attribute nobody consumes dirties nothing.
        assert_eq!(
            local_projection.apply_integer_attribute(
                local,
                attr_type::ATTR_MAX_STUNNED,
                50,
                &entities,
            ),
            TopicMask::EMPTY
        );

        // Stagger matters only on the current attack target.
        let mut target_projection = EntityMonitorProjection::default();
        let target = EntityRef {
            uuid: EntityUuid(2),
            generation: 0,
        };
        target_projection.set_current_target_for_test(target);
        assert_eq!(
            target_projection.apply_integer_attribute(
                target,
                attr_type::ATTR_CURRENT_STUNNED,
                40,
                &entities,
            ),
            TopicMask::MONSTER
        );
        assert_eq!(
            target_projection.apply_integer_attribute(
                target,
                attr_type::ATTR_MAX_STUNNED,
                100,
                &entities,
            ),
            TopicMask::MONSTER
        );
        assert_eq!(
            target_projection.apply_integer_attribute(
                target,
                attr_type::ATTR_CURRENT_HP,
                1,
                &entities,
            ),
            TopicMask::EMPTY
        );

        // Plain bystanders dirty nothing.
        let mut plain_projection = EntityMonitorProjection::default();
        let plain = EntityRef {
            uuid: EntityUuid(3),
            generation: 0,
        };
        assert_eq!(
            plain_projection.apply_integer_attribute(plain, attr_type::ATTR_MAX_HP, 1, &entities,),
            TopicMask::EMPTY
        );
    }

    #[test]
    fn facing_attributes_dirty_only_the_minimap() {
        use crate::live::protocol::attrs as attr_type;
        use crate::live::runtime::events::{BatchId, EntityRef, EntityUuid, EventMeta, SegmentId};

        let (writer, join) = HistoryWriterHandle::start().expect("history writer starts");
        let mut projections = ProjectionSet::new(writer);
        let entities = EntityContext::new();
        let mut scheduler = DeadlineScheduler::new();
        let mut dirty = projections.dirty_mask();
        dirty.remove(ALL_TOPICS);
        projections.dirty = dirty;

        let meta = EventMeta {
            batch_id: BatchId(1),
            capture_sequence: 1,
            stream_id: 1,
            stream_epoch: 1,
            captured_wall_ms: 1_000,
            captured_mono_ns: 1_000_000,
            source_time_ms: None,
        };
        let envelope = DomainEnvelope {
            sequence: 1,
            batch_id: meta.batch_id,
            occurred_at_ms: 1_000,
            meta,
            event_index: 0,
            segment_id: Some(SegmentId(1)),
            event: DomainEvent::AttributeChanged {
                entity: EntityRef {
                    uuid: EntityUuid(1),
                    generation: 0,
                },
                attr_id: attr_type::ATTR_FACING,
                previous: None,
                current: AttributeValue::Int(0),
                is_baseline: false,
            },
        };
        projections
            .apply(&envelope, &entities, &mut scheduler)
            .unwrap();
        assert_eq!(projections.dirty_mask(), TopicMask::MINIMAP);

        drop(projections);
        join.join().expect("history writer stops after disconnect");
    }
}
