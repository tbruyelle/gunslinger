import { getActionDef, relativeToAbsoluteDir } from "../rules";
import type { BoardMap } from "../board/boardA";
import type { GunLocation, GunView } from "../chain/types";
import type { PlanEntry } from "./plan";

/** What the board shows for one character. */
export interface CharView {
  hex: string;
  /** Absolute facing 0=N 1=NE 2=SE 3=S 4=SW 5=NW. */
  facing: number;
  down: boolean;
  delay: number;
  /** The character's guns; the one in a hand shows on the token. */
  guns: GunView[];
}

/** Destination of a Draw & Cock by hand code (0 gun hand, 1 other hand, 2 both hands). */
const HAND_LOCATIONS: GunLocation[] = ["gun_hand", "other_hand", "both_hands"];

/** The type of the gun held in a hand, if any. */
export function gunInHand(guns: GunView[]): string | null {
  return guns.find((g) => g.location !== "holstered")?.type ?? null;
}

/** A copy of a character view that shares nothing with the original. */
export function copyChar(c: CharView): CharView {
  return { ...c, guns: c.guns.map((g) => ({ ...g })) };
}

/**
 * Previews where a plan would leave a character if every action executed:
 * each relative choice is resolved against the state left by the previous
 * one, exactly as the realm replays the committed plan.
 */
export function replayPlan(start: CharView, plan: PlanEntry[], board: BoardMap): CharView {
  const s = copyChar(start);
  for (const e of plan) {
    const def = getActionDef(e);
    if (def.choiceType === "gun") {
      // Draw & Cock: the holstered gun moves to the chosen hand, cocked.
      const g = s.guns.find((x) => x.id === e.gun && x.location === "holstered");
      const loc = HAND_LOCATIONS[e.hand ?? 0];
      if (g && loc) {
        g.location = loc;
        g.cocked = true;
      }
      continue;
    }
    if (def.category !== "foot") continue;
    switch (def.choiceType) {
      case "move_ahead":
      case "move_back":
        if (e.dir) s.hex = board.relNeighbor(s.hex, s.facing, e.dir) ?? s.hex;
        break;
      case "turn_ahead":
      case "turn_back":
        if (e.dir) s.facing = relativeToAbsoluteDir(s.facing, e.dir);
        break;
      case "none":
        if (def.name === "Sprint") s.hex = board.neighbor(s.hex, s.facing) ?? s.hex;
        else if (def.name === "Leap/Drop" || def.name === "Get Up/Down") s.down = !s.down;
        break;
    }
  }
  return s;
}
