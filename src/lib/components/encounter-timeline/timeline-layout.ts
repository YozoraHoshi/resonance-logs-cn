import type { ZoomTier } from "./timeline-data";

/**
 * Single source of truth for every pixel constant the timeline uses. Both the
 * DOM lane renderer and the ECharts curve grid import from here, so the two
 * coordinate systems can no longer silently drift apart (the historical bug
 * this module replaces: `GUTTER`/`LANE_H` used to be hand-copied between the
 * ECharts option builder and the HTML gutter styles).
 */

/** Left gutter reserved for lane name/icon labels (and, lower down, the
 * curve's native Y-axis value labels sharing the same column). Deliberately
 * tight: every pixel here is one the plot does not get, and the column only
 * has to fit a truncated lane name (the full one is a hover tooltip away) plus
 * an abbreviated axis value like "771.4w" (~44px at 10px type). */
export const GUTTER = 96;
/** Right padding so the last pixel column isn't flush against the border. */
export const RIGHT_PADDING = 16;

export const LANE_TOP = 10;
export const LANE_GAP = 14;

/** The panel's one and only size set - there used to be a compact/expanded
 * toggle, but the compact rows were too cramped to read overlapping skill
 * icons in, so the expanded sizes became the single form. `curveH` includes
 * the curve's own bottom time-axis tick labels (ECharts draws them inside its
 * grid's reserved bottom padding, so no extra layout slot is needed). */
const SIZES = {
  laneH: 44,
  curveH: 300,
  iconSize: 24,
};

export const DEFAULT_LANE_H = SIZES.laneH;
export const DEFAULT_CURVE_H = SIZES.curveH;
export const DEFAULT_ICON_SIZE = SIZES.iconSize;

export const MIN_LANE_H = 28;
export const MAX_LANE_H = 88;
export const MIN_CURVE_H = 120;
export const MAX_CURVE_H = 640;

/** Min horizontal gap (px) before a lane marker may show a labelled pill
 * instead of degrading to a tick or dot. Sized for a short abbreviated name. */
export const LABEL_MIN_GAP_PX = 50;
/** Min horizontal gap (px) before a lane marker shows a tick instead of a dot. */
export const TICK_MIN_GAP_PX = 12;
export const PILL_MAX_WIDTH_PX = 72;

export const MINIMAP_HEIGHT_PX = 32;

/** Discrete lane row / icon growth per zoom tier (see `zoomTierFor` in
 * timeline-data.ts). Deliberately stepped rather than continuous: scaling on
 * every wheel tick would reflow the whole panel's height each frame. Only
 * `laneH`/`iconSize` scale — `curveH`/`GUTTER` stay fixed since the curve
 * itself already grows via the ECharts viewport, and the gutter only holds
 * fixed-size text/icons. */
const ZOOM_TIER_SCALE: readonly [number, number, number] = [1, 1.35, 1.7];

export type TimelineSizes = typeof SIZES;

export type TimelineSizeOverrides = {
  laneH?: number;
  curveH?: number;
};

export type ComputedTimelineLayout = TimelineSizes & {
  gutter: number;
  laneTop: number;
  laneGap: number;
  /** Total height of all lane rows stacked together. */
  lanesHeight: number;
  /** Y offset (px) where the curve grid begins. */
  curveTop: number;
  /** Total height of the absolutely-positioned chart body (lanes + curve). */
  totalHeight: number;
};

export function zoomTierScale(zoomTier: ZoomTier): number {
  return ZOOM_TIER_SCALE[zoomTier] ?? 1;
}

export function clampLaneH(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LANE_H;
  return Math.min(MAX_LANE_H, Math.max(MIN_LANE_H, Math.round(value)));
}

export function clampCurveH(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CURVE_H;
  return Math.min(MAX_CURVE_H, Math.max(MIN_CURVE_H, Math.round(value)));
}

/** Convert a zoom-scaled displayed row height back to the persisted base. */
export function displayedLaneHToBase(
  displayedLaneH: number,
  zoomTier: ZoomTier,
): number {
  return clampLaneH(displayedLaneH / zoomTierScale(zoomTier));
}

export function computeTimelineLayout(
  laneCount: number,
  zoomTier: ZoomTier = 0,
  sizes?: TimelineSizeOverrides,
): ComputedTimelineLayout {
  const scale = zoomTierScale(zoomTier);
  const baseLaneH = clampLaneH(sizes?.laneH ?? SIZES.laneH);
  const curveH = clampCurveH(sizes?.curveH ?? SIZES.curveH);
  const laneH = Math.round(baseLaneH * scale);
  const iconSize = Math.round(SIZES.iconSize * (laneH / SIZES.laneH));
  const lanesHeight = laneCount * laneH;
  const curveTop = LANE_TOP + lanesHeight + LANE_GAP;
  const totalHeight = curveTop + curveH;
  return {
    ...SIZES,
    laneH,
    iconSize,
    curveH,
    gutter: GUTTER,
    laneTop: LANE_TOP,
    laneGap: LANE_GAP,
    lanesHeight,
    curveTop,
    totalHeight,
  };
}
