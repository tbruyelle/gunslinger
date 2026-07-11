import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { PHASE } from "@gunslinger/shared";

// ── Nested schemas ──────────────────────────────────────────────────────────

export class WoundSchema extends Schema {
  @type("string") location: string = "chest";
  @type("number") severity: number = 1;
}

export class CharacterStatsSchema extends Schema {
  @type("number") speed: number = 3;
  @type("number") gunSpeed: number = 5;
  @type("number") accuracy: number = 0;
  @type("number") strength: number = 5;
}

export class CharacterSchema extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type(CharacterStatsSchema) baseStats = new CharacterStatsSchema();
}

export class WeaponSchema extends Schema {
  @type("string") type: string = "revolver";
  @type("number") loaded: number = 6;
  @type("number") capacity: number = 6;
}

export class PlayerSchema extends Schema {
  @type("string") charKey: string = "";
  @type("string") ownerSessionId: string = "";
  @type(CharacterSchema) character = new CharacterSchema();
  @type("number") lx: number = 0;
  @type("number") ly: number = 0;
  @type("number") angle: number = 0;
  @type("string") hexId: string = "";
  @type("number") actionPoints: number = 10;
  @type("number") maxActionPoints: number = 10;
  @type([WoundSchema]) wounds = new ArraySchema<WoundSchema>();
  @type([WeaponSchema]) weapons = new ArraySchema<WeaponSchema>();
  @type("number") activeWeaponIndex: number = 0;
  @type("string") status: string = "alive";
}

// ── Card choice (move direction, new facing, or target) ─────────────────────

export class CardChoiceSchema extends Schema {
  @type("string") moveDir: string = "";
  @type("string") newFacing: string = "";
  @type("string") targetCharKey: string = "";
}

// ── Action card selection (card number + side + choice) ─────────────────────

export class ActionCardSelectionSchema extends Schema {
  @type("number") card: number = 1;
  @type("string") side: string = "front";
  @type(CardChoiceSchema) choice: CardChoiceSchema | null = null;
}

// ── Per-player card selections ──────────────────────────────────────────────

export class PlayerCardsSchema extends Schema {
  @type([ActionCardSelectionSchema]) cards = new ArraySchema<ActionCardSelectionSchema>();
}

// ── Board setup ─────────────────────────────────────────────────────────────

export class PlacedBoardSchema extends Schema {
  @type("string") key: string = "";
  @type("number") rotation: number = 0;
  @type("number") lx: number = 0;
  @type("number") ly: number = 0;
}

// ── Root game state ─────────────────────────────────────────────────────────

export class GameStateSchema extends Schema {
  @type("string") phase: string = PHASE.ACTION_SELECTION;
  @type("number") turn: number = 1;
  @type("number") currentSequence: number = 1;
  @type("number") maxTurns: number = 20;
  @type("string") winCondition: string = "last_standing";
  @type(["string"]) playerOrder = new ArraySchema<string>();
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: PlayerCardsSchema }) selectedCards = new MapSchema<PlayerCardsSchema>();
  @type([PlacedBoardSchema]) boards = new ArraySchema<PlacedBoardSchema>();
}
