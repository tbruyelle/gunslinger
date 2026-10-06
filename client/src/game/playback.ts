import { END_OF_TURN_SEG, type GunLocation, type TurnEvent, type TurnResult } from "../chain/types";
import { copyChar, type CharView } from "./replay";

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
  if (!t.start || t.start.length === 0) return fallback.map(copyChar);
  return t.start.map((c) => ({
    hex: c.hex, facing: c.facing, down: c.down, delay: c.delay, status: c.status ?? "alive",
    aim: c.aim ?? 0, aimHex: c.aimHex ?? "", endurance: c.endurance ?? 20, serious: c.serious ?? 0, gunArm: c.gunArm ?? 0, otherArm: c.otherArm ?? 0, leg: c.leg ?? 0,
    guns: (c.guns ?? []).map((g) => ({ ...g })),
  }));
}

/**
 * The characters' state once every event up to and including segment seg
 * has applied: turn-start events (seg 0) always, end-of-turn events
 * (END_OF_TURN_SEG) from segment 5.
 */
export function snapshotAfterSegment(start: CharView[], events: TurnEvent[], seg: number): CharView[] {
  const out = start.map(copyChar);
  for (const e of events) {
    if (e.seg === END_OF_TURN_SEG ? seg < SEGMENTS : e.seg > seg) continue;
    const c = out[e.p];
    if (!c) continue;
    const gun = c.guns.find((x) => x.id === e.gunId);
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
        if (e.endurance) c.endurance = Math.max(0, c.endurance - e.endurance);
        break;
      case "draw":
        if (gun) {
          gun.location = e.to as GunLocation;
          gun.cocked = true;
        }
        break;
      case "wild_shot":
      case "shot":
        if (gun) {
          gun.cocked = false;
          gun.shells = Math.max(0, gun.shells - 1);
        }
        if (e.kind === "shot") c.aimHex = "";
        break;
      case "cock":
        if (gun) gun.cocked = true;
        break;
      case "uncock":
        if (gun) gun.cocked = false;
        break;
      case "malfunction":
        if (gun && e.result === "jams") {
          gun.shells = 0;
          gun.jammed = true;
        } else if (gun && e.result === "explodes") gun.exploded = true;
        break;
      case "drop_gun":
        c.guns = c.guns.filter((x) => x.id !== e.gunId);
        break;
      case "aim":
        c.aim = e.n;
        c.aimHex = e.target >= 0 ? "" : e.to;
        break;
      case "lose_aim":
        c.aim = 0;
        c.aimHex = "";
        break;
      case "wound":
        switch (e.result) {
          case "kill":
            c.status = "killed";
            c.down = true;
            c.aim = 0;
            c.delay = 0;
            break;
          case "serious":
            c.serious += e.n;
            break;
          case "gun_arm":
            c.gunArm += e.n;
            break;
          case "other_arm":
            c.otherArm += e.n;
            break;
          case "leg":
            c.leg += e.n;
            break;
        }
        break;
      case "pass_out":
        c.status = "passed_out";
        c.down = true;
        c.aim = 0;
        break;
    }
  }
  return out;
}

/** The events of one segment; segment 0 holds the turn-start events (fatigue, aim lost on the first reveal). */
export function eventsForSegment(events: TurnEvent[], seg: number): TurnEvent[] {
  return events.filter((e) => e.seg === seg);
}

/** Events recorded after segment 5: cancellations, passing out, the serious-wound check. */
export function endOfTurnEvents(events: TurnEvent[]): TurnEvent[] {
  return events.filter((e) => e.seg === END_OF_TURN_SEG);
}

const DIRS = ["N", "NE", "SE", "S", "SW", "NW"];
const GUN_NAMES: Record<string, string> = { colt45: "Colt 45" };

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
    case "delay": {
      if (e.card === 0) return `${who} gains ${e.n} delay (${e.reason}), now ${e.delay}`;
      const card = `card ${e.card}`;
      const lost = e.endurance > 0 ? `, loses ${e.endurance} endurance` : "";
      if (e.result === "") return `${who} gains ${e.n} delay (${e.reason}, ${card}), now ${e.delay}${lost}`;
      return `${who} draws ${card} (${e.reason}): ${e.result.replace(/_/g, " ").toUpperCase()}`;
    }
    case "wild_shot":
      return `${who}'s ${GUN_NAMES[e.gun] ?? e.gun} goes off (wild shot)`;
    case "cock":
      return `${who} cocks the ${GUN_NAMES[e.gun] ?? e.gun}`;
    case "uncock":
      return `${who} uncocks the ${GUN_NAMES[e.gun] ?? e.gun}`;
    case "aim":
      return `${who} aims at ${e.to}${e.target >= 0 ? ` (${names[e.target] ?? `seat ${e.target}`})` : ""}: ${e.n} AIM points`;
    case "lose_aim":
      return `${who} loses the aim (${e.reason.replace(/_/g, " ")})`;
    case "nothing":
      return `${who} does nothing (${action})`;
    case "shot": {
      const head = `${who} shoots ${names[e.target] ?? `seat ${e.target}`} (card ${e.card}, aim time ${e.n}, range ${e.range}): `;
      if (e.reason === "misfire") return head + "misfire";
      if (e.hit === "-") return head + "miss" + (e.reason ? ` (${e.reason.replace(/_/g, " ")})` : "");
      return head + `${e.hit} hit`;
    }
    case "malfunction":
      return `${who} draws card ${e.card}: MALFUNCTION, ${e.result.replace(/_/g, " ")}`;
    case "wound":
      return `${who} suffers ${e.result.replace(/_/g, " ").toUpperCase()}${e.n > 0 ? ` ${e.n}` : ""}`;
    case "direction":
      return `${who} draws card ${e.card} as a direction: ${e.to.replace(/_/g, " ")}`;
    case "drop_gun":
      return `${who} drops the ${GUN_NAMES[e.gun] ?? e.gun} in ${e.to}`;
    case "pass_out":
      return `${who} passes out`;
    case "serious_check":
      return `${who} draws card ${e.card} for the SERIOUS wounds: ${e.n} points`;
    case "cancel":
      return `${who}: ${action} is cancelled (${e.reason.replace(/_/g, " ")})`;
    case "draw":
      return `${who} draws and cocks the ${GUN_NAMES[e.gun] ?? e.gun}`;
    default:
      return `${who} ${e.kind}`;
  }
}
