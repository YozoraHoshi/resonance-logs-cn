import type {
  MinimapBuffFact,
  MinimapEntity,
  MinimapSkillCast,
  MinimapSnapshot,
} from "$lib/api";
import { t, type MessageKey } from "$lib/i18n/index.svelte";
import { overlayNow } from "../../../game-overlay/overlay-clock.svelte.js";
import { mergeMechanicTargets, toMechanicTargets } from "../../mechanic-row";
import type {
  MechanicRegion,
  MechanicRow,
  MinimapVoiceCueDef,
  MinimapVoiceCueFire,
} from "../../scene-types";
import {
  resolveBuffVoiceCues,
  resolveSkillVoiceCues,
} from "../../voice-cue-utils";

export type WastelandCourtMechanicView = {
  regions: MechanicRegion[];
  rows: MechanicRow[];
  entityColorSlots: Map<string, number>;
};

export type PairColor = "white" | "black";

export type PairMark = {
  slots: [PairColor, PairColor, PairColor];
  lockIndex: 1 | 2 | 3;
  target: PairColor;
  alreadyMatched: boolean;
};

const BOSS_MONSTER_IDS = new Set([4701, 4711]);
const CLONE_MONSTER_ID = 4702;
const PAIR_ORB_MONSTER_ID = 470131;

const PAIR_RENDER_BUFF_ID = 884659;
const PAIR_SWAP_BUFF_ID = 884664;
const PAIR_SETTLE_BUFF_ID = 884660;
const PAIR_PENALTY_BUFF_ID = 884661;
const PAIR_SETTLE_SKILL_ID = 470125;
const PAIR_RESOLVE_SKILL_ID = 470132;
const PAIR_WINDOW_MS = 25_000;
const PAIR_LOCK_OFFSET = 6;
const ORB_RADIUS = 2.5;

const WHEEL_BLUE_BUFF_ID = 884614;
const WHEEL_RED_BUFF_ID = 884615;
const WHEEL_DOOM_BUFF_ID = 884616;

const SHADOW_SKILL_ID = 470119;
const ENERGY_TARGET_BUFF_ID = 884641;
const ENERGY_BALL_MONSTER_IDS = new Set([
  884640, 884668, 884669, 884670, 884671,
]);
const STAR_POOL_MONSTER_ID = 884642;
const ENERGY_BALL_RADIUS = 1.2;
const STAR_POOL_RADIUS = 1.5;

const CHAIN_NEAR_BUFF_ID = 884609;
const CHAIN_FAR_BUFF_ID = 884610;
const CHAIN_NEAR_SKILL_ID = 470112;
const CHAIN_FAR_SKILL_ID = 470113;
const CHAIN_MONSTER_IDS = new Set([884606, 884607]);
const CHAIN_CAST_ROW_MS = 4_000;

const COLOR_SLOT_BOSS = 3;
const COLOR_SLOT_CLONE = 5;
const COLOR_SLOT_WHITE = 4;
const COLOR_SLOT_BLACK = 7;
const COLOR_SLOT_MATCHED = 1;
const COLOR_SLOT_ORB = 5;
const COLOR_SLOT_ORB_ACTIVE = 1;
const PAIR_COLOR_SLOTS = [0, 2, 6, 8] as const;
const COLOR_SLOT_WHEEL_BLUE = 7;
const COLOR_SLOT_WHEEL_RED = 3;
const COLOR_SLOT_WHEEL_DOOM = 2;
const COLOR_SLOT_ENERGY_UNASSIGNED = 11;
const COLOR_SLOT_STAR_POOL = 1;
const ENERGY_TARGET_COLOR_SLOTS = [0, 2, 6, 8, 10] as const;
const COLOR_SLOT_CHAIN_NEAR = 5;
const COLOR_SLOT_CHAIN_FAR = 4;

const APPEARANCE: Record<number, { slot: 1 | 2 | 3; color: PairColor }> = {
  1: { slot: 1, color: "black" },
  2: { slot: 2, color: "black" },
  3: { slot: 3, color: "black" },
  4: { slot: 1, color: "white" },
  5: { slot: 2, color: "white" },
  6: { slot: 3, color: "white" },
};

const textKeys = {
  pairGroup: "minimap.s4WastelandCourt.pair.group",
  pairMark: "minimap.s4WastelandCourt.pair.mark",
  pairSwap: "minimap.s4WastelandCourt.pair.swap",
  pairMatched: "minimap.s4WastelandCourt.pair.matched",
  pairWhite: "minimap.s4WastelandCourt.pair.white",
  pairBlack: "minimap.s4WastelandCourt.pair.black",
  pairSettle: "minimap.s4WastelandCourt.pair.settle",
  orbGroup: "minimap.s4WastelandCourt.orb.group",
  orbActive: "minimap.s4WastelandCourt.orb.active",
  wheelGroup: "minimap.s4WastelandCourt.wheel.group",
  wheelBlue: "minimap.s4WastelandCourt.wheel.blue",
  wheelRed: "minimap.s4WastelandCourt.wheel.red",
  wheelDoom: "minimap.s4WastelandCourt.wheel.doom",
  shadowGroup: "minimap.s4WastelandCourt.shadow.group",
  shadowPhase: "minimap.s4WastelandCourt.shadow.phase",
  energyTarget: "minimap.s4WastelandCourt.shadow.energyTarget",
  chainGroup: "minimap.s4WastelandCourt.chain.group",
  chainOverview: "minimap.s4WastelandCourt.chain.overview",
  chainStep: "minimap.s4WastelandCourt.chain.step",
  chainNear: "minimap.s4WastelandCourt.chain.near",
  chainFar: "minimap.s4WastelandCourt.chain.far",
} satisfies Record<string, MessageKey>;

const voiceCueIds = {
  pair: "s4-wasteland-court.pair",
  pairSettle: "s4-wasteland-court.pairSettle",
  wheelBlue: "s4-wasteland-court.wheelBlue",
  wheelRed: "s4-wasteland-court.wheelRed",
  wheelDoom: "s4-wasteland-court.wheelDoom",
  shadow: "s4-wasteland-court.shadow",
  energyTarget: "s4-wasteland-court.energyTarget",
  chainNear: "s4-wasteland-court.chainNear",
  chainFar: "s4-wasteland-court.chainFar",
} as const;

export const S4_WASTELAND_COURT_VOICE_CUES: MinimapVoiceCueDef[] = [
  {
    id: voiceCueIds.pair,
    labelKey: textKeys.pairGroup,
    autoText: "虚痕对对碰",
  },
  {
    id: voiceCueIds.pairSettle,
    labelKey: textKeys.pairSettle,
    autoText: "虚痕结算",
  },
  {
    id: voiceCueIds.wheelBlue,
    labelKey: textKeys.wheelBlue,
    autoText: "宿命之轮集合",
  },
  {
    id: voiceCueIds.wheelRed,
    labelKey: textKeys.wheelRed,
    autoText: "悲惨之轮独处",
  },
  {
    id: voiceCueIds.wheelDoom,
    labelKey: textKeys.wheelDoom,
    autoText: "绝望之轮",
  },
  {
    id: voiceCueIds.shadow,
    labelKey: textKeys.shadowPhase,
    autoText: "赫鲁加之影",
  },
  {
    id: voiceCueIds.energyTarget,
    labelKey: textKeys.energyTarget,
    autoText: "能量球点名",
  },
  {
    id: voiceCueIds.chainNear,
    labelKey: textKeys.chainNear,
    autoText: "近圈",
  },
  {
    id: voiceCueIds.chainFar,
    labelKey: textKeys.chainFar,
    autoText: "远圈",
  },
];

export function resolveWastelandCourtVoiceCues(
  snapshot: MinimapSnapshot,
  skillCasts: MinimapSkillCast[],
): MinimapVoiceCueFire[] {
  return [
    ...resolveBuffVoiceCues(
      snapshot,
      {
        [PAIR_RENDER_BUFF_ID]: voiceCueIds.pair,
        [WHEEL_BLUE_BUFF_ID]: voiceCueIds.wheelBlue,
        [WHEEL_RED_BUFF_ID]: voiceCueIds.wheelRed,
        [WHEEL_DOOM_BUFF_ID]: voiceCueIds.wheelDoom,
        [ENERGY_TARGET_BUFF_ID]: voiceCueIds.energyTarget,
      },
      "localTarget",
    ),
    ...resolveSkillVoiceCues(skillCasts, {
      [PAIR_RESOLVE_SKILL_ID]: voiceCueIds.pairSettle,
      [SHADOW_SKILL_ID]: voiceCueIds.shadow,
      [CHAIN_NEAR_SKILL_ID]: voiceCueIds.chainNear,
      [CHAIN_FAR_SKILL_ID]: voiceCueIds.chainFar,
    }),
  ];
}

export function parsePairMark(effectIds: readonly number[]): PairMark | null {
  if (effectIds.length < 4) return null;
  const slots: [PairColor | null, PairColor | null, PairColor | null] = [
    null,
    null,
    null,
  ];
  for (let index = 0; index < 3; index += 1) {
    const expectedSlot = (index + 1) as 1 | 2 | 3;
    const appearance = APPEARANCE[effectIds[index]!];
    if (!appearance || appearance.slot !== expectedSlot) return null;
    slots[index] = appearance.color;
  }
  if (slots.some((slot) => slot == null)) return null;

  const lockIndex = (effectIds[3]! - PAIR_LOCK_OFFSET) as 1 | 2 | 3;
  if (lockIndex !== 1 && lockIndex !== 2 && lockIndex !== 3) return null;
  const target = slots[lockIndex - 1];
  if (target == null) return null;
  const filled = slots as [PairColor, PairColor, PairColor];
  return {
    slots: filled,
    lockIndex,
    target,
    alreadyMatched: filled.every((color) => color === target),
  };
}

export function unlockedColors(mark: PairMark): PairColor[] {
  return mark.slots.filter((_, index) => index + 1 !== mark.lockIndex);
}

function unlockedSlotIndexes(mark: PairMark): number[] {
  return [0, 1, 2].filter((index) => index + 1 !== mark.lockIndex);
}

function copiesTargetFrom(self: PairMark, other: PairMark): boolean {
  const unlocked = unlockedSlotIndexes(self);
  return (
    unlocked.length > 0 &&
    unlocked.every((index) => other.slots[index] === self.target)
  );
}

export function isComplementaryPartner(
  self: PairMark,
  other: PairMark,
): boolean {
  if (self.alreadyMatched || other.alreadyMatched) return false;
  return copiesTargetFrom(self, other) && copiesTargetFrom(other, self);
}

export function groupComplementaryPairs(marks: ReadonlyMap<string, PairMark>): {
  pairs: [string, string][];
  unmatched: string[];
} {
  const remaining = [...marks.keys()]
    .filter((uuid) => marks.get(uuid)?.alreadyMatched !== true)
    .sort();
  const pairs: [string, string][] = [];
  const used = new Set<string>();

  for (const uuid of remaining) {
    if (used.has(uuid)) continue;
    const self = marks.get(uuid);
    if (!self) continue;
    const partner = remaining.find((otherUuid) => {
      if (otherUuid === uuid || used.has(otherUuid)) return false;
      const other = marks.get(otherUuid);
      return other != null && isComplementaryPartner(self, other);
    });
    if (partner == null) continue;
    pairs.push(uuid < partner ? [uuid, partner] : [partner, uuid]);
    used.add(uuid);
    used.add(partner);
  }

  const unmatched = [...marks.keys()].filter((uuid) => !used.has(uuid)).sort();
  return { pairs, unmatched };
}

export function formatPairPattern(mark: PairMark): string {
  return mark.slots
    .map((color, index) => {
      const glyph = t(
        color === "white" ? textKeys.pairWhite : textKeys.pairBlack,
      );
      return index + 1 === mark.lockIndex ? `[${glyph}]` : glyph;
    })
    .join("");
}

export function buildMechanicView(
  snapshot: MinimapSnapshot,
  displayName: (entity: MinimapEntity) => string,
  skillCasts: MinimapSkillCast[],
): WastelandCourtMechanicView {
  const regions: MechanicRegion[] = [];
  const rows = new Map<string, MechanicRow>();
  const entityColorSlots = new Map<string, number>();
  const entitiesByUuid = new Map(
    snapshot.entities.map((entity) => [entity.entityUuid, entity]),
  );
  const buffsByTarget = groupBuffsByTarget(snapshot.buffs);

  addBossMarkers(snapshot.entities, entityColorSlots);
  addPairRows(
    snapshot,
    entitiesByUuid,
    buffsByTarget,
    skillCasts,
    rows,
    entityColorSlots,
    displayName,
  );
  addOrbRegions(snapshot, buffsByTarget, regions, rows, entityColorSlots);
  addShadowRows(
    snapshot,
    entitiesByUuid,
    skillCasts,
    regions,
    rows,
    entityColorSlots,
    displayName,
  );
  addWheelRows(snapshot, entitiesByUuid, rows, entityColorSlots, displayName);
  addChainRows(snapshot, entitiesByUuid, skillCasts, rows, entityColorSlots);

  return {
    regions: dedupeRegions(regions),
    rows: [...rows.values()],
    entityColorSlots,
  };
}

function addBossMarkers(
  entities: MinimapEntity[],
  entityColorSlots: Map<string, number>,
) {
  for (const entity of entities) {
    if (entity.monsterId != null && BOSS_MONSTER_IDS.has(entity.monsterId)) {
      entityColorSlots.set(entity.entityUuid, COLOR_SLOT_BOSS);
      continue;
    }
    if (entity.monsterId === CLONE_MONSTER_ID) {
      entityColorSlots.set(entity.entityUuid, COLOR_SLOT_CLONE);
    }
  }
}

function addPairRows(
  snapshot: MinimapSnapshot,
  entitiesByUuid: Map<string, MinimapEntity>,
  _buffsByTarget: Map<string, MinimapBuffFact[]>,
  skillCasts: MinimapSkillCast[],
  rows: Map<string, MechanicRow>,
  entityColorSlots: Map<string, number>,
  displayName: (entity: MinimapEntity) => string,
) {
  const marks = new Map<string, PairMark>();
  let earliestCreate = Number.POSITIVE_INFINITY;
  let durationMs = PAIR_WINDOW_MS;

  for (const buff of snapshot.buffs) {
    if (buff.baseId !== PAIR_RENDER_BUFF_ID) continue;
    earliestCreate = Math.min(earliestCreate, buff.createTimeMs);
    if (buff.durationMs > 0) durationMs = Math.max(durationMs, buff.durationMs);
    const parsed = parsePairMark(buff.effectIds);
    if (parsed) marks.set(buff.targetEntityUuid, parsed);
  }

  if (!Number.isFinite(earliestCreate)) {
    const pairCast = skillCasts.find(
      (cast) => cast.skillId === PAIR_SETTLE_SKILL_ID,
    );
    earliestCreate = pairCast?.timeMs ?? overlayNow();
  }

  if (pairWindowClosed(snapshot, skillCasts, earliestCreate, durationMs)) {
    addSettleRow(snapshot, skillCasts, rows);
    return;
  }

  if (marks.size === 0) {
    addSettleRow(snapshot, skillCasts, rows);
    return;
  }

  const { pairs, unmatched } = groupComplementaryPairs(marks);
  for (const [index, [leftUuid, rightUuid]] of pairs.entries()) {
    const left = marks.get(leftUuid);
    const right = marks.get(rightUuid);
    if (!left || !right) continue;
    const colorSlot = PAIR_COLOR_SLOTS[index % PAIR_COLOR_SLOTS.length]!;
    entityColorSlots.set(leftUuid, colorSlot);
    entityColorSlots.set(rightUuid, colorSlot);
    upsertRow(rows, {
      key: `wasteland:pair:${leftUuid}:${rightUuid}`,
      group: t(textKeys.pairGroup),
      label: t(textKeys.pairSwap, {
        left: formatPairPattern(left),
        right: formatPairPattern(right),
      }),
      colorSlot,
      createTimeMs: earliestCreate,
      durationMs,
      targets: [
        ...toMechanicTargets(
          entitiesByUuid.get(leftUuid),
          snapshot.localPlayerUuid,
          displayName,
        ),
        ...toMechanicTargets(
          entitiesByUuid.get(rightUuid),
          snapshot.localPlayerUuid,
          displayName,
        ),
      ],
    });
  }

  for (const uuid of unmatched) {
    const mark = marks.get(uuid);
    if (!mark) continue;
    const target = entitiesByUuid.get(uuid);
    const colorSlot = mark.alreadyMatched
      ? COLOR_SLOT_MATCHED
      : mark.target === "white"
        ? COLOR_SLOT_WHITE
        : COLOR_SLOT_BLACK;
    if (target) entityColorSlots.set(uuid, colorSlot);
    upsertRow(rows, {
      key: `wasteland:pair:${uuid}`,
      group: t(textKeys.pairGroup),
      label: mark.alreadyMatched
        ? t(textKeys.pairMatched)
        : t(textKeys.pairMark, {
            pattern: formatPairPattern(mark),
            target: t(
              mark.target === "white" ? textKeys.pairWhite : textKeys.pairBlack,
            ),
          }),
      colorSlot,
      createTimeMs: earliestCreate,
      durationMs,
      targets: toMechanicTargets(target, snapshot.localPlayerUuid, displayName),
    });
  }

  addSettleRow(snapshot, skillCasts, rows);
}

function pairWindowClosed(
  snapshot: MinimapSnapshot,
  skillCasts: MinimapSkillCast[],
  earliestCreate: number,
  durationMs: number,
): boolean {
  if (
    snapshot.buffs.some(
      (buff) =>
        buff.baseId === PAIR_SETTLE_BUFF_ID ||
        buff.baseId === PAIR_PENALTY_BUFF_ID,
    )
  ) {
    return true;
  }
  if (
    Number.isFinite(earliestCreate) &&
    overlayNow() > earliestCreate + durationMs
  ) {
    return true;
  }
  const now = overlayNow();
  return skillCasts.some(
    (cast) => cast.skillId === PAIR_RESOLVE_SKILL_ID && now - cast.timeMs >= 0,
  );
}

function addSettleRow(
  snapshot: MinimapSnapshot,
  skillCasts: MinimapSkillCast[],
  rows: Map<string, MechanicRow>,
) {
  const settleBuff = snapshot.buffs.find(
    (buff) => buff.baseId === PAIR_SETTLE_BUFF_ID,
  );
  if (settleBuff) {
    upsertRow(rows, {
      key: "wasteland:pair:settle",
      group: t(textKeys.pairGroup),
      label: t(textKeys.pairSettle),
      colorSlot: COLOR_SLOT_ORB_ACTIVE,
      createTimeMs: settleBuff.createTimeMs,
      durationMs: settleBuff.durationMs > 0 ? settleBuff.durationMs : 5_000,
      targets: [],
    });
    return;
  }

  const now = overlayNow();
  const settleCast = skillCasts.find(
    (cast) =>
      cast.skillId === PAIR_RESOLVE_SKILL_ID &&
      now - cast.timeMs >= -500 &&
      now - cast.timeMs <= 5_000,
  );
  if (!settleCast) return;
  upsertRow(rows, {
    key: "wasteland:pair:settle",
    group: t(textKeys.pairGroup),
    label: t(textKeys.pairSettle),
    colorSlot: COLOR_SLOT_ORB_ACTIVE,
    createTimeMs: settleCast.timeMs,
    durationMs: 5_000,
    targets: [],
  });
}

function addOrbRegions(
  snapshot: MinimapSnapshot,
  buffsByTarget: Map<string, MinimapBuffFact[]>,
  regions: MechanicRegion[],
  rows: Map<string, MechanicRow>,
  entityColorSlots: Map<string, number>,
) {
  let activeCreate = Number.POSITIVE_INFINITY;
  let activeDuration = 0;
  for (const entity of snapshot.entities) {
    if (entity.monsterId !== PAIR_ORB_MONSTER_ID) continue;
    const swap = (buffsByTarget.get(entity.entityUuid) ?? []).find(
      (buff) => buff.baseId === PAIR_SWAP_BUFF_ID,
    );
    const colorSlot = swap ? COLOR_SLOT_ORB_ACTIVE : COLOR_SLOT_ORB;
    entityColorSlots.set(entity.entityUuid, colorSlot);
    regions.push({
      kind: "sector",
      x: entity.x,
      z: entity.z,
      radius: ORB_RADIUS,
      startDeg: 0,
      endDeg: 360,
      colorSlot,
    });
    if (swap) {
      activeCreate = Math.min(activeCreate, swap.createTimeMs);
      activeDuration = Math.max(activeDuration, swap.durationMs);
    }
  }

  if (Number.isFinite(activeCreate)) {
    upsertRow(rows, {
      key: "wasteland:orb:active",
      group: t(textKeys.orbGroup),
      label: t(textKeys.orbActive),
      colorSlot: COLOR_SLOT_ORB_ACTIVE,
      createTimeMs: activeCreate,
      durationMs: activeDuration > 0 ? activeDuration : 3_000,
      targets: [],
    });
  }
}

function addShadowRows(
  snapshot: MinimapSnapshot,
  entitiesByUuid: Map<string, MinimapEntity>,
  skillCasts: MinimapSkillCast[],
  regions: MechanicRegion[],
  rows: Map<string, MechanicRow>,
  entityColorSlots: Map<string, number>,
  displayName: (entity: MinimapEntity) => string,
) {
  const now = overlayNow();
  const shadowCast = skillCasts
    .filter(
      (cast) =>
        cast.skillId === SHADOW_SKILL_ID &&
        now - cast.timeMs >= -500 &&
        now - cast.timeMs <= 15_000,
    )
    .reduce<MinimapSkillCast | null>(
      (latest, cast) =>
        !latest || cast.timeMs > latest.timeMs ? cast : latest,
      null,
    );
  if (shadowCast) {
    rows.set("wasteland:shadow:phase", {
      key: "wasteland:shadow:phase",
      group: t(textKeys.shadowGroup),
      label: t(textKeys.shadowPhase),
      colorSlot: COLOR_SLOT_STAR_POOL,
      createTimeMs: shadowCast.timeMs,
      durationMs: 15_000,
      targets: [],
    });
  }

  const playerSlots = energyPlayerColorSlots(snapshot);
  const assignmentByBall = new Map<
    string,
    { buff: MinimapBuffFact; target: MinimapEntity; colorSlot: number }
  >();
  for (const buff of snapshot.buffs) {
    if (buff.baseId !== ENERGY_TARGET_BUFF_ID || buff.fireUuid == null)
      continue;
    const ball = entitiesByUuid.get(buff.fireUuid);
    const target = entitiesByUuid.get(buff.targetEntityUuid);
    if (
      !ball ||
      ball.monsterId == null ||
      !ENERGY_BALL_MONSTER_IDS.has(ball.monsterId) ||
      !target
    ) {
      continue;
    }
    const colorSlot =
      playerSlots.get(target.entityUuid) ?? ENERGY_TARGET_COLOR_SLOTS[0];
    const previous = assignmentByBall.get(ball.entityUuid);
    if (!previous || buff.createTimeMs >= previous.buff.createTimeMs) {
      assignmentByBall.set(ball.entityUuid, { buff, target, colorSlot });
    }
  }

  const latestAssignmentByTarget = new Map<
    string,
    { buff: MinimapBuffFact; target: MinimapEntity; colorSlot: number }
  >();
  for (const entity of snapshot.entities) {
    if (entity.monsterId === STAR_POOL_MONSTER_ID) {
      entityColorSlots.set(entity.entityUuid, COLOR_SLOT_STAR_POOL);
      regions.push({
        kind: "sector",
        x: entity.x,
        z: entity.z,
        radius: STAR_POOL_RADIUS,
        startDeg: 0,
        endDeg: 360,
        colorSlot: COLOR_SLOT_STAR_POOL,
      });
      continue;
    }
    if (
      entity.monsterId == null ||
      !ENERGY_BALL_MONSTER_IDS.has(entity.monsterId)
    ) {
      continue;
    }

    const assignment = assignmentByBall.get(entity.entityUuid);
    const colorSlot = assignment?.colorSlot ?? COLOR_SLOT_ENERGY_UNASSIGNED;
    entityColorSlots.set(entity.entityUuid, colorSlot);
    regions.push({
      kind: "sector",
      x: entity.x,
      z: entity.z,
      radius: ENERGY_BALL_RADIUS,
      startDeg: 0,
      endDeg: 360,
      colorSlot,
    });
    if (!assignment) continue;

    entityColorSlots.set(assignment.target.entityUuid, colorSlot);
    regions.push({
      kind: "line",
      x1: entity.x,
      z1: entity.z,
      x2: assignment.target.x,
      z2: assignment.target.z,
      colorSlot,
      widthPx: 3,
    });
    const previous = latestAssignmentByTarget.get(assignment.target.entityUuid);
    if (
      !previous ||
      assignment.buff.createTimeMs >= previous.buff.createTimeMs
    ) {
      latestAssignmentByTarget.set(assignment.target.entityUuid, assignment);
    }
  }

  for (const { buff, target, colorSlot } of latestAssignmentByTarget.values()) {
    rows.set(`wasteland:shadow:target:${target.entityUuid}`, {
      key: `wasteland:shadow:target:${target.entityUuid}`,
      group: t(textKeys.shadowGroup),
      label: t(textKeys.energyTarget),
      colorSlot,
      createTimeMs: buff.createTimeMs,
      durationMs: buff.durationMs > 0 ? buff.durationMs : 5_000,
      targets: toMechanicTargets(target, snapshot.localPlayerUuid, displayName),
    });
  }
}

function energyPlayerColorSlots(
  snapshot: MinimapSnapshot,
): Map<string, number> {
  const players = snapshot.entities
    .filter((entity) => entity.kind === "local" || entity.kind === "teammate")
    .sort((left, right) => {
      if (left.entityUuid === snapshot.localPlayerUuid) return -1;
      if (right.entityUuid === snapshot.localPlayerUuid) return 1;
      return left.entityUuid.localeCompare(right.entityUuid);
    });
  return new Map(
    players.map((player, index) => [
      player.entityUuid,
      ENERGY_TARGET_COLOR_SLOTS[index % ENERGY_TARGET_COLOR_SLOTS.length]!,
    ]),
  );
}

function addChainRows(
  snapshot: MinimapSnapshot,
  entitiesByUuid: Map<string, MinimapEntity>,
  skillCasts: MinimapSkillCast[],
  rows: Map<string, MechanicRow>,
  entityColorSlots: Map<string, number>,
) {
  let nearCount = 0;
  let farCount = 0;
  let earliestMark = Number.POSITIVE_INFINITY;
  for (const buff of snapshot.buffs) {
    const entity = entitiesByUuid.get(buff.targetEntityUuid);
    if (
      !entity ||
      entity.monsterId == null ||
      !CHAIN_MONSTER_IDS.has(entity.monsterId)
    ) {
      continue;
    }
    if (buff.baseId === CHAIN_NEAR_BUFF_ID) {
      nearCount += 1;
      earliestMark = Math.min(earliestMark, buff.createTimeMs);
      entityColorSlots.set(entity.entityUuid, COLOR_SLOT_CHAIN_NEAR);
    } else if (buff.baseId === CHAIN_FAR_BUFF_ID) {
      farCount += 1;
      earliestMark = Math.min(earliestMark, buff.createTimeMs);
      entityColorSlots.set(entity.entityUuid, COLOR_SLOT_CHAIN_FAR);
    }
  }

  if (nearCount + farCount > 0) {
    rows.set("wasteland:chain:overview", {
      key: "wasteland:chain:overview",
      group: t(textKeys.chainGroup),
      label: t(textKeys.chainOverview, { near: nearCount, far: farCount }),
      colorSlot: COLOR_SLOT_CHAIN_FAR,
      createTimeMs: earliestMark,
      durationMs: 0,
      targets: [],
      hideTimer: true,
    });
  }

  const chainCasts = skillCasts
    .filter((cast) => {
      if (
        cast.skillId !== CHAIN_NEAR_SKILL_ID &&
        cast.skillId !== CHAIN_FAR_SKILL_ID
      ) {
        return false;
      }
      const caster = entitiesByUuid.get(cast.entityUuid);
      return (
        caster?.monsterId != null && CHAIN_MONSTER_IDS.has(caster.monsterId)
      );
    })
    .sort((left, right) => left.timeMs - right.timeMs);
  const now = overlayNow();
  for (const [index, cast] of chainCasts.entries()) {
    if (now - cast.timeMs < -500 || now - cast.timeMs > CHAIN_CAST_ROW_MS)
      continue;
    const isNear = cast.skillId === CHAIN_NEAR_SKILL_ID;
    const colorSlot = isNear ? COLOR_SLOT_CHAIN_NEAR : COLOR_SLOT_CHAIN_FAR;
    entityColorSlots.set(cast.entityUuid, colorSlot);
    rows.set(`wasteland:chain:cast:${cast.entityUuid}:${cast.timeMs}`, {
      key: `wasteland:chain:cast:${cast.entityUuid}:${cast.timeMs}`,
      group: t(textKeys.chainGroup),
      label: t(textKeys.chainStep, {
        order: index + 1,
        type: t(isNear ? textKeys.chainNear : textKeys.chainFar),
      }),
      colorSlot,
      createTimeMs: cast.timeMs,
      durationMs: CHAIN_CAST_ROW_MS,
      targets: [],
    });
  }
}

function addWheelRows(
  snapshot: MinimapSnapshot,
  entitiesByUuid: Map<string, MinimapEntity>,
  rows: Map<string, MechanicRow>,
  entityColorSlots: Map<string, number>,
  displayName: (entity: MinimapEntity) => string,
) {
  const wheels: Record<
    number,
    { labelKey: MessageKey; colorSlot: number; key: string }
  > = {
    [WHEEL_BLUE_BUFF_ID]: {
      labelKey: textKeys.wheelBlue,
      colorSlot: COLOR_SLOT_WHEEL_BLUE,
      key: "blue",
    },
    [WHEEL_RED_BUFF_ID]: {
      labelKey: textKeys.wheelRed,
      colorSlot: COLOR_SLOT_WHEEL_RED,
      key: "red",
    },
    [WHEEL_DOOM_BUFF_ID]: {
      labelKey: textKeys.wheelDoom,
      colorSlot: COLOR_SLOT_WHEEL_DOOM,
      key: "doom",
    },
  };

  for (const buff of snapshot.buffs) {
    const mapping = wheels[buff.baseId];
    if (!mapping) continue;
    const target = entitiesByUuid.get(buff.targetEntityUuid);
    if (target) entityColorSlots.set(target.entityUuid, mapping.colorSlot);
    upsertRow(rows, {
      key: `wasteland:wheel:${mapping.key}:${buff.targetEntityUuid}`,
      group: t(textKeys.wheelGroup),
      label: t(mapping.labelKey),
      colorSlot: mapping.colorSlot,
      createTimeMs: buff.createTimeMs,
      durationMs: buff.durationMs,
      targets: toMechanicTargets(target, snapshot.localPlayerUuid, displayName),
    });
  }
}

function groupBuffsByTarget(
  buffs: MinimapBuffFact[],
): Map<string, MinimapBuffFact[]> {
  const out = new Map<string, MinimapBuffFact[]>();
  for (const buff of buffs) {
    const list = out.get(buff.targetEntityUuid) ?? [];
    list.push(buff);
    out.set(buff.targetEntityUuid, list);
  }
  return out;
}

function upsertRow(rows: Map<string, MechanicRow>, next: MechanicRow) {
  const existing = rows.get(next.key);
  if (!existing) {
    rows.set(next.key, { ...next, targets: [...next.targets] });
    return;
  }
  existing.createTimeMs =
    existing.createTimeMs <= 0
      ? next.createTimeMs
      : Math.min(existing.createTimeMs, next.createTimeMs);
  existing.durationMs = Math.max(existing.durationMs, next.durationMs);
  if (existing.hideTimer || next.hideTimer) {
    existing.hideTimer = Boolean(existing.hideTimer && next.hideTimer);
  }
  mergeMechanicTargets(existing.targets, next.targets);
}

function dedupeRegions(regions: MechanicRegion[]): MechanicRegion[] {
  const seen = new Set<string>();
  const out: MechanicRegion[] = [];
  for (const region of regions) {
    const key = regionKey(region);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(region);
  }
  return out;
}

function regionKey(region: MechanicRegion): string {
  switch (region.kind) {
    case "ring":
      return `ring:${region.rInner}:${region.rOuter}:${region.colorSlot}`;
    case "rect":
      return `rect:${region.x}:${region.z}:${region.halfX}:${region.halfZ}:${region.colorSlot}:${region.label ?? ""}`;
    case "sector":
      return `sector:${region.x}:${region.z}:${region.radius}:${region.startDeg}:${region.endDeg}:${region.colorSlot}:${region.label ?? ""}`;
    case "polygon":
      return `polygon:${region.points.map((point) => `${point.x}:${point.z}`).join("|")}:${region.colorSlot}:${region.label ?? ""}`;
    case "line":
      return `line:${region.x1}:${region.z1}:${region.x2}:${region.z2}:${region.colorSlot}:${region.widthPx ?? ""}:${region.label ?? ""}`;
  }
}
