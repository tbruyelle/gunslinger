/** Mirrors of the realm's JSON views (see gno.land/r/tbruyelle/gunslinger/v0/json.gno). */

export type Phase = "waiting" | "planning" | "finished";
export type PlayerStatus = "alive" | "out";
export type EventKind = "move" | "turn" | "flip" | "delay" | "cancel";

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
}

export interface TurnResult {
  turn: number;
  seed: string;
  plans: string[];
  events: TurnEvent[];
}

export interface GameView {
  id: string;
  rev: number;
  phase: Phase;
  turn: number;
  maxTurns: number;
  board: string;
  players: PlayerView[];
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
