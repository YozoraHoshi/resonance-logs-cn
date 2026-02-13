use log::{info, warn};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;

const TEMP_ATTR_TABLE_RELATIVE: &str = "meter-data/TempAttrTable.json";
const SKILL_EFFECT_TABLE_RELATIVE: &str = "meter-data/SkillEffectTable.json";
const TAG_NO_CD_REDUCE: i32 = 103;

#[derive(Debug, Clone, Deserialize)]
struct RawTempAttrDef {
    #[serde(rename = "Id")]
    id: i32,
    #[serde(rename = "AttrType")]
    attr_type: i32,
    #[serde(rename = "LogicType")]
    logic_type: i32,
    #[serde(rename = "AttrParams", default)]
    attr_params: Vec<i32>,
}

#[derive(Debug, Clone)]
struct CdTempAttrDef {
    attr_type: i32,
    logic_type: i32,
    attr_params: Vec<i32>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawSkillEffectEntry {
    #[serde(rename = "Tags", default)]
    tags: Vec<i32>,
}

static CD_TEMP_ATTR_DEFS: LazyLock<HashMap<i32, CdTempAttrDef>> = LazyLock::new(|| {
    load_cd_temp_attr_defs().unwrap_or_else(|err| {
        warn!("[skill-cd] failed to load TempAttrTable.json: {}", err);
        HashMap::new()
    })
});

static SKILL_EFFECT_TAGS: LazyLock<HashMap<i32, Vec<i32>>> = LazyLock::new(|| {
    load_skill_effect_tags().unwrap_or_else(|err| {
        warn!("[skill-cd] failed to load SkillEffectTable.json: {}", err);
        HashMap::new()
    })
});

fn locate_meter_data_file(relative_path: &str) -> Option<PathBuf> {
    let mut p = PathBuf::from(relative_path);
    if p.exists() {
        return Some(p);
    }

    p = PathBuf::from(format!("src-tauri/{}", relative_path));
    if p.exists() {
        return Some(p);
    }

    if let Ok(mut exe_dir) = std::env::current_exe() {
        exe_dir.pop();
        let candidate = exe_dir.join(relative_path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn load_cd_temp_attr_defs() -> Result<HashMap<i32, CdTempAttrDef>, Box<dyn std::error::Error>> {
    let path = locate_meter_data_file(TEMP_ATTR_TABLE_RELATIVE).ok_or_else(|| {
        format!("{} not found in known locations", TEMP_ATTR_TABLE_RELATIVE)
    })?;
    let contents = fs::read_to_string(path)?;
    let raw_map: HashMap<String, RawTempAttrDef> = serde_json::from_str(&contents)?;

    let mut result = HashMap::new();
    for raw in raw_map.into_values() {
        // 100 = pct reduce, 101 = flat reduce, 103 = accelerate pct
        if raw.attr_type != 100 && raw.attr_type != 101 && raw.attr_type != 103 {
            continue;
        }
        result.insert(
            raw.id,
            CdTempAttrDef {
                attr_type: raw.attr_type,
                logic_type: raw.logic_type,
                attr_params: raw.attr_params,
            },
        );
    }
    Ok(result)
}

fn load_skill_effect_tags() -> Result<HashMap<i32, Vec<i32>>, Box<dyn std::error::Error>> {
    let path = locate_meter_data_file(SKILL_EFFECT_TABLE_RELATIVE).ok_or_else(|| {
        format!("{} not found in known locations", SKILL_EFFECT_TABLE_RELATIVE)
    })?;
    let contents = fs::read_to_string(path)?;
    let raw_map: HashMap<String, RawSkillEffectEntry> = serde_json::from_str(&contents)?;

    let mut result = HashMap::new();
    for (key, value) in raw_map {
        if let Ok(skill_level_id) = key.parse::<i32>() {
            result.insert(skill_level_id, value.tags);
        }
    }
    Ok(result)
}

fn temp_attr_matches(def: &CdTempAttrDef, skill_id: i32, skill_tags: &HashSet<i32>) -> bool {
    match def.logic_type {
        0 => true,
        1 => def.attr_params.contains(&skill_id),
        3 => def.attr_params.iter().any(|tag| skill_tags.contains(tag)),
        _ => false,
    }
}

pub fn calculate_skill_cd(
    base_cd: f32,
    skill_level_id: i32,
    temp_attr_values: &HashMap<i32, i32>,
    attr_skill_cd: f32,
    attr_skill_cd_pct: f32,
    attr_cd_accelerate_pct: f32,
) -> (f32, f32) {
    let temp_attrs_nonzero: Vec<(i32, i32)> = temp_attr_values
        .iter()
        .filter(|(_, v)| **v != 0)
        .map(|(k, v)| (*k, *v))
        .collect();
    info!(
        "[skill-cd] calc skill_level_id={} base_cd={} attr_skill_cd={} attr_skill_cd_pct={} attr_cd_accelerate_pct={} temp_attrs={:?}",
        skill_level_id, base_cd, attr_skill_cd, attr_skill_cd_pct, attr_cd_accelerate_pct, temp_attrs_nonzero
    );

    if base_cd <= 0.0 {
        info!("[skill-cd]   base_cd<=0, return (0.0, 0.0)");
        return (0.0, 0.0);
    }

    let skill_id = skill_level_id / 100;
    let tag_lookup_skill_level_id = skill_id * 100 + 1;
    let skill_tags_vec = SKILL_EFFECT_TAGS
        .get(&tag_lookup_skill_level_id)
        .cloned()
        .unwrap_or_default();
    let skill_tags: HashSet<i32> = skill_tags_vec.iter().copied().collect();
    info!(
        "[skill-cd]   skill_id={} tag_lookup={} skill_tags={:?}",
        skill_id, tag_lookup_skill_level_id, skill_tags_vec
    );

    if skill_tags.contains(&TAG_NO_CD_REDUCE) {
        info!(
            "[skill-cd]   skill has TAG_NO_CD_REDUCE(103), no reduction applied, return (base_cd={}, accelerate=0.0)",
            base_cd
        );
        return (base_cd.max(0.0), 0.0);
    }

    let mut flat_reduce = attr_skill_cd;
    let mut pct_reduce = attr_skill_cd_pct / 10000.0;
    let mut accelerate = attr_cd_accelerate_pct / 10000.0;
    info!(
        "[skill-cd]   init flat_reduce={} pct_reduce={} accelerate={}",
        flat_reduce, pct_reduce, accelerate
    );

    for (temp_attr_id, value) in temp_attr_values {
        if *value == 0 {
            continue;
        }
        let Some(def) = CD_TEMP_ATTR_DEFS.get(temp_attr_id) else {
            info!(
                "[skill-cd]   temp_attr {} value={} def_found=false (not in CD_TEMP_ATTR_DEFS), skip",
                temp_attr_id, value
            );
            continue;
        };
        let matches = temp_attr_matches(def, skill_id, &skill_tags);
        if !matches {
            info!(
                "[skill-cd]   temp_attr {} value={} def_found=true matches=false (attr_type={} logic_type={} params={:?}), skip",
                temp_attr_id, value, def.attr_type, def.logic_type, def.attr_params
            );
            continue;
        }

        match def.attr_type {
            101 => {
                let contrib = *value as f32 / 1000.0;
                flat_reduce += contrib;
                info!(
                    "[skill-cd]   temp_attr {} value={} attr_type=101(flat) contrib={} -> flat_reduce={}",
                    temp_attr_id, value, contrib, flat_reduce
                );
            }
            100 => {
                let contrib = *value as f32 / 10000.0;
                pct_reduce += contrib;
                info!(
                    "[skill-cd]   temp_attr {} value={} attr_type=100(pct) contrib={} -> pct_reduce={}",
                    temp_attr_id, value, contrib, pct_reduce
                );
            }
            103 => {
                let contrib = *value as f32 / 10000.0;
                accelerate += contrib;
                info!(
                    "[skill-cd]   temp_attr {} value={} attr_type=103(accelerate) contrib={} -> accelerate={}",
                    temp_attr_id, value, contrib, accelerate
                );
            }
            _ => {}
        }
    }

    info!(
        "[skill-cd]   final flat_reduce={} pct_reduce={} accelerate={}",
        flat_reduce, pct_reduce, accelerate
    );

    let reduced_cd = ((1.0 - pct_reduce) * (base_cd - flat_reduce)).max(0.0);
    info!(
        "[skill-cd]   reduced_cd=(1-{})*({}-{})={}",
        pct_reduce, base_cd, flat_reduce, reduced_cd
    );

    info!(
        "[skill-cd]   final_result actual_cd={} accelerate_rate={}",
        reduced_cd, accelerate
    );
    (reduced_cd, accelerate)
}
