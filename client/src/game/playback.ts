import type { TurnEvent } from "../chain/types";
import type { CharView } from "./replay";

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
