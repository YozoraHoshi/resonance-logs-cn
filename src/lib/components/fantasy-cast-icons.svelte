<script lang="ts">
  /**
   * @file Shared circular fantasy-cast icons used by live player rows and the
   * history player table. Callers decide which casts to show; this component
   * only renders icons, the max-tier gold border, and the tooltip.
   */
  import type { FantasyCastDisplay } from "$lib/fantasy-icons";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/utils.svelte";

  let {
    casts,
    size = 16,
  }: {
    casts: readonly FantasyCastDisplay[];
    size?: number;
  } = $props();

  function castTooltip(cast: FantasyCastDisplay): string {
    return cast.remodelLevel != null && cast.remodelLevel > 0
      ? t("live.player.fantasyCastTooltip", {
          name: cast.name,
          level: cast.remodelLevel,
        })
      : cast.name;
  }
</script>

{#if casts.length > 0}
  <span class="inline-flex shrink-0 items-center gap-1">
    {#each casts as cast (cast.id)}
      <img
        src={cast.iconPath}
        alt=""
        class="fantasy-cast-icon"
        class:fantasy-cast-icon-max={cast.remodelLevel === 5}
        style="width: {size}px; height: {size}px;"
        {@attach tooltip(() => castTooltip(cast))}
      />
    {/each}
  </span>
{/if}

<style>
  .fantasy-cast-icon {
    border-radius: 50%;
    object-fit: cover;
    box-sizing: border-box;
    border: 2px solid silver;
    flex-shrink: 0;
  }

  .fantasy-cast-icon-max {
    border-color: gold;
  }
</style>
