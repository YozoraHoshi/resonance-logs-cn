use std::path::Path;

use serde_json::{Map, Value, json};
use tauri::{Manager, PhysicalPosition, PhysicalSize};

use crate::WINDOW_HUD_OVERLAY_LABEL;

const WINDOW_STATE_FILE: &str = ".window-state.json";
const MIGRATION_MARKER_FILE: &str = ".hud-overlay-layout-v1";
const LEGACY_GAME_OVERLAY_LABEL: &str = "game-overlay";
const LEGACY_MINIMAP_OVERLAY_LABEL: &str = "minimap-overlay";

#[derive(Debug, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HudLayoutMigration {
    pub translate_minimap: bool,
    pub minimap_offset_x: i32,
    pub minimap_offset_y: i32,
}

#[derive(Debug, Clone, Copy)]
struct WindowGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

#[tauri::command]
#[specta::specta]
pub fn migrate_hud_layout(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    complete: bool,
) -> Result<HudLayoutMigration, String> {
    if window.label() != WINDOW_HUD_OVERLAY_LABEL {
        return Err(format!(
            "HUD layout migration called by unexpected window {}",
            window.label()
        ));
    }

    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let marker_path = config_dir.join(MIGRATION_MARKER_FILE);
    if complete {
        std::fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
        std::fs::write(marker_path, b"complete").map_err(|error| error.to_string())?;
        return Ok(HudLayoutMigration::default());
    }
    if marker_path.exists() {
        return Ok(HudLayoutMigration::default());
    }

    let state_path = config_dir.join(WINDOW_STATE_FILE);
    let mut states = read_window_states(&state_path)?;

    let current = current_window_state(&window)?;
    let legacy_game = states
        .get(LEGACY_GAME_OVERLAY_LABEL)
        .and_then(window_geometry);
    let legacy_minimap = states
        .get(LEGACY_MINIMAP_OVERLAY_LABEL)
        .and_then(window_geometry);

    let hud_state = legacy_game
        .and_then(|geometry| {
            geometry_on_available_monitor(&window, geometry).then(|| migrated_hud_state(geometry))
        })
        .unwrap_or_else(|| with_hidden_hud_flags(current));
    states.insert(WINDOW_HUD_OVERLAY_LABEL.into(), Value::Object(hud_state));
    write_window_states(&state_path, &states)?;

    let Some(game) =
        legacy_game.filter(|geometry| geometry_on_available_monitor(&window, *geometry))
    else {
        return Ok(HudLayoutMigration::default());
    };

    window
        .set_position(PhysicalPosition::new(game.x, game.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(game.width, game.height))
        .map_err(|error| error.to_string())?;

    let Some(minimap) = legacy_minimap else {
        return Ok(HudLayoutMigration::default());
    };

    Ok(HudLayoutMigration {
        translate_minimap: true,
        minimap_offset_x: minimap.x.saturating_sub(game.x),
        minimap_offset_y: minimap.y.saturating_sub(game.y),
    })
}

fn read_window_states(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice::<Map<String, Value>>(&bytes).map_err(|error| error.to_string())
}

fn write_window_states(path: &Path, states: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(states).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn window_geometry(value: &Value) -> Option<WindowGeometry> {
    let object = value.as_object()?;
    Some(WindowGeometry {
        width: u32::try_from(object.get("width")?.as_u64()?).ok()?,
        height: u32::try_from(object.get("height")?.as_u64()?).ok()?,
        x: i32::try_from(object.get("x")?.as_i64()?).ok()?,
        y: i32::try_from(object.get("y")?.as_i64()?).ok()?,
    })
}

fn normalized_hud_state(geometry: WindowGeometry) -> Map<String, Value> {
    let mut state = Map::new();
    state.insert("width".into(), json!(geometry.width));
    state.insert("height".into(), json!(geometry.height));
    state.insert("x".into(), json!(geometry.x));
    state.insert("y".into(), json!(geometry.y));
    state.insert("prev_x".into(), json!(geometry.x));
    state.insert("prev_y".into(), json!(geometry.y));
    state
}

fn migrated_hud_state(geometry: WindowGeometry) -> Map<String, Value> {
    with_hidden_hud_flags(normalized_hud_state(geometry))
}

fn with_hidden_hud_flags(mut state: Map<String, Value>) -> Map<String, Value> {
    // Logical domain visibility is owned by the main window, not window-state.
    state.insert("visible".into(), Value::Bool(false));
    state.insert("maximized".into(), Value::Bool(false));
    state.insert("fullscreen".into(), Value::Bool(false));
    state.insert("decorated".into(), Value::Bool(false));
    state
}

fn current_window_state(window: &tauri::WebviewWindow) -> Result<Map<String, Value>, String> {
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(normalized_hud_state(WindowGeometry {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
    }))
}

fn geometry_on_available_monitor(window: &tauri::WebviewWindow, geometry: WindowGeometry) -> bool {
    window
        .available_monitors()
        .map(|monitors| {
            monitors.into_iter().any(|monitor| {
                let monitor_position = monitor.position();
                let monitor_size = monitor.size();
                let left = i64::from(monitor_position.x);
                let top = i64::from(monitor_position.y);
                let right = left + i64::from(monitor_size.width);
                let bottom = top + i64::from(monitor_size.height);
                let x = i64::from(geometry.x);
                let y = i64::from(geometry.y);
                x >= left && x < right && y >= top && y < bottom
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_window_geometry_without_rewriting_unknown_fields() {
        let value = json!({
            "width": 1280,
            "height": 960,
            "x": -120,
            "y": 80,
            "custom": "kept"
        });

        let geometry = window_geometry(&value).expect("valid geometry");
        assert_eq!(geometry.width, 1280);
        assert_eq!(geometry.height, 960);
        assert_eq!(geometry.x, -120);
        assert_eq!(geometry.y, 80);
        assert_eq!(value["custom"], "kept");
    }

    #[test]
    fn migrates_legacy_geometry_without_restoring_overlay_visibility() {
        let state = migrated_hud_state(WindowGeometry {
            width: 1280,
            height: 960,
            x: 120,
            y: 80,
        });

        assert_eq!(state["width"], json!(1280));
        assert_eq!(state["height"], json!(960));
        assert_eq!(state["x"], json!(120));
        assert_eq!(state["y"], json!(80));
        assert_eq!(state["visible"], Value::Bool(false));
        assert_eq!(state["maximized"], Value::Bool(false));
        assert_eq!(state["fullscreen"], Value::Bool(false));
        assert_eq!(state["decorated"], Value::Bool(false));
    }
}
