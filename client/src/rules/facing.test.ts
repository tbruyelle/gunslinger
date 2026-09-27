import { describe, expect, it } from "vitest";
import { angleToDirIndex, dirIndexToAngle, relativeToAbsoluteDir } from "./facing";

describe("facing", () => {
  it("resolves relative directions like the realm's hex package", () => {
    expect(relativeToAbsoluteDir(0, "ahead")).toBe(0);
    expect(relativeToAbsoluteDir(0, "ahead_left")).toBe(5);
    expect(relativeToAbsoluteDir(0, "back_right")).toBe(2);
    expect(relativeToAbsoluteDir(3, "ahead_left")).toBe(2);
    expect(relativeToAbsoluteDir(5, "ahead_right")).toBe(0);
  });

  it("round-trips token angles and facings", () => {
    for (const charKey of ["marshal", "dude"]) {
      for (let d = 0; d < 6; d++) {
        expect(angleToDirIndex(dirIndexToAngle(d, charKey), charKey)).toBe(d);
      }
    }
    // The marshal's arrow points NW (5) at angle 0; facing S needs 240°.
    expect(dirIndexToAngle(3, "marshal")).toBe(240);
    expect(dirIndexToAngle(0, "dude")).toBe(300);
  });
});
