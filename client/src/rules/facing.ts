/**
 * Hex facing and relative directions. Absolute directions are indexed 0–5
 * clockwise from North on the flat-top grid: N, NE, SE, S, SW, NW.
 */

export const HEX_DIRECTIONS = ["N", "NE", "SE", "S", "SW", "NW"] as const;
export type HexDirection = (typeof HEX_DIRECTIONS)[number];

/**
 * A direction relative to the character's facing. Left and right are the
 * character's own sides while it keeps facing forward: facing N, back_right
 * is SE. Offsets from the facing: ahead=0, ahead_right=1, back_right=2,
 * back=3, back_left=4, ahead_left=5.
 */
export type RelativeDirection = "ahead" | "ahead_right" | "back_right" | "back" | "back_left" | "ahead_left";

/** The three forward relative directions (move_ahead / turn_ahead cards). */
export const AHEAD_DIRS: RelativeDirection[] = ["ahead_left", "ahead", "ahead_right"];
/** The three backward relative directions (move_back / turn_back cards). */
export const BACK_DIRS: RelativeDirection[] = ["back_left", "back", "back_right"];

const REL_OFFSET: Record<RelativeDirection, number> = {
  ahead: 0,
  ahead_right: 1,
  back_right: 2,
  back: 3,
  back_left: 4,
  ahead_left: 5,
};

/** The absolute direction of a relative one for a facing. */
export function relativeToAbsoluteDir(facing: number, rel: RelativeDirection): number {
  return (facing + REL_OFFSET[rel]) % 6;
}

/**
 * The direction the black arrow of each character token points at in the
 * unrotated PNG: every token points either NE (1) or NW (5).
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

/** Facing (0–5) of a token drawn at a rotation angle in degrees (multiples of 60). */
export function angleToDirIndex(angle: number, charKey?: string): number {
  const baseDir = charKey ? (CHAR_ARROW_DIR[charKey] ?? 1) : 1;
  const rotSteps = ((Math.round(angle / 60) % 6) + 6) % 6;
  return (baseDir + rotSteps) % 6;
}

/** Rotation angle in degrees that makes a token face a direction; inverse of angleToDirIndex. */
export function dirIndexToAngle(dirIndex: number, charKey?: string): number {
  const baseDir = charKey ? (CHAR_ARROW_DIR[charKey] ?? 1) : 1;
  const rotSteps = (((dirIndex - baseDir) % 6) + 6) % 6;
  return rotSteps * 60;
}
