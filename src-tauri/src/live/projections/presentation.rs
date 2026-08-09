//! Replace-only live topic composition from incremental projection DTOs.

use crate::live::counter::engine::CounterSnapshot;
use crate::live::ipc::models::{
    LiveBuffsPayload, LiveCombatPayload, LiveDataPayload, LiveFantasyPayload, LiveMonsterPayload,
    LiveStatusPayload, TrainingDummyPhase, TrainingDummyState,
};
use crate::live::projections::entity_monitor::EntityMonitorSnapshot;
use crate::live::runtime::events::SegmentId;
use crate::live::runtime::segment::{IdleMode, RecordingMode, SegmentState};

#[derive(Debug, Default)]
pub struct PresentationProjection {
    combat_revision: u64,
    status_revision: u64,
    buffs_revision: u64,
    monster_revision: u64,
    fantasy_revision: u64,
    active_segment_id: Option<SegmentId>,
    displayed_segment_id: Option<SegmentId>,
    displayed_combat: Option<LiveDataPayload>,
}

impl PresentationProjection {
    pub fn segment_started(&mut self, segment_id: SegmentId) {
        self.active_segment_id = Some(segment_id);
        self.displayed_segment_id = Some(segment_id);
        self.displayed_combat = None;
    }

    /// Freezes only the combat (meter) payload. Counters are not segment
    /// scoped, so the status payload always reflects the live engine.
    pub fn freeze_segment(&mut self, segment_id: SegmentId, combat: LiveDataPayload) {
        if self.active_segment_id == Some(segment_id) {
            self.active_segment_id = None;
            self.displayed_combat = Some(combat);
        }
    }

    pub fn clear_display(&mut self) {
        self.active_segment_id = None;
        self.displayed_segment_id = None;
        self.displayed_combat = None;
    }

    /// Builds a combat payload and advances its revision (publication path).
    pub fn take_combat_payload(
        &mut self,
        scene_id: Option<i32>,
        dungeon_difficulty: Option<i32>,
        active_combat: Option<LiveDataPayload>,
        deaths: Vec<crate::live::ipc::models::DeathRecord>,
        segment_state: &SegmentState,
    ) -> LiveCombatPayload {
        self.combat_revision = self.combat_revision.saturating_add(1);
        self.combat_payload(
            scene_id,
            dungeon_difficulty,
            active_combat,
            deaths,
            segment_state,
        )
    }

    /// Read-only combat payload for command-side bootstrap.
    #[must_use]
    pub fn peek_combat_payload(
        &self,
        scene_id: Option<i32>,
        dungeon_difficulty: Option<i32>,
        active_combat: Option<LiveDataPayload>,
        deaths: Vec<crate::live::ipc::models::DeathRecord>,
        segment_state: &SegmentState,
    ) -> LiveCombatPayload {
        self.combat_payload(
            scene_id,
            dungeon_difficulty,
            active_combat,
            deaths,
            segment_state,
        )
    }

    pub fn take_status_payload(
        &mut self,
        monitored: &EntityMonitorSnapshot,
        counters: CounterSnapshot,
    ) -> LiveStatusPayload {
        self.status_revision = self.status_revision.saturating_add(1);
        self.status_payload(monitored, counters)
    }

    #[must_use]
    pub fn peek_status_payload(
        &self,
        monitored: &EntityMonitorSnapshot,
        counters: CounterSnapshot,
    ) -> LiveStatusPayload {
        self.status_payload(monitored, counters)
    }

    pub fn take_buffs_payload(&mut self, monitored: &EntityMonitorSnapshot) -> LiveBuffsPayload {
        self.buffs_revision = self.buffs_revision.saturating_add(1);
        self.buffs_payload(monitored)
    }

    #[must_use]
    pub fn peek_buffs_payload(&self, monitored: &EntityMonitorSnapshot) -> LiveBuffsPayload {
        self.buffs_payload(monitored)
    }

    pub fn take_monster_payload(
        &mut self,
        monitored: &EntityMonitorSnapshot,
    ) -> LiveMonsterPayload {
        self.monster_revision = self.monster_revision.saturating_add(1);
        self.monster_payload(monitored)
    }

    #[must_use]
    pub fn peek_monster_payload(&self, monitored: &EntityMonitorSnapshot) -> LiveMonsterPayload {
        self.monster_payload(monitored)
    }

    pub fn take_fantasy_payload(
        &mut self,
        monitored: &EntityMonitorSnapshot,
    ) -> LiveFantasyPayload {
        self.fantasy_revision = self.fantasy_revision.saturating_add(1);
        self.fantasy_payload(monitored)
    }

    #[must_use]
    pub fn peek_fantasy_payload(&self, monitored: &EntityMonitorSnapshot) -> LiveFantasyPayload {
        self.fantasy_payload(monitored)
    }

    fn combat_payload(
        &self,
        scene_id: Option<i32>,
        dungeon_difficulty: Option<i32>,
        active_combat: Option<LiveDataPayload>,
        deaths: Vec<crate::live::ipc::models::DeathRecord>,
        segment_state: &SegmentState,
    ) -> LiveCombatPayload {
        let combat = if self.active_segment_id.is_some() {
            Some(active_combat.expect("active segment has a combat projection"))
        } else {
            self.displayed_combat.clone()
        };
        LiveCombatPayload {
            revision: self.combat_revision,
            scene_id,
            dungeon_difficulty,
            active_segment_id: self.active_segment_id.map(|segment| segment.0),
            displayed_segment_id: self.displayed_segment_id.map(|segment| segment.0),
            combat,
            deaths,
            training: TrainingDummyState {
                phase: training_phase(segment_state),
            },
        }
    }

    fn status_payload(
        &self,
        monitored: &EntityMonitorSnapshot,
        counters: CounterSnapshot,
    ) -> LiveStatusPayload {
        LiveStatusPayload {
            revision: self.status_revision,
            counters: counters.counters,
            factor_counters: counters.factor_counters,
            factor_source_item_ids: counters.factor_source_item_ids,
            factor_slot_item_ids: counters.factor_slot_item_ids,
            season_id: counters.season_id,
            season_active_template_ids: counters.season_active_template_ids,
            skill_cds: monitored.skill_cds.clone(),
            panel_attrs: monitored.panel_attrs.clone(),
            shield_current_hp: monitored.shield_current_hp,
            shield_max_hp: monitored.shield_max_hp,
            shield_entries: monitored.shield_entries.clone(),
            fight_resource: monitored.fight_resource.clone(),
        }
    }

    fn buffs_payload(&self, monitored: &EntityMonitorSnapshot) -> LiveBuffsPayload {
        LiveBuffsPayload {
            revision: self.buffs_revision,
            local_buffs: monitored.local_buffs.clone(),
        }
    }

    fn monster_payload(&self, monitored: &EntityMonitorSnapshot) -> LiveMonsterPayload {
        LiveMonsterPayload {
            revision: self.monster_revision,
            boss_buffs: monitored.boss_buffs.clone(),
            teammate_buffs: monitored.teammate_buffs.clone(),
            boss_mechanics: monitored.boss_mechanics.clone(),
            hate_lists: monitored.hate_lists.clone(),
            stun: monitored.stun.clone(),
            player_names: monitored.player_names.clone(),
            monster_ids: monitored.monster_ids.clone(),
        }
    }

    fn fantasy_payload(&self, monitored: &EntityMonitorSnapshot) -> LiveFantasyPayload {
        LiveFantasyPayload {
            revision: self.fantasy_revision,
            teammate_fantasies: monitored.teammate_fantasies.clone(),
        }
    }
}

fn training_phase(state: &SegmentState) -> TrainingDummyPhase {
    match state {
        SegmentState::Idle {
            mode: IdleMode::Standard,
        }
        | SegmentState::Recording {
            mode: RecordingMode::Standard { .. },
            ..
        } => TrainingDummyPhase::Idle,
        SegmentState::Idle {
            mode: IdleMode::TrainingArmed,
        } => TrainingDummyPhase::Armed,
        SegmentState::Recording {
            mode: RecordingMode::Training { .. },
            ..
        } => TrainingDummyPhase::Running,
        SegmentState::FrozenTraining { .. } => TrainingDummyPhase::Finished,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::projections::entity_monitor::EntityMonitorSnapshot;

    #[test]
    fn peek_does_not_advance_revision() {
        let mut presentation = PresentationProjection::default();
        let monitored = EntityMonitorSnapshot::default();
        let first = presentation.take_status_payload(&monitored, CounterSnapshot::default());
        assert_eq!(first.revision, 1);
        let peeked = presentation.peek_status_payload(&monitored, CounterSnapshot::default());
        assert_eq!(peeked.revision, 1);
        let second = presentation.take_status_payload(&monitored, CounterSnapshot::default());
        assert_eq!(second.revision, 2);
    }
}
