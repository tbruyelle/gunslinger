import Phaser from "phaser";
import { Room } from "colyseus.js";
import type { GameState, Action } from "@gunslinger/shared";

/** Hex grid layout constants (flat-top). */
const HEX_SIZE = 40; // px, center to vertex
const HEX_W = HEX_SIZE * 2;
const HEX_H = Math.sqrt(3) * HEX_SIZE;

/** Convert axial hex coords to pixel center (flat-top layout). */
function hexToPixel(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * (3 / 2) * q,
    y: HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  };
}

export class GameScene extends Phaser.Scene {
  private room!: Room<GameState>;
  private hexGraphics!: Phaser.GameObjects.Graphics;
  private playerSprites: Map<string, Phaser.GameObjects.Arc> = new Map();

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { room: Room<GameState> }) {
    this.room = data.room;
  }

  create() {
    this.hexGraphics = this.add.graphics();
    this.drawGrid(20, 15);

    this.room.onStateChange((state) => this.onStateChange(state));

    this.room.onMessage("error", (msg: string) => {
      console.warn("Server error:", msg);
    });
  }

  // ── Grid ────────────────────────────────────────────────────────────────────

  private drawGrid(cols: number, rows: number) {
    const offsetX = 100;
    const offsetY = 60;

    this.hexGraphics.lineStyle(1, 0x6b4f2a, 0.8);

    for (let q = 0; q < cols; q++) {
      for (let r = 0; r < rows; r++) {
        const { x, y } = hexToPixel(q, r);
        this.drawHex(offsetX + x, offsetY + y);
      }
    }
  }

  private drawHex(cx: number, cy: number) {
    this.hexGraphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = cx + HEX_SIZE * Math.cos(angle);
      const py = cy + HEX_SIZE * Math.sin(angle);
      i === 0 ? this.hexGraphics.moveTo(px, py) : this.hexGraphics.lineTo(px, py);
    }
    this.hexGraphics.closePath();
    this.hexGraphics.strokePath();
  }

  // ── State sync ──────────────────────────────────────────────────────────────

  private onStateChange(state: GameState) {
    const offsetX = 100;
    const offsetY = 60;

    for (const [id, player] of Object.entries(state.players)) {
      const { x, y } = hexToPixel(player.position.q, player.position.r);
      const px = offsetX + x;
      const py = offsetY + y;

      if (!this.playerSprites.has(id)) {
        const circle = this.add.circle(px, py, 16, 0xd4a044);
        this.playerSprites.set(id, circle);
      } else {
        const sprite = this.playerSprites.get(id)!;
        sprite.setPosition(px, py);
      }
    }

    // Remove sprites for disconnected players
    for (const [id, sprite] of this.playerSprites) {
      if (!state.players[id]) {
        sprite.destroy();
        this.playerSprites.delete(id);
      }
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  /** Send a declared action to the server. */
  sendAction(action: Action) {
    this.room.send("action", action);
  }
}
