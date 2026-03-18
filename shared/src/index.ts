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

export type CharacterStatus = "alive" | "down" | "passed_out" | "surrendered" | "dead";

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
  status: CharacterStatus;
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

// ── Choice types for action cards ────────────────────────────────────────────

/**
 * What kind of additional choice a card requires when selected.
 * - move_ahead: pick 1 of 3 forward hexes (straight ahead, ahead left, ahead right)
 * - move_back: pick 1 of 3 backward hexes (straight back, back left, back right)
 * - turn_ahead: pick new facing from 3 forward directions
 * - turn_back: pick new facing from 3 backward directions
 * - target_ranged: pick a target character (any range)
 * - target_melee: pick a target character within 1 hex
 * - target_defend: pick an attacker to defend against
 * - none: no additional choice needed
 */
export type ChoiceType =
  | "move_ahead"
  | "move_back"
  | "turn_ahead"
  | "turn_back"
  | "target_ranged"
  | "target_melee"
  | "target_defend"
  | "none";

/**
 * Relative hex direction from facing.
 * Index into the 6-neighbor ring: ahead=0, ahead_right=+1, back_right=+2,
 * back=+3, back_left=+4, ahead_left=+5 (all mod 6 from facingIndex).
 */
export type RelativeDirection =
  | "ahead"
  | "ahead_right"
  | "back_right"
  | "back"
  | "back_left"
  | "ahead_left";

/** The player's choice for a card that requires one. */
export interface CardChoice {
  /** For move choices: the relative direction to move (Advance, Run, Back Up, Sprint). */
  moveDir?: RelativeDirection;
  /** For turn choices: the relative direction to face (Turn, Spin Around). */
  newFacing?: RelativeDirection;
  /** For target choices: the charKey of the target. */
  targetCharKey?: string;
}

/** A selected action: card number + chosen side + optional choice. */
export interface ActionCardSelection {
  card: CardNumber;
  side: CardSide;
  choice?: CardChoice;
}

/** Static data for one side of an action card. */
export interface ActionSideDef {
  name: string;
  /** Number of sequences this action occupies (1–3). */
  cost: number;
  /** Category shown on the card (top-left). */
  category: string;
  /** What additional choice this card requires. */
  choiceType: ChoiceType;
}

/** Static data for a physical action card (front + back). */
export interface ActionCardDef {
  card: CardNumber;
  front: ActionSideDef;
  back: ActionSideDef;
}

/** All 12 action cards with front and back actions. */
export const ACTION_CARDS: ActionCardDef[] = [
  { card: 1,  front: { name: "Advance",        cost: 2, category: "foot",     choiceType: "move_ahead" },
               back:  { name: "Back Up",         cost: 3, category: "foot",     choiceType: "move_back" } },
  { card: 2,  front: { name: "Run",             cost: 1, category: "foot",     choiceType: "move_ahead" },
               back:  { name: "Spin Around",     cost: 2, category: "foot",     choiceType: "turn_back" } },
  { card: 3,  front: { name: "Sprint",          cost: 1, category: "foot",     choiceType: "none" },
               back:  { name: "Turn",            cost: 1, category: "foot",     choiceType: "turn_ahead" } },
  { card: 4,  front: { name: "Sprint",          cost: 1, category: "foot",     choiceType: "none" },
               back:  { name: "Leap/Drop",       cost: 1, category: "foot",     choiceType: "none" } },
  { card: 5,  front: { name: "Cock/Aim/Shoot",  cost: 2, category: "hand",     choiceType: "target_ranged" },
               back:  { name: "Get Up/Down",     cost: 3, category: "foot",     choiceType: "none" } },
  { card: 6,  front: { name: "Cock/Aim/Shoot",  cost: 2, category: "hand",     choiceType: "target_ranged" },
               back:  { name: "Throw",           cost: 2, category: "hand",     choiceType: "target_ranged" } },
  { card: 7,  front: { name: "Shoot",           cost: 1, category: "hand",     choiceType: "target_ranged" },
               back:  { name: "Strength",        cost: 2, category: "strength", choiceType: "none" } },
  { card: 8,  front: { name: "Load",            cost: 3, category: "hand",     choiceType: "none" },
               back:  { name: "Head Out/Back",   cost: 2, category: "foot",     choiceType: "none" } },
  { card: 9,  front: { name: "Draw & Cock",     cost: 3, category: "hand",     choiceType: "none" },
               back:  { name: "Head Out/Back",   cost: 2, category: "foot",     choiceType: "none" } },
  { card: 10, front: { name: "Jab",             cost: 2, category: "attack",   choiceType: "target_melee" },
               back:  { name: "Duck",            cost: 1, category: "defense",  choiceType: "target_defend" } },
  { card: 11, front: { name: "Swing",           cost: 3, category: "attack",   choiceType: "target_melee" },
               back:  { name: "Block",           cost: 2, category: "defense",  choiceType: "target_defend" } },
  { card: 12, front: { name: "Belt",            cost: 3, category: "attack",   choiceType: "target_melee" },
               back:  { name: "Guard",           cost: 2, category: "defense",  choiceType: "target_defend" } },
];

// ── Hex facing & direction utilities ─────────────────────────────────────────

/**
 * 6 hex neighbor directions, indexed 0–5 clockwise starting from North.
 * Convention: token angle=0 → facing North (up).
 * facingIndex = tokenAngle / 60.
 */
export const HEX_DIRECTIONS = ["N", "NE", "SE", "S", "SW", "NW"] as const;
export type HexDirection = typeof HEX_DIRECTIONS[number];

/**
 * Default arrow direction index for each character at angle=0.
 * Detected from the black arrow position in the token PNG images.
 * All tokens point either NE (1) or NW (5).
 */
export const CHAR_ARROW_DIR: Record<string, number> = {
  andy: 5, axe: 1, banker: 1, barkeep: 1, border_rider: 1, cattle_baron: 5,
  chief: 1, clerk: 5, driver: 5, dude: 1, eagle: 1, el_jefe: 1, fast_draw: 5,
  fast_eddie: 1, floozy: 1, foreman: 5, gambler: 1, guard: 5, gun_artist: 5,
  happy: 5, hawk: 1, ike: 1, innocente: 1, john_henry: 1, lady: 5, lightning: 1,
  ling_ho: 1, little_ernie: 5, lucky: 5, marshal: 5, mountain_man: 5, nco: 5,
  old_man: 5, owner: 1, prospector: 5, quiet_man: 5, reb: 5, running_boy: 1,
  slim: 5, smith: 1, sodbuster: 1, texas: 5, the_drifter: 1, the_kid: 1,
  u_s_scout: 5, veteran: 5, woman: 5, yankee: 5,
};

/**
 * Convert token angle (0,60,120,180,240,300) to a facing direction index (0–5).
 * Accounts for the character's default arrow direction in the unrotated image.
 */
export function angleToDirIndex(angle: number, charKey?: string): number {
  const baseDir = charKey ? (CHAR_ARROW_DIR[charKey] ?? 1) : 1;
  const rotSteps = ((Math.round(angle / 60) % 6) + 6) % 6;
  return (baseDir + rotSteps) % 6;
}

/**
 * Convert a facing direction index back to a token angle for a given character.
 * Inverse of angleToDirIndex.
 */
export function dirIndexToAngle(dirIndex: number, charKey?: string): number {
  const baseDir = charKey ? (CHAR_ARROW_DIR[charKey] ?? 1) : 1;
  const rotSteps = ((dirIndex - baseDir) % 6 + 6) % 6;
  return rotSteps * 60;
}

/** Given a facing index, return the direction index for a relative direction. */
export function relativeToAbsoluteDir(facingIndex: number, rel: RelativeDirection): number {
  const offsets: Record<RelativeDirection, number> = {
    ahead: 0, ahead_right: 1, back_right: 2,
    back: 3, back_left: 4, ahead_left: 5,
  };
  return (facingIndex + offsets[rel]) % 6;
}

/** The 3 forward relative directions (for move_ahead / turn_ahead). */
export const AHEAD_DIRS: RelativeDirection[] = ["ahead_left", "ahead", "ahead_right"];
/** The 3 backward relative directions (for move_back / turn_back). */
export const BACK_DIRS: RelativeDirection[] = ["back_left", "back", "back_right"];

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
 *   action_selection → sequence_resolution (1–5) → turn_end → action_selection (next turn) | end
 */
export const PHASE = {
  ACTION_SELECTION: "action_selection",
  SEQUENCE_RESOLUTION: "sequence_resolution",
  TURN_END: "turn_end",
  END: "end",
} as const;

export type GamePhase = typeof PHASE[keyof typeof PHASE];

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
