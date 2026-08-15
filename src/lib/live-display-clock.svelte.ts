import { isLiveDisplayClockRunning, type DisplayClockAnchors } from "./live-display-clock";

const CLOCK_INTERVAL_MS = 1_000;

const displayNow = $state({
  nowMs: Date.now(),
});

let timerId: number | null = null;
let cleanup: (() => void) | null = null;
let active = false;

function alignedNowMs(timestamp = Date.now()) {
  return timestamp - (timestamp % CLOCK_INTERVAL_MS);
}

function refreshNow(timestamp = Date.now()) {
  displayNow.nowMs = alignedNowMs(timestamp);
}

function clearTimer() {
  if (timerId === null) return;
  window.clearTimeout(timerId);
  timerId = null;
}

function scheduleNextTick() {
  clearTimer();
  if (typeof window === "undefined") return;
  const now = Date.now();
  const remainder = now % CLOCK_INTERVAL_MS;
  const delay =
    remainder === 0 ? CLOCK_INTERVAL_MS : CLOCK_INTERVAL_MS - remainder;
  timerId = window.setTimeout(() => {
    refreshNow();
    scheduleNextTick();
  }, delay);
}

export function liveDisplayNow() {
  return displayNow.nowMs;
}

export function initLiveDisplayClock() {
  if (cleanup) return cleanup;
  if (typeof window === "undefined") {
    return () => {};
  }

  const resync = () => {
    if (!active) return;
    refreshNow();
    scheduleNextTick();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      resync();
    }
  };

  window.addEventListener("focus", resync);
  window.addEventListener("pageshow", resync);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  cleanup = () => {
    active = false;
    clearTimer();
    window.removeEventListener("focus", resync);
    window.removeEventListener("pageshow", resync);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    cleanup = null;
  };
  return cleanup;
}

export function setLiveDisplayClockActive(nextActive: boolean) {
  if (active === nextActive) return;
  active = nextActive;
  if (typeof window === "undefined") return;
  if (nextActive) {
    if (!cleanup) initLiveDisplayClock();
    refreshNow();
    scheduleNextTick();
    return;
  }
  clearTimer();
}

export function syncLiveDisplayClock(clock: DisplayClockAnchors | null | undefined) {
  setLiveDisplayClockActive(isLiveDisplayClockRunning(clock));
}

export function stopLiveDisplayClock() {
  cleanup?.();
}
