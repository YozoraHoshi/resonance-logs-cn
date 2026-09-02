import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands, type LivePullWindow } from "$lib/bindings";

export const LIVE_PULL_GATE_EVENT = "live-pull-gate";

export type LivePullGateTarget = {
  setActive(active: boolean): void;
};

export type LivePullGatePayload = {
  window: LivePullWindow;
  active: boolean;
};

export type LivePullGateWindow = {
  readonly label: string;
};

/**
 * Subscribes the given window's pull session to its own gate signal.
 *
 * `listen()` registers with an `Any` target, which Tauri matches
 * unconditionally - addressing the emit alone cannot keep one window's gate
 * out of another's WebView. The payload therefore carries the intended
 * window and is verified here, so `live` can never pause `hud-overlay`
 * (or vice versa) and blank its topic stores.
 */
export function listenLivePullGate(
  self: LivePullWindow,
  target: LivePullGateTarget,
): Promise<UnlistenFn> {
  return listen<LivePullGatePayload>(LIVE_PULL_GATE_EVENT, (event) => {
    if (event.payload.window !== self) return;
    target.setActive(event.payload.active);
  });
}

/**
 * A low-frequency lifecycle signal for the per-window live pull loop.
 * Data remains invoke-only; this event only starts or stops the timer.
 */
export async function emitLivePullGate(
  window: LivePullGateWindow,
  active: boolean,
): Promise<void> {
  const label = window.label as LivePullWindow;
  try {
    await commands.setLivePullActive(label, active);
  } catch (error) {
    console.error(
      `[live-pull] failed to update backend gate for ${label} active=${active}`,
      error,
    );
  }
  try {
    await emitTo(label, LIVE_PULL_GATE_EVENT, {
      window: label,
      active,
    } satisfies LivePullGatePayload);
  } catch (error) {
    console.error(
      `[live-pull] failed to set ${label} active=${active}`,
      error,
    );
  }
}
