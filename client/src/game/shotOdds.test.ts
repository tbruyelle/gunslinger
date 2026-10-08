import { describe, expect, it } from "vitest";
import { BOARD_A } from "../board/boardA";
import type { GunView } from "../chain/types";
import { hitChance } from "../rules/hitChance";
import type { CharView } from "./replay";
import { shotOdds } from "./shotOdds";

const colt: GunView = { id: 1, type: "colt45", name: "Colt 45", location: "gun_hand", cocked: true, shells: 6, capacity: 6, jammed: false, exploded: false } as GunView;
const me = (over: Partial<CharView> = {}): CharView => ({
  hex: "A-F3", facing: 3, down: false, delay: 0, status: "alive", guns: [colt],
  aim: 0, aimHex: "", endurance: 20, serious: 0, gunArm: 0, otherArm: 0, leg: 0, ...over,
});

describe("hitChance", () => {
  it("reads the table", () => {
    expect(hitChance(9, 5)).toEqual({ hit: 62, bullseye: 29 });
    expect(hitChance(1, 0)).toEqual({ hit: 32, bullseye: 7 });
    expect(hitChance(3, 12)).toEqual({ hit: 1, bullseye: 0 });
  });
  it("clamps aim time and range", () => {
    expect(hitChance(12, 2)).toEqual(hitChance(9, 2));
    expect(hitChance(4, 20)).toEqual(hitChance(4, 12));
    expect(hitChance(0, 1)).toEqual({ hit: 0, bullseye: 0 });
  });
});

describe("BoardMap.distance", () => {
  it("counts steps", () => {
    expect(BOARD_A.distance("A-F3", "A-F3")).toBe(0);
    expect(BOARD_A.distance("A-F3", "A-F4")).toBe(1);
    expect(BOARD_A.distance("A-F3", "A-F9")).toBe(6);
    expect(BOARD_A.distance("A-F3", "nowhere")).toBe(-1);
  });
});

describe("shotOdds", () => {
  it("shot: card aim time plus kept AIM points at the range", () => {
    expect(shotOdds(me(), 2, "A-F5", "", BOARD_A)).toMatchObject({ aimTime: 2, range: 2, hit: 26, bullseye: 3 });
    // 4 AIM points on A-F5: kept for A-F6 (one hex away), lost for A-F7.
    const aimed = me({ aim: 4, aimHex: "A-F5" });
    expect(shotOdds(aimed, 1, "A-F6", "A-F5", BOARD_A)).toMatchObject({ aimTime: 5, range: 3, hit: 42 });
    expect(shotOdds(aimed, 1, "A-F7", "A-F5", BOARD_A)).toMatchObject({ aimTime: 1, aimPoints: 0 });
  });
  it("GUN ARM wounds cut the aim time of a gun in the gun hand", () => {
    expect(shotOdds(me({ gunArm: 2, otherArm: 3 }), 2, "A-F5", "", BOARD_A)).toMatchObject({ aimTime: 0, hit: 0 });
  });
});
