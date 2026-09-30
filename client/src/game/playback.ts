import type { TurnEvent, TurnResult } from "../chain/types";
import type { CharView } from "./replay";

export const SEGMENTS = 5;

/** A position in a replay: which turn (index into the list) and the segment shown (0 = start). */
export interface ReplayPos {
  index: number;
  seg: number;
}

/** The next position, moving into the next turn after segment 5; null at the very end. */
export function stepForward(pos: ReplayPos, turns: number): ReplayPos | null {
  if (pos.seg < SEGMENTS) return { index: pos.index, seg: pos.seg + 1 };
  if (pos.index + 1 < turns) return { index: pos.index + 1, seg: 0 };
  return null;
}

/** The previous position, moving to the previous turn's end before segment 0; null at the very start. */
export function stepBack(pos: ReplayPos): ReplayPos | null {
  if (pos.seg > 0) return { index: pos.index, seg: pos.seg - 1 };
  if (pos.index > 0) return { index: pos.index - 1, seg: SEGMENTS };
  return null;
}

/** The characters' state when a turn began, from the stored snapshot. */
export function startOfTurn(t: TurnResult, fallback: CharView[]): CharView[] {
  if (!t.start || t.start.length === 0) return fallback.map((c) => ({ ...c }));
  return t.start.map((c) => ({ hex: c.hex, facing: c.facing, down: c.down, delay: c.delay }));
}

/** The characters' state once every event up to and including segment seg has applied. */
export function snapshotAfterSegment(start: CharView[], events: TurnEvent[], seg: number): CharView[] {
  const out = start.map((c) => ({ ...c }));
  for (const e of events) {
    if (e.seg < 1 || e.seg > seg) continue;
    const c = out[e.p];
    if (!c) continue;
    switch (e.kind) {
      case "move":
        c.hex = e.to;
        c.facing = e.facing;
        c.down = e.down;
        break;
      case "turn":
        c.facing = e.facing;
        break;
      case "flip":
        c.down = e.down;
        break;
      case "delay":
        c.delay = e.delay;
        break;
    }
  }
  return out;
}

export function eventsForSegment(events: TurnEvent[], seg: number): TurnEvent[] {
  return events.filter((e) => e.seg === seg);
}

/** End-of-turn cancellations (segment 0). */
export function endOfTurnEvents(events: TurnEvent[]): TurnEvent[] {
  return events.filter((e) => e.seg === 0);
}

const DIRS = ["N", "NE", "SE", "S", "SW", "NW"];

/** A one-line description of an event; names are indexed by seat. */
export function describeEvent(e: TurnEvent, names: string[]): string {
  const who = names[e.p] ?? `seat ${e.p}`;
  const action = e.action.replace(/_/g, " ");
  switch (e.kind) {
    case "move":
      return `${who} ${action}: ${e.from} → ${e.to}${e.down ? " (crawling)" : ""}`;
    case "turn":
      return `${who} ${action}: now facing ${DIRS[e.facing] ?? e.facing}`;
    case "flip":
      return e.down ? `${who} goes down` : `${who} gets up`;
    case "delay":
      return `${who} gains ${e.n} delay (${e.reason}), now ${e.delay}`;
    case "cancel":
      return `${who}: ${action} is cancelled (${e.reason})`;
    default:
      return `${who} ${e.kind}`;
  }
}
