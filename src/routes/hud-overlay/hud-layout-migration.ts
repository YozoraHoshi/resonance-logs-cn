import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "$lib/bindings";
import { translateHudPanelRect } from "$lib/hud-layout-migration";
import { SETTINGS } from "$lib/settings-store";

const LOCAL_MIGRATION_MARKER = "hud-overlay-layout-migration-v1";

export async function migrateLegacyHudLayout(): Promise<void> {
  if (localStorage.getItem(LOCAL_MIGRATION_MARKER) === "complete") {
    await completeBackendMigration();
    return;
  }

  const prepared = await commands.migrateHudLayout(false);
  if (prepared.status === "error") {
    throw new Error(String(prepared.error));
  }

  const migration = prepared.data;
  if (migration.translateMinimap) {
    const currentWindow = getCurrentWindow();
    const [scaleFactor, physicalSize] = await Promise.all([
      currentWindow.scaleFactor(),
      currentWindow.innerSize(),
    ]);
    const divisor = scaleFactor > 0 ? scaleFactor : 1;
    const offset = {
      x: migration.minimapOffsetX / divisor,
      y: migration.minimapOffsetY / divisor,
    };
    const viewport = {
      width: physicalSize.width / divisor,
      height: physicalSize.height / divisor,
    };
    const minimap = SETTINGS.minimap.state;
    Object.assign(minimap, {
      mapPanel: translateHudPanelRect(minimap.mapPanel, offset, viewport),
      infoPanel: translateHudPanelRect(minimap.infoPanel, offset, viewport),
    });
  }

  localStorage.setItem(LOCAL_MIGRATION_MARKER, "complete");
  await completeBackendMigration();
}

async function completeBackendMigration(): Promise<void> {
  const completed = await commands.migrateHudLayout(true);
  if (completed.status === "error") {
    throw new Error(String(completed.error));
  }
}
