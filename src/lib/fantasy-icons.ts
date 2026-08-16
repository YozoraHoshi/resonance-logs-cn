/**
 * @file Resolves a fantasy (resonance echo) cast's normalized resonance skill
 * id to a display icon and name.
 *
 * The backend normalizes the summon marker's source config id (or the
 * summoned monster id, via the curated meter-data table) into a resonance
 * skill id before publishing `TeammateFantasyState.resonanceSkillId` or
 * recording a history timeline marker, so the frontend never has to guess
 * which id space a value belongs to. Unresolvable casts fall back to
 * `FANTASY_PLACEHOLDER_ICON_PATH`, since showing a wrong icon is worse than
 * showing a generic one.
 */
import type { EncounterTimelineEvent } from "$lib/components/encounter-timeline/timeline-data";
import { resolveMonsterName } from "$lib/config/game-names";
import { findResonanceSkill } from "$lib/skill-mappings";

/** Generic stand-in used whenever a cast has no resolved resonance skill. */
export const FANTASY_PLACEHOLDER_ICON_PATH =
  "/images/resonance_skill/skill_aoyi_skill_icon_053.png";

export type FantasyIconInfo = {
  /** The resonance skill id this cast was resolved to, if known. */
  skillId: number | null;
  iconPath: string;
  isPlaceholder: boolean;
};

export function resolveFantasyIcon(
  resonanceSkillId: number | null,
): FantasyIconInfo {
  const skill =
    resonanceSkillId === null
      ? undefined
      : findResonanceSkill(resonanceSkillId);
  if (skill) {
    return {
      skillId: skill.skillId,
      iconPath: skill.imagePath,
      isPlaceholder: false,
    };
  }
  return {
    skillId: null,
    iconPath: FANTASY_PLACEHOLDER_ICON_PATH,
    isPlaceholder: true,
  };
}

function stripFantasySuffix(name: string): string {
  const separatorIndex = name.indexOf("-");
  return (
    (separatorIndex >= 0 ? name.slice(0, separatorIndex) : name).trim() || name
  );
}

/** A short display name for a fantasy cast, for tooltips/labels. */
export function resolveFantasyDisplayName(
  resonanceSkillId: number | null,
  monsterId: number,
): string {
  const skillName =
    resonanceSkillId === null
      ? undefined
      : findResonanceSkill(resonanceSkillId)?.name;
  return skillName ?? stripFantasySuffix(resolveMonsterName(monsterId));
}

export type FantasyCastDisplay = {
  id: string;
  name: string;
  iconPath: string;
  remodelLevel: number | null;
};

const RECENT_FANTASY_CAST_LIMIT = 2;

type FantasyTimelineEvent = Pick<
  EncounterTimelineEvent,
  "kind" | "casterUuid" | "skillId" | "tsOffsetMs" | "remodelLevel"
>;

/** Latest two distinct fantasy types per caster, newest first. */
export function recentFantasyCastsByEntity(
  events: readonly FantasyTimelineEvent[],
): Map<string, FantasyCastDisplay[]> {
  const latestByCasterAndSkill = new Map<
    string,
    Map<number, FantasyTimelineEvent>
  >();

  for (const event of events) {
    if (event.kind !== "fantasy") continue;
    let bySkill = latestByCasterAndSkill.get(event.casterUuid);
    if (!bySkill) {
      bySkill = new Map();
      latestByCasterAndSkill.set(event.casterUuid, bySkill);
    }
    const current = bySkill.get(event.skillId);
    if (!current || event.tsOffsetMs > current.tsOffsetMs) {
      bySkill.set(event.skillId, event);
    }
  }

  const result = new Map<string, FantasyCastDisplay[]>();
  for (const [casterUuid, bySkill] of latestByCasterAndSkill) {
    const casts = [...bySkill.values()]
      .sort((left, right) => right.tsOffsetMs - left.tsOffsetMs)
      .flatMap((event) => {
        const icon = resolveFantasyIcon(event.skillId);
        if (icon.isPlaceholder) return [];
        return [
          {
            id: String(event.skillId),
            name: resolveFantasyDisplayName(event.skillId, event.skillId),
            iconPath: icon.iconPath,
            remodelLevel: event.remodelLevel,
          },
        ];
      })
      .slice(0, RECENT_FANTASY_CAST_LIMIT);
    if (casts.length > 0) result.set(casterUuid, casts);
  }
  return result;
}
