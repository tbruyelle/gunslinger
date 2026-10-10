import { describe, expect, it } from "vitest";
import type { GunView, TurnEvent } from "../chain/types";
import type { CharView } from "./replay";
import { soundsForDelay, soundsForEvents, soundsForPreview } from "./sounds";

const ev = (partial: Partial<TurnEvent>): TurnEvent => ({
  seg: 1, p: 0, kind: "move", action: "", from: "", to: "", facing: 0, down: false, n: 0, delay: 0, reason: "", card: 0, result: "", endurance: 0, target: 1, hit: "", range: 0, gun: "", gunId: 0, ...partial,
});

describe("soundsForEvents", () => {
  const groups = (events: TurnEvent[]) => soundsForEvents(events).map((c) => c.group);

  it("maps events to sound groups", () => {
    expect(groups([ev({ kind: "move" }), ev({ kind: "turn" })])).toEqual(["step", "turn"]);
    expect(groups([ev({ kind: "flip", down: true }), ev({ kind: "flip", down: false })])).toEqual(["fall"]);
    expect(groups([ev({ kind: "draw", from: "holstered" })])).toEqual(["unholster", "cock"]);
    expect(groups([ev({ kind: "draw", result: "jammed" })])).toEqual(["unholster"]);
    expect(groups([ev({ kind: "cock" }), ev({ kind: "aim" }), ev({ kind: "load" })])).toEqual(["cock", "aim", "reload"]);
    expect(groups([ev({ kind: "shot", hit: "vital" }), ev({ kind: "wild_shot" })])).toEqual(["gunshot", "gunshot"]);
    expect(groups([ev({ kind: "shot", hit: "-" })])).toEqual(["gunshot", "ricochet"]);
    expect(groups([ev({ kind: "shot", hit: "-", reason: "misfire" }), ev({ kind: "malfunction", result: "no_penalty" })])).toEqual(["gunshot", "ricochet"]);
    expect(groups([ev({ kind: "shot", hit: "-", reason: "misfire" }), ev({ kind: "malfunction", result: "jams" })])).toEqual([]);
    expect(groups([ev({ kind: "wound", result: "stun" }), ev({ kind: "wound", result: "kill" }), ev({ kind: "pass_out" })])).toEqual(["wounded", "dead", "fall"]);
  });

  it("groans once per character when SERIOUS fatigue costs endurance", () => {
    const serious = (p: number, endurance: number) => ev({ seg: 0, p, kind: "delay", reason: "serious", endurance });
    expect(groups([serious(0, 2), serious(0, 1), serious(1, 0)])).toEqual(["wounded"]);
    expect(groups([serious(0, 1), serious(1, 3)])).toEqual(["wounded", "wounded"]);
    expect(groups([ev({ kind: "delay", reason: "sprint", endurance: 1 })])).toEqual([]);
  });

  it("plays wounds after the gunshot", () => {
    const [shot, wound] = soundsForEvents([ev({ kind: "shot", hit: "vital" }), ev({ kind: "wound", result: "kill" })]);
    expect(shot.delayMs).toBeLessThan(wound.delayMs);
  });
});

const colt = (partial: Partial<GunView> = {}): GunView =>
  ({ id: 1, type: "colt45", name: "Colt 45", location: "holstered", cocked: false, shells: 6, capacity: 6, jammed: false, exploded: false, ...partial }) as GunView;
const char = (partial: Partial<CharView> = {}): CharView =>
  ({ hex: "A-F3", facing: 3, down: false, delay: 0, status: "alive", aim: 0, guns: [colt()], ...partial }) as CharView;

describe("soundsForPreview", () => {
  const groups = (before: CharView, after: CharView) => soundsForPreview(before, after).map((c) => c.group);

  it("plays what the plan decides", () => {
    expect(groups(char(), char({ hex: "A-F4" }))).toEqual(["step"]);
    expect(groups(char(), char({ facing: 2 }))).toEqual(["turn"]);
    expect(groups(char(), char({ down: true }))).toEqual(["fall"]);
    expect(groups(char({ aim: 2 }), char({ aim: 4 }))).toEqual(["aim"]);
    expect(groups(char({ down: true }), char())).toEqual([]);
    expect(groups(char(), char({ guns: [colt({ location: "gun_hand", cocked: true })] }))).toEqual(["unholster", "cock"]);
    expect(groups(char(), char({ guns: [colt({ location: "gun_hand", jammed: true })] }))).toEqual(["unholster"]);
    expect(groups(char({ guns: [colt({ location: "gun_hand" })] }), char({ guns: [colt({ location: "gun_hand", cocked: true })] }))).toEqual(["cock"]);
    expect(groups(char({ guns: [colt({ location: "both_hands", shells: 5 })] }), char({ guns: [colt({ location: "both_hands" })] }))).toEqual(["reload"]);
  });

  it("leaves shots silent", () => {
    expect(groups(char({ guns: [colt({ location: "gun_hand", cocked: true })] }), char({ guns: [colt({ location: "gun_hand", shells: 5 })] }))).toEqual([]);
  });
});

describe("soundsForDelay", () => {
  const groups = (before: number[], after: CharView[]) => soundsForDelay(before, after).map((c) => c.group);

  it("plays delay1 up, reversed down, once each", () => {
    expect(groups([0, 0], [char({ delay: 1 }), char({ delay: 2 })])).toEqual(["delay"]);
    expect(groups([4, 1], [char({ delay: 2 }), char({ delay: 1 })])).toEqual(["undelay"]);
    expect(groups([1, 4], [char({ delay: 2 }), char({ delay: 2 })])).toEqual(["delay", "undelay"]);
    expect(groups([1, 1], [char({ delay: 1 }), char({ delay: 1 })])).toEqual([]);
  });

  it("keeps a killed character silent", () => {
    expect(groups([3], [char({ delay: 0, status: "killed" })])).toEqual([]);
  });
});
