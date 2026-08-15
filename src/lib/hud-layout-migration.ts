export type HudLayoutOffset = {
  x: number;
  y: number;
};

export type HudViewport = {
  width: number;
  height: number;
};

type PanelRect = {
  x: number;
  y: number;
  width: number;
  scale?: number;
};

export function translateHudPanelRect<T extends PanelRect>(
  rect: T,
  offset: HudLayoutOffset,
  viewport: HudViewport,
): T {
  return {
    ...rect,
    x: clamp(rect.x + offset.x, 0, Math.max(0, viewport.width - 24)),
    y: clamp(rect.y + offset.y, 0, Math.max(0, viewport.height - 24)),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
