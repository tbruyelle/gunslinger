import Phaser from "phaser";

export class SetupScene extends Phaser.Scene {
  constructor() {
    super({ key: "SetupScene" });
  }

  create() {
    const { width, height } = this.scale;

    this.add.rectangle(0, 0, width, height, 0x1a1008).setOrigin(0);

    this.add
      .text(width / 2, height / 2 - 40, "Game Setup", {
        fontSize: "36px",
        color: "#d4a044",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 20, "(coming soon)", {
        fontSize: "18px",
        color: "#888",
      })
      .setOrigin(0.5);

    // Back to splash
    const back = this.add
      .text(width / 2, height / 2 + 80, "← Back", {
        fontSize: "18px",
        color: "#d4a044",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    back.on("pointerover", () => back.setColor("#ffffff"));
    back.on("pointerout",  () => back.setColor("#d4a044"));
    back.on("pointerup",   () => this.scene.start("LobbyScene"));
  }
}
