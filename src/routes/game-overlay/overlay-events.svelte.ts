import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  onBuffCounterUpdate,
  onBuffUpdate,
  onFightResUpdate,
  onPanelAttrUpdate,
  onSkillCdUpdate,
  type BuffUpdateState,
  type CounterUpdateState,
} from "$lib/api";
import {
  getAvailableBuffDefinitions,
  type BuffDefinition,
} from "$lib/config/buff-name-table";
import {
  ensureBuffGroups,
  ensureCustomPanelGroups,
  ensureCustomPanelStyle,
  ensureIndividualMonitorAllGroup,
  ensureOverlayPositions,
  ensureOverlaySizes,
  ensureOverlayVisibility,
  ensureTextBuffPanelStyle,
} from "./overlay-utils";
import {
  activeProfile,
  updateActiveProfile,
} from "./overlay-profile.svelte.js";
import { overlayRuntime } from "./overlay-runtime.svelte.js";
import {
  onGlobalPointerMove,
  onGlobalPointerUp,
  setEditMode,
  setOverlayWindow,
} from "./overlay-layout.svelte.js";
import { updateDisplay } from "./overlay-display.svelte.js";

export function initOverlay() {
  if (overlayRuntime.cleanup) return overlayRuntime.cleanup;
  if (typeof window === "undefined") {
    return () => {};
  }

  overlayRuntime.isMounted = true;
  overlayRuntime.isInitialized = true;
  setOverlayWindow(getCurrentWindow());

  document.documentElement.style.setProperty(
    "background",
    "transparent",
    "important",
  );
  document.body.style.setProperty("background", "transparent", "important");

  ensureActiveProfileDefaults();
  void setEditMode(false);
  loadAvailableBuffs();

  const unlistenEditToggle = listen("overlay-edit-toggle", () => {
    void setEditMode(!overlayRuntime.isEditing);
  });
  const unlistenBuff = onBuffUpdate((event) => {
    const next = new Map<number, BuffUpdateState>();
    for (const buff of event.payload.buffs) {
      const existing = next.get(buff.baseId);
      if (!existing || buff.createTimeMs >= existing.createTimeMs) {
        next.set(buff.baseId, buff);
      }
    }
    overlayRuntime.buffMap = next;
  });
  const unlistenCounter = onBuffCounterUpdate((event) => {
    const next = new Map<number, CounterUpdateState>();
    for (const counter of event.payload.counters) {
      next.set(counter.ruleId, counter);
    }
    overlayRuntime.counterMap = next;
  });
  const unlistenCd = onSkillCdUpdate((event) => {
    const next = new Map(overlayRuntime.cdMap);
    for (const cd of event.payload.skillCds) {
      const baseId = Math.floor(cd.skillLevelId / 100);
      next.set(baseId, cd);
    }
    overlayRuntime.cdMap = next;
  });
  const unlistenRes = onFightResUpdate((event) => {
    overlayRuntime.fightResValues = event.payload.fightRes.values;
  });
  const unlistenPanelAttr = onPanelAttrUpdate((event) => {
    const next = new Map(overlayRuntime.panelAttrMap);
    for (const attr of event.payload.attrs) {
      next.set(attr.attrId, attr.value);
    }
    overlayRuntime.panelAttrMap = next;
  });

  window.addEventListener("pointermove", onGlobalPointerMove);
  window.addEventListener("pointerup", onGlobalPointerUp);
  overlayRuntime.rafId = requestAnimationFrame(updateDisplay);

  overlayRuntime.cleanup = () => {
    overlayRuntime.isMounted = false;
    overlayRuntime.isInitialized = false;
    overlayRuntime.dragState = null;
    overlayRuntime.resizeState = null;
    unlistenEditToggle.then((fn) => fn());
    unlistenBuff.then((fn) => fn());
    unlistenCounter.then((fn) => fn());
    unlistenCd.then((fn) => fn());
    unlistenRes.then((fn) => fn());
    unlistenPanelAttr.then((fn) => fn());
    window.removeEventListener("pointermove", onGlobalPointerMove);
    window.removeEventListener("pointerup", onGlobalPointerUp);
    if (overlayRuntime.rafId) {
      cancelAnimationFrame(overlayRuntime.rafId);
      overlayRuntime.rafId = null;
    }
    setOverlayWindow(null);
    overlayRuntime.cleanup = null;
  };

  return overlayRuntime.cleanup;
}

function loadAvailableBuffs() {
  const next = new Map<number, BuffDefinition>();
  for (const buff of getAvailableBuffDefinitions()) {
    next.set(buff.baseId, buff);
  }
  overlayRuntime.buffDefinitions = next;
}

function ensureActiveProfileDefaults() {
  const profile = activeProfile();
  if (
    profile &&
    (!profile.overlayPositions ||
      !profile.overlaySizes ||
      !profile.overlayVisibility ||
      !profile.buffDisplayMode ||
      !profile.buffGroups ||
      !profile.customPanelGroups ||
      !profile.customPanelStyle ||
      !profile.textBuffPanelStyle ||
      !profile.textBuffMaxVisible)
  ) {
    updateActiveProfile((profile) => ({
      ...profile,
      overlayPositions: ensureOverlayPositions(profile),
      overlaySizes: ensureOverlaySizes(profile),
      overlayVisibility: ensureOverlayVisibility(profile),
      buffDisplayMode: profile.buffDisplayMode ?? "individual",
      buffGroups: ensureBuffGroups(profile),
      individualMonitorAllGroup: ensureIndividualMonitorAllGroup(profile),
      customPanelGroups: ensureCustomPanelGroups(profile),
      inlineBuffEntries: [],
      customPanelStyle: ensureCustomPanelStyle(profile),
      textBuffPanelStyle: ensureTextBuffPanelStyle(profile),
      textBuffMaxVisible: Math.max(
        1,
        Math.min(20, profile.textBuffMaxVisible ?? 10),
      ),
    }));
  }
}
