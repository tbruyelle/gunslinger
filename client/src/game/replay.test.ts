import { describe, expect, it } from "vitest";
import { BOARD_A } from "../board/boardA";
import { decodePlan } from "./plan";
import { gunInHand, replayPlan } from "./replay";
import type { GunView } from "../chain/types";

describe("replayPlan", () => {
  const start = { hex: "A-F1", facing: 3, down: false, delay: 0, guns: [] };
  const colt: GunView = { id: 1, type: "colt45", name: "Colt 45", location: "holstered", cocked: false, shells: 6, capacity: 6 };

  it("moves, turns and flips in plan order", () => {
    // Advance ahead-left (SE) from F1 -> G2, then turn ahead_right (SW), then drop.
    const end = replayPlan(start, decodePlan("1f:ahead_left,3b:ahead_right,4b"), BOARD_A);
    expect(end.hex).toBe("A-G2");
    expect(end.facing).toBe(4);
    expect(end.down).toBe(true);
    expect(start.hex).toBe("A-F1");
  });

  it("sprints straight ahead", () => {
    const end = replayPlan(start, decodePlan("1f:ahead,2f:ahead,3f"), BOARD_A);
    expect(end.hex).toBe("A-F4");
  });

  it("draws and cocks a holstered gun into the chosen hand", () => {
    const end = replayPlan({ ...start, guns: [colt] }, decodePlan("9f:1:0,1f:ahead"), BOARD_A);
    expect(end.guns[0]).toEqual({ ...colt, location: "gun_hand", cocked: true });
    expect(end.hex).toBe("A-F2");
    expect(colt.location).toBe("holstered");
    expect(gunInHand(end.guns)).toBe("colt45");
    expect(gunInHand([colt])).toBeNull();
  });

  it("stays put on an off-board move", () => {
    const end = replayPlan({ ...start, hex: "A-F12" }, decodePlan("1f:ahead"), BOARD_A);
    expect(end.hex).toBe("A-F12");
  });
});
