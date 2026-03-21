import type {
  OverlayPositions,
  OverlaySizes,
  OverlayVisibility,
} from "$lib/settings-store";

export const RESOURCE_SCALES_BY_CLASS: Record<string, Record<number, number>> = {
  wind_knight: {
    4: 100,
    5: 100,
  },
  frost_mage: {
    4: 100,
    5: 100,
  },
  stormblade: {},
};

export const DEFAULT_RESOURCE_VALUES_BY_CLASS: Record<
  string,
  Record<number, number>
> = {
  wind_knight: { 4: 130, 5: 130, 6: 6, 7: 6 },
  frost_mage: { 4: 0, 5: 125, 6: 0, 7: 4 },
  stormblade: { 4: 0, 5: 400, 6: 0, 7: 6 },
};

export const DEFAULT_OVERLAY_POSITIONS: OverlayPositions = {
  skillCdGroup: { x: 40, y: 40 },
  resourceGroup: { x: 40, y: 170 },
  textBuffPanel: { x: 360, y: 40 },
  specialBuffGroup: { x: 360, y: 220 },
  panelAttrGroup: { x: 700, y: 40 },
  customPanelGroup: { x: 700, y: 280 },
  iconBuffPositions: {},
  skillDurationPositions: {},
  categoryIconPositions: {},
};

export const DEFAULT_OVERLAY_SIZES: OverlaySizes = {
  skillCdGroupScale: 1,
  resourceGroupScale: 1,
  textBuffPanelScale: 1,
  panelAttrGroupScale: 1,
  customPanelGroupScale: 1,
  panelAttrGap: 4,
  panelAttrFontSize: 14,
  panelAttrColumnGap: 12,
  iconBuffSizes: {},
  skillDurationSizes: {},
  categoryIconSizes: {},
};

export const DEFAULT_OVERLAY_VISIBILITY: OverlayVisibility = {
  showSkillCdGroup: true,
  showSkillDurationGroup: true,
  showResourceGroup: true,
  showPanelAttrGroup: true,
  showCustomPanelGroup: true,
};
