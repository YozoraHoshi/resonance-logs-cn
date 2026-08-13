import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands, type LivePullWindow } from "$lib/bindings";

export const LIVE_PULL_GATE_EVENT = "live-pull-gate";

export type LivePullGateTarget = {
  setActive(active: boolean): void;
};

export function listenLivePullGate(
  target: LivePullGateTarget,
): Promise<UnlistenFn> {
  return listen<boolean>(LIVE_PULL_GATE_EVENT, (event) => {
    target.setActive(event.payload);
  });
}

/**
 * A low-frequency lifecycle signal for the per-window live pull loop.
 * Data remains invoke-only; this event only starts or stops the timer.
 */
export async function emitLivePullGate(
  window: WebviewWindow,
  active: boolean,
): Promise<void> {
  try {
    await commands.setLivePullActive(window.label as LivePullWindow, active);
  } catch (error) {
    console.error(
      `[live-pull] failed to update backend gate for ${window.label} active=${active}`,
      error,
    );
  }
  try {
    await window.emit(LIVE_PULL_GATE_EVENT, active);
  } catch (error) {
    console.error(
      `[live-pull] failed to set ${window.label} active=${active}`,
      error,
    );
  }
}
