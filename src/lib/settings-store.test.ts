import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEATH_REPLAY_COLUMN_ORDER,
  normalizeDeathReplayColumnOrder,
} from "./settings-store";

describe("normalizeDeathReplayColumnOrder", () => {
  it("appends missing default keys at the end", () => {
    expect(
      normalizeDeathReplayColumnOrder(["time", "skill", "source", "damage"]),
    ).toEqual([...DEFAULT_DEATH_REPLAY_COLUMN_ORDER]);
  });

  it("drops unknown keys and keeps the remaining order", () => {
    expect(
      normalizeDeathReplayColumnOrder([
        "damage",
        "unknown",
        "time",
        "skill",
        "source",
      ]),
    ).toEqual([
      "damage",
      "time",
      "skill",
      "source",
      "share",
      "property",
      "damageMode",
    ]);
  });

  it("uses the default order when the saved list is empty", () => {
    expect(normalizeDeathReplayColumnOrder([])).toEqual([
      ...DEFAULT_DEATH_REPLAY_COLUMN_ORDER,
    ]);
    expect(normalizeDeathReplayColumnOrder(undefined)).toEqual([
      ...DEFAULT_DEATH_REPLAY_COLUMN_ORDER,
    ]);
  });
});
