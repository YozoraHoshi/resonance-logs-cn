import { SETTINGS, createDefaultMinimapConfig } from "$lib/settings-store";

function patchMinimapSettings(
  updater: (
    config: typeof SETTINGS.minimap.state,
  ) => typeof SETTINGS.minimap.state,
) {
  Object.assign(SETTINGS.minimap.state, updater(SETTINGS.minimap.state));
}

export function resetMinimapPositions() {
  const defaults = createDefaultMinimapConfig();
  patchMinimapSettings((config) => ({
    ...config,
    mapPanel: {
      ...config.mapPanel,
      x: defaults.mapPanel.x,
      y: defaults.mapPanel.y,
    },
    infoPanel: {
      ...config.infoPanel,
      x: defaults.infoPanel.x,
      y: defaults.infoPanel.y,
    },
  }));
}
export function resetMinimapSizes() {
  const defaults = createDefaultMinimapConfig();
  patchMinimapSettings((config) => ({
    ...config,
    mapPanel: {
      ...config.mapPanel,
      width: defaults.mapPanel.width,
      scale: defaults.mapPanel.scale,
    },
    infoPanel: {
      ...config.infoPanel,
      width: defaults.infoPanel.width,
      scale: defaults.infoPanel.scale,
    },
  }));
}
