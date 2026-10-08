import { describe, expect, it } from "vitest";
import { BOARD_A } from "../board/boardA";
import { decodePlan } from "./plan";
import { gunInHand, replayPlan } from "./replay";
import type { GunView } from "../chain/types";

describe("replayPlan", () => {
  const start = { hex: "A-F1", facing: 3, down: false, delay: 0, guns: [], status: "alive" as const, aim: 0, aimHex: "", endurance: 20, serious: 0, gunArm: 0, otherArm: 0, leg: 0 };
  const colt: GunView = { id: 1, type: "colt45", name: "Colt 45", location: "holstered", cocked: false, shells: 6, capacity: 6, jammed: false, exploded: false };

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
    expect(gunInHand(end.guns)?.type).toBe("colt45");
    expect(gunInHand([colt])).toBeNull();
  });

  it("previews gun actions and the aim", () => {
    const armed = { ...colt, location: "gun_hand" as const, cocked: true };
    // Aim twice, then shoot: the aim shows while aiming and goes with the shot.
    const aimed = replayPlan({ ...start, guns: [armed] }, decodePlan("5f:aim:A-F6,6f:aim:A-F7"), BOARD_A);
    expect(aimed.aim).toBe(4);
    expect(aimed.aimHex).toBe("A-F7");
    // An aim whose target is not picked yet shows nothing; an aim at a character puts the markers on it.
    expect(replayPlan({ ...start, guns: [armed] }, [{ card: 5, side: "front", opt: "aim" }], BOARD_A).aim).toBe(0);
    const atKid = replayPlan({ ...start, guns: [armed] }, decodePlan("5f:aim:@1"), BOARD_A);
    expect(atKid.aim).toBe(2);
    expect(atKid.aimHex).toBe("");
    const shot = replayPlan({ ...start, guns: [armed] }, decodePlan("5f:aim:A-F6,7f:shoot:@1"), BOARD_A);
    expect(shot.aim).toBe(0);
    expect(shot.aimHex).toBe("");
    expect(shot.guns[0]).toEqual({ ...armed, cocked: false, shells: 5 });
    // Revealing a foot action loses the aim; a Turn keeps it; cocking loses it.
    expect(replayPlan({ ...start, aim: 4 }, decodePlan("1f:ahead"), BOARD_A).aim).toBe(0);
    expect(replayPlan({ ...start, aim: 4 }, decodePlan("3b:ahead"), BOARD_A).aim).toBe(4);
    expect(replayPlan({ ...start, aim: 4, guns: [armed] }, decodePlan("5f:cock"), BOARD_A).aim).toBe(0);
    // A gun card whose option is not picked yet changes nothing.
    expect(replayPlan({ ...start, aim: 4, guns: [armed] }, [{ card: 5, side: "front" }], BOARD_A).aim).toBe(4);
    expect(replayPlan({ ...start, guns: [{ ...armed, cocked: false }] }, decodePlan("5f:cock"), BOARD_A).guns[0].cocked).toBe(true);
    // Picking the Colt up from the ground gives it a fresh id, cocked, in the gun hand.
    const picked = replayPlan({ ...start, guns: [] }, decodePlan("9f:g4:0"), BOARD_A, [{ id: 4, hex: "A-F1", guns: [{ ...colt, shells: 4 }] }]);
    expect(picked.guns).toEqual([{ ...colt, id: 1, shells: 4, location: "gun_hand", cocked: true }]);
    // Draw & Cock then shoot in one plan.
    const drawn = replayPlan({ ...start, guns: [colt] }, decodePlan("9f:1:0,7f:shoot:@1"), BOARD_A);
    expect(drawn.guns[0]).toEqual({ ...colt, location: "gun_hand", cocked: false, shells: 5 });
  });

  it("moves a gun into both hands, then loads it", () => {
    const colt = { id: 1, type: "colt45", name: "Colt 45", location: "gun_hand" as const, cocked: true, shells: 0, capacity: 6, jammed: true, exploded: false };
    const both = replayPlan({ ...start, guns: [{ ...colt, jammed: false }] }, decodePlan("9f:1:2"), BOARD_A);
    expect(both.guns[0]).toMatchObject({ location: "both_hands", cocked: true });
    // A jammed gun moves but stays uncocked, and Cock does nothing on it.
    const jammed = replayPlan({ ...start, guns: [{ ...colt, cocked: false }] }, decodePlan("9f:1:2"), BOARD_A);
    expect(jammed.guns[0]).toMatchObject({ location: "both_hands", cocked: false });
    expect(replayPlan({ ...start, guns: [{ ...colt, cocked: false }] }, decodePlan("5f:cock"), BOARD_A).guns[0].cocked).toBe(false);
    const loaded = replayPlan({ ...start, guns: [{ ...colt, location: "both_hands" }] }, decodePlan("8f"), BOARD_A);
    expect(loaded.guns[0]).toMatchObject({ shells: 1, cocked: false, jammed: true });
    const full = replayPlan({ ...start, guns: [{ ...colt, location: "both_hands", shells: 5 }] }, decodePlan("8f"), BOARD_A);
    expect(full.guns[0]).toMatchObject({ shells: 6, jammed: false });
  });

  it("stays put on an off-board move", () => {
    const end = replayPlan({ ...start, hex: "A-F12" }, decodePlan("1f:ahead"), BOARD_A);
    expect(end.hex).toBe("A-F12");
  });
});
