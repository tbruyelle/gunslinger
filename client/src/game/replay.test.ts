import { describe, expect, it } from "vitest";
import { BOARD_A } from "../board/boardA";
import { decodePlan } from "./plan";
import { replayPlan } from "./replay";

describe("replayPlan", () => {
  const start = { hex: "A-F1", facing: 3, down: false, delay: 0 };

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

  it("stays put on an off-board move", () => {
    const end = replayPlan({ ...start, hex: "A-F12" }, decodePlan("1f:ahead"), BOARD_A);
    expect(end.hex).toBe("A-F12");
  });
});
