import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MinimapSkillCast, MinimapSnapshot } from "$lib/api";
import {
  minimapOverlaySession,
  type MinimapFrameContext,
  type MinimapOverlayFrame,
} from "$lib/stores/live-window-sessions.svelte";
import { listenLivePullGate } from "$lib/live-pull-gate";
import {
  initOverlayClock,
  overlayNow,
} from "../game-overlay/overlay-clock.svelte.js";
import {
  handleMinimapVoiceCues,
  resetMinimapVoiceCues,
} from "./minimap-voice.svelte.js";
import {
  clearSkillCastEntries,
  clearSkillCastLog,
  consumeMinimapSkillCasts,
  minimapRuntime,
  minimapSnapshot,
  setMinimapSnapshot,
  updateElectromagneticRingCycle,
  updateEntityFirstSeen,
} from "./minimap-runtime.svelte.js";
import { resolveScene } from "./scene-registry";
import { setMinimapEditMode } from "./minimap-state.svelte.js";

/**
 * Wires up the minimap overlay: edit-mode toggle, the high-frequency
 * minimap pull session and the shared overlay clock
 * (drives buff countdowns). Returns a cleanup function that unsubscribes all
 * listeners; safe to call repeatedly (idempotent via the runtime guard).
 */
export function initMinimapOverlay() {
  if (minimapRuntime.cleanup) return minimapRuntime.cleanup;
  if (typeof window === "undefined") {
    return () => {};
  }

  minimapRuntime.isMounted = true;
  minimapRuntime.isInitialized = true;
  minimapRuntime.currentWindow = getCurrentWindow();

  document.documentElement.style.setProperty(
    "background",
    "transparent",
    "important",
  );
  document.body.style.setProperty("background", "transparent", "important");

  const stopClock = initOverlayClock();
  void setMinimapEditMode(false);

  const unlistenEditToggle = listen("minimap-overlay-edit-toggle", () => {
    void setMinimapEditMode(!minimapRuntime.isEditing);
  });

  const unlistenPullGate = listenLivePullGate(minimapOverlaySession);
  minimapOverlaySession.setFrameHandler(handleMinimapFrame);
  minimapOverlaySession.start();

  const cleanup = () => {
    stopClock();
    void unlistenEditToggle.then((fn) => fn());
    void unlistenPullGate.then((unlisten) => unlisten());
    minimapOverlaySession.setFrameHandler(null);
    minimapOverlaySession.stop();
    minimapRuntime.cleanup = null;
    minimapRuntime.isMounted = false;
  };
  minimapRuntime.cleanup = cleanup;
  return cleanup;
}

function handleMinimapFrame(
  frame: MinimapOverlayFrame,
  context: MinimapFrameContext,
): void {
  if (frame.castsReset || context.epochChanged) {
    // A cursor reset invalidates only accumulated cast history. Scene timing,
    // entity first-seen state, and voice dedupe remain valid for the current
    // snapshot.
    clearSkillCastEntries();
  }

  const snapshotUpdate = frame.snapshot;
  if (!snapshotUpdate && frame.skillCasts.length === 0) return;

  applyMinimapUpdate(
    snapshotUpdate ? snapshotUpdate.snapshot : minimapSnapshot(),
    frame.skillCasts,
  );
}

function applyMinimapUpdate(
  snapshot: MinimapSnapshot | null,
  skillCasts: MinimapSkillCast[],
): void {
  if (snapshot) {
    if (
      minimapRuntime.lastSceneId !== null &&
      minimapRuntime.lastSceneId !== snapshot.sceneId
    ) {
      clearSkillCastLog();
      resetMinimapVoiceCues();
    }
    minimapRuntime.lastSceneId = snapshot.sceneId;
    setMinimapSnapshot(snapshot);
    updateEntityFirstSeen(snapshot, overlayNow());
    updateElectromagneticRingCycle(snapshot, overlayNow());
    // Uses this tick's fresh skill-cast delta (not the accumulated log
    // resolveView reads), so each qualifying mechanic occurrence is seen by
    // resolveVoiceCues exactly once.
    const fires = resolveScene(snapshot.sceneId)?.resolveVoiceCues?.(
      snapshot,
      skillCasts,
    );
    if (fires && fires.length > 0) {
      handleMinimapVoiceCues(fires);
    }
  } else if (skillCasts.length === 0) {
    setMinimapSnapshot(null);
    minimapRuntime.lastSceneId = null;
    clearSkillCastLog();
    resetMinimapVoiceCues();
  }
  consumeMinimapSkillCasts(skillCasts);
}
