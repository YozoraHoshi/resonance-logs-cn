export type DisplayClockAnchors = {
  startedAtWallMs: number;
  accumulatedPausedMs: number;
  pausedAtWallMs: number | null;
  endedAtWallMs: number | null;
};

export function displayElapsedMs(
  clock: DisplayClockAnchors | null | undefined,
  nowMs: number,
): number {
  if (clock == null || clock.startedAtWallMs <= 0) {
    return 0;
  }
  const stop = clock.endedAtWallMs ?? clock.pausedAtWallMs ?? nowMs;
  return Math.max(0, stop - clock.startedAtWallMs - clock.accumulatedPausedMs);
}

export function isLiveDisplayClockRunning(
  clock: DisplayClockAnchors | null | undefined,
): boolean {
  return (
    clock != null &&
    clock.startedAtWallMs > 0 &&
    clock.endedAtWallMs == null &&
    clock.pausedAtWallMs == null
  );
}
