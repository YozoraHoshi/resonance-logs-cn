import { afterEach, describe, expect, it } from "vitest";
import {
  createHudTimelineHandle,
  hasRegisteredHudTimeline,
  hudTemporalProgressPercent,
} from "./hud-temporal.svelte";

const handles: Array<ReturnType<typeof createHudTimelineHandle>> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

describe("HUD temporal channel", () => {
  it("computes remaining progress from one anchored percentage", () => {
    expect(
      hudTemporalProgressPercent({ deadlineMs: 1_000, durationMs: 1_000 }, 250),
    ).toBe(75);
  });

  it("unregisters the shared clock when the last timeline becomes inactive", () => {
    const first = createHudTimelineHandle();
    const second = createHudTimelineHandle();
    handles.push(first, second);

    first.setActive(true);
    second.setActive(true);
    expect(hasRegisteredHudTimeline()).toBe(true);

    first.setActive(false);
    expect(hasRegisteredHudTimeline()).toBe(true);

    second.dispose();
    expect(hasRegisteredHudTimeline()).toBe(false);
  });
});
