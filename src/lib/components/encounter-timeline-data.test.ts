import { describe, expect, it } from "vitest";
import {
  foldEncounterDamageBuckets,
  normalizeEncounterBrushRange,
  toCumulativeDpsCurve,
  toRollingDpsCurve,
  type EncounterChart,
  type EncounterChartSeries,
} from "./encounter-timeline-data";

function series(
  values: Partial<EncounterChartSeries> &
    Pick<EncounterChartSeries, "entityUuid" | "metric">,
): EncounterChartSeries {
  const offsetsMs = values.offsetsMs ?? [];
  const zeros = offsetsMs.map(() => 0);
  return {
    entityUuid: values.entityUuid,
    metric: values.metric,
    offsetsMs,
    totals: values.totals ?? zeros,
  };
}

describe("foldEncounterDamageBuckets", () => {
  it("sums sparse damage series per entity and ignores heal/taken rows", () => {
    const chart: EncounterChart = {
      durationMs: 1_500,
      bucketMs: 1_000,
      series: [
        series({
          entityUuid: "a",
          metric: 0,
          offsetsMs: [0, 1_000],
          totals: [100, 100],
        }),
        series({
          entityUuid: "a",
          metric: 0,
          offsetsMs: [0],
          totals: [50],
        }),
        series({
          entityUuid: "b",
          metric: 0,
          offsetsMs: [0],
          totals: [25],
        }),
        series({
          entityUuid: "a",
          metric: 1,
          offsetsMs: [0],
          totals: [40],
        }),
        series({
          entityUuid: "a",
          metric: 2,
          offsetsMs: [0],
          totals: [30],
        }),
      ],
    };

    const result = foldEncounterDamageBuckets(chart);

    expect(result.durationMs).toBe(1_500);
    expect(result.bucketMs).toBe(1_000);
    expect(result.perEntityBuckets.get("a")).toEqual([150, 100]);
    expect(result.perEntityBuckets.get("b")).toEqual([25, 0]);
  });

  it("fills absent buckets with zeroes", () => {
    const result = foldEncounterDamageBuckets({
      durationMs: 3_000,
      bucketMs: 1_000,
      series: [
        series({
          entityUuid: "a",
          metric: 0,
          offsetsMs: [1_000],
          totals: [100],
        }),
      ],
    });

    expect(result.perEntityBuckets.get("a")).toEqual([0, 100, 0]);
  });

  it("drops out-of-range and non-finite samples", () => {
    const result = foldEncounterDamageBuckets({
      durationMs: 2_000,
      bucketMs: 1_000,
      series: [
        series({
          entityUuid: "a",
          metric: 0,
          offsetsMs: [-1, 0, 2_000, Number.NaN],
          totals: [1, 100, 2, Number.NaN],
        }),
      ],
    });

    expect(result.perEntityBuckets.get("a")).toEqual([100, 0]);
  });
});

describe("toRollingDpsCurve", () => {
  it("uses the actual bucket count as divisor while the window is filling", () => {
    // 1s buckets, 10s window: the first 9 points divide by (index + 1)
    // buckets, not by 10.
    const totals = [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const curve = toRollingDpsCurve(totals, 1_000, 12_000);

    expect(curve[0]).toEqual([1_000, 100]);
    expect(curve[1]).toEqual([2_000, 50]);
    expect(curve[9]).toEqual([10_000, 10]);
  });

  it("evicts damage once it leaves the trailing window", () => {
    const totals = [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const curve = toRollingDpsCurve(totals, 1_000, 12_000);

    // The window is left-closed right-open: at 10s it covers [0s, 10s) and
    // still contains the 0s hit; at 11s it covers [1s, 11s) and the hit is
    // gone.
    expect(curve[9]).toEqual([10_000, 10]);
    expect(curve[10]).toEqual([11_000, 0]);
  });

  it("sums concurrent hits inside the window", () => {
    const totals = [0, 0, 0, 0, 0, 100, 0, 0, 0, 200, 0, 0];
    const curve = toRollingDpsCurve(totals, 1_000, 12_000);

    expect(curve[9]).toEqual([10_000, 30]);
  });

  it("clamps the final point to durationMs", () => {
    // 2.5s duration with 1s buckets: the third bucket only covers 0.5s of
    // wall-clock time, but the window divisor stays bucket-based.
    const curve = toRollingDpsCurve([0, 0, 100], 1_000, 2_500);

    expect(curve[2]?.[0]).toBe(2_500);
  });
});

describe("toCumulativeDpsCurve", () => {
  it("divides the running total by elapsed time", () => {
    const curve = toCumulativeDpsCurve([100, 0, 300], 1_000, 3_000);

    expect(curve).toEqual([
      [1_000, 100],
      [2_000, 50],
      [3_000, 400 / 3],
    ]);
  });

  it("ends at total damage over durationMs", () => {
    const totals = [10, 20, 30, 40];
    const curve = toCumulativeDpsCurve(totals, 1_000, 4_000);

    expect(curve.at(-1)).toEqual([4_000, 25]);
  });
});

describe("rolling vs cumulative", () => {
  it("coincide when the fight is shorter than the rolling window", () => {
    // 5s fight, 1s buckets: the 10s window never fills, so both curves divide
    // the same running sum by the same covered time.
    const totals = [100, 50, 0, 200, 0];
    const rolling = toRollingDpsCurve(totals, 1_000, 5_000);
    const cumulative = toCumulativeDpsCurve(totals, 1_000, 5_000);

    expect(rolling).toEqual(cumulative);
  });
});

describe("normalizeEncounterBrushRange", () => {
  it("returns a clamped half-open integer range", () => {
    expect(normalizeEncounterBrushRange([120.2, 980.1], 1_000)).toEqual([
      120, 981,
    ]);
    expect(normalizeEncounterBrushRange([900.8, 100.2], 1_000)).toEqual([
      100, 901,
    ]);
    expect(normalizeEncounterBrushRange([-20, 2_000], 1_000)).toEqual([
      0, 1_000,
    ]);
  });

  it("keeps a zero-width brush queryable and rejects non-finite input", () => {
    expect(normalizeEncounterBrushRange([500, 500], 1_000)).toEqual([500, 501]);
    expect(normalizeEncounterBrushRange([Number.NaN, 500], 1_000)).toBeNull();
  });
});
