export type HudDomain = "game" | "monster" | "minimap";

export type HudDomainVisibility = Record<HudDomain, boolean>;

export function isHudDomain(value: string): value is HudDomain {
  return value === "game" || value === "monster" || value === "minimap";
}

export function shouldShowHudWindow(
  visibility: HudDomainVisibility,
  editing: boolean,
): boolean {
  return editing || visibility.game || visibility.monster || visibility.minimap;
}
