<script lang="ts">
  import { resolveBuffDisplayName } from "$lib/config/buff-name-table";
  import { t } from "$lib/i18n/index.svelte";
  import {
    overlayPanelBackground,
    overlayTextShadow,
  } from "$lib/overlay-text-style";
  import type { BuffUpdateState } from "$lib/bindings";
  import BuffCoverageRow from "./BuffCoverageRow.svelte";
  import {
    buffAliases,
    buffCoverage,
    buffCoverageEntries,
    buffCoverageStyle,
    buffMap,
    getGroupPosition,
    getGroupScale,
    isEditing,
    startDrag,
    startResize,
  } from "./overlay-state.svelte.js";

  const editing = $derived(isEditing());
  const groupPos = $derived(getGroupPosition("buffCoverageGroup"));
  const groupScale = $derived(getGroupScale("buffCoverageGroupScale"));
  const style = $derived(buffCoverageStyle());
  const aliases = $derived(buffAliases());

  const coverageByBaseId = $derived(
    new Map(buffCoverage().map((entry) => [entry.baseId, entry])),
  );

  type CoverageRow = {
    key: string;
    name: string;
    activeNow: boolean;
    percentText: string;
    buff: BuffUpdateState | undefined;
    count: number;
  };

  const rows = $derived.by<CoverageRow[]>(() =>
    buffCoverageEntries()
      .filter((entry) => entry.showInLive)
      .map((entry) => {
        const coverage = coverageByBaseId.get(entry.buffId);
        const buff = coverage?.activeNow
          ? buffMap().get(entry.buffId)
          : undefined;
        return {
          key: entry.id,
          name: resolveBuffDisplayName(entry.buffId, aliases),
          activeNow: coverage?.activeNow ?? false,
          percentText:
            coverage && coverage.activeMs > 0
              ? `${((coverage.coveredMs / coverage.activeMs) * 100).toFixed(1)}%`
              : "--",
          buff,
          count: coverage?.count ?? 0,
        };
      }),
  );

  const hasData = $derived(rows.length > 0);
  const textShadowVar = $derived(overlayTextShadow(style.textShadowEnabled));
  const backgroundVar = $derived(
    overlayPanelBackground(style.backgroundEnabled, style.backgroundOpacity),
  );
</script>

{#if hasData || editing}
  <div
    class="overlay-group buff-coverage-group"
    class:editable={editing}
    class:has-background={backgroundVar !== undefined}
    style:left={`${groupPos.x}px`}
    style:top={`${groupPos.y}px`}
    style:transform={`scale(${groupScale})`}
    style:transform-origin="top left"
    style:--overlay-text-shadow={textShadowVar}
    style:background={backgroundVar}
    onpointerdown={(e) =>
      startDrag(e, { kind: "group", key: "buffCoverageGroup" }, groupPos)}
  >
    {#if editing}
      <div class="group-tag">{t("gameOverlay.group.buffCoverage")}</div>
    {/if}

    <div
      class="coverage-list"
      style:gap={`${style.gap}px`}
      style:font-size={`${style.fontSize}px`}
    >
      {#each rows as row (row.key)}
        <BuffCoverageRow
          name={row.name}
          percentText={row.percentText}
          count={row.count}
          activeNow={row.activeNow}
          buff={row.buff}
          showProgress={style.showProgress}
          {style}
        />
      {/each}
      {#if editing && rows.length === 0}
        <div class="coverage-empty" style:color={style.nameColor}>
          {t("gameOverlay.coverage.empty")}
        </div>
      {/if}
    </div>

    {#if editing}
      <div
        class="resize-handle"
        onpointerdown={(e) =>
          startResize(
            e,
            { kind: "group", key: "buffCoverageGroupScale" },
            groupScale,
          )}
      ></div>
    {/if}
  </div>
{/if}

<style>
  .buff-coverage-group.has-background {
    padding: 6px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.24);
  }

  .buff-coverage-group.editable {
    border: 2px solid var(--overlay-edit-panel-border);
    border-radius: 10px;
    background: var(--overlay-edit-panel-bg);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
    padding: 8px;
    min-width: 220px;
    min-height: 40px;
  }

  .coverage-list {
    display: flex;
    flex-direction: column;
    min-width: 220px;
  }

  .coverage-empty {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: var(--overlay-text-shadow, 0 0 4px rgba(0, 0, 0, 0.8));
  }
</style>
