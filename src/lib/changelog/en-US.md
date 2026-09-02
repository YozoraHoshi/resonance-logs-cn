# Changelog v0.2.3

## Changes

### DPS / History

- Dummy-training mode adds a lock policy: "First Monster Hit" (DPS Meter → Settings → Live → Training Lock)
    - Defaults to the guild dummy and locks after the first hit
- DPS and history duration are now based on the last-hit encounter split
    - True DPS still uses active combat time
- DPS table column names can be customized (DPS Meter → Settings → Live / History → General Settings)
- History teammate curves can be clicked again to switch to instant DPS
- Improved history curve display
- Added Buff coverage: configure a watch list in Live Monitor, show self coverage on the live overlay, and summarize party coverage in history
    - Configure under Live Monitor → Buff Coverage. Check "Show live" for self buffs you care about; uncheck it for teammate buffs you care about (those appear in history)

  ![Live overlay Buff coverage](/images/changelog/v0.2.3_1.png)

  ![History Buff coverage timeline](/images/changelog/v0.2.3_2.png)

  ![History Buff coverage summary](/images/changelog/v0.2.3_3.png)

- Improved death-replay layout on DPS and history views; death Buff snapshots are collapsed and moved later
- Death replay hits can show Phys/Mag and element, with column visibility and order (default: time, skill, source, damage) (DPS Meter → Settings → Live / History → Death Replay Columns)
- History death-replay headers now match DPS/heal alignment (labels left, other columns right)
- Adjusted history record styling
- Fixed Fortress not auto-resetting mid-path
- Fixed Trial in the Mirror phase 1 resetting unexpectedly

### Overlay Monitor

- Added Wasteland Court dungeon mechanics

  ![Wasteland Court - Void Scar Match](/images/changelog/v0.2.3_4.png)

  ![Wasteland Court - Energy Orb Tracking](/images/changelog/v0.2.3_5.png)

- Unified Monster Monitor and Live Monitor styles
- Despawning an entity no longer clears the attack target, so Monster Monitor keeps receiving updates
- Fixed nearby players not fully showing around Buff Coverage
- Fixed Season Node Area and Buff Coverage Area possibly duplicating iconless buffs
- Added Vanguard set counters (Live Monitor → Custom Monitor → Add Counter)
    - Vanguard S4 - Auto Dragon Cannon
    - Vanguard S4 - Extra Phantom Spiral
- Added Frost Mage set counters (Live Monitor → Custom Monitor → Add Counter)
    - Ray S4 - Frost Infusion 4-Piece

### Voice

- Added voice alerts for "Match Found", "Ready Check", and "Dungeon Vote", with built-in preset audio (Voice → Match Alerts)

### App Settings

- Added "Exit when the close button is clicked" (App Settings → General → App Behavior)
- Improved some English and Japanese translations

### Stability

- Fixed switching DPS and Overlay windows possibly clearing each other, and simplified window-switch control

## Notes

### Compatibility

- If you used 0.0.2 or 0.0.3, first launch on 0.0.4-0.2.3 requires deleting `resonance-logs-cn.db` under `%LOCALAPPDATA%\resonance-logs-cn` and restarting
- 0.2.2 and 0.2.1 went through large refactors; if existing features break, please contact me promptly
- 0.2.2 changed table fields; errors on old history records are expected, new records work normally
- Voice announcements require a separate model download; the first phrase generation may take a while, but playback after that does not reload the model

### Important

- If you modify the code and share builds without opening a PR, please change the app name, version, and other upstream identifiers so your fork is not mistaken for the original
- The close button now hides to the bottom-right; drag the hidden bar back to the corner if you have many windows
- See the HTML user guide for common questions

### Community

- QQ group: `1084866292`
- Discord: https://discord.gg/RHeX47wvDU
