import { describe, expect, it, vi } from "vitest";

import {
  createDeadlineScheduler,
  createFrameInvalidator,
} from "./hud-scheduler.svelte";

describe("HUD one-shot scheduling", () => {
  it("fires a monster projection deadline without recursively scheduling", () => {
    let now = 100;
    const scheduled: Array<() => void> = [];
    const setTimeout = vi.fn((callback: () => void) => {
      scheduled.push(callback);
      return 1;
    });
    const clearTimeout = vi.fn();
    const onDeadline = vi.fn();
    const scheduler = createDeadlineScheduler(onDeadline, {
      now: () => now,
      setTimeout,
      clearTimeout,
    });

    scheduler.schedule(250);
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 150);

    now = 250;
    expect(scheduled[0]).toBeDefined();
    scheduled[0]?.();

    expect(onDeadline).toHaveBeenCalledOnce();
    expect(onDeadline).toHaveBeenCalledWith(250);
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingDeadline()).toBeNull();
  });

  it("coalesces dirty canvas invalidations into one animation frame", () => {
    const pendingFrames: FrameRequestCallback[] = [];
    const request = vi.fn((callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return 7;
    });
    const cancel = vi.fn();
    const draw = vi.fn();
    const invalidator = createFrameInvalidator(draw, { request, cancel });

    invalidator.invalidate();
    invalidator.invalidate();
    invalidator.invalidate();
    expect(request).toHaveBeenCalledOnce();

    expect(pendingFrames[0]).toBeDefined();
    pendingFrames[0]?.(16);

    expect(draw).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(invalidator.isPending()).toBe(false);

    invalidator.invalidate();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
