<script lang="ts">
  // Visual-only layer stacked on top of the gesture surface: crosshair +
  // hover tooltip (replaces ECharts' axis tooltip), plus the live brush
  // preview and the persisted selection highlight. Everything here is
  // `pointer-events: none` - the gesture layer underneath owns all input.
  import {
    clampInstantDpsWindowSec,
    collapseHoverLanePoints,
    dpsValueAt,
    resolveHoverDisplayTimeMs,
    type DamageHitIndex,
    type EncounterTimelineEvent,
  } from "./timeline-data";
  import { formatTimeMs, formatValue } from "./timeline-format";
  import { t } from "$lib/i18n/index.svelte";
  import { SETTINGS } from "$lib/settings-store";
  import type {
    Lane,
    TimelineEventDisplay,
    TimelineHoverPoint,
    TimelineTeammateCurve,
  } from "./timeline-types";

  type Props = {
    lanes: Lane[];
    laneH: number;
    lanesHeight: number;
    startMs: number;
    endMs: number;
    hoverPoint: TimelineHoverPoint | null;
    brushPreviewMs: [number, number] | null;
    selectedRange: [number, number] | null;
    mineHits: DamageHitIndex | null;
    teammateCurves?: TimelineTeammateCurve[];
    showAverageCurve: boolean;
    resolveEvent: (event: EncounterTimelineEvent) => TimelineEventDisplay;
  };

  let {
    lanes,
    laneH,
    lanesHeight,
    startMs,
    endMs,
    hoverPoint,
    brushPreviewMs,
    selectedRange,
    mineHits,
    teammateCurves = [],
    showAverageCurve,
    resolveEvent,
  }: Props = $props();

  const spanMs = $derived(Math.max(1, endMs - startMs));
  const instantWindowMs = $derived(
    clampInstantDpsWindowSec(
      SETTINGS.history.general.state.instantDpsWindowSec,
    ) * 1_000,
  );

  /** Same abbreviation the curve's Y axis uses, so the tooltip and the axis
   * never disagree about a value's unit. Called from the markup, so the
   * settings read is tracked by the template's own effect. */
  function formatCurveValue(value: number): string {
    return formatValue(
      value,
      SETTINGS.history.general.state.abbreviationStyle,
      SETTINGS.history.general.state.abbreviatedDecimalPlaces ?? 1,
    );
  }

  function toLeftPct(timeMs: number): number {
    return ((timeMs - startMs) / spanMs) * 100;
  }

  // ~1.2% of the visible span, floored at 30ms: gives a consistent "hit
  // radius" around the cursor regardless of zoom level.
  const toleranceMs = $derived(Math.max(30, spanMs * 0.012));

  const hoverLaneIndex = $derived.by(() => {
    if (!hoverPoint) return null;
    if (hoverPoint.y < 0 || hoverPoint.y >= lanesHeight) return null;
    const index = Math.floor(hoverPoint.y / laneH);
    return index >= 0 && index < lanes.length ? index : null;
  });

  const hoverLaneEvents = $derived.by(() => {
    if (hoverLaneIndex === null || !hoverPoint) return [];
    const lane = lanes[hoverLaneIndex];
    if (!lane) return [];
    const point = hoverPoint;
    return collapseHoverLanePoints(
      lane.points
        .filter((p) => Math.abs(p.timeMs - point.timeMs) <= toleranceMs)
        .sort(
          (a, b) =>
            Math.abs(a.timeMs - point.timeMs) -
            Math.abs(b.timeMs - point.timeMs),
        )
        .slice(0, 6),
    );
  });

  const hoverCurveInfo = $derived.by(() => {
    if (!hoverPoint || hoverLaneIndex !== null) return null;
    const instant = mineHits
      ? dpsValueAt(mineHits, "instant", hoverPoint.timeMs, instantWindowMs)
      : null;
    const average =
      showAverageCurve && mineHits
        ? dpsValueAt(mineHits, "average", hoverPoint.timeMs, instantWindowMs)
        : null;
    const teammates = teammateCurves.flatMap((row) => {
      const value = dpsValueAt(
        row.hits,
        row.mode,
        hoverPoint.timeMs,
        instantWindowMs,
      );
      return [
        {
          entityUuid: row.entityUuid,
          name: row.name,
          color: row.color,
          mode: row.mode,
          value,
        },
      ];
    });
    if (instant === null && average === null && teammates.length === 0) {
      return null;
    }
    return { instant, average, teammates };
  });

  const showTooltip = $derived(
    hoverPoint !== null &&
      (hoverLaneEvents.length > 0 || hoverCurveInfo !== null),
  );

  const displayTimeMs = $derived(
    resolveHoverDisplayTimeMs(
      hoverPoint?.timeMs ?? 0,
      hoverLaneEvents[0]?.timeMs,
    ),
  );

  const showHeaderTime = $derived(hoverLaneEvents.length <= 1);

  const showPerEventTime = $derived.by(() => {
    const first = hoverLaneEvents[0]?.timeMs;
    return (
      hoverLaneEvents.length > 1 &&
      hoverLaneEvents.some((point) => point.timeMs !== first)
    );
  });

  const tooltipLeftPct = $derived(toLeftPct(displayTimeMs));
  const tooltipFlip = $derived(tooltipLeftPct > 65);

  const brushRectStyle = $derived.by(() => {
    if (!brushPreviewMs) return null;
    const [a, b] = brushPreviewMs;
    const left = toLeftPct(Math.min(a, b));
    const width = toLeftPct(Math.max(a, b)) - left;
    return `left: ${left}%; width: ${width}%`;
  });

  const selectionRectStyle = $derived.by(() => {
    if (!selectedRange) return null;
    const left = toLeftPct(selectedRange[0]);
    const width = toLeftPct(selectedRange[1]) - left;
    if (width <= 0) return null;
    return `left: ${Math.max(0, left)}%; width: ${width}%`;
  });
</script>

<div class="pointer-events-none absolute inset-0 overflow-hidden">
  {#if selectionRectStyle}
    <div class="tl-selection-rect" style={selectionRectStyle}></div>
  {/if}
  {#if brushRectStyle}
    <div class="tl-brush-rect" style={brushRectStyle}></div>
  {/if}
  {#if hoverPoint}
    <div class="tl-crosshair" style="left: {tooltipLeftPct}%"></div>
  {/if}
  {#if showTooltip && hoverPoint}
    <div
      class="tl-tooltip"
      class:tl-tooltip--flip={tooltipFlip}
      style="left: {tooltipLeftPct}%; top: {hoverPoint.y}px"
    >
      {#if showHeaderTime}
        <div class="tl-tooltip-time">{formatTimeMs(displayTimeMs, true)}</div>
      {/if}
      {#if hoverLaneIndex !== null}
        {#each hoverLaneEvents as point (point.event.sequence)}
          {@const display = resolveEvent(point.event)}
          <div class="tl-tooltip-row">
            {#if display.iconPath}
              <img src={display.iconPath} alt="" class="tl-tooltip-icon" />
            {/if}
            <span class="tl-tooltip-name">{display.name}</span>
            {#if showPerEventTime}
              <span class="tl-tooltip-event-time"
                >{formatTimeMs(point.timeMs, true)}</span
              >
            {/if}
          </div>
        {/each}
      {:else if hoverCurveInfo}
        {#if hoverCurveInfo.instant !== null}
          <div class="tl-tooltip-row">
            <span class="tl-tooltip-dot"></span>
            {t("history.timeline.series.instant")}:
            <b>{formatCurveValue(hoverCurveInfo.instant)}</b>
          </div>
        {/if}
        {#if hoverCurveInfo.average !== null}
          <div class="tl-tooltip-row">
            <span class="tl-tooltip-dot tl-tooltip-dot--muted"></span>
            {t("history.timeline.series.average")}:
            <b>{formatCurveValue(hoverCurveInfo.average)}</b>
          </div>
        {/if}
        {#each hoverCurveInfo.teammates as teammate (teammate.entityUuid)}
          <div class="tl-tooltip-row">
            <span class="tl-tooltip-dot" style="background: {teammate.color}"
            ></span>
            <span class="tl-tooltip-name">{teammate.name}</span>
            <span class="tl-tooltip-mode">
              {teammate.mode === "instant"
                ? t("history.timeline.curves.modeInstant")
                : t("history.timeline.curves.modeAverage")}
            </span>
            <b>{formatCurveValue(teammate.value)}</b>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .tl-crosshair {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(148, 163, 184, 0.35);
    transform: translateX(-0.5px);
  }

  .tl-brush-rect {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(96, 165, 250, 0.08);
    border-left: 1px solid rgba(96, 165, 250, 0.55);
    border-right: 1px solid rgba(96, 165, 250, 0.55);
  }

  .tl-selection-rect {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(96, 165, 250, 0.06);
    border-left: 1px solid rgba(96, 165, 250, 0.4);
    border-right: 1px solid rgba(96, 165, 250, 0.4);
  }

  .tl-tooltip {
    position: absolute;
    z-index: 30;
    min-width: 120px;
    max-width: 220px;
    transform: translate(12px, -50%);
    background: var(--tl-tooltip-bg);
    border: 1px solid var(--tl-tooltip-border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 11px;
    color: var(--tl-fg);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .tl-tooltip--flip {
    transform: translate(calc(-100% - 12px), -50%);
  }

  .tl-tooltip-time {
    font-weight: 600;
    margin-bottom: 2px;
  }

  .tl-tooltip-row {
    display: flex;
    align-items: center;
    gap: 4px;
    line-height: 1.5;
  }

  .tl-tooltip-event-time {
    margin-left: auto;
    color: var(--tl-fg-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .tl-tooltip-mode {
    color: var(--tl-fg-muted);
    font-size: 10px;
  }

  .tl-tooltip-icon {
    /* Bigger than the in-lane marker (which shrinks/hides at low zoom) so
       the tooltip stays a reliable fallback for "what skill is this" even
       when the timeline itself is too dense to show icons. */
    width: 32px;
    height: 32px;
    border-radius: 4px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .tl-tooltip-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--tl-mine);
  }

  .tl-tooltip-dot--muted {
    background: var(--tl-average);
  }
</style>
