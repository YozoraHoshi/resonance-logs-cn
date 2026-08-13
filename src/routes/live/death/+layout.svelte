<script lang="ts">
  /**
   * @file Scopes the deaths interest bit to the death route subtree. The live
   * window keeps one pull session; this route only asks that session to include
   * or omit the optional deaths slice.
   */
  import { onMount } from "svelte";
  import { liveWindowSession } from "$lib/stores/live-window-sessions.svelte";

  let { children } = $props();

  onMount(() => {
    liveWindowSession.setIncludeDeaths(true);
    return () => {
      liveWindowSession.setIncludeDeaths(false);
    };
  });
</script>

{@render children()}
