// ── Coordinates ──────────────────────────────────────────────────────────────

/** Axial hex coordinates (q = column, r = row). */
export interface HexCoord {
  q: number;
  r: number;
}

/** The six cardinal hex facings (0 = N, clockwise). */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

// ── Characters ────────────────────────────────────────────────────────────────

/** Body locations for hit resolution (rules p.14). */
export type BodyLocation =
  | "head"
  | "chest"
  | "abdomen"
  | "right_arm"
  | "left_arm"
  | "right_leg"
  | "left_leg";

/** A wound entry applied to a body location. */
export interface Wound {
  location: BodyLocation;
  severity: 1 | 2 | 3; // flesh / serious / critical
}

/** All stats that wounds can degrade. */
export interface CharacterStats {
  speed: number;       // hexes per move action
  gunSpeed: number;    // draw/fire AP modifier
  accuracy: number;    // base accuracy modifier
  strength: number;    // melee / endurance base
}

export interface Character {
  id: string;
  name: string;
  baseStats: CharacterStats;
}

// ── Weapons ──────────────────────────────────────────────────────────────────

export type WeaponType = "revolver" | "rifle" | "shotgun" | "derringer" | "knife" | "fists";

export interface Weapon {
  type: WeaponType;
  loaded: number;    // rounds currently loaded
  capacity: number;
}

// ── Players ──────────────────────────────────────────────────────────────────

export type PlayerStatus = "alive" | "down" | "passed_out" | "surrendered" | "dead";

export interface Player {
  /** Character key (e.g. "marshal"), also used as the map key in GameState.players. */
  charKey: string;
  /** Session ID of the client controlling this character. */
  ownerSessionId: string;
  character: Character;
  /** Layout-space position on the composite board. */
  lx: number;
  ly: number;
  /** Rotation angle in degrees (hex facing). */
  angle: number;
  /** Hex ID from hex_grid.json (e.g. "A_0103"). */
  hexId: string;
  actionPoints: number;
  maxActionPoints: number;
  wounds: Wound[];
  weapons: Weapon[];
  activeWeaponIndex: number;
  status: PlayerStatus;
}

// ── Action cards ─────────────────────────────────────────────────────────────

/**
 * 12 physical cards, each with a front and back action (24 actions total).
 * A player cannot use both sides of the same card in one turn.
 */

/** Physical card IDs (1–12). */
export type CardNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Which side of a card is being played. */
export type CardSide = "front" | "back";

/** A selected action: card number + chosen side. */
export interface ActionCardSelection {
  card: CardNumber;
  side: CardSide;
}

/** Static data for one side of an action card. */
export interface ActionSideDef {
  name: string;
  /** Number of sequences this action occupies (1–3). */
  cost: number;
  /** Category shown on the card (top-left). */
  category: string;
}

/** Static data for a physical action card (front + back). */
export interface ActionCardDef {
  card: CardNumber;
  front: ActionSideDef;
  back: ActionSideDef;
}

/** All 12 action cards with front and back actions. */
export const ACTION_CARDS: ActionCardDef[] = [
  { card: 1,  front: { name: "Advance",        cost: 2, category: "foot" },
               back:  { name: "Back Up",         cost: 3, category: "foot" } },
  { card: 2,  front: { name: "Run",             cost: 1, category: "foot" },
               back:  { name: "Spin Around",     cost: 2, category: "foot" } },
  { card: 3,  front: { name: "Sprint",          cost: 1, category: "foot" },
               back:  { name: "Turn",            cost: 1, category: "foot" } },
  { card: 4,  front: { name: "Sprint",          cost: 1, category: "foot" },
               back:  { name: "Leap/Drop",       cost: 1, category: "foot" } },
  { card: 5,  front: { name: "Cock/Aim/Shoot",  cost: 2, category: "hand" },
               back:  { name: "Get Up/Down",     cost: 3, category: "foot" } },
  { card: 6,  front: { name: "Cock/Aim/Shoot",  cost: 2, category: "hand" },
               back:  { name: "Throw",           cost: 2, category: "hand" } },
  { card: 7,  front: { name: "Shoot",           cost: 1, category: "hand" },
               back:  { name: "Strength",        cost: 2, category: "strength" } },
  { card: 8,  front: { name: "Load",            cost: 3, category: "hand" },
               back:  { name: "Head Out/Back",   cost: 2, category: "foot" } },
  { card: 9,  front: { name: "Draw & Cock",     cost: 3, category: "hand" },
               back:  { name: "Head Out/Back",   cost: 2, category: "foot" } },
  { card: 10, front: { name: "Jab",             cost: 2, category: "attack" },
               back:  { name: "Duck",            cost: 1, category: "defense" } },
  { card: 11, front: { name: "Swing",           cost: 3, category: "attack" },
               back:  { name: "Block",           cost: 2, category: "defense" } },
  { card: 12, front: { name: "Belt",            cost: 3, category: "attack" },
               back:  { name: "Guard",           cost: 2, category: "defense" } },
];

/** Total sequences per turn that must be filled with action cards. */
export const SEQUENCES_PER_TURN = 5;

/** Helper: get the ActionSideDef for a selection. */
export function getActionDef(sel: ActionCardSelection): ActionSideDef {
  const card = ACTION_CARDS.find(c => c.card === sel.card)!;
  return sel.side === "front" ? card.front : card.back;
}

/** Helper: get the asset filename for a card selection (no path prefix). */
export function getActionCardAsset(card: CardNumber, side: CardSide): string {
  return side === "front" ? `action_card_a${card}.png` : `action_card_a${card}_back.png`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type ActionType =
  | "move"
  | "turn"
  | "draw"
  | "aim"
  | "fire"
  | "reload"
  | "pass";

export interface Action {
  type: ActionType;
  playerId: string;
  // move / turn
  target?: HexCoord;
  facing?: Facing;
  // fire / aim
  targetPlayerId?: string;
}

// ── Game phases ───────────────────────────────────────────────────────────────

/**
 * Turn sequence:
 *   action_selection → sequence (1–5) → turn_end → action_selection (next turn) | end
 */
export type GamePhase = "lobby" | "action_selection" | "sequence" | "turn_end" | "end";

export type SequenceNumber = 1 | 2 | 3 | 4 | 5;

// ── Game config ──────────────────────────────────────────────────────────────

export type WinCondition = "last_standing" | "team";

export interface GameConfig {
  maxTurns: number;
  winCondition: WinCondition;
}

// ── Token / board setup data (passed from client) ────────────────────────────

export interface PlacedTokenSetup {
  charKey: string;
  lx: number;
  ly: number;
  angle: number;
  hexId?: string;
}

export interface PlacedBoardSetup {
  key: string;
  rotation: number;
  lx: number;
  ly: number;
}

// ── Game state (authoritative, lives on server) ───────────────────────────────

export interface GameState {
  phase: GamePhase;
  turn: number;
  currentSequence: SequenceNumber;
  maxTurns: number;
  winCondition: WinCondition;
  /** Ordered charKeys — index 0 plays first (token placement order). */
  playerOrder: string[];
  /** Players keyed by charKey. */
  players: Record<string, Player>;
  /** Selected action cards for current turn, keyed by charKey. */
  selectedCards: Record<string, ActionCardSelection[]>;
  /** Board layout (for client reference). */
  boards: PlacedBoardSetup[];
}
