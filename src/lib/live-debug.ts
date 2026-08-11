/**
 * @file Frontend-to-backend log bridge. Packaged builds have no visible
 * console, so frontend failures would otherwise be silent; this bridge writes
 * them into the same rotating log file under the `app::live` target (kept at
 * info level in release builds).
 *
 * Fire-and-forget: logging must never affect app behavior. The invoke request
 * reaches Rust even when the webview cannot run eval scripts, so error reports
 * still land in the log when the window is in a bad state.
 */
import { invoke } from "@tauri-apps/api/core";

export type LiveDebugLevel = "info" | "warn" | "error";

export function liveDebugLog(
  message: string,
  level: LiveDebugLevel = "info",
): void {
  invoke("frontend_log", { level, message }).catch(() => {});
}

/** Best-effort error description; Tauri invoke errors are often plain strings. */
export function liveDebugError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
