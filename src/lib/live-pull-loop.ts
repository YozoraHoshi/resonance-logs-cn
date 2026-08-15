export type PullLoopTimer = ReturnType<typeof setTimeout>;

export type PullLoopScheduler = {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => PullLoopTimer;
  clearTimer: (timer: PullLoopTimer) => void;
};

export type LivePullLoopOptions<T> = {
  pull: () => Promise<T>;
  onFrame: (frame: T) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  maxBackoffMs?: number;
  scheduler?: PullLoopScheduler;
};

const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_MAX_BACKOFF_MS = 2_000;

const defaultScheduler: PullLoopScheduler = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
};

/**
 * Deadline-based, single-flight polling loop.
 *
 * Pausing or stopping advances the generation, so a response from an older
 * lifecycle cannot reach `onFrame`. A slow request never causes catch-up
 * bursts: the next deadline advances to the first interval strictly after
 * the current time.
 */
export class LivePullLoop<T> {
  readonly #pull: () => Promise<T>;
  readonly #onFrame: (frame: T) => void;
  readonly #onError: (error: unknown) => void;
  readonly #intervalMs: number;
  readonly #maxBackoffMs: number;
  readonly #scheduler: PullLoopScheduler;

  #started = false;
  #active = false;
  #inFlight = false;
  #resumePending = false;
  #generation = 0;
  #failures = 0;
  #deadlineMs = 0;
  #timer: PullLoopTimer | null = null;

  constructor(options: LivePullLoopOptions<T>) {
    this.#pull = options.pull;
    this.#onFrame = options.onFrame;
    this.#onError = options.onError ?? (() => {});
    this.#intervalMs = positiveDuration(
      options.intervalMs,
      DEFAULT_INTERVAL_MS,
    );
    this.#maxBackoffMs = Math.max(
      this.#intervalMs,
      positiveDuration(options.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS),
    );
    this.#scheduler = options.scheduler ?? defaultScheduler;
  }

  start(active = true): void {
    if (this.#started) return;

    this.#started = true;
    this.#active = active;
    this.#generation += 1;
    this.#failures = 0;
    this.#deadlineMs = this.#scheduler.now();
    if (active) this.#startImmediately();
  }

  stop(): void {
    if (!this.#started && !this.#active) return;

    this.#started = false;
    this.#active = false;
    this.#generation += 1;
    this.#failures = 0;
    this.#resumePending = false;
    this.#clearScheduledTimer();
  }

  setActive(active: boolean): void {
    if (this.#active === active) return;

    this.#active = active;
    this.#generation += 1;
    this.#failures = 0;
    this.#clearScheduledTimer();

    if (!this.#started || !active) {
      this.#resumePending = false;
      return;
    }

    this.#deadlineMs = this.#scheduler.now();
    this.#startImmediately();
  }

  /**
   * Invalidates an in-flight request whose request parameters changed and
   * starts a fresh generation without creating concurrent invokes.
   */
  refresh(): void {
    if (!this.#started || !this.#active) return;

    this.#generation += 1;
    this.#failures = 0;
    this.#clearScheduledTimer();
    this.#deadlineMs = this.#scheduler.now();
    this.#startImmediately();
  }

  #startImmediately(): void {
    if (this.#inFlight) {
      // Tauri invokes cannot be cancelled. Preserve strict single-flight and
      // start the resumed generation as soon as the stale invoke settles.
      this.#resumePending = true;
      return;
    }

    this.#resumePending = false;
    const generation = this.#generation;
    const deadlineMs = this.#deadlineMs;
    void this.#poll(generation, deadlineMs);
  }

  async #poll(generation: number, deadlineMs: number): Promise<void> {
    if (!this.#isCurrent(generation) || this.#inFlight) return;

    this.#inFlight = true;
    try {
      const frame = await this.#pull();
      if (!this.#isCurrent(generation)) return;

      this.#onFrame(frame);
      if (!this.#isCurrent(generation)) return;

      this.#failures = 0;
      this.#scheduleNextDeadline(generation, deadlineMs);
    } catch (error) {
      if (!this.#isCurrent(generation)) return;

      this.#onError(error);
      if (!this.#isCurrent(generation)) return;

      this.#failures += 1;
      this.#scheduleBackoff(generation);
    } finally {
      this.#inFlight = false;
      if (
        this.#resumePending &&
        this.#started &&
        this.#active &&
        generation !== this.#generation
      ) {
        this.#deadlineMs = this.#scheduler.now();
        this.#startImmediately();
      }
    }
  }

  #scheduleNextDeadline(generation: number, previousDeadlineMs: number): void {
    const now = this.#scheduler.now();
    let nextDeadlineMs = previousDeadlineMs + this.#intervalMs;

    if (nextDeadlineMs <= now) {
      const missedIntervals =
        Math.floor((now - nextDeadlineMs) / this.#intervalMs) + 1;
      nextDeadlineMs += missedIntervals * this.#intervalMs;
    }

    this.#deadlineMs = nextDeadlineMs;
    this.#schedule(generation, nextDeadlineMs - now);
  }

  #scheduleBackoff(generation: number): void {
    const exponent = Math.min(this.#failures, 30);
    const delayMs = Math.min(
      this.#intervalMs * 2 ** exponent,
      this.#maxBackoffMs,
    );
    this.#deadlineMs = this.#scheduler.now() + delayMs;
    this.#schedule(generation, delayMs);
  }

  #schedule(generation: number, delayMs: number): void {
    this.#clearScheduledTimer();
    this.#timer = this.#scheduler.setTimer(
      () => {
        this.#timer = null;
        if (!this.#isCurrent(generation)) return;
        this.#startImmediately();
      },
      Math.max(0, delayMs),
    );
  }

  #clearScheduledTimer(): void {
    if (this.#timer === null) return;
    this.#scheduler.clearTimer(this.#timer);
    this.#timer = null;
  }

  #isCurrent(generation: number): boolean {
    return this.#started && this.#active && generation === this.#generation;
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
