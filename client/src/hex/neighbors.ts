/**
 * Hex neighbor finding using pixel positions from hex_grid.json.
 *
 * Convention: 6 directions indexed 0–5 clockwise from North:
 *   0=N (up), 1=NE, 2=SE, 3=S (down), 4=SW, 5=NW
 *
 * Token angle=0 → facing North (direction index 0).
 * facingIndex = tokenAngle / 60.
 */

import type { PlacedBoardSetup, RelativeDirection } from "@gunslinger/shared";
import { angleToDirIndex, relativeToAbsoluteDir } from "@gunslinger/shared";

// ── Types ───────────────────────────────────────────────────────────────────

interface HexPoint { id: string; x: number; y: number }
interface HexGridData { boards: Record<string, { hexes: HexPoint[] }> }

interface Dims { w: number; h: number }

const BOARD_DIMS: Record<string, Dims> = {
  board_A: { w: 1600, h: 2232 }, board_AA: { w: 1600, h: 2232 },
  board_B: { w: 1600, h: 2232 }, board_BB: { w: 1600, h: 2232 },
  board_C: { w: 1600, h: 2232 }, board_CC: { w: 1600, h: 2232 },
  board_D: { w: 1600, h: 2232 }, board_DD: { w: 1600, h: 2232 },
  board_E: { w: 1600, h: 2232 }, board_EE: { w: 1600, h: 2232 },
  board_F: { w: 1600, h: 2232 }, board_FF: { w: 1600, h: 2232 },
  board_G: { w: 1600, h: 2232 }, board_GG: { w: 1600, h: 2232 },
  board_H: { w: 1600, h: 2232 }, board_HH: { w: 1600, h: 2232 },
  board_UFC: { w: 1176, h: 1490 },
  board_UFCC: { w: 852, h: 1102 },
  board_UFDD: { w: 1280, h: 1286 },
};

/** A hex in unified layout-space coordinates. */
export interface LayoutHex {
  id: string;
  lx: number;
  ly: number;
}

/** The 6 neighbors of a hex, indexed by direction (0=N, 1=NE, ..., 5=NW). */
export type NeighborRing = (LayoutHex | null)[];

// ── Board-local ↔ layout coordinate transforms ─────────────────────────────

function boardLocalToLayout(b: PlacedBoardSetup, hx: number, hy: number): { lx: number; ly: number } {
  const d = BOARD_DIMS[b.key];
  if (!d) return { lx: hx, ly: hy };
  const w = d.w, h = d.h;
  switch (b.rotation) {
    case 90:  return { lx: b.lx + hy,      ly: b.ly + w - hx };
    case 180: return { lx: b.lx + w - hx,  ly: b.ly + h - hy };
    case 270: return { lx: b.lx + h - hy,  ly: b.ly + hx };
    default:  return { lx: b.lx + hx,      ly: b.ly + hy };
  }
}

// ── HexNeighborMap ──────────────────────────────────────────────────────────

/**
 * Precomputed neighbor lookup for all hexes in the current board layout.
 * Build once per game when the boards are known.
 */
export class HexNeighborMap {
  /** All hexes in layout space, keyed by hex ID. */
  private hexes = new Map<string, LayoutHex>();
  /** Cached neighbor rings, keyed by hex ID. */
  private neighbors = new Map<string, NeighborRing>();

  /**
   * Build from hex grid JSON data + board layout.
   * Transforms all hex positions into unified layout space.
   */
  constructor(hexGridData: HexGridData, boards: PlacedBoardSetup[]) {
    for (const board of boards) {
      const entry = hexGridData.boards[board.key];
      if (!entry) continue;
      for (const hex of entry.hexes) {
        const { lx, ly } = boardLocalToLayout(board, hex.x, hex.y);
        this.hexes.set(hex.id, { id: hex.id, lx, ly });
      }
    }
  }

  /** Get a hex by ID. */
  getHex(hexId: string): LayoutHex | undefined {
    return this.hexes.get(hexId);
  }

  /**
   * Get the 6 neighbors of a hex, indexed 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW.
   * Returns null for directions with no neighbor (board edge).
   */
  getNeighbors(hexId: string): NeighborRing {
    const cached = this.neighbors.get(hexId);
    if (cached) return cached;

    const hex = this.hexes.get(hexId);
    if (!hex) return [null, null, null, null, null, null];

    // Find the 6 nearest hexes by distance
    const candidates: { hex: LayoutHex; dist: number; angle: number }[] = [];
    for (const [id, other] of this.hexes) {
      if (id === hexId) continue;
      const dx = other.lx - hex.lx;
      const dy = other.ly - hex.ly;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Only consider hexes within ~1.3x the expected neighbor distance (~200px)
      if (dist > 300) continue;
      // Screen-space angle: atan2(dy, dx), where positive dy = down
      const angle = Math.atan2(dy, dx);
      candidates.push({ hex: other, dist, angle });
    }

    // Sort by distance
    candidates.sort((a, b) => a.dist - b.dist);

    // The 6 direction reference angles in radians (screen coords, CW from East):
    // N=up=-π/2, NE≈-0.54, SE≈0.54, S=down=π/2, SW≈2.60, NW≈-2.60
    const dirAngles = [
      -Math.PI / 2,        // 0: N (up)
      -Math.PI / 6,        // 1: NE (≈-30°)
       Math.PI / 6,        // 2: SE (≈30°)
       Math.PI / 2,        // 3: S (down)
       Math.PI * 5 / 6,    // 4: SW (≈150°)
      -Math.PI * 5 / 6,    // 5: NW (≈-150°)
    ];

    const ring: NeighborRing = [null, null, null, null, null, null];
    const assigned = new Set<string>();

    // Assign nearest candidates to their closest direction
    for (const c of candidates) {
      if (assigned.size >= 6) break;

      let bestDir = -1;
      let bestDelta = Infinity;
      for (let d = 0; d < 6; d++) {
        if (ring[d] !== null) continue;
        let delta = Math.abs(angleDiff(c.angle, dirAngles[d]));
        if (delta < bestDelta) {
          bestDelta = delta;
          bestDir = d;
        }
      }

      // Only assign if the angle is within 30° of the direction (π/6)
      if (bestDir >= 0 && bestDelta < Math.PI / 5) {
        ring[bestDir] = c.hex;
        assigned.add(c.hex.id);
      }
    }

    this.neighbors.set(hexId, ring);
    return ring;
  }

  /**
   * Get a specific relative-direction neighbor given a hex and facing angle.
   * @param hexId - The hex to find neighbors of
   * @param tokenAngle - The character's rotation angle (0,60,...,300)
   * @param relDir - Relative direction (ahead, ahead_right, etc.)
   * @param charKey - Character key (for arrow offset lookup)
   */
  getRelativeNeighbor(
    hexId: string,
    tokenAngle: number,
    relDir: RelativeDirection,
    charKey?: string,
  ): LayoutHex | null {
    const facingIndex = angleToDirIndex(tokenAngle, charKey);
    const absDir = relativeToAbsoluteDir(facingIndex, relDir);
    const ring = this.getNeighbors(hexId);
    return ring[absDir];
  }

  /**
   * Get multiple relative-direction neighbors at once.
   * Returns array of { relDir, hex } pairs (hex may be null for edges).
   */
  getRelativeNeighbors(
    hexId: string,
    tokenAngle: number,
    relDirs: RelativeDirection[],
    charKey?: string,
  ): { relDir: RelativeDirection; hex: LayoutHex | null }[] {
    return relDirs.map(relDir => ({
      relDir,
      hex: this.getRelativeNeighbor(hexId, tokenAngle, relDir, charKey),
    }));
  }
}

/** Signed angle difference, result in [-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
