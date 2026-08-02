<script lang="ts">
  // Per-encounter timeline panel, rendered as a self-contained dark "chart
  // island" that does not follow the global color theme (canvas charts cannot
  // read CSS variables; the semantic palette is tuned for a dark surface).
  //
  // Structure, top to bottom:
  //   - header bar: curve legend toggles + teammate lane selector;
  //   - swim-lane grid: one row per boss caster, the local player's key
  //     casts, and one row per *selected* teammate (default:
  //     healing/concerto supports);
  //   - curve grid: the local player's instant + average DPS curves drawn in
  //     one coordinate system;
  //   - selection bar: active brush range + clear button.
  // Brushing a range on either grid drives the range recount in the parent.
  import * as echarts from "echarts/core";
  import { CustomChart, LineChart } from "echarts/charts";
  import {
    BrushComponent,
    DataZoomComponent,
    GridComponent,
    ToolboxComponent,
    TooltipComponent,
  } from "echarts/components";
  import { CanvasRenderer } from "echarts/renderers";
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import Clock3Icon from "@lucide/svelte/icons/clock-3";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import UsersIcon from "@lucide/svelte/icons/users";
  import {
    foldEncounterDamageBuckets,
    normalizeEncounterBrushRange,
    toCumulativeDpsCurve,
    toRollingDpsCurve,
    type EncounterChart,
    type EncounterCurvePoint,
    type EncounterTimelineEvent,
  } from "$lib/components/encounter-timeline-data";
  import { getClassColorRaw, getClassIcon } from "$lib/utils.svelte";
  import { t } from "$lib/i18n/index.svelte";

  echarts.use([
    CustomChart,
    LineChart,
    BrushComponent,
    DataZoomComponent,
    GridComponent,
    ToolboxComponent,
    TooltipComponent,
    CanvasRenderer,
  ]);

  /** Player metadata needed to build cast lanes and DPS curves. */
  export type TimelinePlayerMeta = {
    entityUuid: string;
    /** Display name (already privacy-filtered by the parent). */
    name: string;
    className: string;
    classSpecName: string;
    isLocalPlayer: boolean;
  };

  /** Display strings/icon for one lane marker, resolved by the parent. */
  export type TimelineEventDisplay = {
    name: string;
    /** null when the marker has no artwork (boss skills): rendered as a text pill. */
    iconPath: string | null;
    casterName: string;
  };

  /** Boss caster identity for labelling one lane per boss. */
  export type TimelineBossMeta = {
    entityUuid: string;
    name: string;
  };

  type Props = {
    chart: EncounterChart;
    events: EncounterTimelineEvent[];
    /** Party members shown in the lanes / curves. */
    players?: TimelinePlayerMeta[];
    /** Boss casters used to label their lanes; unknown casters fall back to a
     * generic label. */
    bosses?: TimelineBossMeta[];
    /** Whether exact millisecond recount is available for this encounter. */
    selectionEnabled?: boolean;
    /** Whether the parent is recounting the currently selected range. */
    selectionPending?: boolean;
    /** Selected half-open [startMs, endMs) range, null when unselected. */
    selectedRange?: [number, number] | null;
    /** Resolve the display strings/icon for one marker event. */
    resolveEvent: (event: EncounterTimelineEvent) => TimelineEventDisplay;
  };

  let {
    chart,
    events,
    players = [],
    bosses = [],
    selectionEnabled = true,
    selectionPending = false,
    selectedRange = $bindable(null),
    resolveEvent,
  }: Props = $props();

  /** Support classes whose key casts (heal / concerto) are shown by default. */
  const DEFAULT_LANE_CLASSES = new Set(["Verdant Oracle", "Beat Performer"]);

  // Layout constants (px). The HTML gutter/backdrop align with the chart
  // grids because every row height is fixed.
  const GUTTER = 148;
  const LANE_TOP = 10;
  const LANE_H = 30;
  const LANE_GAP = 14;
  const CURVE_H = 168;
  const BOTTOM_H = 52;

  // ---- Fixed dark palette ("chart island", decoupled from app theme) -----
  // Mirrors the --tl-* CSS variables declared on the panel root below.
  const TL_FG = "#e7e9ee";
  const TL_FG_MUTED = "#8b93a4";
  const TL_GRID = "rgba(148,163,184,0.10)";
  const TL_AXIS = "rgba(148,163,184,0.20)";
  const TL_TOOLTIP_BG = "rgba(15,18,24,0.94)";
  const TL_TOOLTIP_BORDER = "rgba(148,163,184,0.22)";

  const COLOR_MINE = "#60a5fa";
  const COLOR_BOSS = "#f87171";
  const FALLBACK_PLAYER_COLOR = "#a78bfa";

  /** Min horizontal gap (px) before a lane event may show a labelled pill.
   * Sized to a 4-CJK-char pill (4 * 10.5 + 14 padding) so abbreviated boss
   * skill names stay visible at moderate density. */
  const LABEL_MIN_GAP = 50;
  /** Min horizontal gap (px) before a lane event shows a tick instead of a dot. */
  const TICK_MIN_GAP = 12;
  const PILL_MAX_W = 56;
  /** Square marker icon edge length (px). */
  const ICON_SIZE = 18;

  type LanePoint = {
    value: [number, number];
    event: EncounterTimelineEvent;
  };

  type Lane =
    | { key: string; type: "boss"; name: string; points: LanePoint[] }
    | {
        key: string;
        type: "mine";
        player: TimelinePlayerMeta;
        points: LanePoint[];
      }
    | {
        key: string;
        type: "teammate";
        player: TimelinePlayerMeta;
        points: LanePoint[];
      };

  // ---- Curve visibility toggles (HTML legend chips) -----------------------
  // The average line is a reference baseline and can be hidden; the instant
  // line is always on.
  let showAverageCurve = $state(true);

  // ---- Teammate lane selection --------------------------------------------
  // null = "use the default" (support players); a string[] once the user has
  // interacted with the selector.
  let manualTeammateSelection = $state<string[] | null>(null);
  let selectorOpen = $state(false);

  // The DTO is sparse and column-oriented. Fold it once into per-entity
  // damage buckets; curves are built on demand from those buckets so the
  // cost stays independent of party size.
  const damageBuckets = $derived(foldEncounterDamageBuckets(chart));
  const chartDurationMs = $derived(damageBuckets.durationMs);
  const chartBucketMs = $derived(damageBuckets.bucketMs);
  const perEntityBuckets = $derived(damageBuckets.perEntityBuckets);

  const localPlayer = $derived(players.find((p) => p.isLocalPlayer) ?? null);

  const mineBuckets = $derived.by(() =>
    localPlayer ? (perEntityBuckets.get(localPlayer.entityUuid) ?? null) : null,
  );

  const mineInstantCurve = $derived.by(() =>
    mineBuckets
      ? toRollingDpsCurve(mineBuckets, chartBucketMs, chartDurationMs)
      : null,
  );

  const mineAverageCurve = $derived.by(() =>
    mineBuckets
      ? toCumulativeDpsCurve(mineBuckets, chartBucketMs, chartDurationMs)
      : null,
  );

  function clampEventOffsetMs(ev: EncounterTimelineEvent): number {
    const offsetMs = Number(ev.tsOffsetMs);
    if (!Number.isFinite(offsetMs)) return 0;
    return Math.min(chartDurationMs, Math.max(0, offsetMs));
  }

  /** Boss-cast events grouped by caster uuid, one lane per caster. */
  let bossEventsByCaster = $derived.by(() => {
    const map = new SvelteMap<string, EncounterTimelineEvent[]>();
    for (const ev of events) {
      if (ev.kind !== "boss_skill") continue;
      const list = map.get(ev.casterUuid) ?? [];
      list.push(ev);
      map.set(ev.casterUuid, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.tsOffsetMs - b.tsOffsetMs);
    }
    return map;
  });

  let bossNameByUuid = $derived.by(() => {
    const map = new SvelteMap<string, string>();
    for (const boss of bosses) {
      if (!boss.name || map.has(boss.entityUuid)) continue;
      map.set(boss.entityUuid, boss.name);
    }
    return map;
  });

  /** Player-cast events (fantasy + key skill) grouped by caster uuid. */
  let playerEventsByCaster = $derived.by(() => {
    const map = new SvelteMap<string, EncounterTimelineEvent[]>();
    for (const ev of events) {
      if (ev.kind === "boss_skill") continue;
      const list = map.get(ev.casterUuid) ?? [];
      list.push(ev);
      map.set(ev.casterUuid, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.tsOffsetMs - b.tsOffsetMs);
    }
    return map;
  });

  /** Non-local players that have casts or damage worth a lane/curve. */
  let teammates = $derived.by(() => {
    return players.filter((p) => {
      if (localPlayer && p.entityUuid === localPlayer.entityUuid) return false;
      return (
        (playerEventsByCaster.get(p.entityUuid)?.length ?? 0) > 0 ||
        (perEntityBuckets.get(p.entityUuid)?.some((total) => total > 0) ??
          false)
      );
    });
  });

  /** Default lane selection: supports that actually cast key skills. */
  let defaultTeammateUuids = $derived(
    teammates
      .filter(
        (p) =>
          DEFAULT_LANE_CLASSES.has(p.className) &&
          (playerEventsByCaster.get(p.entityUuid)?.length ?? 0) > 0,
      )
      .map((p) => p.entityUuid),
  );

  let selectedTeammateUuids = $derived(
    manualTeammateSelection ?? defaultTeammateUuids,
  );

  let selectedTeammates = $derived(
    teammates.filter((p) => selectedTeammateUuids.includes(p.entityUuid)),
  );

  function toggleTeammate(entityUuid: string) {
    const current = manualTeammateSelection ?? [...selectedTeammateUuids];
    manualTeammateSelection = current.includes(entityUuid)
      ? current.filter((uuid) => uuid !== entityUuid)
      : [...current, entityUuid];
  }

  function selectAllTeammates() {
    manualTeammateSelection = teammates.map((p) => p.entityUuid);
  }

  function clearTeammates() {
    manualTeammateSelection = [];
  }

  function toPoints(
    list: EncounterTimelineEvent[],
    laneIndex: number,
  ): LanePoint[] {
    return list.map((ev) => ({
      value: [clampEventOffsetMs(ev), laneIndex],
      event: ev,
    }));
  }

  let lanes = $derived.by<Lane[]>(() => {
    const result: Lane[] = [];
    // One lane per boss caster, ordered by its first cast so the boss that
    // engages first sits on top.
    const bossCasters = [...bossEventsByCaster].sort(
      (a, b) => (a[1][0]?.tsOffsetMs ?? 0) - (b[1][0]?.tsOffsetMs ?? 0),
    );
    for (const [casterUuid, list] of bossCasters) {
      result.push({
        key: `boss-${casterUuid}`,
        type: "boss",
        name:
          bossNameByUuid.get(casterUuid) ?? t("history.timeline.lanes.boss"),
        points: toPoints(list, result.length),
      });
    }
    if (localPlayer) {
      result.push({
        key: "mine",
        type: "mine",
        player: localPlayer,
        points: toPoints(
          playerEventsByCaster.get(localPlayer.entityUuid) ?? [],
          result.length,
        ),
      });
    }
    for (const player of selectedTeammates) {
      result.push({
        key: `teammate-${player.entityUuid}`,
        type: "teammate",
        player,
        points: toPoints(
          playerEventsByCaster.get(player.entityUuid) ?? [],
          result.length,
        ),
      });
    }
    return result;
  });

  let mineLaneIndex = $derived(lanes.findIndex((l) => l.type === "mine"));

  let lanesHeight = $derived(lanes.length * LANE_H);
  let curveTop = $derived(LANE_TOP + lanesHeight + LANE_GAP);
  let totalHeight = $derived(curveTop + CURVE_H + BOTTOM_H);

  function laneColor(lane: Lane): string {
    switch (lane.type) {
      case "boss":
        return COLOR_BOSS;
      case "mine":
        return COLOR_MINE;
      case "teammate":
        return lane.player.className
          ? getClassColorRaw(lane.player.className, lane.player.classSpecName)
          : FALLBACK_PLAYER_COLOR;
    }
  }

  function playerColor(player: TimelinePlayerMeta): string {
    return player.className
      ? getClassColorRaw(player.className, player.classSpecName)
      : FALLBACK_PLAYER_COLOR;
  }

  function formatTimeMs(valueMs: number, includeMillis = false): string {
    const totalMs = Math.max(0, Math.round(valueMs));
    const totalSeconds = Math.floor(totalMs / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    if (!includeMillis) return `${minutes}:${seconds}`;
    const millis = (totalMs % 1_000).toString().padStart(3, "0");
    return `${minutes}:${seconds}.${millis}`;
  }

  function formatValue(value: number): string {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return `${Math.round(value)}`;
  }

  function escapeHtml(value: unknown): string {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1] ?? "0", 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function estimateTextWidth(text: string): number {
    let w = 0;
    for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0xff ? 10.5 : 5.6;
    return w;
  }

  function truncateToWidth(text: string, maxW: number): string {
    if (estimateTextWidth(text) <= maxW) return text;
    let out = "";
    for (const ch of text) {
      if (estimateTextWidth(out + ch) > maxW - 8) break;
      out += ch;
    }
    return `${out}…`;
  }

  type RenderItemParams = { dataIndex: number };
  type RenderItemApi = {
    value: (dim: number) => number;
    coord: (value: [number, number]) => [number, number];
  };

  /** Icon marker for a player cast: fantasy casts are circular (matching the
   * live window), key skills are rounded squares, so the marker category is
   * encoded by shape rather than color alone. */
  function makeIconMarker(
    x: number,
    y: number,
    iconPath: string,
    isFantasy: boolean,
    stroke: string,
    isMine: boolean,
  ) {
    const half = ICON_SIZE / 2;
    const radius = isFantasy ? half : 4;
    const frame = {
      x: x - half,
      y: y - half,
      width: ICON_SIZE,
      height: ICON_SIZE,
      r: radius,
    };
    return {
      type: "group",
      children: [
        {
          type: "group",
          clipPath: { type: "rect", shape: frame },
          children: [
            {
              type: "rect",
              shape: {
                x: x - half,
                y: y - half,
                width: ICON_SIZE,
                height: ICON_SIZE,
              },
              style: { fill: "#0f1218" },
            },
            {
              type: "image",
              style: {
                image: iconPath,
                x: x - half,
                y: y - half,
                width: ICON_SIZE,
                height: ICON_SIZE,
              },
            },
          ],
        },
        {
          type: "rect",
          shape: frame,
          style: {
            fill: "none",
            stroke: hexToRgba(stroke, isMine ? 0.9 : 0.55),
            lineWidth: isMine ? 1.5 : 1,
            shadowBlur: isMine ? 5 : 0,
            shadowColor: isMine ? hexToRgba(stroke, 0.5) : "transparent",
          },
        },
      ],
    };
  }

  /**
   * Render one lane event. Boss lanes degrade to tick/dot under density (no
   * artwork); player lanes always render the skill/fantasy icon, letting
   * overlapping markers stack — the axis tooltip lists every event at the
   * hovered timestamp.
   */
  function makeLaneRenderItem(lane: Lane) {
    const stroke = laneColor(lane);
    const points = lane.points;
    const isMine = lane.type === "mine";
    const isBoss = lane.type === "boss";

    return (params: RenderItemParams, api: RenderItemApi) => {
      const point = points[params.dataIndex];
      if (!point) return { type: "group", children: [] };
      const ev = point.event;
      const sec = api.value(0);
      const laneIdx = api.value(1);
      const [x, y] = api.coord([sec, laneIdx]);

      const isFantasy = ev.kind === "fantasy";
      const display = resolveEvent(ev);

      if (!isBoss && display.iconPath !== null) {
        return makeIconMarker(
          x,
          y,
          display.iconPath,
          isFantasy,
          stroke,
          isMine,
        );
      }

      const prev = points[params.dataIndex - 1];
      const next = points[params.dataIndex + 1];
      const prevGap = prev
        ? x - api.coord([prev.value[0], laneIdx])[0]
        : Number.POSITIVE_INFINITY;
      const nextGap = next
        ? api.coord([next.value[0], laneIdx])[0] - x
        : Number.POSITIVE_INFINITY;
      const avail = Math.min(prevGap, nextGap);

      if (avail >= LABEL_MIN_GAP) {
        const name = truncateToWidth(display.name, PILL_MAX_W - 14);
        const w = Math.min(PILL_MAX_W, estimateTextWidth(name) + 14);
        return {
          type: "group",
          children: [
            {
              type: "rect",
              shape: { x: x - w / 2, y: y - 8, width: w, height: 16, r: 3 },
              style: {
                fill: hexToRgba(stroke, 0.1),
                stroke,
                lineWidth: 1,
              },
            },
            {
              type: "text",
              style: {
                x,
                y: y + 0.5,
                text: name,
                align: "center",
                verticalAlign: "middle",
                fontSize: 9,
                fill: TL_FG,
              },
            },
          ],
        };
      }

      if (avail >= TICK_MIN_GAP) {
        return {
          type: "rect",
          shape: { x: x - 1.5, y: y - 6, width: 3, height: 12, r: 1 },
          style: { fill: hexToRgba(stroke, isFantasy ? 0.95 : 0.6) },
        };
      }

      return {
        type: "circle",
        shape: { cx: x, cy: y, r: 2 },
        style: { fill: hexToRgba(stroke, 0.8) },
      };
    };
  }

  function eventTooltipHtml(ev: EncounterTimelineEvent): string {
    const display = resolveEvent(ev);
    const icon =
      display.iconPath === null
        ? null
        : `<img src="${escapeHtml(display.iconPath)}" width="20" height="20" alt="" style="border-radius: 4px; vertical-align: middle; margin-right: 4px;"/>`;
    return [
      `${icon ?? ""}<b>${escapeHtml(display.name)}</b>`,
      display.casterName ? escapeHtml(display.casterName) : null,
      formatTimeMs(ev.tsOffsetMs, true),
    ]
      .filter((row) => row !== null)
      .join("<br/>");
  }

  function lineSeriesBase(
    name: string,
    data: EncounterCurvePoint[],
    color: string,
  ) {
    return {
      name,
      type: "line",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color },
      itemStyle: { color },
    };
  }

  function buildOption(): echarts.EChartsCoreOption {
    const laneSeriesList = lanes.map((lane) => ({
      name: lane.key,
      type: "custom" as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      clip: true,
      renderItem: makeLaneRenderItem(lane),
      data: lane.points,
      z: 5,
    }));

    const curveSeries: Record<string, unknown>[] = [];

    // Same hue for both self curves: they are two readings of one player,
    // not two entities. The average line recedes via dash + transparency.
    if (showAverageCurve && mineAverageCurve) {
      curveSeries.push({
        ...lineSeriesBase(
          t("history.timeline.series.average"),
          mineAverageCurve,
          COLOR_MINE,
        ),
        lineStyle: {
          width: 1.5,
          type: "dashed",
          color: hexToRgba(COLOR_MINE, 0.45),
        },
        z: 2,
      });
    }
    if (mineInstantCurve) {
      curveSeries.push({
        ...lineSeriesBase(
          t("history.timeline.series.instant"),
          mineInstantCurve,
          COLOR_MINE,
        ),
        lineStyle: {
          width: 2.5,
          color: COLOR_MINE,
          shadowBlur: 8,
          shadowColor: "rgba(96,165,250,0.4)",
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(96,165,250,0.22)" },
            { offset: 1, color: "rgba(96,165,250,0)" },
          ]),
        },
        z: 3,
      });
    }

    return {
      animation: false,
      backgroundColor: "transparent",
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: GUTTER, right: 16, top: LANE_TOP, height: lanesHeight },
        { left: GUTTER, right: 16, top: curveTop, height: CURVE_H },
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: TL_TOOLTIP_BG,
        borderColor: TL_TOOLTIP_BORDER,
        textStyle: { color: TL_FG, fontSize: 11 },
        confine: true,
        axisPointer: {
          type: "line",
          lineStyle: { color: TL_AXIS },
        },
        formatter: (params: unknown) => {
          if (!Array.isArray(params)) return "";
          const items = params as Array<{
            seriesType?: string;
            seriesIndex?: number;
            axisValue?: number;
            marker?: string;
            seriesName?: string;
            value?: [number, number];
            data?: LanePoint;
          }>;

          // Lane hover: list every marker at this timestamp on the hovered
          // lane (overlapping icons all show up).
          const laneItems = items.filter(
            (p) => p.seriesType === "custom" && p.data?.event,
          );
          if (laneItems.length > 0) {
            const first = laneItems[0];
            if (!first) return "";
            const laneIndex = Math.round(first.data?.value[1] ?? 0);
            const rows = laneItems
              .filter((p) => Math.round(p.data?.value[1] ?? -1) === laneIndex)
              .map((p) => {
                const ev = p.data?.event;
                return ev ? eventTooltipHtml(ev) : "";
              })
              .filter((row) => row !== "");
            return rows.join("<br/><br/>");
          }

          // Curve hover: only line series carry meaningful values.
          const curveItems = items.filter((p) => p.seriesType === "line");
          if (curveItems.length === 0) return "";
          const first = curveItems[0];
          const rows = curveItems.map(
            (p) =>
              `${p.marker ?? ""}${escapeHtml(p.seriesName ?? "")}: <b>${formatValue(p.value?.[1] ?? 0)}</b>`,
          );
          return [
            `<b>${formatTimeMs(first?.axisValue ?? 0, true)}</b>`,
            ...rows,
          ].join("<br/>");
        },
      },
      xAxis: [
        {
          type: "value",
          gridIndex: 0,
          min: 0,
          max: chartDurationMs,
          show: false,
        },
        {
          type: "value",
          gridIndex: 1,
          min: 0,
          max: chartDurationMs,
          axisLabel: {
            color: TL_FG_MUTED,
            fontSize: 10,
            formatter: (v: number) => formatTimeMs(v),
          },
          splitLine: { show: false },
          axisLine: { lineStyle: { color: TL_AXIS } },
          axisTick: { lineStyle: { color: TL_AXIS } },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          min: -0.5,
          max: lanes.length - 0.5,
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        {
          type: "value",
          gridIndex: 1,
          axisLabel: {
            color: TL_FG_MUTED,
            fontSize: 10,
            formatter: (v: number) => formatValue(v),
          },
          splitLine: { lineStyle: { color: TL_GRID } },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1],
          filterMode: "none",
        },
        {
          type: "slider",
          xAxisIndex: [0, 1],
          height: 12,
          bottom: 6,
          borderColor: "transparent",
          backgroundColor: "rgba(148,163,184,0.06)",
          fillerColor: "rgba(148,163,184,0.12)",
          handleStyle: { color: "#475569", borderColor: "#475569" },
          moveHandleSize: 0,
          textStyle: { color: TL_FG_MUTED, fontSize: 9 },
          labelFormatter: (v: number) => formatTimeMs(v),
          filterMode: "none",
        },
      ],
      brush: selectionEnabled
        ? {
            xAxisIndex: "all",
            brushType: "lineX",
            brushMode: "single",
            transformable: true,
            brushStyle: {
              borderWidth: 1,
              color: "rgba(96,165,250,0.08)",
              borderColor: "rgba(96,165,250,0.55)",
            },
            outOfBrush: { colorAlpha: 0.6 },
            throttleType: "debounce",
            throttleDelay: 150,
          }
        : undefined,
      toolbox: { show: false },
      series: [...laneSeriesList, ...curveSeries],
    };
  }

  // The whole option is derived state: dependencies (lanes, curves, legend
  // toggles, locale) are tracked automatically, and the attachment effect
  // below only applies it.
  const chartOption = $derived.by(buildOption);

  /** Module-level cache of already-warmed icon URLs (zrender repaints once
   * each image finishes loading; this only removes the first-frame flicker). */
  const warmedIconUrls: Record<string, true> = {};

  function warmEventIcons() {
    for (const ev of events) {
      const iconPath = resolveEvent(ev).iconPath;
      if (iconPath === null || warmedIconUrls[iconPath]) continue;
      warmedIconUrls[iconPath] = true;
      const img = new Image();
      img.src = iconPath;
    }
  }

  function chartAttachment(node: HTMLDivElement) {
    warmEventIcons();
    const chart = echarts.init(node, null, { renderer: "canvas" });

    const armBrush = () => {
      if (!selectionEnabled) return;
      chart.dispatchAction({
        type: "takeGlobalCursor",
        key: "brush",
        brushOption: { brushType: "lineX", brushMode: "single" },
      });
    };

    // Activate lineX brush cursor by default so users can drag-select a range.
    armBrush();

    chart.on("brushEnd", (params: unknown) => {
      if (!selectionEnabled) return;
      const areas = (params as { areas?: { coordRange?: [number, number] }[] })
        .areas;
      const range = areas?.[0]?.coordRange;
      if (range) {
        selectedRange = normalizeEncounterBrushRange(range, chartDurationMs);
      }
    });
    chart.on("brush", (params: unknown) => {
      if (!selectionEnabled) return;
      const areas = (params as { areas?: unknown[] }).areas;
      if (Array.isArray(areas) && areas.length === 0) {
        selectedRange = null;
      }
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(node);

    // chartOption is a $derived, so the effect re-runs on any input change
    // (including locale) without a hand-maintained dependency list.
    const effectCleanup = $effect.root(() => {
      $effect(() => {
        chart.setOption(chartOption, { notMerge: true });
        // Re-arm the brush cursor after notMerge resets.
        armBrush();
        // Restore the visual brush after the option rebuild wiped it. Read
        // untracked: brushing itself must not retrigger the full rebuild.
        const range = untrack(() => selectedRange);
        if (selectionEnabled && range) {
          chart.dispatchAction({
            type: "brush",
            areas: [
              {
                brushType: "lineX",
                coordRange: [range[0], range[1]],
                xAxisIndex: 0,
              },
            ],
          });
        }
      });
      $effect(() => {
        // Clear the visual brush when the parent resets the selection.
        if (selectedRange === null) {
          chart.dispatchAction({ type: "brush", areas: [] });
        }
      });
    });

    return () => {
      effectCleanup();
      resizeObserver.disconnect();
      chart.dispose();
    };
  }

  type LegendChip = {
    key: string;
    label: string;
    color: string;
    active: boolean;
    toggle: (() => void) | null;
  };

  let legendChips = $derived.by<LegendChip[]>(() => [
    {
      key: "instant",
      label: t("history.timeline.series.instant"),
      color: COLOR_MINE,
      active: true,
      toggle: null,
    },
    {
      key: "average",
      label: t("history.timeline.series.average"),
      color: COLOR_MINE,
      active: showAverageCurve,
      toggle: () => (showAverageCurve = !showAverageCurve),
    },
  ]);
</script>

<!-- Fixed dark "chart island": interior colors are intentionally decoupled
     from the app theme; only the outer border follows the theme. -->
<div class="tl-panel border-border overflow-hidden rounded-md border">
  <!-- Header: curve legend + teammate lane selector. -->
  <div class="tl-header flex items-center justify-between gap-2 px-3 py-1.5">
    <div class="flex min-w-0 flex-wrap items-center gap-1">
      {#each legendChips as chip (chip.key)}
        {#if chip.toggle}
          <button
            type="button"
            class="tl-chip flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 transition-opacity duration-150 {chip.active
              ? ''
              : 'opacity-40'}"
            onclick={chip.toggle}
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              style="background: {chip.color}"
            ></span>
            <span class="text-[10px]" style="color: var(--tl-fg-muted)">
              {chip.label}
            </span>
          </button>
        {:else}
          <span class="flex items-center gap-1.5 rounded px-1.5 py-0.5">
            <span
              class="size-1.5 shrink-0 rounded-full"
              style="background: {chip.color}; box-shadow: 0 0 5px {chip.color}"
            ></span>
            <span class="text-[10px] font-medium" style="color: var(--tl-fg)">
              {chip.label}
            </span>
          </span>
        {/if}
      {/each}
    </div>

    {#if teammates.length > 0}
      <div class="relative shrink-0">
        <button
          type="button"
          class="tl-chip flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[10px] transition-colors duration-150"
          style="color: var(--tl-fg-muted)"
          onclick={() => (selectorOpen = !selectorOpen)}
        >
          <UsersIcon class="size-3 shrink-0" />
          <span>{t("history.timeline.lanes.selectTeammates")}</span>
          <span
            class="rounded px-1 tabular-nums"
            style="background: rgba(148,163,184,0.12); color: var(--tl-fg)"
          >
            {selectedTeammates.length}/{teammates.length}
          </span>
          <ChevronDownIcon
            class="size-2.5 shrink-0 transition-transform duration-150 {selectorOpen
              ? 'rotate-180'
              : ''}"
            strokeWidth={2.5}
          />
        </button>

        {#if selectorOpen}
          <!-- Click-away backdrop. -->
          <button
            type="button"
            class="fixed inset-0 z-10 cursor-default"
            aria-label={t("history.timeline.lanes.closeSelector")}
            onclick={() => (selectorOpen = false)}
          ></button>
          <div
            class="tl-popover absolute right-0 z-20 mt-1 w-52 rounded-md py-1 shadow-xl"
          >
            <div
              class="flex items-center justify-between px-2.5 pt-1 pb-1.5"
              style="border-bottom: 1px solid var(--tl-row-line)"
            >
              <button
                type="button"
                class="cursor-pointer text-[10px] transition-colors duration-150 hover:underline"
                style="color: var(--tl-fg-muted)"
                onclick={selectAllTeammates}
              >
                {t("history.timeline.lanes.selectAll")}
              </button>
              <button
                type="button"
                class="cursor-pointer text-[10px] transition-colors duration-150 hover:underline"
                style="color: var(--tl-fg-muted)"
                onclick={clearTeammates}
              >
                {t("history.timeline.lanes.clearAll")}
              </button>
            </div>
            <div class="max-h-56 overflow-y-auto">
              {#each teammates as player (player.entityUuid)}
                {@const checked = selectedTeammateUuids.includes(
                  player.entityUuid,
                )}
                <label
                  class="tl-chip flex cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors duration-150"
                >
                  <input
                    type="checkbox"
                    class="size-3 shrink-0 accent-blue-400"
                    {checked}
                    onchange={() => toggleTeammate(player.entityUuid)}
                  />
                  <img
                    class="size-3.5 shrink-0 object-contain"
                    src={getClassIcon(player.className)}
                    alt=""
                  />
                  <span
                    class="truncate text-[11px]"
                    style="color: {playerColor(player)}"
                  >
                    {player.name}
                  </span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Chart area: backdrop rows + canvas + HTML gutter, pixel-aligned via
       fixed row heights. -->
  <div class="relative w-full" style="height: {totalHeight}px">
    <!-- Backdrop layer: local-player row highlight + lane separators. -->
    <div class="pointer-events-none absolute inset-0">
      {#if mineLaneIndex >= 0}
        <div
          class="absolute right-0 left-0"
          style="top: {LANE_TOP + mineLaneIndex * LANE_H}px; height: {LANE_H}px;
                 background: rgba(96,165,250,0.06);
                 border-left: 2px solid rgba(96,165,250,0.7)"
        ></div>
      {/if}
      {#each lanes as lane, i (lane.key)}
        <div
          class="absolute right-0 left-0"
          style="top: {LANE_TOP + (i + 1) * LANE_H}px; height: 1px;
                 background: var(--tl-row-line)"
        ></div>
      {/each}
    </div>

    <div
      class="absolute inset-0"
      role="img"
      aria-label={t("history.timeline.chartAriaLabel")}
      {@attach chartAttachment}
    ></div>

    <!-- Lane gutter labels. -->
    <div
      class="pointer-events-none absolute top-0 left-0"
      style="width: {GUTTER}px; height: {curveTop + CURVE_H}px"
    >
      {#each lanes as lane, i (lane.key)}
        <div
          class="absolute right-2 left-2.5 flex items-center gap-1.5 overflow-hidden"
          style="top: {LANE_TOP + i * LANE_H}px; height: {LANE_H}px"
        >
          {#if lane.type === "boss"}
            <TriangleAlertIcon
              class="size-3.5 shrink-0"
              style="color: {COLOR_BOSS}"
            />
            <span
              class="truncate text-[11px]"
              style="color: {hexToRgba(COLOR_BOSS, 0.9)}"
            >
              {lane.name}
            </span>
          {:else if lane.type === "mine"}
            <span
              class="size-1.5 shrink-0 rounded-full"
              style="background: {COLOR_MINE}; box-shadow: 0 0 6px {hexToRgba(
                COLOR_MINE,
                0.9,
              )}"
            ></span>
            <span
              class="truncate text-[11px] font-medium"
              style="color: #dbeafe"
            >
              {lane.player.name}
            </span>
          {:else}
            <img
              class="size-3.5 shrink-0 object-contain"
              src={getClassIcon(lane.player.className)}
              alt=""
            />
            <span
              class="truncate text-[11px]"
              style="color: {playerColor(lane.player)}"
            >
              {lane.player.name}
            </span>
          {/if}
        </div>
      {/each}

      <!-- Curve-area caption. -->
      <div
        class="absolute left-2.5 text-[9px] font-semibold tracking-widest uppercase"
        style="top: {curveTop + 2}px; color: var(--tl-fg-muted)"
      >
        {t("history.timeline.curve.caption")}
      </div>
    </div>
  </div>

  <!-- Selection bar: active brush range + clear. -->
  {#if selectionEnabled && selectedRange}
    <div
      class="flex items-center justify-between gap-2 px-3 py-1.5"
      style="border-top: 1px solid var(--tl-row-line); background: rgba(96,165,250,0.05)"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <Clock3Icon class="size-3.5 shrink-0" style="color: {COLOR_MINE}" />
        <span class="truncate text-[11px] tabular-nums" style="color: #bfdbfe">
          {t("history.timeline.selection.label", {
            start: formatTimeMs(selectedRange[0], true),
            end: formatTimeMs(selectedRange[1], true),
            duration: formatTimeMs(selectedRange[1] - selectedRange[0], true),
          })}
        </span>
        {#if selectionPending}
          <span
            class="flex shrink-0 items-center gap-1 text-[10px]"
            style="color: var(--tl-fg-muted)"
          >
            <LoaderCircleIcon class="size-3 animate-spin" />
            {t("history.detail.loading")}
          </span>
        {/if}
      </div>
      <button
        type="button"
        class="shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] transition-colors duration-150 hover:bg-blue-400/15"
        style="border-color: rgba(96,165,250,0.4); color: {COLOR_MINE}"
        onclick={() => (selectedRange = null)}
      >
        {t("history.timeline.selection.clear")}
      </button>
    </div>
  {/if}
</div>

<style>
  /* Fixed dark palette; mirrored by the TL_* constants used for the canvas. */
  .tl-panel {
    --tl-bg: #14171d;
    --tl-header-bg: #181c24;
    --tl-fg: #e7e9ee;
    --tl-fg-muted: #8b93a4;
    --tl-row-line: rgba(148, 163, 184, 0.1);
    background: var(--tl-bg);
  }

  .tl-header {
    background: var(--tl-header-bg);
    border-bottom: 1px solid var(--tl-row-line);
  }

  .tl-chip:hover {
    background: rgba(148, 163, 184, 0.1);
  }

  .tl-popover {
    background: #1b1f28;
    border: 1px solid rgba(148, 163, 184, 0.18);
  }
</style>
