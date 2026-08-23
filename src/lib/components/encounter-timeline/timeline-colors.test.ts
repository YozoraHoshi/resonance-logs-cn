import { describe, expect, it } from "vitest";
import { TIMELINE_PALETTE } from "./timeline-palette";
import { laneColor, playerColor } from "./timeline-colors";
import type { TimelinePlayerMeta } from "./timeline-types";

function player(
  overrides: Partial<TimelinePlayerMeta> = {},
): TimelinePlayerMeta {
  return {
    entityUuid: "10",
    name: "Local",
    className: "雷影剑",
    classSpecName: "",
    isLocalPlayer: false,
    ...overrides,
  };
}

describe("playerColor", () => {
  it("keeps the local player on the reserved mine blue", () => {
    expect(playerColor(player({ isLocalPlayer: true }))).toBe(
      TIMELINE_PALETTE.mine,
    );
  });

  it("is stable for the same uuid and ignores class", () => {
    const first = player({ entityUuid: "21", className: "雷影剑" });
    expect(playerColor(first)).toBe(playerColor({ ...first }));
    expect(playerColor(first)).toBe(
      playerColor(player({ entityUuid: "21", className: "冰魔导师" })),
    );
  });

  it("assigns different hues to different teammate uuids", () => {
    const colors = new Set(
      ["21", "22", "23", "24", "25", "26", "27", "28"].map((entityUuid) =>
        playerColor(player({ entityUuid, className: "雷影剑" })),
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("does not use mine, average, or boss for teammates", () => {
    const reserved = new Set<string>([
      TIMELINE_PALETTE.mine,
      TIMELINE_PALETTE.average,
      TIMELINE_PALETTE.boss,
    ]);
    const color = playerColor(player({ entityUuid: "99" }));
    expect(reserved.has(color)).toBe(false);
  });
});

describe("laneColor", () => {
  it("keeps mine lanes on the reserved blue", () => {
    expect(
      laneColor({
        key: "mine",
        type: "mine",
        player: player({ isLocalPlayer: true }),
        points: [],
      }),
    ).toBe(TIMELINE_PALETTE.mine);
  });
});
