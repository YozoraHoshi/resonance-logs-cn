<script lang="ts">
  /**
   * @file This is the layout for the main application window (Toolbox).
   * It sets up the left sidebar with tool list and right content area.
   */
  import { setupShortcuts } from "./dps/settings/shortcuts";
  import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { goto } from "$app/navigation";
  import { SETTINGS } from '$lib/settings-store';
  import { commands, type CounterRule } from "$lib/bindings";
  import { setMonitoredPanelAttrs } from "$lib/api";
  import { expandBuffSelection } from "$lib/config/buff-name-table";
  import { applyCustomFonts } from "$lib/font-loader";
  import { getCounterRules, getDefaultMonitoredBuffIds } from "$lib/skill-mappings";
  import { onMount } from 'svelte';
  import ToolSidebar from "./tool-sidebar.svelte";
  import ChangelogModal from '$lib/components/ChangelogModal.svelte';
  import UpdateModal from '$lib/components/UpdateModal.svelte';
  import { getVersion } from "@tauri-apps/api/app";

  let { children } = $props();

  $effect.pre(() => {
    (async () => {
      await setupShortcuts();
    })();
  });

  function getActiveSkillMonitorProfile() {
    const profiles = SETTINGS.skillMonitor.state.profiles;
    if (profiles.length === 0) return null;
    const index = Math.min(
      Math.max(SETTINGS.skillMonitor.state.activeProfileIndex, 0),
      profiles.length - 1,
    );
    return profiles[index];
  }

  let lastMonitorSyncKey = "";
  let lastOverlayVisibleState: boolean | null = null;
  let lastMonsterMonitorSyncKey = "";
  let lastMonsterOverlayVisibleState: boolean | null = null;
  let monitorSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let monsterSyncTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const enabled = SETTINGS.skillMonitor.state.enabled;
    const activeProfile = getActiveSkillMonitorProfile();
    const selectedClass = activeProfile?.selectedClass ?? "wind_knight";
    const monitoredSkillIds = activeProfile?.monitoredSkillIds ?? [];
    const monitoredBuffIds = expandBuffSelection(
      activeProfile?.monitoredBuffIds ?? [],
      activeProfile?.monitoredBuffCategories,
    );
    const monitoredPanelAttrs = activeProfile?.monitoredPanelAttrs ?? [];
    const inlineBuffEntries = activeProfile?.inlineBuffEntries ?? [];
    const inlineCounterRuleIds = inlineBuffEntries
      .filter((entry) => entry.sourceType === "counter")
      .map((entry) => entry.sourceId);
    const buffDisplayMode = activeProfile?.buffDisplayMode ?? "individual";
    const buffGroups = activeProfile?.buffGroups ?? [];
    const individualAllGroup = activeProfile?.individualMonitorAllGroup ?? null;
    const anyGroupMonitorAll =
      (buffDisplayMode === "grouped" && buffGroups.some((group) => group.monitorAll))
      || (buffDisplayMode === "individual" && !!individualAllGroup);
    const groupBuffIds =
      buffDisplayMode === "grouped"
        ? buffGroups.flatMap((group) => (group.monitorAll ? [] : group.buffIds))
        : [];
    const inlineBuffIds = inlineBuffEntries
      .filter((entry) => entry.sourceType === "buff")
      .map((entry) => entry.sourceId);
    const activeCounterRuleIds = inlineCounterRuleIds;
    const counterLinkedBuffIds = getCounterRules()
      .filter((rule) => activeCounterRuleIds.includes(rule.ruleId))
      .map((rule) => rule.linkedBuffId);
    const defaultLinkedBuffIds = getDefaultMonitoredBuffIds(selectedClass);
    const mergedBuffIds = Array.from(
      new Set([
        ...monitoredBuffIds,
        ...groupBuffIds,
        ...inlineBuffIds,
        ...counterLinkedBuffIds,
        ...defaultLinkedBuffIds,
      ]),
    );
    const monitoredPanelAttrIds = monitoredPanelAttrs
      .filter((item) => item.enabled)
      .map((item) => item.attrId);
    const enabledCounterRules: CounterRule[] = getCounterRules()
      .filter((rule) => activeCounterRuleIds.includes(rule.ruleId))
      .map((rule) => ({
        ruleId: rule.ruleId,
        trigger: rule.trigger,
        linkedBuffId: rule.linkedBuffId,
        threshold: rule.threshold,
        onBuffAdd: rule.onBuffAdd,
        onBuffRemove: rule.onBuffRemove,
      }));
    const monitorSyncKey = JSON.stringify({
      enabled,
      monitoredSkillIds,
      mergedBuffIds,
      monitoredPanelAttrIds,
      anyGroupMonitorAll,
      activeCounterRuleIds,
    });

    if (monitorSyncKey !== lastMonitorSyncKey) {
      if (monitorSyncTimer) {
        clearTimeout(monitorSyncTimer);
      }
      monitorSyncTimer = setTimeout(() => {
        void (async () => {
          try {
            lastMonitorSyncKey = monitorSyncKey;
            if (enabled) {
              await commands.setMonitorAllBuff(anyGroupMonitorAll);
              await commands.setMonitoredSkills(monitoredSkillIds);
              await commands.setMonitoredBuffs(mergedBuffIds);
              await setMonitoredPanelAttrs(monitoredPanelAttrIds);
              await commands.setBuffCounterRules(enabledCounterRules);
            } else {
              await commands.setMonitorAllBuff(false);
              await commands.setMonitoredSkills([]);
              await commands.setMonitoredBuffs([]);
              await setMonitoredPanelAttrs([]);
              await commands.setBuffCounterRules([]);
            }
          } catch (error) {
            console.error("[skill-monitor] failed to sync monitor state", error);
          }
        })();
      }, 50);
    }

    void (async () => {
      try {
        const overlayWindow = await WebviewWindow.getByLabel("game-overlay");
        if (overlayWindow) {
          if (lastOverlayVisibleState !== enabled) {
            lastOverlayVisibleState = enabled;
            if (enabled) {
              await overlayWindow.show();
              await overlayWindow.unminimize();
            } else {
              await overlayWindow.hide();
            }
          }
        }
      } catch (error) {
        console.error("[skill-monitor] failed to sync monitor state", error);
      }
    })();
  });

  $effect(() => {
    const enabled = SETTINGS.monsterMonitor.state.enabled;
    const monitoredBuffIds = SETTINGS.monsterMonitor.state.monitoredBuffIds;
    const selfAppliedBuffIds = SETTINGS.monsterMonitor.state.selfAppliedBuffIds;
    const monsterMonitorSyncKey = JSON.stringify({
      enabled,
      monitoredBuffIds,
      selfAppliedBuffIds,
    });

    if (monsterMonitorSyncKey !== lastMonsterMonitorSyncKey) {
      if (monsterSyncTimer) {
        clearTimeout(monsterSyncTimer);
      }
      monsterSyncTimer = setTimeout(() => {
        void (async () => {
          try {
            lastMonsterMonitorSyncKey = monsterMonitorSyncKey;
            if (enabled) {
              await commands.setBossMonitoredBuffs(
                monitoredBuffIds,
                selfAppliedBuffIds,
              );
            } else {
              await commands.setBossMonitoredBuffs([], []);
            }
          } catch (error) {
            console.error("[monster-monitor] failed to sync monster monitor state", error);
          }
        })();
      }, 50);
    }

    void (async () => {
      try {
        const monsterOverlayWindow = await WebviewWindow.getByLabel("monster-overlay");
        if (monsterOverlayWindow) {
          if (lastMonsterOverlayVisibleState !== enabled) {
            lastMonsterOverlayVisibleState = enabled;
            if (enabled) {
              await monsterOverlayWindow.show();
              await monsterOverlayWindow.unminimize();
            } else {
              await monsterOverlayWindow.hide();
            }
          }
        }
      } catch (error) {
        console.error("[monster-monitor] failed to sync monster monitor state", error);
      }
    })();
  });

  $effect(() => {
    applyCustomFonts({
      sansEnabled: SETTINGS.accessibility.state.customFontSansEnabled,
      sansName: SETTINGS.accessibility.state.customFontSansName,
      sansUrl: SETTINGS.accessibility.state.customFontSansUrl,
      monoEnabled: SETTINGS.accessibility.state.customFontMonoEnabled,
      monoName: SETTINGS.accessibility.state.customFontMonoName,
      monoUrl: SETTINGS.accessibility.state.customFontMonoUrl,
    });
  });

  // Navigation listener is set up in onMount and properly cleaned up
  let navigateUnlisten: (() => void) | null = null;

  let showChangelog = $state(false);
  let currentVersion = $state('');
  type UpdateInfo = {
    version: string;
    body: string;
    downloadUrl: string;
  };
  let updateInfo = $state<UpdateInfo | null>(null);
  let updateUnlisten: UnlistenFn | null = null;

  onMount(() => {
    // Set up navigation listener
    const appWebview = getCurrentWebviewWindow();
    appWebview.listen<string>("navigate", (event) => {
      const route = event.payload;
      goto(route);
    }).then((unlisten) => {
      navigateUnlisten = unlisten;
    });

    listen<UpdateInfo>("update-available", (event) => {
      updateInfo = event.payload;
    }).then((unlisten) => {
      updateUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe update-available event", err);
    });

    // Get app version and check changelog
    getVersion().then((v) => {
      currentVersion = v;
      // Compare persisted last-seen version with current app version
      if ((SETTINGS.appVersion.state as any).value !== v) {
        showChangelog = true;
      }
    }).catch((err) => {
      console.error('Failed to get app version', err);
    });

    // Poll settings for background image
    const bgAndFontInterval = window.setInterval(() => {
      try {
        // Apply background image if enabled
        const bgImageEnabled = SETTINGS.accessibility.state.backgroundImageEnabled;
        const bgImage = SETTINGS.accessibility.state.backgroundImage;
        const bgMode = SETTINGS.accessibility.state.backgroundImageMode || 'cover';
        const bgContainColor = SETTINGS.accessibility.state.backgroundImageContainColor || 'rgba(0, 0, 0, 1)';

        if (bgImageEnabled && bgImage) {
          document.body.style.backgroundImage = `url('${bgImage}')`;
          document.body.style.backgroundSize = bgMode;
          document.body.style.backgroundPosition = 'center';
          document.body.style.backgroundRepeat = 'no-repeat';
          if (bgMode === 'contain') {
            document.body.style.backgroundColor = bgContainColor;
          } else {
            document.body.style.backgroundColor = '';
          }
        } else {
          // Clear any background image settings
          document.body.style.background = '';
          document.body.style.backgroundImage = '';
          document.body.style.backgroundColor = '';
        }
      } catch (e) {
        // ignore
      }
    }, 200);

    // Cleanup on unmount
    return () => {
      if (monitorSyncTimer) {
        clearTimeout(monitorSyncTimer);
        monitorSyncTimer = null;
      }
      if (monsterSyncTimer) {
        clearTimeout(monsterSyncTimer);
        monsterSyncTimer = null;
      }
      if (navigateUnlisten) {
        navigateUnlisten();
        navigateUnlisten = null;
      }
      if (updateUnlisten) {
        updateUnlisten();
        updateUnlisten = null;
      }
      clearInterval(bgAndFontInterval);
    };
  });

  function handleClose() {
    // mark changelog as seen for this version
    try {
      (SETTINGS.appVersion.state as any).value = currentVersion;
    } catch (e) {
      console.error('Failed to set appVersion setting', e);
    }
    showChangelog = false;
  }
</script>

<div class="flex h-screen bg-background-main text-foreground font-sans">
  <!-- Left Sidebar - Tool List -->
  <ToolSidebar />

  <!-- Right Content Area -->
  <main class="flex-1 flex flex-col overflow-hidden">
    <div class="flex-1 overflow-y-auto p-6">
      {@render children()}
    </div>
  </main>

  {#if showChangelog}
    <ChangelogModal onclose={handleClose} />
  {/if}

  {#if !showChangelog && updateInfo}
    <UpdateModal
      info={updateInfo}
      {currentVersion}
      onclose={() => {
        updateInfo = null;
      }}
    />
  {/if}
</div>

<style>
  :global {
    /* Hide scrollbars globally but keep scrolling functional */
    * {
      -ms-overflow-style: none; /* IE and Edge */
      scrollbar-width: none; /* Firefox */
    }
    *::-webkit-scrollbar {
      display: none; /* Chrome, Safari, Edge */
    }
  }
</style>
