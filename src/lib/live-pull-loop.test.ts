import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LivePullLoop } from "./live-pull-loop";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("LivePullLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one invoke in flight and skips missed deadlines", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const pull = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onFrame = vi.fn();
    const loop = new LivePullLoop({ pull, onFrame });

    loop.start();
    expect(pull).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(pull).toHaveBeenCalledTimes(1);

    first.resolve(1);
    await flushPromises();
    expect(onFrame).toHaveBeenCalledWith(1);

    await vi.advanceTimersByTimeAsync(49);
    expect(pull).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(2);

    second.resolve(2);
    await flushPromises();
    loop.stop();
  });

  it("pauses timers and resumes with an immediate invoke", async () => {
    const pull = vi.fn(async () => 1);
    const loop = new LivePullLoop({ pull, onFrame: vi.fn() });

    loop.start();
    await flushPromises();
    expect(pull).toHaveBeenCalledTimes(1);

    loop.setActive(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pull).toHaveBeenCalledTimes(1);

    loop.setActive(true);
    expect(pull).toHaveBeenCalledTimes(2);
    await flushPromises();
    loop.stop();
  });

  it("drops a response from an earlier generation", async () => {
    const stale = deferred<number>();
    const pull = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(2);
    const onFrame = vi.fn();
    const loop = new LivePullLoop({ pull, onFrame });

    loop.start();
    loop.setActive(false);
    loop.setActive(true);
    expect(pull).toHaveBeenCalledTimes(1);

    stale.resolve(1);
    await flushPromises();

    expect(pull).toHaveBeenCalledTimes(2);
    await flushPromises();
    expect(onFrame).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledWith(2);
    loop.stop();
  });

  it("starts paused and refreshes changed request parameters without overlap", async () => {
    const stale = deferred<number>();
    const pull = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(2);
    const onFrame = vi.fn();
    const loop = new LivePullLoop({ pull, onFrame });

    loop.start(false);
    expect(pull).not.toHaveBeenCalled();

    loop.setActive(true);
    expect(pull).toHaveBeenCalledOnce();
    loop.refresh();
    expect(pull).toHaveBeenCalledOnce();

    stale.resolve(1);
    await flushPromises();

    expect(pull).toHaveBeenCalledTimes(2);
    await flushPromises();
    expect(onFrame).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledWith(2);
    loop.stop();
  });

  it("backs off exponentially and returns to the 50ms cadence", async () => {
    const pull = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"))
      .mockResolvedValue(4);
    const onError = vi.fn();
    const loop = new LivePullLoop({
      pull,
      onFrame: vi.fn(),
      onError,
    });

    loop.start();
    await flushPromises();
    expect(pull).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(pull).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(199);
    expect(pull).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(399);
    expect(pull).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(49);
    expect(pull).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(5);
    loop.stop();
  });
});
