<script lang="ts">
  import { page } from "$app/state";
  import { settings, SETTINGS } from "$lib/settings-store";
  import { getLiveData } from "$lib/stores/live-meter-store.svelte";
  import { computePlayerRows } from "$lib/live-derived";
  import {
    groupSkillsByRecount,
    type RecountGroup,
    type SkillDisplayRow,
  } from "$lib/config/recount-table";
  import TableRowGlow from "$lib/components/table-row-glow.svelte";
  import { historyDpsSkillColumns } from "$lib/column-data";
  import AbbreviatedNumber from "$lib/components/abbreviated-number.svelte";
  import PercentFormat from "$lib/components/percent-format.svelte";

  type FlatSkillRow = SkillDisplayRow & {
    key: string;
    isGroup: boolean;
    depth: number;
    groupId?: number;
    expandable?: boolean;
    expanded?: boolean;
  };

  const playerUid = Number(page.url.searchParams.get("playerUid") ?? "-1");
  const expandedGroups = $state(new Set<number>());

  let liveData = $derived(getLiveData());
  let dpsPlayers = $derived(
    liveData ? computePlayerRows(liveData, "dps") : [],
  );
  let currPlayer = $derived(dpsPlayers.find((player) => player.uid === playerUid));
  let currEntity = $derived(
    liveData?.entities.find((entity) => entity.uid === playerUid) ?? null,
  );
  let elapsedSecs = $derived((liveData?.elapsedMs ?? 0) / 1000);

  let groupedSkills = $derived(
    currEntity
      ? groupSkillsByRecount(
          currEntity.dmgSkills,
          elapsedSecs,
          currEntity.damage.total,
        )
      : { groups: [] as RecountGroup[], ungrouped: [] as SkillDisplayRow[] },
  );

  let maxSkillValue = $state(0);
  let SETTINGS_YOUR_NAME = $state(settings.state.live.general.showYourName);
  let SETTINGS_OTHERS_NAME = $state(settings.state.live.general.showOthersName);

  let tableSettings = $derived(SETTINGS.live.tableCustomization.state);
  let customThemeColors = $derived(
    SETTINGS.accessibility.state.customThemeColors,
  );

  let sortKey = $derived(SETTINGS.live.sorting.dpsSkills.state.sortKey);
  let sortDesc = $derived(SETTINGS.live.sorting.dpsSkills.state.sortDesc);
  let columnOrder = $derived(SETTINGS.live.columnOrder.dpsSkills.state.order);

  function handleSort(key: string) {
    if (SETTINGS.live.sorting.dpsSkills.state.sortKey === key) {
      SETTINGS.live.sorting.dpsSkills.state.sortDesc =
        !SETTINGS.live.sorting.dpsSkills.state.sortDesc;
    } else {
      SETTINGS.live.sorting.dpsSkills.state.sortKey = key;
      SETTINGS.live.sorting.dpsSkills.state.sortDesc = true;
    }
  }

  function numericValue(value: unknown): number {
    return typeof value === "number" ? value : 0;
  }

  function sortRows<T extends Record<string, unknown>>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const aVal = numericValue(a[sortKey]);
      const bVal = numericValue(b[sortKey]);
      return sortDesc ? bVal - aVal : aVal - bVal;
    });
  }

  function toggleGroup(groupId: number) {
    if (expandedGroups.has(groupId)) expandedGroups.delete(groupId);
    else expandedGroups.add(groupId);
    expandedGroups;
  }

  let flatRows = $derived.by(() => {
    const rows: FlatSkillRow[] = [];
    const sortedGroups = sortRows(groupedSkills.groups);
    const sortedUngrouped = sortRows(groupedSkills.ungrouped);

    for (const group of sortedGroups) {
      const groupRow: FlatSkillRow = {
        key: `group-${group.recountId}`,
        skillId: group.recountId,
        name: group.recountName,
        totalDmg: group.totalDmg,
        dps: group.dps,
        dmgPct: group.dmgPct,
        critRate: 0,
        critDmgRate: 0,
        luckyRate: 0,
        luckyDmgRate: 0,
        hits: group.hits,
        hitsPerMinute: group.hitsPerMinute,
        raw: {
          totalValue: group.totalDmg,
          hits: group.hits,
          critHits: 0,
          critTotalValue: 0,
          luckyHits: 0,
          luckyTotalValue: 0,
        },
        isGroup: true,
        depth: 0,
        groupId: group.recountId,
        expandable: true,
        expanded: expandedGroups.has(group.recountId),
      };
      rows.push(groupRow);

      if (expandedGroups.has(group.recountId)) {
        const children = sortRows(group.skills).map(
          (skill): FlatSkillRow => ({
            ...skill,
            key: `skill-${group.recountId}-${skill.skillId}`,
            isGroup: false,
            depth: 1,
            groupId: group.recountId,
          }),
        );
        rows.push(...children);
      }
    }

    rows.push(
      ...sortedUngrouped.map(
        (skill): FlatSkillRow => ({
          ...skill,
          key: `ungrouped-${skill.skillId}`,
          isGroup: false,
          depth: 0,
        }),
      ),
    );

    return rows;
  });

  $effect(() => {
    maxSkillValue = flatRows.reduce(
      (max, row) => (row.totalDmg > max ? row.totalDmg : max),
      0,
    );
  });

  $effect(() => {
    SETTINGS_YOUR_NAME = settings.state.live.general.showYourName;
    SETTINGS_OTHERS_NAME = settings.state.live.general.showOthersName;
  });

  let visibleSkillColumns = $derived.by(() => {
    const visible = historyDpsSkillColumns.filter(
      (col) => settings.state.live.dps.skillBreakdown[col.key],
    );
    return visible.sort((a, b) => {
      const aIdx = columnOrder.indexOf(a.key);
      const bIdx = columnOrder.indexOf(b.key);
      return aIdx - bIdx;
    });
  });
</script>

<svelte:window oncontextmenu={() => window.history.back()} />

<div class="relative flex flex-col">
  <table class="w-full border-collapse">
    {#if tableSettings.skillShowHeader}
      <thead class="z-1 sticky top-0">
        <tr
          class="bg-popover/60"
          style="height: {tableSettings.skillHeaderHeight}px;"
        >
          <th
            class="px-2 py-1 text-left font-medium uppercase tracking-wider"
            style="font-size: {tableSettings.skillHeaderFontSize}px; color: {tableSettings.skillHeaderTextColor};"
            >Skill</th
          >
          {#each visibleSkillColumns as col (col.key)}
            <th
              class="px-2 py-1 text-right font-medium uppercase tracking-wider cursor-pointer select-none hover:bg-muted/40 transition-colors"
              style="font-size: {tableSettings.skillHeaderFontSize}px; color: {tableSettings.skillHeaderTextColor};"
              onclick={() => handleSort(col.key)}
            >
              <span class="inline-flex items-center gap-1 justify-end">
                {col.header}
                {#if sortKey === col.key}
                  <span class="text-primary">{sortDesc ? "▼" : "▲"}</span>
                {/if}
              </span>
            </th>
          {/each}
        </tr>
      </thead>
    {/if}
    <tbody>
      {#each flatRows as skill (skill.key)}
        {#if currPlayer}
          {@const className = currPlayer.name.includes("You")
            ? SETTINGS_YOUR_NAME !== "Hide Your Name"
              ? currPlayer.className
              : ""
            : SETTINGS_OTHERS_NAME !== "Hide Others' Name"
              ? currPlayer.className
              : ""}
          <tr
            class="relative hover:bg-muted/60 transition-colors bg-background/40"
            style="height: {tableSettings.skillRowHeight}px; font-size: {tableSettings.skillFontSize}px;"
          >
            <td
              class="px-2 py-1 relative z-10"
              style="color: {customThemeColors.tableTextColor};"
            >
              <button
                class="flex items-center gap-1 h-full w-full text-left"
                onclick={() =>
                  skill.isGroup && skill.groupId !== undefined
                    ? toggleGroup(skill.groupId)
                    : undefined}
                disabled={!skill.isGroup}
              >
                <span style="padding-left: {skill.depth * 12}px;"></span>
                {#if skill.isGroup && skill.expandable}
                  <span class="text-xs">{skill.expanded ? "▼" : "▶"}</span>
                {:else}
                  <span class="text-xs text-muted-foreground">•</span>
                {/if}
                <span class="truncate">{skill.name}</span>
              </button>
            </td>
            {#each visibleSkillColumns as col (col.key)}
              <td
                class="px-2 py-1 text-right relative z-10"
                style="color: {customThemeColors.tableTextColor};"
              >
                {#if col.key === "totalDmg"}
                  {#if SETTINGS.live.general.state.shortenDps}
                    <AbbreviatedNumber
                      num={skill.totalDmg}
                      suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                      suffixColor={customThemeColors.tableAbbreviatedColor}
                    />
                  {:else}
                    {skill.totalDmg.toLocaleString()}
                  {/if}
                {:else if col.key === "dps"}
                  {#if SETTINGS.live.general.state.shortenDps}
                    <AbbreviatedNumber
                      num={skill.dps}
                      suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                      suffixColor={customThemeColors.tableAbbreviatedColor}
                    />
                  {:else}
                    {Math.round(skill.dps).toLocaleString()}
                  {/if}
                {:else if col.key === "dmgPct"}
                  <PercentFormat
                    val={skill.dmgPct}
                    fractionDigits={0}
                    suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else if col.key === "critRate" || col.key === "critDmgRate" || col.key === "luckyRate" || col.key === "luckyDmgRate"}
                  <PercentFormat
                    val={skill[col.key]}
                    suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {col.format(skill[col.key] ?? 0)}
                {/if}
              </td>
            {/each}
            <TableRowGlow
              isSkill={true}
              {className}
              classSpecName={currPlayer.classSpecName}
              percentage={SETTINGS.live.general.state.relativeToTopDPSSkill
                ? maxSkillValue > 0
                  ? (skill.totalDmg / maxSkillValue) * 100
                  : 0
                : skill.dmgPct}
            />
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>
