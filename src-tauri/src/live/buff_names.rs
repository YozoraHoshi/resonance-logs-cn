use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const BUFF_JSON_RELATIVE: &str = "meter-data/BuffName.json";

#[derive(Debug, Deserialize)]
struct RawBuffEntry {
    #[serde(rename = "Id")]
    id: i32,
    #[serde(rename = "Icon")]
    icon: Option<String>,
    #[serde(rename = "NameDesign")]
    name: Option<String>,
    #[serde(rename = "SpriteFile")]
    sprite_file: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BuffNameEntry {
    pub name: String,
    pub icon: String,
    pub sprite_file: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BuffSpriteEntry {
    pub base_id: i32,
    pub name: String,
    pub sprite_file: String,
}

/// Cache stores buff metadata keyed by buff id.
static BUFF_CACHE: Lazy<RwLock<HashMap<i32, BuffNameEntry>>> = Lazy::new(|| {
    let map = load_buff_names().unwrap_or_default();
    RwLock::new(map)
});

fn locate_buff_file() -> Option<PathBuf> {
    // Try relative path first
    let mut p = PathBuf::from(BUFF_JSON_RELATIVE);
    if p.exists() {
        return Some(p);
    }

    // Try src-tauri prefixed
    p = PathBuf::from(format!("src-tauri/{}", BUFF_JSON_RELATIVE));
    if p.exists() {
        return Some(p);
    }

    // Try exe dir
    if let Ok(mut exe_dir) = std::env::current_exe() {
        exe_dir.pop();
        let candidate = exe_dir.join(BUFF_JSON_RELATIVE);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn load_buff_names() -> Result<HashMap<i32, BuffNameEntry>, Box<dyn std::error::Error>> {
    let path = match locate_buff_file() {
        Some(p) => p,
        None => return Ok(HashMap::new()),
    };

    let contents = fs::read_to_string(path)?;
    let entries: Vec<RawBuffEntry> = serde_json::from_str(&contents)?;
    let mut buff_map: HashMap<i32, BuffNameEntry> = HashMap::new();

    for entry in entries {
        let name = entry.name.unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let icon = entry.icon.unwrap_or_default();
        let sprite_file = entry.sprite_file.and_then(|v| if v.is_empty() { None } else { Some(v) });
        buff_map.insert(
            entry.id,
            BuffNameEntry {
                name,
                icon,
                sprite_file,
            },
        );
    }

    Ok(buff_map)
}

/// Returns the display name for the given buff id.
#[allow(dead_code)]
pub fn lookup_name(buff_id: i32) -> Option<String> {
    let cache = BUFF_CACHE.read();
    cache.get(&buff_id).map(|entry| entry.name.clone())
}

/// Returns true when the buff exists in the cache.
pub fn is_valid(buff_id: i32) -> bool {
    let cache = BUFF_CACHE.read();
    cache.contains_key(&buff_id)
}

/// Returns sprite file name when available.
pub fn lookup_sprite(buff_id: i32) -> Option<String> {
    let cache = BUFF_CACHE.read();
    cache.get(&buff_id).and_then(|entry| entry.sprite_file.clone())
}

/// Returns all buffs that have a sprite file for selection.
pub fn get_buffs_with_sprites() -> Vec<BuffSpriteEntry> {
    let cache = BUFF_CACHE.read();
    let mut result: Vec<BuffSpriteEntry> = cache
        .iter()
        .filter_map(|(id, entry)| {
            entry
                .sprite_file
                .as_ref()
                .map(|sprite| BuffSpriteEntry {
                    base_id: *id,
                    name: entry.name.clone(),
                    sprite_file: sprite.clone(),
                })
        })
        .collect();
    result.sort_by_key(|entry| entry.base_id);
    result
}

/// Searches buffs by name and returns matching base ids.
pub fn search_buffs_by_name(keyword: &str, limit: usize) -> Vec<(i32, BuffNameEntry)> {
    let needle = keyword.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }

    let cache = BUFF_CACHE.read();
    let mut result: Vec<(i32, BuffNameEntry)> = cache
        .iter()
        .filter_map(|(id, entry)| {
            let name_hit = entry.name.to_lowercase().contains(&needle);
            if name_hit {
                Some((*id, entry.clone()))
            } else {
                None
            }
        })
        .collect();

    result.sort_by_key(|(id, _)| *id);
    if result.len() > limit {
        result.truncate(limit);
    }
    result
}

/// Reload the cache from disk.
#[allow(dead_code)]
pub fn reload_cache() -> Result<(), Box<dyn std::error::Error>> {
    let new_map = load_buff_names()?;
    let mut cache = BUFF_CACHE.write();
    *cache = new_map;
    Ok(())
}

