/**
 * @file Single source of truth for whether a HUD domain should be on screen.
 *
 * The three domains (game / monster / minimap) share one physical
 * `hud-overlay` window but each has its own enable switch, and two of the
 * three layer extra scene rules on top. Keeping the decision in one pure
 * function means the toggle buttons, the settings switches and the
 * scene-driven auto-hide all agree on the same answer instead of racing to
 * write visibility from three near-duplicate effects.
 */
import {
  isDailyScene,
  isSupportedMinimapScene,
} from "$lib/config/daily-scene-blacklist";
import type { HudDomain } from "$lib/hud-domain";

export type HudDomainRules = {
  /** Does the user want this monitor at all? Persisted per domain. */
  enabled: boolean;
  /** Hide while in a casual/daily scene. */
  autoHideInDailyScenes: boolean;
};

export type SceneVisibilityInput = HudDomainRules & {
  sceneId: number | null;
  /**
   * Domains whose content only exists for specific scenes. The backend only
   * publishes minimap data for registered scenes (see
   * `projections/minimap/scene.rs`), so an unsupported scene can only ever
   * render an empty panel.
   */
  requiresSupportedScene: boolean;
};

/**
 * Resolves a domain's visibility from its persisted intent plus the scene.
 *
 * Order matters: `enabled` is the user's explicit intent and outranks every
 * scene rule, so a disabled domain stays hidden regardless of scene.
 */
export function resolveSceneVisibility(input: SceneVisibilityInput): boolean {
  if (!input.enabled) return false;
  if (input.autoHideInDailyScenes && isDailyScene(input.sceneId)) return false;
  if (input.requiresSupportedScene && !isSupportedMinimapScene(input.sceneId)) {
    return false;
  }
  return true;
}

/** Only `minimap` has per-scene content; the other two work everywhere. */
export function domainRequiresSupportedScene(domain: HudDomain): boolean {
  return domain === "minimap";
}
