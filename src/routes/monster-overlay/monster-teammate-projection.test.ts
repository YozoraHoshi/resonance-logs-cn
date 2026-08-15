import { describe, expect, it } from "vitest";
import type { BuffUpdateState } from "$lib/api";
import { latestBuffsByCategory } from "./monster-teammate-projection";

function buff(baseId: number, createTimeMs: number): BuffUpdateState {
  return {
    baseId,
    layer: 1,
    durationMs: 10_000,
    createTimeMs,
    sourceRemodelLevel: null,
  };
}

describe("latestBuffsByCategory", () => {
  it("selects the newest Buff in each category", () => {
    const older = buff(101, 1_000);
    const newer = buff(102, 2_000);
    const result = latestBuffsByCategory(
      new Map([
        [older.baseId, older],
        [newer.baseId, newer],
      ]),
      new Map([
        [101, ["food"]],
        [102, ["food"]],
      ]),
    );

    expect(result.get("food")).toBe(newer);
  });

  it("indexes one Buff into every configured category", () => {
    const shared = buff(201, 3_000);
    const result = latestBuffsByCategory(
      new Map([[shared.baseId, shared]]),
      new Map([[201, ["food", "alchemy"]]]),
    );

    expect(result.get("food")).toBe(shared);
    expect(result.get("alchemy")).toBe(shared);
  });

  it("returns no categories when the snapshot has no indexed Buffs", () => {
    const result = latestBuffsByCategory(
      new Map([[301, buff(301, 4_000)]]),
      new Map([[999, ["food"]]]),
    );

    expect(result.size).toBe(0);
  });
});
