import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURVE_H,
  DEFAULT_LANE_H,
  MAX_CURVE_H,
  MAX_LANE_H,
  MIN_CURVE_H,
  MIN_LANE_H,
  clampCurveH,
  clampLaneH,
  computeTimelineLayout,
  displayedLaneHToBase,
} from "./timeline-layout";

describe("computeTimelineLayout", () => {
  it("uses the base sizes at zoom tier 0", () => {
    const layout = computeTimelineLayout(3, 0);
    expect(layout.laneH).toBe(44);
    expect(layout.iconSize).toBe(24);
    expect(layout.lanesHeight).toBe(132);
    expect(layout.curveH).toBe(300);
  });

  it("scales laneH/iconSize up at zoom tier 1 and 2, keeping curveH fixed", () => {
    const tier0 = computeTimelineLayout(3, 0);
    const tier1 = computeTimelineLayout(3, 1);
    const tier2 = computeTimelineLayout(3, 2);

    expect(tier1.laneH).toBeGreaterThan(tier0.laneH);
    expect(tier1.iconSize).toBeGreaterThan(tier0.iconSize);
    expect(tier2.laneH).toBeGreaterThan(tier1.laneH);
    expect(tier2.iconSize).toBeGreaterThan(tier1.iconSize);

    // The curve grid itself already grows via the ECharts viewport, so its
    // slot height must not also scale with the discrete zoom tier.
    expect(tier1.curveH).toBe(tier0.curveH);
    expect(tier2.curveH).toBe(tier0.curveH);
  });

  it("defaults to zoom tier 0 when omitted", () => {
    const withDefault = computeTimelineLayout(2);
    const explicitTier0 = computeTimelineLayout(2, 0);
    expect(withDefault).toEqual(explicitTier0);
  });

  it("stacks the curve below however many lanes there are", () => {
    const two = computeTimelineLayout(2, 0);
    const five = computeTimelineLayout(5, 0);
    expect(five.lanesHeight - two.lanesHeight).toBe(3 * two.laneH);
    expect(five.curveTop - two.curveTop).toBe(3 * two.laneH);
    expect(five.totalHeight).toBe(five.curveTop + five.curveH);
  });

  it("uses a custom base laneH/curveH at zoom tier 0", () => {
    const layout = computeTimelineLayout(2, 0, { laneH: 60, curveH: 400 });
    expect(layout.laneH).toBe(60);
    expect(layout.curveH).toBe(400);
    expect(layout.lanesHeight).toBe(120);
    expect(layout.iconSize).toBe(Math.round((24 * 60) / 44));
    expect(layout.totalHeight).toBe(layout.curveTop + 400);
  });

  it("scales a custom base laneH with zoom, leaving custom curveH fixed", () => {
    const overrides = { laneH: 60, curveH: 400 };
    const tier1 = computeTimelineLayout(2, 1, overrides);
    const tier2 = computeTimelineLayout(2, 2, overrides);

    expect(tier1.laneH).toBe(Math.round(60 * 1.35));
    expect(tier2.laneH).toBe(Math.round(60 * 1.7));
    expect(tier1.curveH).toBe(400);
    expect(tier2.curveH).toBe(400);
    expect(tier1.iconSize).toBe(
      Math.round((24 * tier1.laneH) / DEFAULT_LANE_H),
    );
  });

  it("clamps custom sizes to the allowed range", () => {
    const tooSmall = computeTimelineLayout(1, 0, { laneH: 8, curveH: 10 });
    expect(tooSmall.laneH).toBe(MIN_LANE_H);
    expect(tooSmall.curveH).toBe(MIN_CURVE_H);

    const tooLarge = computeTimelineLayout(1, 0, { laneH: 400, curveH: 2000 });
    expect(tooLarge.laneH).toBe(MAX_LANE_H);
    expect(tooLarge.curveH).toBe(MAX_CURVE_H);
  });
});

describe("clampLaneH / clampCurveH", () => {
  it("falls back to defaults for non-finite values", () => {
    expect(clampLaneH(Number.NaN)).toBe(DEFAULT_LANE_H);
    expect(clampCurveH(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CURVE_H);
  });
});

describe("displayedLaneHToBase", () => {
  it("round-trips a zoomed displayed height back to the persisted base", () => {
    const displayed = Math.round(60 * 1.7);
    expect(displayedLaneHToBase(displayed, 2)).toBe(60);
  });
});
