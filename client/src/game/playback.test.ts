import { describe, expect, it } from "vitest";
import { END_OF_TURN_SEG, type GunView, type TurnEvent, type TurnResult } from "../chain/types";
import { describeEvent, endOfTurnEvents, eventsForSegment, snapshotAfterSegment, startOfTurn, stepBack, stepForward } from "./playback";

const ev = (partial: Partial<TurnEvent>): TurnEvent => ({
  seg: 0, p: 0, kind: "move", action: "", from: "", to: "", facing: 0, down: false, n: 0, delay: 0, reason: "", card: 0, result: "", endurance: 0, target: 0, hit: "", range: 0, gun: "", gunId: 0, ...partial,
});

const events: TurnEvent[] = [
  ev({ seg: 1, p: 1, kind: "flip", action: "leap_drop", down: true }),
  ev({ seg: 1, p: 1, kind: "delay", n: 2, delay: 2, reason: "leap" }),
  ev({ seg: 2, p: 0, kind: "move", action: "advance", from: "A-F1", to: "A-G2", facing: 3 }),
  ev({ seg: 3, p: 0, kind: "turn", action: "turn", facing: 4 }),
  ev({ seg: END_OF_TURN_SEG, p: 1, kind: "cancel", action: "advance", reason: "time" }),
];

const fresh = { status: "alive" as const, aim: 0, aimHex: "", endurance: 20, serious: 0, gunArm: 0, otherArm: 0, leg: 0 };
const start = [
  { hex: "A-F1", facing: 3, down: false, delay: 0, guns: [], ...fresh },
  { hex: "A-F12", facing: 0, down: false, delay: 0, guns: [], ...fresh },
];
const colt: GunView = { id: 1, type: "colt45", name: "Colt 45", location: "holstered", cocked: false, shells: 6, capacity: 6, jammed: false, exploded: false };

describe("snapshotAfterSegment", () => {
  it("folds events up to a segment", () => {
    expect(snapshotAfterSegment(start, events, 0)).toEqual(start);
    const s1 = snapshotAfterSegment(start, events, 1);
    expect(s1[1]).toEqual({ hex: "A-F12", facing: 0, down: true, delay: 2, guns: [], ...fresh });
    expect(s1[0]).toEqual(start[0]);
    const s3 = snapshotAfterSegment(start, events, 3);
    expect(s3[0]).toEqual({ hex: "A-G2", facing: 4, down: false, delay: 0, guns: [], ...fresh });
    expect(snapshotAfterSegment(start, events, 5)).toEqual(s3);
    expect(start[1].down).toBe(false);
  });

  it("folds gun events", () => {
    const s = [{ ...start[0], guns: [colt] }, start[1]];
    const evs = [
      ev({ seg: 3, p: 0, kind: "draw", action: "draw_and_cock", from: "holstered", to: "gun_hand", gun: "colt45", gunId: 1 }),
      ev({ seg: 4, p: 0, kind: "wild_shot", gun: "colt45", gunId: 1 }),
    ];
    expect(snapshotAfterSegment(s, evs, 2)[0].guns[0]).toEqual(colt);
    expect(snapshotAfterSegment(s, evs, 3)[0].guns[0]).toEqual({ ...colt, location: "gun_hand", cocked: true });
    expect(snapshotAfterSegment(s, evs, 4)[0].guns[0]).toEqual({ ...colt, location: "gun_hand", cocked: false, shells: 5 });
    expect(colt.location).toBe("holstered");
  });

  it("folds shots, aim and wounds", () => {
    const armed = { ...colt, location: "gun_hand" as const, cocked: true };
    const s = [{ ...start[0], guns: [armed] }, start[1]];
    const evs = [
      ev({ seg: 0, p: 0, kind: "delay", n: 1, delay: 1, reason: "serious", card: 37, endurance: 1 }),
      ev({ seg: 1, p: 0, kind: "aim", action: "cock_aim_shoot", to: "A-F6", target: -1, n: 2 }),
      ev({ seg: 3, p: 0, kind: "shot", action: "shoot", card: 6, target: 1, hit: "VITAL", range: 1, n: 3, gun: "colt45", gunId: 1 }),
      ev({ seg: 3, p: 0, kind: "lose_aim", reason: "shot" }),
      ev({ seg: 3, p: 1, kind: "wound", result: "kill" }),
      ev({ seg: END_OF_TURN_SEG, p: 0, kind: "pass_out" }),
    ];
    const s0 = snapshotAfterSegment(s, evs, 0);
    expect(s0[0].endurance).toBe(19);
    expect(s0[0].delay).toBe(1);
    const s1 = snapshotAfterSegment(s, evs, 1);
    expect(s1[0].aim).toBe(2);
    expect(s1[0].aimHex).toBe("A-F6");
    const s3 = snapshotAfterSegment(s, evs, 3);
    expect(s3[0].aim).toBe(0);
    expect(s3[0].guns[0]).toEqual({ ...armed, cocked: false, shells: 5 });
    expect(s3[1].status).toBe("killed");
    expect(s3[1].down).toBe(true);
    expect(s3[0].status).toBe("alive");
    expect(snapshotAfterSegment(s, evs, 5)[0].status).toBe("passed_out");
    const names = ["marshal", "dude"];
    expect(describeEvent(evs[2], names)).toBe("marshal shoots dude (card 6, aim time 3, range 1): VITAL hit");
    expect(describeEvent(ev({ p: 0, kind: "shot", card: 1, target: 1, hit: "-", range: 6, n: 3 }), names)).toBe("marshal shoots dude (card 1, aim time 3, range 6): miss");
    expect(describeEvent(ev({ p: 0, kind: "shot", card: 104, target: 1, hit: "-", reason: "misfire" }), names)).toBe("marshal shoots dude (card 104, aim time 0, range 0): misfire");
    expect(describeEvent(evs[4], names)).toBe("dude suffers KILL");
    expect(describeEvent(ev({ p: 1, kind: "wound", result: "stun", n: 4 }), names)).toBe("dude suffers STUN 4");
    expect(describeEvent(evs[1], names)).toBe("marshal aims at A-F6: 2 AIM points");
    expect(describeEvent(ev({ p: 0, kind: "aim", to: "A-F9", target: 1, n: 4 }), names)).toBe("marshal aims at A-F9 (dude): 4 AIM points");
    expect(describeEvent(evs[0], names)).toBe("marshal gains 1 delay (serious, card 37), now 1, loses 1 endurance");
    expect(endOfTurnEvents(evs)).toHaveLength(1);
    expect(eventsForSegment(evs, 0)).toHaveLength(1);
  });

  it("filters segments", () => {
    expect(eventsForSegment(events, 1)).toHaveLength(2);
    expect(endOfTurnEvents(events)).toHaveLength(1);
  });

  it("describes events", () => {
    const names = ["marshal", "dude"];
    expect(describeEvent(events[2], names)).toBe("marshal advance: A-F1 → A-G2");
    expect(describeEvent(events[3], names)).toBe("marshal turn: now facing SW");
    expect(describeEvent(events[0], names)).toBe("dude goes down");
    expect(describeEvent(events[1], names)).toBe("dude gains 2 delay (leap), now 2");
    expect(describeEvent(ev({ p: 1, kind: "delay", n: 1, delay: 3, reason: "sprint", card: 42 }), names)).toBe("dude gains 1 delay (sprint, card 42), now 3");
    expect(describeEvent(ev({ p: 1, kind: "delay", reason: "leap", card: 95, result: "lose_aim" }), names)).toBe("dude draws card 95 (leap): LOSE AIM");
    expect(describeEvent(ev({ p: 1, kind: "delay", reason: "occupied", card: 107, result: "drop" }), names)).toBe("dude draws card 107 (occupied): DROP");
    expect(describeEvent(ev({ p: 0, kind: "wild_shot", gun: "colt45", gunId: 1 }), names)).toBe("marshal's Colt 45 goes off (wild shot)");
    expect(describeEvent(events[4], names)).toBe("dude: advance is cancelled (time)");
    expect(describeEvent(ev({ seg: 3, p: 0, kind: "draw", action: "draw_and_cock", gun: "colt45" }), names)).toBe("marshal draws and cocks the Colt 45");
  });
});

describe("replay stepping", () => {
  it("walks segments and turns forward and back", () => {
    expect(stepForward({ index: 0, seg: 0 }, 2)).toEqual({ index: 0, seg: 1 });
    expect(stepForward({ index: 0, seg: 5 }, 2)).toEqual({ index: 1, seg: 0 });
    expect(stepForward({ index: 1, seg: 5 }, 2)).toBeNull();
    expect(stepBack({ index: 1, seg: 0 })).toEqual({ index: 0, seg: 5 });
    expect(stepBack({ index: 0, seg: 3 })).toEqual({ index: 0, seg: 2 });
    expect(stepBack({ index: 0, seg: 0 })).toBeNull();
  });

  it("uses the stored start of a turn, or the fallback", () => {
    const t: TurnResult = { turn: 1, seed: "", cards: [], plans: ["", ""], events: [], start: [{ hex: "A-F3", facing: 3, down: false, delay: 1, guns: [colt], ...fresh }, { hex: "A-F9", facing: 0, down: true, delay: 0, guns: [], ...fresh, aim: 4 }] };
    expect(startOfTurn(t, start)).toEqual([
      { hex: "A-F3", facing: 3, down: false, delay: 1, guns: [colt], ...fresh },
      { hex: "A-F9", facing: 0, down: true, delay: 0, guns: [], ...fresh, aim: 4 },
    ]);
    expect(startOfTurn(t, start)[0].guns[0]).not.toBe(colt);
    expect(startOfTurn({ ...t, start: [] }, start)).toEqual(start);
  });
});
