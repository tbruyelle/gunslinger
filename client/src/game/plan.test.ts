import { describe, expect, it } from "vitest";
import { decodePlan, encodePlan, planCost, validatePlan, type PlanEntry } from "./plan";

describe("plan encoding", () => {
  it("round-trips the realm's format", () => {
    for (const s of ["", "1f:ahead_left", "1f:ahead_left,2f:ahead,3f", "4b", "1b:back_right,3b:ahead", "12b"]) {
      expect(encodePlan(decodePlan(s))).toBe(s);
    }
  });

  it("drops directions the card does not take", () => {
    const plan: PlanEntry[] = [{ card: 3, side: "front", dir: "ahead" }];
    expect(encodePlan(plan)).toBe("3f");
  });

  it("rejects malformed strings", () => {
    for (const s of ["13f", "1x", "1f:north", "1f,", "1f, 2f", "0f", "1f:"]) {
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
      expect(validatePlan(decodePlan(plan), budget)).toBe(want);
    });
  }
});
