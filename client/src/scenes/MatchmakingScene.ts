import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import type { GameState } from "@gunslinger/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export class MatchmakingScene extends Phaser.Scene {
  private client!: Client;
  private room?: Room<GameState>;

  constructor() {
    super({ key: "MatchmakingScene" });
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
      this.room = await this.client.joinOrCreate<GameState>("game");
      this.scene.start("GameScene", { room: this.room });
    } catch (err) {
      console.error("Failed to join room:", err);
    }
  }
}
