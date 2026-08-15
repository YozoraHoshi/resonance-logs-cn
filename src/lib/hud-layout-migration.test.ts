import { describe, expect, it } from "vitest";
import { translateHudPanelRect } from "./hud-layout-migration";

describe("translateHudPanelRect", () => {
  it("preserves panel shape while translating from the legacy window origin", () => {
    expect(
      translateHudPanelRect(
        { x: 24, y: 40, width: 340, scale: 1.25 },
        { x: 300, y: 120 },
        { width: 1280, height: 960 },
      ),
    ).toEqual({ x: 324, y: 160, width: 340, scale: 1.25 });
  });

  it("clamps a migrated panel handle into the shared canvas", () => {
    expect(
      translateHudPanelRect(
        { x: 400, y: 500, width: 300, scale: 1 },
        { x: 2000, y: -1000 },
        { width: 1280, height: 960 },
      ),
    ).toEqual({ x: 1256, y: 0, width: 300, scale: 1 });
  });
});
