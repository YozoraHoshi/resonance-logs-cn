import { describe, expect, it } from "vitest";
import {
  displayElapsedMs,
  isLiveDisplayClockRunning,
  type DisplayClockAnchors,
} from "./live-display-clock";

function clock(
  overrides: Partial<DisplayClockAnchors> = {},
): DisplayClockAnchors {
  return {
    startedAtWallMs: 1_000,
    accumulatedPausedMs: 0,
    pausedAtWallMs: null,
    endedAtWallMs: null,
    ...overrides,
  };
}

describe("displayElapsedMs", () => {
  it("returns 0 without a clock or a real start", () => {
    expect(displayElapsedMs(null, 5_000)).toBe(0);
    expect(displayElapsedMs(undefined, 5_000)).toBe(0);
    expect(displayElapsedMs(clock({ startedAtWallMs: 0 }), 5_000)).toBe(0);
  });

  it("advances with now while recording, including combat gaps", () => {
    const recording = clock();
    expect(displayElapsedMs(recording, 1_000)).toBe(0);
    expect(displayElapsedMs(recording, 3_500)).toBe(2_500);
  });

  it("freezes at pausedAt while a pause is open", () => {
    const paused = clock({ pausedAtWallMs: 4_000, accumulatedPausedMs: 200 });
    expect(displayElapsedMs(paused, 4_000)).toBe(2_800);
    expect(displayElapsedMs(paused, 9_000)).toBe(2_800);
  });

  it("resumes from the folded pause once pausedAt clears", () => {
    const resumed = clock({ accumulatedPausedMs: 2_000 });
    expect(displayElapsedMs(resumed, 8_000)).toBe(5_000);
  });

  it("stays at the drop instant after endedAt is stamped", () => {
    const ended = clock({
      accumulatedPausedMs: 500,
      endedAtWallMs: 10_000,
    });
    expect(displayElapsedMs(ended, 10_000)).toBe(8_500);
    expect(displayElapsedMs(ended, 20_000)).toBe(8_500);
  });
});

describe("isLiveDisplayClockRunning", () => {
  it("is only true for an unended, unpaused segment", () => {
    expect(isLiveDisplayClockRunning(null)).toBe(false);
    expect(isLiveDisplayClockRunning(clock())).toBe(true);
    expect(isLiveDisplayClockRunning(clock({ pausedAtWallMs: 2_000 }))).toBe(
      false,
    );
    expect(isLiveDisplayClockRunning(clock({ endedAtWallMs: 2_000 }))).toBe(
      false,
    );
  });
});
