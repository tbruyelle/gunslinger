import { getActionDef, type CardNumber, type CardSide, type RelativeDirection } from "../rules";

/** One card side in the turn plan, with its committed direction when it takes one. */
export interface PlanEntry {
  card: CardNumber;
  side: CardSide;
  dir?: RelativeDirection;
}

export const MAX_ACTION_POINTS = 5;
export const MAX_PLAN_ENTRIES = 5;

/** Actions the realm implements so far (foot actions only). */
export const ENABLED_ACTIONS = new Set(["Advance", "Back Up", "Run", "Spin Around", "Sprint", "Turn", "Leap/Drop", "Get Up/Down"]);

const AHEAD = new Set<RelativeDirection>(["ahead_left", "ahead", "ahead_right"]);
const BACK = new Set<RelativeDirection>(["back_left", "back", "back_right"]);
const ALL_DIRS = new Set<string>([...AHEAD, ...BACK]);

export function isEnabled(entry: { card: CardNumber; side: CardSide }): boolean {
  return ENABLED_ACTIONS.has(getActionDef(entry).name);
}

/** Whether a side can be picked now: implemented, and Sprint only after a Run on the previous turn. */
export function canPlay(entry: { card: CardNumber; side: CardSide }, ranLastTurn: boolean): boolean {
  if (!isEnabled(entry)) return false;
  return ranLastTurn || getActionDef(entry).name !== "Sprint";
}

/** The realm's plan string: "<card><f|b>[:<dir>]" entries joined by commas. */
export function encodePlan(plan: PlanEntry[]): string {
  return plan
    .map((e) => {
      const def = getActionDef(e);
      const needsDir = def.choiceType === "move_ahead" || def.choiceType === "move_back" || def.choiceType === "turn_ahead" || def.choiceType === "turn_back";
      return `${e.card}${e.side === "front" ? "f" : "b"}${needsDir && e.dir ? `:${e.dir}` : ""}`;
    })
    .join(",");
}

export function decodePlan(s: string): PlanEntry[] {
  if (s === "") return [];
  return s.split(",").map((token) => {
    const m = /^(\d{1,2})([fb])(?::([a-z_]+))?$/.exec(token);
    if (!m) throw new Error(`invalid plan entry "${token}"`);
    const card = Number(m[1]);
    if (card < 1 || card > 12) throw new Error(`invalid card ${card}`);
    const entry: PlanEntry = { card: card as CardNumber, side: m[2] === "f" ? "front" : "back" };
    if (m[3] !== undefined) {
      if (!ALL_DIRS.has(m[3])) throw new Error(`invalid direction "${m[3]}"`);
      entry.dir = m[3] as RelativeDirection;
    }
    return entry;
  });
}

export function planCost(plan: PlanEntry[]): number {
  return plan.reduce((sum, e) => sum + getActionDef(e).cost, 0);
}

/**
 * Checks the plan the way the realm does (engine.Plan.Validate); returns the
 * error message or null. budget is 5 minus the character's carried delay;
 * ranLastTurn says whether a Run was played on the previous turn.
 */
export function validatePlan(plan: PlanEntry[], budget = MAX_ACTION_POINTS, ranLastTurn = true): string | null {
  if (plan.length > MAX_PLAN_ENTRIES) return "too many actions in plan";
  const used = new Set<number>();
  const names = new Set<string>();
  for (const e of plan) {
    const def = getActionDef(e);
    if (!ENABLED_ACTIONS.has(def.name)) return "that action is not available yet";
    if (used.has(e.card)) return "you cannot use both sides of a card";
    used.add(e.card);
    names.add(def.name);
    switch (def.choiceType) {
      case "move_ahead":
      case "turn_ahead":
        if (!e.dir || !AHEAD.has(e.dir)) return "choose a forward direction";
        break;
      case "move_back":
      case "turn_back":
        if (!e.dir || !BACK.has(e.dir)) return "choose a backward direction";
        break;
      default:
        if (e.dir) return "that action takes no direction";
    }
  }
  if (planCost(plan) > budget) return "those actions cost more time points than you have";
  if (names.has("Run") && !names.has("Advance")) return "run can only be played together with advance";
  if (names.has("Sprint")) {
    if (!names.has("Run")) return "sprint can only be played together with run";
    if (!ranLastTurn) return "sprint can only be played after a run on the previous turn";
  }
  return null;
}
