export type HudTimerHandle = number;

export type HudDeadlineTimerApi = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => HudTimerHandle;
  clearTimeout: (handle: HudTimerHandle) => void;
};

export type HudFrameApi = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
};

export function createDeadlineScheduler(
  onDeadline: (deadlineMs: number) => void,
  api: HudDeadlineTimerApi,
) {
  let timer: HudTimerHandle | null = null;
  let deadlineMs: number | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    api.clearTimeout(timer);
    timer = null;
  };

  return {
    schedule(nextDeadlineMs: number | null) {
      const normalizedDeadline =
        nextDeadlineMs !== null && Number.isFinite(nextDeadlineMs)
          ? nextDeadlineMs
          : null;
      if (normalizedDeadline === deadlineMs && timer !== null) return;

      cancelTimer();
      deadlineMs = normalizedDeadline;
      if (deadlineMs === null) return;

      const scheduledDeadline = deadlineMs;
      timer = api.setTimeout(
        () => {
          timer = null;
          deadlineMs = null;
          onDeadline(scheduledDeadline);
        },
        Math.max(0, scheduledDeadline - api.now()),
      );
    },
    cancel() {
      cancelTimer();
      deadlineMs = null;
    },
    pendingDeadline() {
      return deadlineMs;
    },
  };
}

export function createFrameInvalidator(draw: () => void, api: HudFrameApi) {
  let frameHandle: number | null = null;

  return {
    invalidate() {
      if (frameHandle !== null) return;
      frameHandle = api.request(() => {
        frameHandle = null;
        draw();
      });
    },
    cancel() {
      if (frameHandle === null) return;
      api.cancel(frameHandle);
      frameHandle = null;
    },
    isPending() {
      return frameHandle !== null;
    },
  };
}

export function browserFrameApi(): HudFrameApi {
  return {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
  };
}
