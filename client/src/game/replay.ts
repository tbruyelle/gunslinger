import { getActionDef, relativeToAbsoluteDir } from "../rules";
import type { BoardMap } from "../board/boardA";
import type { PlanEntry } from "./plan";

/** What the board shows for one character. */
export interface CharView {
  hex: string;
  /** Absolute facing 0=N 1=NE 2=SE 3=S 4=SW 5=NW. */
  facing: number;
  down: boolean;
  delay: number;
}

/**
 * Previews where a plan would leave a character if every action executed:
 * each relative choice is resolved against the state left by the previous
 * one, exactly as the realm replays the committed plan.
 */
export function replayPlan(start: CharView, plan: PlanEntry[], board: BoardMap): CharView {
  const s: CharView = { ...start };
  for (const e of plan) {
    const def = getActionDef(e);
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
