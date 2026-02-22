import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    this.load.image("splash", "splash_screen.png");
  }

  create() {
    this.scene.start("LobbyScene");
  }
}
