/**
 * Chances of hitting with a shot, from the players' aid "Probabilities of
 * hitting (%)" (percent_hit.png): for each aim time (1 to 9) and range (0 to
 * 12), the share of the 108 result cards whose FIRE chart gives a hit, and
 * the share giving a bullseye. Malfunction cards (8 of 108, a dud shot) are
 * counted as misses. Target Status (13.6) is not taken into account: a
 * moving or running target turns some hits into misses, a down one too.
 */
export const MAX_AIM_TIME = 9;
export const MAX_RANGE = 12;

// Rows by aim time 1..9, columns by range 0..12.
const HIT: number[][] = [
  [32, 20, 13, 7, 4, 2, 1, 1, 1, 1, 1, 1, 1],
  [57, 30, 26, 14, 9, 6, 1, 1, 1, 1, 1, 1, 1],
  [70, 38, 37, 29, 19, 10, 3, 1, 1, 1, 1, 1, 1],
  [80, 63, 50, 32, 25, 14, 6, 3, 1, 1, 1, 1, 1],
  [87, 76, 59, 42, 32, 19, 10, 5, 3, 1, 1, 1, 1],
  [89, 76, 69, 54, 42, 25, 15, 7, 5, 3, 1, 1, 1],
  [89, 89, 81, 67, 44, 33, 22, 13, 6, 5, 3, 1, 1],
  [93, 93, 91, 78, 59, 51, 33, 20, 12, 8, 5, 3, 1],
  [93, 93, 91, 86, 67, 62, 45, 31, 19, 14, 8, 6, 3],
];

const BULLSEYE: number[][] = [
  [7, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [17, 7, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [26, 13, 6, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0],
  [35, 20, 9, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0],
  [49, 32, 18, 7, 6, 5, 0, 0, 0, 0, 0, 0, 0],
  [57, 42, 25, 15, 7, 6, 2, 0, 0, 0, 0, 0, 0],
  [71, 56, 40, 24, 11, 8, 4, 2, 0, 0, 0, 0, 0],
  [83, 74, 54, 34, 18, 18, 7, 6, 4, 2, 2, 0, 0],
  [93, 90, 78, 55, 29, 29, 16, 12, 7, 6, 4, 2, 0],
];

export interface HitChance {
  /** Percent chance of any hit (bullseye included). */
  hit: number;
  /** Percent chance of a bullseye. */
  bullseye: number;
}

/**
 * The chance of hitting at an aim time and a range. An aim time above 9
 * reads the 9 row (the charts' last row is "9+"), one below 1 never hits;
 * a range beyond 12 reads the 12 column.
 */
export function hitChance(aimTime: number, range: number): HitChance {
  if (aimTime < 1 || range < 0) return { hit: 0, bullseye: 0 };
  const row = Math.min(aimTime, MAX_AIM_TIME) - 1;
  const col = Math.min(range, MAX_RANGE);
  return { hit: HIT[row][col], bullseye: BULLSEYE[row][col] };
}
