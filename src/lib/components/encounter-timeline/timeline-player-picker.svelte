<script lang="ts">
  // Shared teammate checkbox popover. Lane and curve selectors each own
  // their own instance + selection state; this component only renders the
  // list and reports toggles.
  import type { Snippet } from "svelte";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import { getClassIcon } from "$lib/utils.svelte";
  import { playerColor } from "./timeline-colors";
  import type { TimelinePlayerMeta } from "./timeline-types";

  type Props = {
    label: string;
    closeAriaLabel: string;
    selectAllLabel: string;
    clearAllLabel: string;
    players: TimelinePlayerMeta[];
    selectedUuids: string[];
    onToggle: (entityUuid: string) => void;
    onSelectAll: () => void;
    onClear: () => void;
    icon: Snippet;
  };

  let {
    label,
    closeAriaLabel,
    selectAllLabel,
    clearAllLabel,
    players,
    selectedUuids,
    onToggle,
    onSelectAll,
    onClear,
    icon,
  }: Props = $props();

  let selectorOpen = $state(false);
</script>

{#if players.length > 0}
  <div class="relative shrink-0">
    <button
      type="button"
      class="tl-chip flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[10px] transition-colors duration-150"
      style="color: var(--tl-fg-muted)"
      onclick={() => (selectorOpen = !selectorOpen)}
    >
      {@render icon()}
      <span>{label}</span>
      <span
        class="rounded px-1 tabular-nums"
        style="background: rgba(148,163,184,0.12); color: var(--tl-fg)"
      >
        {selectedUuids.length}/{players.length}
      </span>
      <ChevronDownIcon
        class="size-2.5 shrink-0 transition-transform duration-150 {selectorOpen
          ? 'rotate-180'
          : ''}"
        strokeWidth={2.5}
      />
    </button>

    {#if selectorOpen}
      <button
        type="button"
        class="fixed inset-0 z-10 cursor-default"
        aria-label={closeAriaLabel}
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
            onclick={onSelectAll}
          >
            {selectAllLabel}
          </button>
          <button
            type="button"
            class="cursor-pointer text-[10px] transition-colors duration-150 hover:underline"
            style="color: var(--tl-fg-muted)"
            onclick={onClear}
          >
            {clearAllLabel}
          </button>
        </div>
        <div class="max-h-56 overflow-y-auto">
          {#each players as player (player.entityUuid)}
            {@const checked = selectedUuids.includes(player.entityUuid)}
            <label
              class="tl-chip flex cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors duration-150"
            >
              <input
                type="checkbox"
                class="size-3 shrink-0 accent-blue-400"
                {checked}
                onchange={() => onToggle(player.entityUuid)}
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

<style>
  .tl-chip:hover {
    background: rgba(148, 163, 184, 0.1);
  }

  .tl-popover {
    background: var(--tl-popover-bg);
    border: 1px solid rgba(148, 163, 184, 0.18);
  }
</style>
