import { describe, expect, it } from "vitest";
import type { TurnEvent } from "../chain/types";
import { describeEvent, endOfTurnEvents, eventsForSegment, snapshotAfterSegment } from "./playback";

const ev = (partial: Partial<TurnEvent>): TurnEvent => ({
  seg: 0, p: 0, kind: "move", action: "", from: "", to: "", facing: 0, down: false, n: 0, delay: 0, reason: "", ...partial,
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
  });
});
