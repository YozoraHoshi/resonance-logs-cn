<script lang="ts">
  // Header bar: curve legend toggles, viewport indicator/reset, and the
  // independent lane / curve teammate selector popovers.
  import ChartLineIcon from "@lucide/svelte/icons/chart-line";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import UsersIcon from "@lucide/svelte/icons/users";
  import { t } from "$lib/i18n/index.svelte";
  import { formatTimeMs } from "./timeline-format";
  import { playerColor } from "./timeline-colors";
  import { TIMELINE_PALETTE } from "./timeline-palette";
  import TimelinePlayerPicker from "./timeline-player-picker.svelte";
  import type { TimelineViewport } from "./timeline-viewport.svelte";
  import type { TimelinePlayerMeta } from "./timeline-types";

  type Props = {
    showAverageCurve: boolean;
    onToggleAverage: () => void;
    teammates: TimelinePlayerMeta[];
    selectedTeammateUuids: string[];
    onToggleTeammate: (entityUuid: string) => void;
    onSelectAllTeammates: () => void;
    onClearTeammates: () => void;
    curveTeammates: TimelinePlayerMeta[];
    selectedCurveTeammateUuids: string[];
    onToggleCurveTeammate: (entityUuid: string) => void;
    onSelectAllCurveTeammates: () => void;
    onClearCurveTeammates: () => void;
    viewport: TimelineViewport;
  };

  let {
    showAverageCurve,
    onToggleAverage,
    teammates,
    selectedTeammateUuids,
    onToggleTeammate,
    onSelectAllTeammates,
    onClearTeammates,
    curveTeammates,
    selectedCurveTeammateUuids,
    onToggleCurveTeammate,
    onSelectAllCurveTeammates,
    onClearCurveTeammates,
    viewport,
  }: Props = $props();

  const selectedCurveTeammates = $derived(
    curveTeammates.filter((player) =>
      selectedCurveTeammateUuids.includes(player.entityUuid),
    ),
  );
</script>

<div class="tl-header flex items-center justify-between gap-2 px-3 py-1.5">
  <div class="flex min-w-0 flex-wrap items-center gap-1">
    <span class="flex items-center gap-1.5 rounded px-1.5 py-0.5">
      <span
        class="size-1.5 shrink-0 rounded-full"
        style="background: {TIMELINE_PALETTE.mine}; box-shadow: 0 0 5px {TIMELINE_PALETTE.mine}"
      ></span>
      <span class="text-[10px] font-medium" style="color: var(--tl-fg)">
        {t("history.timeline.series.instant")}
      </span>
    </span>
    <button
      type="button"
      class="tl-chip flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 transition-opacity duration-150 {showAverageCurve
        ? ''
        : 'opacity-40'}"
      onclick={onToggleAverage}
    >
      <span
        class="size-1.5 shrink-0 rounded-full"
        style="background: {TIMELINE_PALETTE.average}"
      ></span>
      <span class="text-[10px]" style="color: var(--tl-fg-muted)">
        {t("history.timeline.series.average")}
      </span>
    </button>
    {#each selectedCurveTeammates as player (player.entityUuid)}
      <button
        type="button"
        class="tl-chip flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5"
        onclick={() => onToggleCurveTeammate(player.entityUuid)}
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          style="background: {playerColor(player)}"
        ></span>
        <span class="max-w-20 truncate text-[10px]" style="color: {playerColor(player)}">
          {player.name}
        </span>
      </button>
    {/each}
    <span class="text-[10px]" style="color: var(--tl-fg-muted)">
      {t("history.timeline.hint.gestures")}
    </span>

    {#if viewport.isZoomed}
      <span
        class="ml-1 flex items-center gap-1.5 rounded px-1.5 py-0.5 tabular-nums"
        style="color: var(--tl-fg-muted)"
      >
        <span class="text-[10px]">
          {t("history.timeline.zoom.windowLabel", {
            start: formatTimeMs(viewport.startMs),
            end: formatTimeMs(viewport.endMs),
            duration: formatTimeMs(viewport.durationMs),
          })}
        </span>
      </span>
      <button
        type="button"
        class="tl-chip flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5"
        style="color: var(--tl-fg-muted)"
        onclick={() => viewport.reset()}
        title={t("history.timeline.zoom.reset")}
      >
        <RotateCcwIcon class="size-3 shrink-0" />
        <span class="text-[10px]">{t("history.timeline.zoom.reset")}</span>
      </button>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-1">
    <TimelinePlayerPicker
      label={t("history.timeline.curves.selectTeammates")}
      closeAriaLabel={t("history.timeline.curves.closeSelector")}
      selectAllLabel={t("history.timeline.curves.selectAll")}
      clearAllLabel={t("history.timeline.curves.clearAll")}
      players={curveTeammates}
      selectedUuids={selectedCurveTeammateUuids}
      onToggle={onToggleCurveTeammate}
      onSelectAll={onSelectAllCurveTeammates}
      onClear={onClearCurveTeammates}
    >
      {#snippet icon()}
        <ChartLineIcon class="size-3 shrink-0" />
      {/snippet}
    </TimelinePlayerPicker>
    <TimelinePlayerPicker
      label={t("history.timeline.lanes.selectTeammates")}
      closeAriaLabel={t("history.timeline.lanes.closeSelector")}
      selectAllLabel={t("history.timeline.lanes.selectAll")}
      clearAllLabel={t("history.timeline.lanes.clearAll")}
      players={teammates}
      selectedUuids={selectedTeammateUuids}
      onToggle={onToggleTeammate}
      onSelectAll={onSelectAllTeammates}
      onClear={onClearTeammates}
    >
      {#snippet icon()}
        <UsersIcon class="size-3 shrink-0" />
      {/snippet}
    </TimelinePlayerPicker>
  </div>
</div>

<style>
  .tl-header {
    background: var(--tl-header-bg);
    border-bottom: 1px solid var(--tl-row-line);
  }

  .tl-chip:hover {
    background: rgba(148, 163, 184, 0.1);
  }
</style>
