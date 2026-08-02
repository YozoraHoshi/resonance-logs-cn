import type { HistoryCastKind } from "$lib/bindings";

export type EncounterChartSeries = {
  entityUuid: string;
  metric: number;
  offsetsMs: number[];
  totals: number[];
};

export type EncounterChart = {
  durationMs: number;
  bucketMs: number;
  series: EncounterChartSeries[];
};

export type EncounterTimelineEvent = {
  tsOffsetMs: number;
  casterUuid: string;
  skillId: number;
  kind: HistoryCastKind;
};

const METRIC_DAMAGE = 0;

function positiveInteger(value: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(1, Math.round(numeric))
    : 1;
}

export type EncounterCurvePoint = [offsetMs: number, valuePerSecond: number];

export type EncounterDamageBuckets = {
  durationMs: number;
  bucketMs: number;
  /** Per-entity damage totals by bucket index; the raw fact curves derive from. */
  perEntityBuckets: Map<string, number[]>;
};

/** Folds a sparse column-oriented chart DTO into dense per-entity damage buckets. */
export function foldEncounterDamageBuckets(
  chart: EncounterChart,
): EncounterDamageBuckets {
  const durationMs = positiveInteger(chart.durationMs);
  const bucketMs = positiveInteger(chart.bucketMs);
  const bucketCount = Math.max(1, Math.ceil(durationMs / bucketMs));
  const perEntityTotals = new Map<string, number[]>();

  for (const series of chart.series) {
    if (series.metric !== METRIC_DAMAGE) continue;

    let entityTotals = perEntityTotals.get(series.entityUuid);
    if (!entityTotals) {
      entityTotals = new Array<number>(bucketCount).fill(0);
      perEntityTotals.set(series.entityUuid, entityTotals);
    }

    for (let index = 0; index < series.offsetsMs.length; index += 1) {
      const offsetMs = Number(series.offsetsMs[index]);
      if (!Number.isFinite(offsetMs) || offsetMs < 0) continue;
      const bucketIndex = Math.floor(offsetMs / bucketMs);
      if (bucketIndex < 0 || bucketIndex >= bucketCount) continue;

      const total = Number(series.totals[index] ?? 0);
      if (!Number.isFinite(total)) continue;
      entityTotals[bucketIndex] = (entityTotals[bucketIndex] ?? 0) + total;
    }
  }

  return { durationMs, bucketMs, perEntityBuckets: perEntityTotals };
}

/** Instant-DPS trailing window length. Quantized by bucketMs (duration / 600). */
const ROLLING_WINDOW_MS = 10_000;

export function toRollingDpsCurve(
  totals: number[],
  bucketMs: number,
  durationMs: number,
): EncounterCurvePoint[] {
  const windowBuckets = Math.max(
    1,
    Math.min(totals.length, Math.round(ROLLING_WINDOW_MS / bucketMs)),
  );
  const points: EncounterCurvePoint[] = [];
  let sum = 0;
  for (let index = 0; index < totals.length; index += 1) {
    sum += totals[index] ?? 0;
    if (index >= windowBuckets) sum -= totals[index - windowBuckets] ?? 0;
    // Numerator is an integer number of buckets; use the same count as the
    // divisor so bucket-width quantization cannot skew the value. During the
    // opening ramp the window is not yet full, so dividing by the full window
    // would dilute the first 10s into a fake slope.
    const coveredMs = Math.min(index + 1, windowBuckets) * bucketMs;
    points.push([
      Math.min(durationMs, (index + 1) * bucketMs),
      (sum * 1_000) / coveredMs,
    ]);
  }
  return points;
}

export function toCumulativeDpsCurve(
  totals: number[],
  bucketMs: number,
  durationMs: number,
): EncounterCurvePoint[] {
  let sum = 0;
  return totals.map((total, index) => {
    sum += total ?? 0;
    const elapsedMs = Math.min(durationMs, (index + 1) * bucketMs);
    return [elapsedMs, (sum * 1_000) / elapsedMs];
  });
}

/** Converts a continuous brush extent into a valid half-open millisecond range. */
export function normalizeEncounterBrushRange(
  coordRange: readonly [number, number],
  durationMs: number,
): [number, number] | null {
  if (!Number.isFinite(coordRange[0]) || !Number.isFinite(coordRange[1])) {
    return null;
  }

  const normalizedDurationMs = positiveInteger(durationMs);
  const low = Math.min(coordRange[0], coordRange[1]);
  const high = Math.max(coordRange[0], coordRange[1]);
  const startMs = Math.min(
    normalizedDurationMs - 1,
    Math.max(0, Math.floor(low)),
  );
  const endMs = Math.min(
    normalizedDurationMs,
    Math.max(startMs + 1, Math.ceil(high)),
  );
  return endMs > startMs ? [startMs, endMs] : null;
}
