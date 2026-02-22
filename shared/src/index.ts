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
  sessionId: string;
  character: Character;
  position: HexCoord;
  facing: Facing;
  actionPoints: number;
  maxActionPoints: number;
  wounds: Wound[];
  weapons: Weapon[];
  activeWeaponIndex: number;
  status: PlayerStatus;
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
 * Simplified turn sequence (rules p.4):
 *   declare → resolve_movement → resolve_fire → end
 */
export type GamePhase = "lobby" | "declare" | "resolve_movement" | "resolve_fire" | "end";

// ── Game state (authoritative, lives on server) ───────────────────────────────

export interface GameState {
  phase: GamePhase;
  turn: number;
  players: Record<string, Player>;
  /** Declared actions for current turn, keyed by playerId. */
  declaredActions: Record<string, Action[]>;
}
