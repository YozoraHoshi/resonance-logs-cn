import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { liveDebugError, liveDebugLog } from "$lib/live-debug";

export type LiveTopicStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

type Revisioned = { revision: number };
type BootstrapResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

/**
 * Replace-only state for one pulled live topic.
 *
 * Window sessions own transport and lifecycle. This store only accepts a
 * revisioned value or clears it, while protecting consumers from a late
 * lower-revision frame within the same backend epoch.
 */
export class LiveTopicStore<T extends Revisioned> {
  data = $state.raw<T | null>(null);
  status = $state.raw<LiveTopicStatus>({ state: "idle" });

  apply(next: T): void {
    if (this.data && next.revision < this.data.revision) return;
    this.data = next;
    this.status = { state: "ready" };
  }

  clear(status: LiveTopicStatus = { state: "idle" }): void {
    this.data = null;
    this.status = status;
  }
}

/**
 * The main window keeps `live-scene` as a low-frequency event stream. It is
 * intentionally isolated from the invoke-only stores used by overlay windows.
 */
export class LiveSceneEventStore<
  T extends Revisioned,
> extends LiveTopicStore<T> {
  readonly #eventName: string;
  readonly #bootstrap: () => Promise<BootstrapResult<T>>;
  #connectPromise: Promise<void> | null = null;
  #unlisten: UnlistenFn | null = null;
  #consumers = 0;

  constructor(eventName: string, bootstrap: () => Promise<BootstrapResult<T>>) {
    super();
    this.#eventName = eventName;
    this.#bootstrap = bootstrap;
  }

  async connect(): Promise<() => void> {
    this.#consumers += 1;
    try {
      if (!this.#connectPromise) {
        this.clear({ state: "loading" });
        this.#connectPromise = this.#connect();
      }
      await this.#connectPromise;
    } catch (error) {
      this.#consumers -= 1;
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#consumers -= 1;
      if (this.#consumers > 0) return;

      this.#unlisten?.();
      this.#unlisten = null;
      this.#connectPromise = null;
      this.clear();
    };
  }

  async #connect(): Promise<void> {
    try {
      this.#unlisten = await listen<T>(this.#eventName, (event) => {
        this.apply(event.payload);
      });

      const result = await this.#bootstrap();
      if (result.status === "error") throw new Error(result.error);
      this.apply(result.data);
    } catch (error) {
      this.#unlisten?.();
      this.#unlisten = null;
      this.#connectPromise = null;
      this.clear({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      // Packaged builds have no visible console; a silent failure here leaves
      // the window permanently empty, so surface it in the backend log file.
      liveDebugLog(
        `live_topic_connect_failed topic=${this.#eventName} error=${liveDebugError(error)}`,
        "error",
      );
      throw error;
    }
  }
}
