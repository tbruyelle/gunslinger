import type { BoardMap } from "../board/boardA";
import { hitChance, type HitChance } from "../rules/hitChance";
import { gunInFiringBox } from "./plan";
import type { CharView } from "./replay";

/** Aim time printed on the shooting actions for a one-handed gun (13.52). */
export const COCK_AIM_SHOOT_AIM_TIME = 2;
export const SHOOT_AIM_TIME = 1;

export interface ShotOdds extends HitChance {
  aimTime: number;
  range: number;
  /** AIM points the shot would use. */
  aimPoints: number;
}

/**
 * The chance of hitting target from where me stands, as the realm computes
 * the shot: the card's aim time + AIM points − the arm wounds of the hands
 * holding the gun, at the range between the hexes. AIM points count only
 * when the target is within one hex of the markers (12.5); markersHex is
 * where they stand (the aimed hex, or the hex of the character they follow).
 */
export function shotOdds(me: CharView, cardAimTime: number, target: string, markersHex: string, board: BoardMap): ShotOdds {
  const aimPoints = me.aim > 0 && markersHex !== "" && board.distance(markersHex, target) <= 1 ? me.aim : 0;
  const gun = gunInFiringBox(me.guns);
  let wounds = 0;
  if (gun?.location === "gun_hand" || gun?.location === "both_hands") wounds += me.gunArm;
  if (gun?.location === "other_hand" || gun?.location === "both_hands") wounds += me.otherArm;
  const aimTime = cardAimTime + aimPoints - wounds;
  const range = board.distance(me.hex, target);
  return { ...hitChance(aimTime, range), aimTime, range, aimPoints };
}
