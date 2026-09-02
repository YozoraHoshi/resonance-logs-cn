<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import SettingsSwitch from "./settings-switch.svelte";
  import SettingsSelect from "./settings-select.svelte";
  import SettingsSlider from "./settings-slider.svelte";
  import SettingsColumnLabel from "./settings-column-label.svelte";
  import {
    historyDpsPlayerColumns,
    historyDpsSkillColumns,
    historyHealPlayerColumns,
    historyHealSkillColumns,
    historyTankedPlayerColumns,
    historyTankedSkillColumns,
    deathReplayColumns,
  } from "$lib/column-data";
  import {
    DEFAULT_CURVE_H,
    DEFAULT_LANE_H,
    MAX_CURVE_H,
    MAX_LANE_H,
    MIN_CURVE_H,
    MIN_LANE_H,
  } from "$lib/components/encounter-timeline/timeline-layout";
  import {
    DEFAULT_INSTANT_DPS_WINDOW_SEC,
    MAX_INSTANT_DPS_WINDOW_SEC,
    MIN_INSTANT_DPS_WINDOW_SEC,
  } from "$lib/components/encounter-timeline/timeline-data";
  import {
    SETTINGS,
    DEFAULT_HISTORY_TANKED_STATS,
    DEFAULT_HISTORY_TANKED_SKILL_STATS,
    DEFAULT_DEATH_REPLAY_COLUMNS,
    normalizeDeathReplayColumnOrder,
  } from "$lib/settings-store";
  import { t } from "$lib/i18n/index.svelte";
  import ChevronDown from "virtual:icons/lucide/chevron-down";

  const SETTINGS_CATEGORY = "history";

  // Collapsible section state - all collapsed by default
  let expandedSections = $state({
    general: false,
    dpsPlayers: false,
    dpsSkills: false,
    healPlayers: false,
    healSkills: false,
    tankedPlayers: false,
    tankedSkills: false,
    deathReplay: false,
  });

  function toggleSection(section: keyof typeof expandedSections) {
    expandedSections[section] = !expandedSections[section];
  }

  const deathReplayColumnOrder = $derived(
    normalizeDeathReplayColumnOrder(
      SETTINGS.live.columnOrder.deathReplay.state.order,
    ),
  );

  $effect(() => {
    SETTINGS.history.general.state.timelineLaneH ??= DEFAULT_LANE_H;
    SETTINGS.history.general.state.timelineCurveH ??= DEFAULT_CURVE_H;
    SETTINGS.history.general.state.instantDpsWindowSec ??=
      DEFAULT_INSTANT_DPS_WINDOW_SEC;
    for (const key of Object.keys(DEFAULT_HISTORY_TANKED_STATS)) {
      const typedKey = key as keyof typeof DEFAULT_HISTORY_TANKED_STATS;
      SETTINGS.history.tanked.players.state[typedKey] ??=
        DEFAULT_HISTORY_TANKED_STATS[typedKey];
    }
    for (const key of Object.keys(DEFAULT_HISTORY_TANKED_SKILL_STATS)) {
      const typedKey = key as keyof typeof DEFAULT_HISTORY_TANKED_SKILL_STATS;
      SETTINGS.history.tanked.skillBreakdown.state[typedKey] ??=
        DEFAULT_HISTORY_TANKED_SKILL_STATS[typedKey];
    }
    for (const key of deathReplayColumnOrder) {
      const typedKey = key as keyof typeof DEFAULT_DEATH_REPLAY_COLUMNS;
      SETTINGS.live.deathReplay.state[typedKey] ??=
        DEFAULT_DEATH_REPLAY_COLUMNS[typedKey];
    }
  });
</script>

<Tabs.Content value={SETTINGS_CATEGORY}>
  <div class="space-y-3">
    <div
      class="bg-card/40 border-border/60 overflow-hidden rounded-lg border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <button
        type="button"
        class="hover:bg-muted/30 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("general")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.general")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.general
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.general}
        <div class="space-y-1 px-4 pb-3">
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.showYourName}
            values={[
              {
                label: t("settings.common.name.option.yourName"),
                value: "Show Your Name",
              },
              {
                label: t("settings.common.name.option.yourClass"),
                value: "Show Your Class",
              },
              {
                label: t("settings.common.name.option.yourNameClass"),
                value: "Show Your Name - Class",
              },
              {
                label: t("settings.common.name.option.yourNameSpec"),
                value: "Show Your Name - Spec",
              },
              {
                label: t("settings.common.name.option.hideYourName"),
                value: "Hide Your Name",
              },
            ]}
            label={t("settings.common.name.your")}
            description={t("settings.common.name.yourDescription")}
          />
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.showOthersName}
            values={[
              {
                label: t("settings.common.name.option.othersName"),
                value: "Show Others' Name",
              },
              {
                label: t("settings.common.name.option.othersClass"),
                value: "Show Others' Class",
              },
              {
                label: t("settings.common.name.option.othersNameClass"),
                value: "Show Others' Name - Class",
              },
              {
                label: t("settings.common.name.option.othersNameSpec"),
                value: "Show Others' Name - Spec",
              },
              {
                label: t("settings.common.name.option.hideOthersName"),
                value: "Hide Others' Name",
              },
            ]}
            label={t("settings.common.name.others")}
            description={t("settings.common.name.othersDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.showYourAbilityScore}
            label={t("settings.common.ability.your")}
            description={t("settings.common.ability.yourDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.showOthersAbilityScore}
            label={t("settings.common.ability.others")}
            description={t("settings.common.ability.othersDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.showYourSeasonStrength}
            label={t("settings.common.seasonStrength.your")}
            description={t("settings.common.seasonStrength.yourDescription")}
          />
          <SettingsSwitch
            bind:checked={
              SETTINGS.history.general.state.showOthersSeasonStrength
            }
            label={t("settings.common.seasonStrength.others")}
            description={t("settings.common.seasonStrength.othersDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.showFantasyCastIcons}
            label={t("settings.history.fantasyCastIcons")}
            description={t("settings.history.fantasyCastIconsDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.relativeToTopDPSPlayer}
            label={t("settings.common.relative.dpsPlayer")}
            description={t("settings.common.relative.dpsPlayerDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.relativeToTopDPSSkill}
            label={t("settings.common.relative.dpsSkill")}
            description={t("settings.common.relative.dpsSkillDescription")}
          />
          <SettingsSwitch
            bind:checked={
              SETTINGS.history.general.state.relativeToTopHealPlayer
            }
            label={t("settings.common.relative.healPlayer")}
            description={t("settings.common.relative.healPlayerDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.relativeToTopHealSkill}
            label={t("settings.common.relative.healSkill")}
            description={t("settings.common.relative.healSkillDescription")}
          />
          <SettingsSwitch
            bind:checked={
              SETTINGS.history.general.state.relativeToTopTankedPlayer
            }
            label={t("settings.common.relative.tankedPlayer")}
            description={t("settings.common.relative.tankedPlayerDescription")}
          />
          <SettingsSwitch
            bind:checked={
              SETTINGS.history.general.state.relativeToTopTankedSkill
            }
            label={t("settings.common.relative.tankedSkill")}
            description={t("settings.common.relative.tankedSkillDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.shortenTps}
            label={t("settings.common.shorten.tps")}
            description={t("settings.common.shorten.tpsDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.shortenAbilityScore}
            label={t("settings.common.shorten.abilityScore")}
            description={t("settings.common.shorten.abilityScoreDescription")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.history.general.state.shortenDps}
            label={t("settings.common.shorten.dps")}
            description={t("settings.common.shorten.dpsDescription")}
          />
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.abbreviationStyle}
            label={t("settings.common.abbreviationStyle")}
            description={t("settings.common.abbreviationStyleDescription")}
            values={[
              {
                label: t("settings.common.abbreviationStyle.western"),
                value: "western",
              },
              { label: t("settings.common.abbreviationStyle.cn"), value: "cn" },
            ]}
          />
          <SettingsSelect
            bind:selected={
              SETTINGS.history.general.state.abbreviatedDecimalPlaces
            }
            label={t("settings.common.decimalPlaces")}
            description={t("settings.common.decimalPlacesDescription")}
            values={[
              { label: t("settings.common.decimalPlaces.1"), value: 1 },
              { label: t("settings.common.decimalPlaces.2"), value: 2 },
              { label: t("settings.common.decimalPlaces.3"), value: 3 },
              { label: t("settings.common.decimalPlaces.4"), value: 4 },
            ]}
          />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.timelineLaneH}
            label={t("settings.history.timeline.laneH")}
            description={t("settings.history.timeline.laneHDescription")}
            min={MIN_LANE_H}
            max={MAX_LANE_H}
            step={2}
            unit="px"
          />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.timelineCurveH}
            label={t("settings.history.timeline.curveH")}
            description={t("settings.history.timeline.curveHDescription")}
            min={MIN_CURVE_H}
            max={MAX_CURVE_H}
            step={10}
            unit="px"
          />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.instantDpsWindowSec}
            label={t("settings.history.timeline.instantWindow")}
            description={t(
              "settings.history.timeline.instantWindowDescription",
            )}
            min={MIN_INSTANT_DPS_WINDOW_SEC}
            max={MAX_INSTANT_DPS_WINDOW_SEC}
            step={1}
            unit="s"
          />
        </div>
      {/if}
    </div>

    <!-- DPS - Player Settings -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("dpsPlayers")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.dpsPlayers")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.dpsPlayers
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.dpsPlayers}
        <div class="space-y-1 px-4 pb-3">
          <div
            class="border-border/30 bg-muted/20 flex items-center gap-3 rounded border px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <div class="text-foreground text-sm font-medium">
                {t("settings.common.columns.first.player")}
              </div>
              <div class="text-muted-foreground mt-0.5 text-xs">
                {t("settings.common.columns.customNameHint")}
              </div>
            </div>
            <SettingsColumnLabel
              bind:value={
                SETTINGS.live.columnLabels.state.history.players.first
              }
              placeholder={t("history.detail.table.player")}
              ariaLabel={t("settings.common.columns.customNameAriaLabel", {
                column: t("history.detail.table.player"),
              })}
              resetLabel={t("settings.common.columns.resetName")}
            />
          </div>
          {#each historyDpsPlayerColumns as col (col.key)}
            <div
              class="border-border/30 bg-muted/20 flex items-center gap-3 rounded border px-2 py-1"
            >
              <div class="min-w-0 flex-1">
                <SettingsSwitch
                  bind:checked={SETTINGS.history.dps.players.state[col.key]}
                  label={col.label}
                  description={col.description}
                />
              </div>
              <SettingsColumnLabel
                bind:value={
                  SETTINGS.live.columnLabels.state.history.players.columns[
                    col.key
                  ]
                }
                placeholder={col.header}
                ariaLabel={t("settings.common.columns.customNameAriaLabel", {
                  column: col.label,
                })}
                resetLabel={t("settings.common.columns.resetName")}
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- DPS - Skill Breakdown Settings -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("dpsSkills")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.dpsSkills")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.dpsSkills
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.dpsSkills}
        <div class="space-y-1 px-4 pb-3">
          <div
            class="border-border/30 bg-muted/20 flex items-center gap-3 rounded border px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <div class="text-foreground text-sm font-medium">
                {t("settings.common.columns.first.skill")}
              </div>
              <div class="text-muted-foreground mt-0.5 text-xs">
                {t("settings.common.columns.customNameHint")}
              </div>
            </div>
            <SettingsColumnLabel
              bind:value={SETTINGS.live.columnLabels.state.history.skills.first}
              placeholder={t("history.detail.table.skill")}
              ariaLabel={t("settings.common.columns.customNameAriaLabel", {
                column: t("history.detail.table.skill"),
              })}
              resetLabel={t("settings.common.columns.resetName")}
            />
          </div>
          {#each historyDpsSkillColumns as col (col.key)}
            <div
              class="border-border/30 bg-muted/20 flex items-center gap-3 rounded border px-2 py-1"
            >
              <div class="min-w-0 flex-1">
                <SettingsSwitch
                  bind:checked={
                    SETTINGS.history.dps.skillBreakdown.state[col.key]
                  }
                  label={col.label}
                  description={col.description}
                />
              </div>
              <SettingsColumnLabel
                bind:value={
                  SETTINGS.live.columnLabels.state.history.skills.columns[
                    col.key
                  ]
                }
                placeholder={col.header}
                ariaLabel={t("settings.common.columns.customNameAriaLabel", {
                  column: col.label,
                })}
                resetLabel={t("settings.common.columns.resetName")}
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Heal - Player Settings -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("healPlayers")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.healPlayers")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.healPlayers
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.healPlayers}
        <div class="space-y-1 px-4 pb-3">
          {#each historyHealPlayerColumns as col (col.key)}
            <SettingsSwitch
              bind:checked={SETTINGS.history.heal.players.state[col.key]}
              label={col.label}
              description={col.description}
            />
          {/each}
        </div>
      {/if}
    </div>

    <!-- Heal - Skill Breakdown Settings -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("healSkills")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.healSkills")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.healSkills
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.healSkills}
        <div class="space-y-1 px-4 pb-3">
          {#each historyHealSkillColumns as col (col.key)}
            <SettingsSwitch
              bind:checked={SETTINGS.history.heal.skillBreakdown.state[col.key]}
              label={col.label}
              description={col.description}
            />
          {/each}
        </div>
      {/if}
    </div>

    <!-- Tanked - Player Settings -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("tankedPlayers")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.tankedPlayers")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.tankedPlayers
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.tankedPlayers}
        <div class="space-y-1 px-4 pb-3">
          {#each historyTankedPlayerColumns as col (col.key)}
            {@const key = col.key as keyof typeof DEFAULT_HISTORY_TANKED_STATS}
            <SettingsSwitch
              bind:checked={SETTINGS.history.tanked.players.state[key]}
              label={col.label}
              description={col.description}
            />
          {/each}
        </div>
      {/if}
    </div>

    <!-- Tanked - Skill Breakdown Settings -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("tankedSkills")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.tankedSkills")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.tankedSkills
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.tankedSkills}
        <div class="space-y-1 px-4 pb-3">
          {#each historyTankedSkillColumns as col (col.key)}
            {@const key =
              col.key as keyof typeof DEFAULT_HISTORY_TANKED_SKILL_STATS}
            <SettingsSwitch
              bind:checked={SETTINGS.history.tanked.skillBreakdown.state[key]}
              label={col.label}
              description={col.description}
            />
          {/each}
        </div>
      {/if}
    </div>

    <!-- Death Replay Columns (shared with live) -->
    <div
      class="bg-popover/40 border-border/50 overflow-hidden rounded-lg border"
    >
      <button
        type="button"
        class="hover:bg-popover/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
        onclick={() => toggleSection("deathReplay")}
      >
        <h2 class="text-foreground text-base font-semibold">
          {t("settings.common.columns.deathReplay")}
        </h2>
        <ChevronDown
          class="text-muted-foreground h-5 w-5 transition-transform duration-200 {expandedSections.deathReplay
            ? 'rotate-180'
            : ''}"
        />
      </button>
      {#if expandedSections.deathReplay}
        <div class="space-y-1 px-4 pb-3">
          <p class="text-muted-foreground mb-2 text-xs">
            {t("settings.common.columns.orderHint")}
          </p>
          <p class="text-muted-foreground mb-2 text-xs">
            {t("settings.common.columns.deathReplaySharedHint")}
          </p>
          {#each deathReplayColumnOrder as colKey, idx (colKey)}
            {@const col = deathReplayColumns.find((c) => c.key === colKey)}
            {#if col}
              {@const key =
                col.key as keyof typeof DEFAULT_DEATH_REPLAY_COLUMNS}
              <div
                class="bg-muted/20 border-border/30 flex items-center gap-2 rounded border px-2 py-1"
              >
                <div class="flex flex-col">
                  <button
                    type="button"
                    class="hover:bg-muted/50 rounded px-1 text-xs disabled:opacity-30"
                    disabled={idx === 0}
                    onclick={() => {
                      const arr = [...deathReplayColumnOrder];
                      const prev = arr[idx - 1];
                      const curr = arr[idx];
                      if (prev !== undefined && curr !== undefined) {
                        arr.splice(idx - 1, 2, curr, prev);
                        SETTINGS.live.columnOrder.deathReplay.state.order = arr;
                      }
                    }}>▲</button
                  >
                  <button
                    type="button"
                    class="hover:bg-muted/50 rounded px-1 text-xs disabled:opacity-30"
                    disabled={idx === deathReplayColumnOrder.length - 1}
                    onclick={() => {
                      const arr = [...deathReplayColumnOrder];
                      const curr = arr[idx];
                      const next = arr[idx + 1];
                      if (curr !== undefined && next !== undefined) {
                        arr.splice(idx, 2, next, curr);
                        SETTINGS.live.columnOrder.deathReplay.state.order = arr;
                      }
                    }}>▼</button
                  >
                </div>
                <SettingsSwitch
                  bind:checked={SETTINGS.live.deathReplay.state[key]}
                  label={col.label}
                  description={col.description}
                />
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
</Tabs.Content>
