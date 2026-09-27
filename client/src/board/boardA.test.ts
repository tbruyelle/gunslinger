import { describe, expect, it } from "vitest";
import { BOARD_A } from "./boardA";

describe("BOARD_A", () => {
  it("has 137 hexes with symmetric adjacency", () => {
    const ids = BOARD_A.ids();
    expect(ids).toHaveLength(137);
    for (const id of ids) {
      let n = 0;
      for (let d = 0; d < 6; d++) {
        const nb = BOARD_A.neighbor(id, d);
        if (!nb) continue;
        n++;
        expect(BOARD_A.neighbor(nb, (d + 3) % 6)).toBe(id);
      }
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it("matches the realm's sample rings", () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => BOARD_A.neighbor("A-F6", d))).toEqual(["A-F5", "A-G6", "A-G7", "A-F7", "A-E7", "A-E6"]);
    expect(BOARD_A.neighbor("A-F12", 3)).toBeNull();
    expect(BOARD_A.neighbor("A-F1", 3)).toBe("A-F2");
    expect(BOARD_A.neighbor("nope", 0)).toBeNull();
    expect(BOARD_A.neighbor("A-F6", 6)).toBeNull();
  });

  it("resolves relative directions against a facing", () => {
    // Facing S (3): ahead is S, ahead_left is SE, back_right is NW.
    expect(BOARD_A.relNeighbor("A-F6", 3, "ahead")).toBe("A-F7");
    expect(BOARD_A.relNeighbor("A-F6", 3, "ahead_left")).toBe("A-G7");
    expect(BOARD_A.relNeighbor("A-F6", 3, "back_right")).toBe("A-E6");
    expect(BOARD_A.relNeighbors("A-F12", 3, ["ahead_left", "ahead", "ahead_right"]).map((o) => o.hex)).toEqual([null, null, null]);
  });

  it("finds the nearest hex and hex positions", () => {
    const p = BOARD_A.hexPos("A-F6");
    expect(BOARD_A.nearest(p.x + 10, p.y - 10)).toBe("A-F6");
    expect(() => BOARD_A.hexPos("nope")).toThrow();
    expect(BOARD_A.w).toBe(1600);
  });
});
