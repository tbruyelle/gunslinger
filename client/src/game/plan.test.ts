import { describe, expect, it } from "vitest";
import type { GunView } from "../chain/types";
import { canPlay, decodePlan, drawableGuns, encodePlan, planCost, validatePlan, type PlanEntry } from "./plan";

const COLT: GunView = { id: 1, type: "colt45", name: "Colt 45", location: "holstered", cocked: false, shells: 6, capacity: 6 };

describe("plan encoding", () => {
  it("round-trips the realm's format", () => {
    for (const s of ["", "1f:ahead_left", "1f:ahead_left,2f:ahead,3f", "4b", "1b:back_right,3b:ahead", "12b", "9f:1:0", "1f:ahead,9f:12:2"]) {
      expect(encodePlan(decodePlan(s))).toBe(s);
    }
  });

  it("drops directions the card does not take", () => {
    const plan: PlanEntry[] = [{ card: 3, side: "front", dir: "ahead" }];
    expect(encodePlan(plan)).toBe("3f");
  });

  it("rejects malformed strings", () => {
    for (const s of ["13f", "1x", "1f:north", "1f,", "1f, 2f", "0f", "1f:", "9f:1", "9f:0:0", "9f:1:3", "9f:ahead", "1f:0"]) {
      expect(() => decodePlan(s), s).toThrow();
    }
  });

  it("computes cost", () => {
    expect(planCost(decodePlan("1f:ahead,2f:ahead,3f"))).toBe(4);
    expect(planCost([])).toBe(0);
  });
});

describe("validatePlan", () => {
  const cases: [string, number, string | null][] = [
    ["", 5, null],
    ["1f:ahead,2f:ahead_left,3f", 5, null],
    ["1b:back_left,3b:ahead", 5, null],
    ["5b,3b:ahead_right,4b", 5, null],
    ["1f:ahead,1b:back", 5, "you cannot use both sides of a card"],
    ["3f,3f", 5, "you cannot use both sides of a card"],
    ["1b:back,5b", 5, "those actions cost more time points than you have"],
    ["1f:ahead,3b:ahead,4b", 3, "those actions cost more time points than you have"],
    ["1f:ahead,3b:ahead", 3, null],
    ["2f:ahead", 5, "run can only be played together with advance"],
    ["1f:ahead,3f", 5, "sprint can only be played together with run"],
    ["1f", 5, "choose a forward direction"],
    ["1f:back", 5, "choose a forward direction"],
    ["1b:ahead", 5, "choose a backward direction"],
    ["2b:ahead_right", 5, "choose a backward direction"],
    ["3f:ahead", 5, "that action takes no direction"],
    ["5f", 5, "that action is not available yet"],
    ["12b", 5, "that action is not available yet"],
  ];
  for (const [plan, budget, want] of cases) {
    it(`${JSON.stringify(plan)} with budget ${budget}`, () => {
      expect(validatePlan(decodePlan(plan), budget, true)).toBe(want);
    });
  }

  it("needs a run on the previous turn to sprint", () => {
    expect(validatePlan(decodePlan("1f:ahead,2f:ahead,3f"), 5, false)).toBe("sprint can only be played after a run on the previous turn");
    expect(validatePlan(decodePlan("1f:ahead,3f"), 5, false)).toBe("sprint can only be played together with run");
    expect(validatePlan(decodePlan("1f:ahead,2f:ahead"), 5, false)).toBeNull();
    expect(canPlay({ card: 3, side: "front" }, false)).toBe(false);
    expect(canPlay({ card: 3, side: "front" }, true)).toBe(true);
    expect(canPlay({ card: 2, side: "front" }, false)).toBe(true);
    expect(canPlay({ card: 7, side: "front" }, true)).toBe(false);
  });

  it("draw & cock needs a holstered gun and a free gun hand", () => {
    expect(validatePlan(decodePlan("9f:1:0"), 5, true, [COLT])).toBeNull();
    expect(validatePlan(decodePlan("9f"), 5, true, [COLT])).toBe("choose the gun to draw");
    expect(validatePlan(decodePlan("9f:2:0"), 5, true, [COLT])).toBe("that gun is not in a holster");
    expect(validatePlan(decodePlan("9f:1:1"), 5, true, [COLT])).toBe("only the gun hand can draw for now");
    expect(validatePlan(decodePlan("9f:1:0"), 5, true, [{ ...COLT, location: "gun_hand" }])).toBe("that gun is not in a holster");
    expect(validatePlan(decodePlan("9f:2:0"), 5, true, [{ ...COLT, location: "gun_hand" }, { ...COLT, id: 2 }])).toBe("that hand already holds a gun");
    expect(validatePlan(decodePlan("9f:1:0"), 5, true, [])).toBe("that gun is not in a holster");
    expect(canPlay({ card: 9, side: "front" }, true, [COLT])).toBe(true);
    expect(canPlay({ card: 9, side: "front" }, true, [])).toBe(false);
    expect(canPlay({ card: 9, side: "front" }, true, [{ ...COLT, location: "gun_hand" }])).toBe(false);
    expect(drawableGuns([COLT, { ...COLT, id: 2, location: "gun_hand" }])).toEqual([]);
    expect(encodePlan([{ card: 9, side: "front", gun: 1, hand: 0 }])).toBe("9f:1:0");
    expect(encodePlan([{ card: 9, side: "front", gun: 1 }])).toBe("9f:1:0");
    expect(decodePlan("9f:12:2")[0]).toEqual({ card: 9, side: "front", gun: 12, hand: 2 });
    expect(encodePlan([{ card: 9, side: "front" }])).toBe("9f");
  });
});
