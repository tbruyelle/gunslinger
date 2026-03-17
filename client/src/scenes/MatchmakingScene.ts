import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import type { GameState, PlacedBoardSetup, PlacedTokenSetup } from "@gunslinger/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

interface SceneData {
  boards?: PlacedBoardSetup[];
  tokens?: PlacedTokenSetup[];
}

export class MatchmakingScene extends Phaser.Scene {
  private client!: Client;
  private room?: Room<GameState>;
  private boards: PlacedBoardSetup[] = [];
  private tokens: PlacedTokenSetup[] = [];

  constructor() {
    super({ key: "MatchmakingScene" });
  }

  init(data: SceneData) {
    this.boards = (data.boards ?? []).map(b => ({
      key: b.key, rotation: b.rotation, lx: b.lx, ly: b.ly,
    }));
    this.tokens = (data.tokens ?? []).map(t => ({
      charKey: t.charKey, lx: t.lx, ly: t.ly, angle: t.angle, hexId: t.hexId,
    }));
  }

  create() {
    this.client = new Client(SERVER_URL);

    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 60, "GUNSLINGER", {
        fontSize: "48px",
        color: "#d4a044",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const tokenInfo = this.tokens.length > 0
      ? `${this.tokens.length} characters placed`
      : "No setup data";

    this.add
      .text(width / 2, height / 2 - 10, tokenInfo, {
        fontSize: "16px",
        color: "#888",
      })
      .setOrigin(0.5);

    const joinBtn = this.add
      .text(width / 2, height / 2 + 40, "Join Game", {
        fontSize: "28px",
        color: "#ffffff",
        backgroundColor: "#4a2800",
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    joinBtn.on("pointerup", () => this.joinGame());
  }

  private async joinGame() {
    try {
      this.room = await this.client.joinOrCreate<GameState>("game", {
        boards: this.boards,
        tokens: this.tokens,
      });
      this.scene.start("GameScene", {
        room: this.room,
        boards: this.boards,
        tokens: this.tokens,
      });
    } catch (err) {
      console.error("Failed to join room:", err);
    }
  }
}
