use crate::WINDOW_LIVE_LABEL;
use crate::live::state::{AppStateManager, StateEvent};
use log::info;
use tauri::Manager;
use window_vibrancy::{apply_blur, clear_blur};
// request_restart is not needed in this module at present

/// Enables blur on the live meter window.
///
/// # Arguments
///
/// * `app` - A handle to the Tauri application instance.
#[tauri::command]
#[specta::specta]
pub fn enable_blur(app: tauri::AppHandle) {
    if let Some(meter_window) = app.get_webview_window(WINDOW_LIVE_LABEL) {
        apply_blur(&meter_window, Some((10, 10, 10, 50))).ok();
    }
}

/// Disables blur on the live meter window.
///
/// # Arguments
///
/// * `app` - A handle to the Tauri application instance.
#[tauri::command]
#[specta::specta]
pub fn disable_blur(app: tauri::AppHandle) {
    if let Some(meter_window) = app.get_webview_window(WINDOW_LIVE_LABEL) {
        clear_blur(&meter_window).ok();
    }
}

// #[tauri::command]
// #[specta::specta]
// pub fn get_header_info(state: tauri::State<'_, EncounterMutex>) -> Result<HeaderInfo, String> {
//     let encounter = state.lock().unwrap();

//     if encounter.total_dmg == 0 {
//         return Err("No damage found".to_string());
//     }

//     let time_elapsed_ms = encounter
//         .time_last_combat_packet_ms
//         .saturating_sub(encounter.time_fight_start_ms);
//     #[allow(clippy::cast_precision_loss)]
//     let time_elapsed_secs = time_elapsed_ms as f64 / 1000.0;

//     #[allow(clippy::cast_precision_loss)]
//     Ok(HeaderInfo {
//         total_dps: nan_is_zero(encounter.total_dmg as f64 / time_elapsed_secs),
//         total_dmg: encounter.total_dmg,
//         elapsed_ms: time_elapsed_ms,
//     })
// }

// #[tauri::command]
// #[specta::specta]
// pub fn hard_reset(state: tauri::State<'_, EncounterMutex>) {
//     let mut encounter = state.lock().unwrap();
//     encounter.clone_from(&Encounter::default());
//     request_restart();
//     info!("Hard Reset");
// }

/// Resets the encounter.
///
/// # Arguments
///
/// * `state_manager` - The state manager.
///
/// # Returns
///
/// * `Result<(), String>` - An empty result.
#[tauri::command]
#[specta::specta]
pub fn reset_encounter(state_manager: tauri::State<'_, AppStateManager>) -> Result<(), String> {
    state_manager
        .inner()
        .send_state_event(StateEvent::ResetEncounter { is_manual: true })?;
    info!("encounter reset via command");
    Ok(())
}

/// Toggles pausing the encounter.
///
/// # Arguments
///
/// * `state_manager` - The state manager.
///
/// # Returns
///
/// * `Result<(), String>` - An empty result.
#[tauri::command]
#[specta::specta]
pub fn toggle_pause_encounter(
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    state_manager.send_toggle_pause_encounter()?;
    Ok(())
}

/// Sets the event update rate in milliseconds.
///
/// # Arguments
///
/// * `rate_ms` - The update rate in milliseconds (clamped to 50-2000ms range).
/// * `state_manager` - The state manager.
///
/// # Returns
///
/// * `Result<(), String>` - An empty result.
#[tauri::command]
#[specta::specta]
pub fn set_event_update_rate_ms(
    rate_ms: u64,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    // Clamp to reasonable range: 50ms to 2000ms
    let clamped = rate_ms.clamp(50, 2000);
    state_manager.set_event_update_rate_ms(clamped)?;
    info!("Event update rate set to: {}ms", clamped);
    Ok(())
}

/// Sets the monitored buff list for buff updates.
#[tauri::command]
#[specta::specta]
pub fn set_monitored_buffs(
    buff_base_ids: Vec<i32>,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    info!(
        target: "app::live",
        "[buff] set monitored buffs: {:?}",
        buff_base_ids
    );
    state_manager.set_monitored_buffs(buff_base_ids)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_boss_monitored_buffs(
    global_ids: Vec<i32>,
    self_applied_ids: Vec<i32>,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    info!(
        target: "app::live",
        "[boss-buff] set monitored buffs: global={:?} self_applied={:?}",
        global_ids, self_applied_ids
    );
    state_manager.set_boss_monitored_buffs(global_ids, self_applied_ids)?;
    Ok(())
}

/// Sets the monitored panel attribute list for panel attribute updates.
#[tauri::command]
#[specta::specta]
pub fn set_monitored_panel_attrs(
    attr_ids: Vec<i32>,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    info!(
        target: "app::live",
        "[panel-attr] set monitored attrs: {:?}",
        attr_ids
    );
    state_manager.set_monitored_panel_attrs(attr_ids)?;
    Ok(())
}

/// Sets the monitored skill list for skill CD updates.
#[tauri::command]
#[specta::specta]
pub fn set_monitored_skills(
    skill_level_ids: Vec<i32>,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    if skill_level_ids.len() > 10 {
        return Err("最多监控10个技能".to_string());
    }

    info!(
        target: "app::live",
        "[skill-cd] set monitored skills: {:?}",
        skill_level_ids
    );

    state_manager.set_monitored_skills(skill_level_ids)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_monitor_all_buff(
    monitor_all_buff: bool,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    info!(
        target: "app::live",
        "[monitor-buff] set monitorAllBuff: {:?}",
        monitor_all_buff
    );
    state_manager.set_monitor_all_buff(monitor_all_buff)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_buff_counter_rules(
    rules: Vec<crate::live::counter_tracker::CounterRule>,
    state_manager: tauri::State<'_, AppStateManager>,
) -> Result<(), String> {
    info!(target: "app::live", "[buff-counter] set rules: {}", rules.len());
    state_manager.set_buff_counter_rules(rules)?;
    Ok(())
}
