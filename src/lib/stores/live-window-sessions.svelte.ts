import {
  commands,
  type GameOverlayFrame,
  type LiveWindowFrame,
  type MinimapOverlayFrame,
  type MonsterOverlayFrame,
  type Result,
} from "$lib/bindings";
export type { MinimapOverlayFrame } from "$lib/bindings";
import { liveDebugError, liveDebugLog } from "$lib/live-debug";
import { LivePullLoop } from "$lib/live-pull-loop";
import type { LiveTopicStatus } from "$lib/stores/live-topic-store.svelte";
import {
  liveBuffsStore,
  liveCombatStore,
  liveDeathsStore,
  liveFantasyStore,
  liveMonsterStore,
  liveStatusStore,
} from "$lib/stores/live-topics.svelte";

type Revisioned = { revision: number };
type ResettableTopicStore = {
  data: Revisioned | null;
  clear: (status?: LiveTopicStatus) => void;
};
type WindowFrame = { active: boolean; epoch: number };

export type WindowPullSession = {
  start: () => void;
  stop: () => void;
  setActive: (active: boolean) => void;
};

type TopicWindowSessionOptions<TFrame extends WindowFrame> = {
  label: string;
  activeTopics: () => ResettableTopicStore[];
  allTopics: ResettableTopicStore[];
  pull: (epoch: number | null) => Promise<TFrame>;
  apply: (frame: TFrame, epochChanged: boolean) => void;
};

class TopicWindowSession<TFrame extends WindowFrame>
  implements WindowPullSession
{
  readonly #label: string;
  readonly #activeTopics: () => ResettableTopicStore[];
  readonly #allTopics: ResettableTopicStore[];
  readonly #pullFrame: (epoch: number | null) => Promise<TFrame>;
  readonly #applyFrame: (frame: TFrame, epochChanged: boolean) => void;
  readonly #loop: LivePullLoop<TFrame>;

  #started = false;
  #active = false;
  #epoch: number | null = null;

  constructor(options: TopicWindowSessionOptions<TFrame>) {
    this.#label = options.label;
    this.#activeTopics = options.activeTopics;
    this.#allTopics = options.allTopics;
    this.#pullFrame = options.pull;
    this.#applyFrame = options.apply;
    this.#loop = new LivePullLoop({
      pull: () => this.#pullFrame(this.#epoch),
      onFrame: (frame) => this.#handleFrame(frame),
      onError: (error) => this.#handleError(error),
    });
  }

  get started(): boolean {
    return this.#started;
  }

  get active(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#started) return;

    this.#started = true;
    this.#active = true;
    this.#epoch = null;
    clearTopics(this.#allTopics);
    clearTopics(this.#activeTopics(), { state: "loading" });
    this.#loop.start();
  }

  stop(): void {
    if (!this.#started) return;

    this.#started = false;
    this.#active = false;
    this.#epoch = null;
    this.#loop.stop();
    clearTopics(this.#allTopics);
  }

  setActive(active: boolean): void {
    if (this.#active === active) return;

    this.#active = active;
    if (active && this.#started) {
      clearTopics(this.#activeTopics(), { state: "loading" });
    } else if (!active) {
      clearTopics(this.#allTopics);
    }
    this.#loop.setActive(active);
  }

  #handleFrame(frame: TFrame): void {
    if (!frame.active) {
      this.#epoch = frame.epoch;
      this.setActive(false);
      return;
    }

    const epochChanged = this.#epoch !== null && this.#epoch !== frame.epoch;
    if (epochChanged) {
      clearTopics(this.#activeTopics(), { state: "loading" });
    }
    this.#epoch = frame.epoch;
    this.#applyFrame(frame, epochChanged);
  }

  #handleError(error: unknown): void {
    const message = liveDebugError(error);
    for (const topic of this.#activeTopics()) {
      if (topic.data === null) {
        topic.clear({ state: "error", message });
      }
    }
    console.error(`[live-pull] ${this.#label} frame failed`, error);
    liveDebugLog(
      `live_pull_failed window=${this.#label} error=${message}`,
      "error",
    );
  }
}

class LiveWindowPullSession implements WindowPullSession {
  #includeDeaths = false;

  readonly #session = new TopicWindowSession<LiveWindowFrame>({
    label: "live",
    activeTopics: () => [
      liveCombatStore,
      liveFantasyStore,
      ...(this.#includeDeaths ? [liveDeathsStore] : []),
    ],
    allTopics: [liveCombatStore, liveFantasyStore, liveDeathsStore],
    pull: async (epoch) =>
      unwrapResult(
        commands.pullLiveWindowFrame({
          epoch,
          combatRevision: revisionOf(liveCombatStore.data),
          fantasyRevision: revisionOf(liveFantasyStore.data),
          deathsRevision: this.#includeDeaths
            ? revisionOf(liveDeathsStore.data)
            : null,
          includeDeaths: this.#includeDeaths,
        }),
      ),
    apply: (frame) => {
      if (frame.combat) liveCombatStore.apply(frame.combat);
      if (frame.fantasy) liveFantasyStore.apply(frame.fantasy);
      if (this.#includeDeaths && frame.deaths) {
        liveDeathsStore.apply(frame.deaths);
      }
    },
  });

  start(): void {
    this.#session.start();
    if (!this.#includeDeaths) liveDeathsStore.clear();
  }

  stop(): void {
    this.#includeDeaths = false;
    this.#session.stop();
  }

  setActive(active: boolean): void {
    this.#session.setActive(active);
    if (!this.#includeDeaths) liveDeathsStore.clear();
  }

  setIncludeDeaths(includeDeaths: boolean): void {
    if (this.#includeDeaths === includeDeaths) return;

    this.#includeDeaths = includeDeaths;
    if (!includeDeaths) {
      liveDeathsStore.clear();
    } else if (this.#session.started && this.#session.active) {
      liveDeathsStore.clear({ state: "loading" });
    }
  }
}

export const liveWindowSession = new LiveWindowPullSession();

export const gameOverlaySession: WindowPullSession =
  new TopicWindowSession<GameOverlayFrame>({
    label: "game-overlay",
    activeTopics: () => [liveStatusStore, liveBuffsStore],
    allTopics: [liveStatusStore, liveBuffsStore],
    pull: async (epoch) =>
      unwrapResult(
        commands.pullGameOverlayFrame({
          epoch,
          statusRevision: revisionOf(liveStatusStore.data),
          buffsRevision: revisionOf(liveBuffsStore.data),
        }),
      ),
    apply: (frame) => {
      if (frame.status) liveStatusStore.apply(frame.status);
      if (frame.buffs) liveBuffsStore.apply(frame.buffs);
    },
  });

export const monsterOverlaySession: WindowPullSession =
  new TopicWindowSession<MonsterOverlayFrame>({
    label: "monster-overlay",
    activeTopics: () => [liveMonsterStore, liveFantasyStore],
    allTopics: [liveMonsterStore, liveFantasyStore],
    pull: async (epoch) =>
      unwrapResult(
        commands.pullMonsterOverlayFrame({
          epoch,
          monsterRevision: revisionOf(liveMonsterStore.data),
          fantasyRevision: revisionOf(liveFantasyStore.data),
        }),
      ),
    apply: (frame) => {
      if (frame.monster) liveMonsterStore.apply(frame.monster);
      if (frame.fantasy) liveFantasyStore.apply(frame.fantasy);
    },
  });

export type MinimapFrameContext = {
  epochChanged: boolean;
};

export type MinimapFrameHandler = (
  frame: MinimapOverlayFrame,
  context: MinimapFrameContext,
) => void;

class MinimapOverlayPullSession implements WindowPullSession {
  readonly #loop = new LivePullLoop<MinimapOverlayFrame>({
    pull: () =>
      unwrapResult(
        commands.pullMinimapOverlayFrame({
          epoch: this.#epoch,
          snapshotRevision: this.#snapshotRevision,
          skillCastCursor: this.#skillCastCursor,
        }),
      ),
    onFrame: (frame) => this.#handleFrame(frame),
    onError: (error) => {
      const message = liveDebugError(error);
      console.error("[live-pull] minimap-overlay frame failed", error);
      liveDebugLog(
        `live_pull_failed window=minimap-overlay error=${message}`,
        "error",
      );
    },
  });

  #started = false;
  #active = false;
  #epoch: number | null = null;
  #snapshotRevision: number | null = null;
  #skillCastCursor: number | null = null;
  #handler: MinimapFrameHandler | null = null;

  start(): void {
    if (this.#started) return;

    this.#started = true;
    this.#active = true;
    this.#resetProtocolState();
    this.#loop.start();
  }

  stop(): void {
    if (!this.#started) return;

    this.#started = false;
    this.#active = false;
    this.#loop.stop();
    this.#resetProtocolState();
  }

  setActive(active: boolean): void {
    if (this.#active === active) return;

    this.#active = active;
    if (!active) {
      // A null cursor makes the first resumed request an initial pull. Rust
      // advances the cursor but deliberately omits casts accumulated while
      // this window was hidden.
      this.#skillCastCursor = null;
    }
    this.#loop.setActive(active);
  }

  setFrameHandler(handler: MinimapFrameHandler | null): void {
    this.#handler = handler;
  }

  #handleFrame(frame: MinimapOverlayFrame): void {
    if (!frame.active) {
      this.#epoch = frame.epoch;
      this.setActive(false);
      return;
    }

    const epochChanged = this.#epoch !== null && this.#epoch !== frame.epoch;
    if (epochChanged) {
      this.#snapshotRevision = null;
      this.#skillCastCursor = null;
    }

    this.#epoch = frame.epoch;
    if (frame.snapshot) {
      this.#snapshotRevision = frame.snapshot.revision;
    }
    this.#skillCastCursor = frame.skillCastCursor;
    this.#handler?.(frame, { epochChanged });
  }

  #resetProtocolState(): void {
    this.#epoch = null;
    this.#snapshotRevision = null;
    this.#skillCastCursor = null;
  }
}

export const minimapOverlaySession = new MinimapOverlayPullSession();

function revisionOf(value: Revisioned | null): number | null {
  return value?.revision ?? null;
}

function clearTopics(
  topics: ResettableTopicStore[],
  status: LiveTopicStatus = { state: "idle" },
): void {
  for (const topic of topics) topic.clear(status);
}

async function unwrapResult<T>(
  promise: Promise<Result<T, string>>,
): Promise<T> {
  const result = await promise;
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}
