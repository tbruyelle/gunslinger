/**
 * The 12 physical action cards, each with a front and a back action (24
 * actions). A player cannot use both sides of the same card in one turn.
 * Mirrors gno.land/p/tbruyelle/gunslinger/cards/v0.
 */

/** Physical card numbers (1–12). */
export type CardNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Which side of a card is being played. */
export type CardSide = "front" | "back";

/**
 * What the player must decide when selecting a side.
 * - move_ahead / move_back: one of the three forward / backward hexes
 * - turn_ahead / turn_back: a new facing among the three forward / backward directions
 * - target_ranged / target_melee / target_defend: a character (combat, not implemented yet)
 * - gun: one of the character's holstered guns (Draw & Cock)
 * - none: nothing
 */
export type ChoiceType =
  | "move_ahead"
  | "move_back"
  | "turn_ahead"
  | "turn_back"
  | "target_ranged"
  | "target_melee"
  | "target_defend"
  | "gun"
  | "none";

/** Static data for one side of an action card. */
export interface ActionSideDef {
  name: string;
  /** Time points: the sequences this action takes (1–3). */
  cost: number;
  /** Category printed on the card. */
  category: "foot" | "hand" | "attack" | "defense" | "strength";
  choiceType: ChoiceType;
}

export interface ActionCardDef {
  card: CardNumber;
  front: ActionSideDef;
  back: ActionSideDef;
}

/** Time points available per turn before carried delay (rule 7.3). */
export const SEQUENCES_PER_TURN = 5;

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
  { card: 9,  front: { name: "Draw & Cock",     cost: 3, category: "hand",     choiceType: "gun" },
               back:  { name: "Head Out/Back",   cost: 2, category: "foot",     choiceType: "none" } },
  { card: 10, front: { name: "Jab",             cost: 2, category: "attack",   choiceType: "target_melee" },
               back:  { name: "Duck",            cost: 1, category: "defense",  choiceType: "target_defend" } },
  { card: 11, front: { name: "Swing",           cost: 3, category: "attack",   choiceType: "target_melee" },
               back:  { name: "Block",           cost: 2, category: "defense",  choiceType: "target_defend" } },
  { card: 12, front: { name: "Belt",            cost: 3, category: "attack",   choiceType: "target_melee" },
               back:  { name: "Guard",           cost: 2, category: "defense",  choiceType: "target_defend" } },
];

/** The definition of a card side. */
export function getActionDef(sel: { card: CardNumber; side: CardSide }): ActionSideDef {
  const card = ACTION_CARDS[sel.card - 1];
  return sel.side === "front" ? card.front : card.back;
}

/** Asset filename of a card side (served from assets/). */
export function getActionCardAsset(card: CardNumber, side: CardSide): string {
  return side === "front" ? `action_card_a${card}.png` : `action_card_a${card}_back.png`;
}
