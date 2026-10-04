import { describe, expect, it } from "vitest";
import type { TurnEvent, TurnResult } from "../chain/types";
import { describeEvent, endOfTurnEvents, eventsForSegment, snapshotAfterSegment, startOfTurn, stepBack, stepForward } from "./playback";

const ev = (partial: Partial<TurnEvent>): TurnEvent => ({
  seg: 0, p: 0, kind: "move", action: "", from: "", to: "", facing: 0, down: false, n: 0, delay: 0, reason: "", gun: "", gunId: 0, ...partial,
});

const events: TurnEvent[] = [
  ev({ seg: 1, p: 1, kind: "flip", action: "leap_drop", down: true }),
  ev({ seg: 1, p: 1, kind: "delay", n: 2, delay: 2, reason: "leap" }),
  ev({ seg: 2, p: 0, kind: "move", action: "advance", from: "A-F1", to: "A-G2", facing: 3 }),
  ev({ seg: 3, p: 0, kind: "turn", action: "turn", facing: 4 }),
  ev({ seg: 0, p: 1, kind: "cancel", action: "advance", reason: "time" }),
];

const start = [
  { hex: "A-F1", facing: 3, down: false, delay: 0 },
  { hex: "A-F12", facing: 0, down: false, delay: 0 },
];

describe("snapshotAfterSegment", () => {
  it("folds events up to a segment", () => {
    expect(snapshotAfterSegment(start, events, 0)).toEqual(start);
    const s1 = snapshotAfterSegment(start, events, 1);
    expect(s1[1]).toEqual({ hex: "A-F12", facing: 0, down: true, delay: 2 });
    expect(s1[0]).toEqual(start[0]);
    const s3 = snapshotAfterSegment(start, events, 3);
    expect(s3[0]).toEqual({ hex: "A-G2", facing: 4, down: false, delay: 0 });
    expect(snapshotAfterSegment(start, events, 5)).toEqual(s3);
    expect(start[1].down).toBe(false);
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
    const t: TurnResult = { turn: 1, seed: "", plans: ["", ""], events: [], start: [{ hex: "A-F3", facing: 3, down: false, delay: 1, status: "alive" }, { hex: "A-F9", facing: 0, down: true, delay: 0, status: "alive" }] };
    expect(startOfTurn(t, start)).toEqual([
      { hex: "A-F3", facing: 3, down: false, delay: 1 },
      { hex: "A-F9", facing: 0, down: true, delay: 0 },
    ]);
    expect(startOfTurn({ ...t, start: [] }, start)).toEqual(start);
  });
});
