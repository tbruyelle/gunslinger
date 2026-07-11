import type { PlacedBoardSetup, RelativeDirection } from "@gunslinger/shared";
import { angleToDirIndex, relativeToAbsoluteDir } from "@gunslinger/shared";

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

export interface LayoutHex {
  id: string;
  lx: number;
  ly: number;
}

export type NeighborRing = (LayoutHex | null)[];

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

export class ServerHexNeighborMap {
  private hexes = new Map<string, LayoutHex>();
  private neighbors = new Map<string, NeighborRing>();

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

  getHex(hexId: string): LayoutHex | undefined {
    return this.hexes.get(hexId);
  }

  getNeighbors(hexId: string): NeighborRing {
    const cached = this.neighbors.get(hexId);
    if (cached) return cached;

    const hex = this.hexes.get(hexId);
    if (!hex) return [null, null, null, null, null, null];

    const candidates: { hex: LayoutHex; dist: number; angle: number }[] = [];
    for (const [id, other] of this.hexes) {
      if (id === hexId) continue;
      const dx = other.lx - hex.lx;
      const dy = other.ly - hex.ly;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 300) continue;
      const angle = Math.atan2(dy, dx);
      candidates.push({ hex: other, dist, angle });
    }

    candidates.sort((a, b) => a.dist - b.dist);

    const dirAngles = [
      -Math.PI / 2,
      -Math.PI / 6,
       Math.PI / 6,
       Math.PI / 2,
       Math.PI * 5 / 6,
      -Math.PI * 5 / 6,
    ];

    const ring: NeighborRing = [null, null, null, null, null, null];
    const assigned = new Set<string>();

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

      if (bestDir >= 0 && bestDelta < Math.PI / 5) {
        ring[bestDir] = c.hex;
        assigned.add(c.hex.id);
      }
    }

    this.neighbors.set(hexId, ring);
    return ring;
  }

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

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

import * as fs from "fs";
import * as path from "path";

let cachedHexGrid: HexGridData | null = null;

export function loadHexGridData(): HexGridData {
  if (cachedHexGrid) return cachedHexGrid;
  const hexGridPath = path.join(__dirname, "..", "..", "..", "assets", "hex_grid.json");
  const raw = fs.readFileSync(hexGridPath, "utf-8");
  cachedHexGrid = JSON.parse(raw) as HexGridData;
  return cachedHexGrid;
}
