/** Mirrors of the realm's JSON views (see gno.land/r/tbruyelle/gunslinger/v0/json.gno). */

export type Phase = "waiting" | "planning" | "finished";
export type PlayerStatus = "alive" | "out" | "killed" | "passed_out";
export type EventKind =
  | "move" | "turn" | "flip" | "delay" | "cancel" | "draw" | "wild_shot"
  | "cock" | "uncock" | "load" | "aim" | "lose_aim" | "nothing" | "shot" | "malfunction" | "wound" | "direction" | "drop_gun" | "pass_out" | "serious_check";

/** Seg of the events recorded after segment 5 (cancels, passing out, the serious-wound check); turn-start events have seg 0. */
export const END_OF_TURN_SEG = 6;

export interface PlayerView {
  addr: string;
  char: string;
  hex: string;
  /** Absolute facing 0=N 1=NE 2=SE 3=S 4=SW 5=NW. */
  facing: number;
  down: boolean;
  delay: number;
  status: PlayerStatus;
  submitted: boolean;
  playedFoot: boolean;
  playedRun: boolean;
  /** A Run was played on the previous turn: required to Sprint (rule 9.23). */
  ranLastTurn: boolean;
  /** AIM points (0-8) and the hex the markers sit on, "" when they are on the opponent and follow it. */
  aim: number;
  aimHex: string;
  /** Endurance boxes left (20 at the start); wounds and fatigue cross them off. */
  endurance: number;
  /** Permanent wounds: fatigue cards per turn, aim penalties per hand, fatigue cards per hex moved. */
  serious: number;
  gunArm: number;
  otherArm: number;
  leg: number;
  guns: GunView[];
}

/** Wound and aim fields shared by the live view and the turn-start snapshots. */
export type WoundFields = Pick<PlayerView, "aim" | "aimHex" | "endurance" | "serious" | "gunArm" | "otherArm" | "leg">;

/** A weapon lying in a hex; id is its ground id, "g<id>" in a plan. */
export interface GroundGunView {
  id: number;
  hex: string;
  guns: GunView[];
}

export type GunLocation = "holstered" | "gun_hand" | "other_hand" | "both_hands";

export interface GunView {
  /** Stable id of the gun within the game (the plan string refers to it). */
  id: number;
  type: string;
  name: string;
  location: GunLocation;
  cocked: boolean;
  shells: number;
  capacity: number;
  jammed: boolean;
  exploded: boolean;
}

export interface TurnEvent {
  /** Segment 1-5, or 0 for end-of-turn cancellations. */
  seg: number;
  /** Seat index. */
  p: number;
  kind: EventKind;
  action: string;
  from: string;
  to: string;
  facing: number;
  down: boolean;
  n: number;
  delay: number;
  reason: string;
  /** Result card drawn for a delay event (1-108; 0 when no card was drawn, e.g. crawl). */
  card: number;
  /** The card's penalty when its DELAY line is not a number (lose_aim, wild_shot, drop), a malfunction result, or a wound's penalty kind. */
  result: string;
  /** Endurance boxes crossed off by a wound or fatigue card. */
  endurance: number;
  /** Seat shot at, for shots. */
  target: number;
  /** Final hit location of a shot ("-" for a miss). */
  hit: string;
  /** Range of a shot in hexes. */
  range: number;
  /** Gun type and id for gun events ("" and 0 otherwise). */
  gun: string;
  gunId: number;
  /**
   * The part of the segment the event belongs to, in resolution order:
   * STEP_SHOTS, each seat's action (STEP_ACTION + seat), then STEP_END;
   * 0 outside the segments and for turns recorded before steps existed.
   */
  step: number;
}

/** Steps of a segment (engine StepShots, StepEnd, StepAction). */
export const STEP_SHOTS = 1;
export const STEP_END = 2;
export const STEP_ACTION = 3;

/** A character's state when a turn began. */
export interface StartChar extends WoundFields {
  hex: string;
  facing: number;
  down: boolean;
  delay: number;
  status: PlayerStatus;
  guns: GunView[];
}

export interface TurnResult {
  turn: number;
  seed: string;
  /** Result cards drawn during the turn (1-108), in draw order. */
  cards: number[];
  plans: string[];
  events: TurnEvent[];
  /** State of both seats at the start of the turn. */
  start: StartChar[];
}

/** Every resolved turn of a game, oldest first. */
export interface HistoryView {
  id: string;
  turn: number;
  phase: Phase;
  players: { addr: string; char: string }[];
  turns: TurnResult[];
}

export interface GameView {
  id: string;
  rev: number;
  phase: Phase;
  turn: number;
  maxTurns: number;
  /** Inactivity, in seconds, after which anyone may claim the timeout. */
  timeout: number;
  board: string;
  players: PlayerView[];
  /** Weapons lying on the board. */
  ground: GroundGunView[];
  /** Seat index of the winner, -1 for none. */
  winner: number;
  endReason: string;
  createdAt: number;
  updatedAt: number;
  /** Unix seconds after which ClaimTimeout succeeds; 0 when finished. */
  timeoutAt: number;
  lastTurn: TurnResult | null;
}

export interface GameSummary {
  id: string;
  rev: number;
  phase: Phase;
  turn: number;
  maxTurns: number;
  /** Inactivity, in seconds, after which anyone may claim the timeout. */
  timeout: number;
  /** Seat index of the winner, -1 for none. */
  winner: number;
  /** "" while running; cancelled, expired, resign, timeout, abandoned, max_turns, last_standing. */
  endReason: string;
  createdAt: number;
  updatedAt: number;
  players: { addr: string; char: string }[];
}

export interface GamesView {
  open: GameSummary[];
  mine: GameSummary[];
}

function bad(what: string): never {
  throw new Error(`bad game JSON: ${what}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function checkPlayer(v: unknown): PlayerView {
  if (!isRecord(v) || typeof v.addr !== "string" || typeof v.hex !== "string" || typeof v.facing !== "number") {
    bad("player");
  }
  return v as unknown as PlayerView;
}

function checkSummary(v: unknown): GameSummary {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.rev !== "number" || !Array.isArray(v.players)) {
    bad("summary");
  }
  return v as unknown as GameSummary;
}

export function parseGameView(json: string): GameView {
  const v: unknown = JSON.parse(json);
  if (!isRecord(v)) bad("not an object");
  if (typeof v.id !== "string" || typeof v.rev !== "number" || typeof v.turn !== "number") bad("header");
  if (v.phase !== "waiting" && v.phase !== "planning" && v.phase !== "finished") bad("phase");
  if (!Array.isArray(v.players) || v.players.length !== 2) bad("players");
  v.players.forEach(checkPlayer);
  if (v.lastTurn !== null) {
    if (!isRecord(v.lastTurn) || !Array.isArray(v.lastTurn.events)) bad("lastTurn");
  }
  return v as unknown as GameView;
}

/** The plan an address submitted for the turn in progress (json/plan/{id}/{addr}). */
export interface PlanView {
  id: string;
  turn: number;
  /** Seat of the address, -1 when it is not a player. */
  seat: number;
  submitted: boolean;
  plan: string;
}

export function parsePlanView(json: string): PlanView {
  const v: unknown = JSON.parse(json);
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.turn !== "number" || typeof v.submitted !== "boolean" || typeof v.plan !== "string") bad("plan");
  return v as unknown as PlanView;
}

export function parseHistoryView(json: string): HistoryView {
  const v: unknown = JSON.parse(json);
  if (!isRecord(v) || typeof v.id !== "string" || !Array.isArray(v.players) || !Array.isArray(v.turns)) bad("history");
  for (const t of v.turns) {
    if (!isRecord(t) || typeof t.turn !== "number" || !Array.isArray(t.events) || !Array.isArray(t.start)) bad("turn");
  }
  return v as unknown as HistoryView;
}

export function parseGamesView(json: string): GamesView {
  const v: unknown = JSON.parse(json);
  if (!isRecord(v) || !Array.isArray(v.open) || !Array.isArray(v.mine)) bad("games");
  v.open.forEach(checkSummary);
  v.mine.forEach(checkSummary);
  return v as unknown as GamesView;
}

/** Seat of an address in a game, or -1. */
export function seatOf(game: { players: { addr: string }[] }, addr: string): number {
  return game.players.findIndex((p) => p.addr !== "" && p.addr === addr);
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
