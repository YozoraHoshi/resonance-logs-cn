import { describe, expect, it } from "vitest";
import { resolveBuffDisplayName } from "./buff-name-table";

describe("resolveBuffDisplayName", () => {
  it("reads one alias key without rebuilding the alias table", () => {
    const aliases = {
      "11": "  迅捷  ",
      "12": "坚韧",
    };
    expect(resolveBuffDisplayName(11, aliases)).toBe("迅捷");
    expect(resolveBuffDisplayName(12, aliases)).toBe("坚韧");
  });

  it("falls back to the catalog id when the alias is blank", () => {
    expect(resolveBuffDisplayName(91_234_567, { "91234567": "   " })).toBe(
      "#91234567",
    );
  });
});
