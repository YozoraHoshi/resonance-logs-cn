import { describe, expect, it } from "vitest";
import type { EncounterTimelineEvent } from "$lib/components/encounter-timeline/timeline-data";
import { recentFantasyCastsByEntity } from "./fantasy-icons";
import { RESONANCE_SKILLS } from "./skill-mappings";

const firstSkill = RESONANCE_SKILLS[0];
const secondSkill = RESONANCE_SKILLS[1];
const thirdSkill = RESONANCE_SKILLS[2];

function event(
  partial: Partial<EncounterTimelineEvent> &
    Pick<EncounterTimelineEvent, "sequence" | "skillId" | "casterUuid">,
): EncounterTimelineEvent {
  return {
    tsOffsetMs: partial.tsOffsetMs ?? partial.sequence * 1_000,
    kind: partial.kind ?? "fantasy",
    remodelLevel: partial.remodelLevel ?? null,
    ...partial,
  };
}

describe("recentFantasyCastsByEntity", () => {
  it("keeps the latest cast of the same skill", () => {
    if (!firstSkill) throw new Error("expected resonance skills");
    const result = recentFantasyCastsByEntity([
      event({
        sequence: 1,
        casterUuid: "p1",
        skillId: firstSkill.skillId,
        tsOffsetMs: 1_000,
        remodelLevel: 2,
      }),
      event({
        sequence: 2,
        casterUuid: "p1",
        skillId: firstSkill.skillId,
        tsOffsetMs: 8_000,
        remodelLevel: 5,
      }),
    ]);

    const [cast] = result.get("p1") ?? [];
    expect(cast?.id).toBe(String(firstSkill.skillId));
    expect(cast?.iconPath).toBe(firstSkill.imagePath);
    expect(cast?.remodelLevel).toBe(5);
    expect(cast?.name).toBeTruthy();
  });

  it("keeps the two newest distinct skills", () => {
    if (!firstSkill || !secondSkill || !thirdSkill) {
      throw new Error("expected resonance skills");
    }
    const result = recentFantasyCastsByEntity([
      event({
        sequence: 1,
        casterUuid: "p1",
        skillId: firstSkill.skillId,
        tsOffsetMs: 1_000,
      }),
      event({
        sequence: 2,
        casterUuid: "p1",
        skillId: secondSkill.skillId,
        tsOffsetMs: 2_000,
      }),
      event({
        sequence: 3,
        casterUuid: "p1",
        skillId: thirdSkill.skillId,
        tsOffsetMs: 3_000,
      }),
    ]);

    expect(result.get("p1")?.map((cast) => cast.id)).toEqual([
      String(thirdSkill.skillId),
      String(secondSkill.skillId),
    ]);
  });

  it("ignores non-fantasy markers", () => {
    if (!firstSkill) throw new Error("expected resonance skills");
    const result = recentFantasyCastsByEntity([
      event({
        sequence: 1,
        casterUuid: "p1",
        skillId: firstSkill.skillId,
        kind: "key_skill",
      }),
      event({
        sequence: 2,
        casterUuid: "p1",
        skillId: firstSkill.skillId,
        kind: "boss_skill",
      }),
    ]);
    expect(result.size).toBe(0);
  });

  it("drops placeholder icons", () => {
    const result = recentFantasyCastsByEntity([
      event({
        sequence: 1,
        casterUuid: "p1",
        skillId: 999_999_999,
      }),
    ]);
    expect(result.size).toBe(0);
  });

  it("isolates casters", () => {
    if (!firstSkill || !secondSkill)
      throw new Error("expected resonance skills");
    const result = recentFantasyCastsByEntity([
      event({
        sequence: 1,
        casterUuid: "p1",
        skillId: firstSkill.skillId,
      }),
      event({
        sequence: 2,
        casterUuid: "p2",
        skillId: secondSkill.skillId,
      }),
    ]);
    expect(result.get("p1")?.map((cast) => cast.id)).toEqual([
      String(firstSkill.skillId),
    ]);
    expect(result.get("p2")?.map((cast) => cast.id)).toEqual([
      String(secondSkill.skillId),
    ]);
  });
});
