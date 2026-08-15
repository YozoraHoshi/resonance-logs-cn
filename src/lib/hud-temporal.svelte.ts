import { createDeadlineScheduler } from "./hud-scheduler.svelte.js";

const CLOCK_INTERVAL_MS = 100;

export type HudAlertState = {
  highlightColor: string;
  flash: boolean;
  flashIntervalMs: number;
  applyToProgress: boolean;
};

export type HudTemporalValue = {
  deadlineMs: number;
  durationMs: number;
  alert?: {
    thresholdMs: number;
    state: HudAlertState;
  };
};

const overlayClock = $state({
  nowMs: Date.now(),
});
let overlayClockTimerId: number | null = null;
let overlayClockCleanup: (() => void) | null = null;

const projectionRevisions = $state<Record<string, number>>({});
const projectionDeadlines = new Map<string, number>();
const activeTimelines = $state({ count: 0 });
let projectionScheduler: ReturnType<typeof createDeadlineScheduler> | null =
  null;

function getAlignedNowMs(timestamp = Date.now()) {
  return timestamp - (timestamp % CLOCK_INTERVAL_MS);
}

function refreshOverlayClockNow(timestamp = Date.now()) {
  overlayClock.nowMs = getAlignedNowMs(timestamp);
}

function clearOverlayClockTimer() {
  if (overlayClockTimerId === null) return;
  window.clearTimeout(overlayClockTimerId);
  overlayClockTimerId = null;
}

function scheduleNextOverlayClockTick() {
  clearOverlayClockTimer();
  const now = Date.now();
  const remainder = now % CLOCK_INTERVAL_MS;
  const delay =
    remainder === 0 ? CLOCK_INTERVAL_MS : CLOCK_INTERVAL_MS - remainder;
  overlayClockTimerId = window.setTimeout(() => {
    refreshOverlayClockNow();
    scheduleNextOverlayClockTick();
  }, delay);
}

function nearestProjectionDeadline(): number | null {
  let nearest: number | null = null;
  for (const deadlineMs of projectionDeadlines.values()) {
    if (nearest === null || deadlineMs < nearest) nearest = deadlineMs;
  }
  return nearest;
}

function rescheduleProjectionDeadline() {
  if (typeof window === "undefined") return;
  projectionScheduler ??= createDeadlineScheduler(
    (firedDeadlineMs) => {
      const cutoff = Math.max(Date.now(), firedDeadlineMs);
      const expiredSources: string[] = [];
      for (const [source, deadlineMs] of projectionDeadlines) {
        if (deadlineMs > cutoff) continue;
        projectionDeadlines.delete(source);
        expiredSources.push(source);
      }
      for (const source of expiredSources) {
        projectionRevisions[source] = (projectionRevisions[source] ?? 0) + 1;
      }
      rescheduleProjectionDeadline();
    },
    {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
    },
  );
  projectionScheduler.schedule(nearestProjectionDeadline());
}

export function overlayNow() {
  return overlayClock.nowMs;
}

export function refreshOverlayClock() {
  refreshOverlayClockNow();
}

export function initOverlayClock() {
  if (overlayClockCleanup) {
    return overlayClockCleanup;
  }

  if (typeof window === "undefined") {
    return () => {};
  }

  const resyncOverlayClock = () => {
    refreshOverlayClockNow();
    scheduleNextOverlayClockTick();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      resyncOverlayClock();
    }
  };

  resyncOverlayClock();
  window.addEventListener("focus", resyncOverlayClock);
  window.addEventListener("pageshow", resyncOverlayClock);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  overlayClockCleanup = () => {
    clearOverlayClockTimer();
    window.removeEventListener("focus", resyncOverlayClock);
    window.removeEventListener("pageshow", resyncOverlayClock);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    overlayClockCleanup = null;
  };

  return overlayClockCleanup;
}

export function setOverlayClockActive(active: boolean) {
  if (active) {
    if (!overlayClockCleanup) initOverlayClock();
    return;
  }
  overlayClockCleanup?.();
}

export function createHudTimelineHandle() {
  let active = false;
  let disposed = false;
  return {
    setActive(nextActive: boolean) {
      if (disposed || active === nextActive) return;
      active = nextActive;
      activeTimelines.count += nextActive ? 1 : -1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) activeTimelines.count -= 1;
      active = false;
    },
  };
}

export function hasRegisteredHudTimeline() {
  return activeTimelines.count > 0;
}

export function hudProjectionRevision(source: string) {
  return projectionRevisions[source] ?? 0;
}

export function setHudProjectionDeadline(
  source: string,
  deadlineMs: number | null,
) {
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) {
    projectionDeadlines.delete(source);
  } else {
    projectionDeadlines.set(source, deadlineMs);
  }
  rescheduleProjectionDeadline();
}

export function clearHudProjectionDeadline(source: string) {
  projectionDeadlines.delete(source);
  rescheduleProjectionDeadline();
}

export function hudTemporalRemainingMs(
  temporal: HudTemporalValue,
  nowMs: number,
) {
  return Math.max(0, temporal.deadlineMs - nowMs);
}

export function hudTemporalProgressPercent(
  temporal: HudTemporalValue,
  nowMs: number,
) {
  if (temporal.durationMs <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      100,
      (hudTemporalRemainingMs(temporal, nowMs) / temporal.durationMs) * 100,
    ),
  );
}

export function hudTemporalAlert(
  temporal: HudTemporalValue,
  nowMs: number,
): HudAlertState | undefined {
  const alert = temporal.alert;
  if (!alert) return undefined;
  return hudTemporalRemainingMs(temporal, nowMs) <= alert.thresholdMs
    ? alert.state
    : undefined;
}
