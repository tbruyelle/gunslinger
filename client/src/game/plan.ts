import type { GunView } from "../chain/types";
import { getActionDef, type CardNumber, type CardSide, type RelativeDirection } from "../rules";

/** One card side in the turn plan, with its committed choice when it takes one. */
export interface PlanEntry {
  card: CardNumber;
  side: CardSide;
  /** Relative direction, for move and turn cards. */
  dir?: RelativeDirection;
  /** Gun id, for Draw & Cock. */
  gun?: number;
  /** Destination hand for Draw & Cock: 0 gun hand, 1 other hand, 2 both hands. */
  hand?: number;
  /** What a Cock/Aim/Shoot does, or a Shoot (shoot or nothing). */
  opt?: ShootOption;
  /** The hex aimed at, for the aim option. */
  hex?: string;
}

export type ShootOption = "cock" | "uncock" | "aim" | "shoot" | "nothing";

/** The options each gun action offers, in display order. */
export const SHOOT_OPTIONS: Record<string, ShootOption[]> = {
  "Cock/Aim/Shoot": ["cock", "uncock", "aim", "shoot"],
  Shoot: ["shoot", "nothing"],
};

/** Whether the side is a gun action taking a shoot option. */
export function isShooting(entry: { card: CardNumber; side: CardSide }): boolean {
  return getActionDef(entry).name in SHOOT_OPTIONS;
}

export const HAND_GUN = 0;
export const HAND_OTHER = 1;
export const HAND_BOTH = 2;
export const HAND_LOCATION: Record<number, GunView["location"]> = { 0: "gun_hand", 1: "other_hand", 2: "both_hands" };

export const MAX_ACTION_POINTS = 5;
/** The most AIM points a character holds on a target (rule 12.3). */
export const MAX_AIM = 8;
export const MAX_PLAN_ENTRIES = 5;

/** Actions the realm implements so far: the foot actions and Draw & Cock. */
export const ENABLED_ACTIONS = new Set(["Advance", "Back Up", "Run", "Spin Around", "Sprint", "Turn", "Leap/Drop", "Get Up/Down", "Draw & Cock", "Cock/Aim/Shoot", "Shoot"]);

/** The holstered guns a Draw & Cock may take, given the character's guns. */
export function drawableGuns(guns: GunView[]): GunView[] {
  if (guns.some((g) => g.location === "gun_hand")) return [];
  return guns.filter((g) => g.location === "holstered");
}

const AHEAD = new Set<RelativeDirection>(["ahead_left", "ahead", "ahead_right"]);
const BACK = new Set<RelativeDirection>(["back_left", "back", "back_right"]);
const ALL_DIRS = new Set<string>([...AHEAD, ...BACK]);

export function isEnabled(entry: { card: CardNumber; side: CardSide }): boolean {
  return ENABLED_ACTIONS.has(getActionDef(entry).name);
}

/**
 * Whether a side can be picked now: implemented, Sprint only after a Run on
 * the previous turn, Draw & Cock only with a holstered gun and a free gun hand.
 */
export function canPlay(entry: { card: CardNumber; side: CardSide }, ranLastTurn: boolean, guns: GunView[] = []): boolean {
  if (!isEnabled(entry)) return false;
  const name = getActionDef(entry).name;
  if (name === "Sprint") return ranLastTurn;
  if (name === "Draw & Cock") return drawableGuns(guns).length > 0;
  return true;
}

/** The realm's plan string: "<card><f|b>[:<choice>]" entries joined by commas (a direction, or "<gun id>:<hand>" for Draw & Cock). */
export function encodePlan(plan: PlanEntry[]): string {
  return plan
    .map((e) => {
      const def = getActionDef(e);
      const base = `${e.card}${e.side === "front" ? "f" : "b"}`;
      if (def.name in SHOOT_OPTIONS) {
        if (!e.opt || (def.name === "Shoot" && e.opt === "nothing")) return base;
        return e.opt === "aim" ? `${base}:aim:${e.hex ?? ""}` : `${base}:${e.opt}`;
      }
      if (def.choiceType === "gun") return e.gun !== undefined ? `${base}:${e.gun}:${e.hand ?? HAND_GUN}` : base;
      const needsDir = def.choiceType === "move_ahead" || def.choiceType === "move_back" || def.choiceType === "turn_ahead" || def.choiceType === "turn_back";
      return needsDir && e.dir ? `${base}:${e.dir}` : base;
    })
    .join(",");
}

export function decodePlan(s: string): PlanEntry[] {
  if (s === "") return [];
  return s.split(",").map((token) => {
    const m = /^(\d{1,2})([fb])(?::([a-zA-Z_0-9:-]+))?$/.exec(token);
    if (!m) throw new Error(`invalid plan entry "${token}"`);
    const card = Number(m[1]);
    if (card < 1 || card > 12) throw new Error(`invalid card ${card}`);
    const entry: PlanEntry = { card: card as CardNumber, side: m[2] === "f" ? "front" : "back" };
    const name = getActionDef(entry).name;
    if (name in SHOOT_OPTIONS) {
      const choice = m[3] ?? (name === "Shoot" ? "nothing" : "");
      const i = choice.indexOf(":");
      const opt = i >= 0 ? choice.slice(0, i) : choice;
      const arg = i >= 0 ? choice.slice(i + 1) : "";
      if (!(SHOOT_OPTIONS[name] as string[]).includes(opt)) throw new Error(`invalid option "${opt}" for ${name}`);
      if (opt === "aim") {
        if (!/^[A-Z0-9-]{3,8}$/.test(arg)) throw new Error(`aim needs the hex to aim at, e.g. "${token.split(":")[0]}:aim:A-F6"`);
        entry.hex = arg;
      } else if (arg) throw new Error(`option "${opt}" takes no argument`);
      entry.opt = opt as ShootOption;
      return entry;
    }
    if (m[3] !== undefined) {
      if (getActionDef(entry).choiceType === "gun") {
        const g = /^([1-9][0-9]*):([0-2])$/.exec(m[3]);
        if (!g) throw new Error(`invalid gun choice "${m[3]}" (expected <gun id>:<hand>)`);
        entry.gun = Number(g[1]);
        entry.hand = Number(g[2]);
      } else {
        if (!ALL_DIRS.has(m[3])) throw new Error(`invalid direction "${m[3]}"`);
        entry.dir = m[3] as RelativeDirection;
      }
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
 * ranLastTurn says whether a Run was played on the previous turn; guns are
 * the character's guns, for Draw & Cock.
 */
export function validatePlan(plan: PlanEntry[], budget = MAX_ACTION_POINTS, ranLastTurn = true, guns: GunView[] = []): string | null {
  if (plan.length > MAX_PLAN_ENTRIES) return "too many actions in plan";
  const used = new Set<number>();
  const names = new Set<string>();
  for (const e of plan) {
    const def = getActionDef(e);
    if (!ENABLED_ACTIONS.has(def.name)) return "that action is not available yet";
    if (used.has(e.card)) return "you cannot use both sides of a card";
    used.add(e.card);
    names.add(def.name);
    if (def.name in SHOOT_OPTIONS) {
      if (!e.opt || !SHOOT_OPTIONS[def.name].includes(e.opt)) return "choose what to do with the gun";
      if (e.opt === "aim" && !e.hex) return "choose the hex to aim at";
      continue;
    }
    switch (def.choiceType) {
      case "move_ahead":
      case "turn_ahead":
        if (!e.dir || !AHEAD.has(e.dir)) return "choose a forward direction";
        break;
      case "move_back":
      case "turn_back":
        if (!e.dir || !BACK.has(e.dir)) return "choose a backward direction";
        break;
      case "gun": {
        if (e.gun === undefined) return "choose the gun to draw";
        const g = guns.find((x) => x.id === e.gun);
        if (!g || g.location !== "holstered") return "that gun is not in a holster";
        const hand = e.hand ?? HAND_GUN;
        if (hand !== HAND_GUN) return "only the gun hand can draw for now";
        if (guns.some((x) => x.location === HAND_LOCATION[hand])) return "that hand already holds a gun";
        break;
      }
      default:
        if (e.dir) return "that action takes no direction";
        if (e.gun !== undefined) return "that action takes no gun";
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
