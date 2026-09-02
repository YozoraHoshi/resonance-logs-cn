import { TIMELINE_PALETTE } from "./timeline-palette";
import type { Lane, TimelinePlayerMeta } from "./timeline-types";

/** Distinct teammate hues for the history chart. Avoids `mine` / `average` /
 * `boss` so overlay curves stay separable from the local player, the
 * cumulative-DPS series, and boss markers. */
const TEAMMATE_HUES = [
  "#34d399",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f472b6",
  "#4ade80",
  "#c084fc",
  "#e879f9",
  "#2dd4bf",
  "#818cf8",
  "#fdba74",
  "#5eead4",
  "#f0abfc",
  "#86efac",
] as const;

function hashEntityUuid(uuid: string): number {
  let hash = 2166136261;
  for (let i = 0; i < uuid.length; i += 1) {
    hash ^= uuid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Chart color for one combatant. Local player stays `mine` so skill lanes
 * and the primary curve keep their familiar blue; everyone else is a stable
 * hash of `entityUuid`, not class/spec. */
export function playerColor(player: TimelinePlayerMeta): string {
  if (player.isLocalPlayer) return TIMELINE_PALETTE.mine;
  if (!player.entityUuid) return TIMELINE_PALETTE.fallbackPlayer;
  const index = hashEntityUuid(player.entityUuid) % TEAMMATE_HUES.length;
  return TEAMMATE_HUES[index] ?? TIMELINE_PALETTE.fallbackPlayer;
}

export function laneColor(lane: Lane): string {
  switch (lane.type) {
    case "boss":
      return TIMELINE_PALETTE.boss;
    case "mine":
      return TIMELINE_PALETTE.mine;
    case "teammate":
      return playerColor(lane.player);
  }
}
