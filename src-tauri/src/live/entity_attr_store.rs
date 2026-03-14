use crate::live::commands_models::{HateEntry, PanelAttrState};
use crate::live::opcodes_models::{AttrType, AttrValue, Entity};
use blueprotobuf_lib::blueprotobuf::EActorState;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct EntityAttrStore {
    attrs: HashMap<i64, HashMap<AttrType, AttrValue>>,
    hate_lists: HashMap<i64, Vec<HateEntry>>,
    temp_attrs: HashMap<i32, i32>,
    local_player_uid: i64,
    panel_attr_values: HashMap<i32, i32>,
    cd_dirty: bool,
    panel_dirty_attrs: Vec<PanelAttrState>,
}

#[derive(Debug, Default)]
pub struct AttrChanges {
    pub cd_dirty: bool,
    pub panel_dirty_attrs: Vec<PanelAttrState>,
}

impl EntityAttrStore {
    pub fn with_capacity(attr_entries: usize) -> Self {
        Self {
            attrs: HashMap::with_capacity(attr_entries),
            hate_lists: HashMap::new(),
            temp_attrs: HashMap::new(),
            local_player_uid: 0,
            panel_attr_values: HashMap::new(),
            cd_dirty: false,
            panel_dirty_attrs: Vec::with_capacity(8),
        }
    }

    pub fn set_local_uid(&mut self, uid: i64) {
        self.local_player_uid = uid;
    }

    pub fn set_attr(&mut self, uid: i64, attr_type: AttrType, value: AttrValue) -> bool {
        let changed = self
            .attrs
            .entry(uid)
            .or_default()
            .get(&attr_type)
            .is_none_or(|prev| *prev != value);
        if !changed {
            return false;
        }
        self.attrs.entry(uid).or_default().insert(attr_type, value);
        if uid == self.local_player_uid
            && matches!(
                attr_type,
                AttrType::SkillCd | AttrType::SkillCdPct | AttrType::CdAcceleratePct
            )
        {
            self.cd_dirty = true;
        }
        true
    }

    pub fn set_panel_attr(&mut self, attr_id: i32, value: i32) -> bool {
        let prev = self.panel_attr_values.insert(attr_id, value);
        if prev == Some(value) {
            return false;
        }
        self.panel_dirty_attrs
            .push(PanelAttrState { attr_id, value });
        true
    }

    pub fn panel_attr_value(&self, attr_id: i32) -> Option<i32> {
        self.panel_attr_values.get(&attr_id).copied()
    }

    pub fn set_temp_attr(&mut self, attr_id: i32, value: i32) -> bool {
        let prev = self.temp_attrs.insert(attr_id, value);
        if prev == Some(value) {
            return false;
        }
        self.cd_dirty = true;
        true
    }

    pub fn attr(&self, uid: i64, attr_type: AttrType) -> Option<&AttrValue> {
        self.attrs
            .get(&uid)
            .and_then(|entity_attrs| entity_attrs.get(&attr_type))
    }

    pub fn hate_list_mut(&mut self, uid: i64) -> &mut Vec<HateEntry> {
        self.hate_lists
            .entry(uid)
            .or_insert_with(|| Vec::with_capacity(8))
    }

    pub fn hate_lists(&self) -> &HashMap<i64, Vec<HateEntry>> {
        &self.hate_lists
    }

    pub fn is_dead(&self, uid: i64) -> bool {
        self.attr(uid, AttrType::ActorState)
            .and_then(AttrValue::as_int)
            .is_some_and(|value| value == i64::from(EActorState::ActorStateDead as i32))
    }

    pub fn hydrate_entity(&self, uid: i64, entity: &mut Entity) {
        if let Some(name) = self
            .attr(uid, AttrType::Name)
            .and_then(AttrValue::as_string)
        {
            if !name.is_empty() {
                entity.name = name.to_string();
            }
        }
        if let Some(value) = self
            .attr(uid, AttrType::ProfessionId)
            .and_then(AttrValue::as_int)
        {
            entity.class_id = value as i32;
        }
        if let Some(value) = self
            .attr(uid, AttrType::FightPoint)
            .and_then(AttrValue::as_int)
        {
            entity.ability_score = value as i32;
        }
        if let Some(value) = self.attr(uid, AttrType::Level).and_then(AttrValue::as_int) {
            entity.level = value as i32;
        }
        if let Some(value) = self
            .attr(uid, AttrType::SeasonStrength)
            .and_then(AttrValue::as_int)
        {
            entity.season_strength = value as i32;
        }
    }

    pub fn temp_attrs(&self) -> &HashMap<i32, i32> {
        &self.temp_attrs
    }

    pub fn cd_inputs(&self) -> (f32, f32, f32) {
        let uid = self.local_player_uid;
        let attr_skill_cd = self
            .attr(uid, AttrType::SkillCd)
            .and_then(AttrValue::as_int)
            .unwrap_or(0) as f32;
        let attr_skill_cd_pct = self
            .attr(uid, AttrType::SkillCdPct)
            .and_then(AttrValue::as_int)
            .unwrap_or(0) as f32;
        let attr_cd_accelerate_pct = self
            .attr(uid, AttrType::CdAcceleratePct)
            .and_then(AttrValue::as_int)
            .unwrap_or(0) as f32;
        (attr_skill_cd, attr_skill_cd_pct, attr_cd_accelerate_pct)
    }

    pub fn mark_cd_dirty(&mut self) {
        self.cd_dirty = true;
    }

    pub fn clear_all_entities(&mut self) {
        self.attrs.clear();
        self.hate_lists.clear();
    }

    pub fn drain_changes(&mut self) -> AttrChanges {
        AttrChanges {
            cd_dirty: std::mem::take(&mut self.cd_dirty),
            panel_dirty_attrs: std::mem::take(&mut self.panel_dirty_attrs),
        }
    }
}
