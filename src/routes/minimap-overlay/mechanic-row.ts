import type { MinimapEntity } from "$lib/api";
import type { MechanicRowTarget } from "./scene-types";

export function toMechanicTargets(
  entity: MinimapEntity | undefined,
  localPlayerUuid: string | null | undefined,
  displayName: (entity: MinimapEntity) => string,
): MechanicRowTarget[] {
  if (!entity) return [];
  return [
    {
      uuid: entity.entityUuid,
      name: displayName(entity),
      isLocal: entity.entityUuid === localPlayerUuid,
    },
  ];
}

export function mergeMechanicTargets(
  existing: MechanicRowTarget[],
  incoming: MechanicRowTarget[],
): void {
  for (const target of incoming) {
    if (existing.some((item) => item.uuid === target.uuid)) continue;
    existing.push(target);
  }
}

export function sortLocalFirst<T extends { isLocal: boolean }>(
  targets: readonly T[],
): T[] {
  return [...targets].sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
}
