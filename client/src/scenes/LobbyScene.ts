import Phaser from "phaser";

const BTN_WIDTH = 220;
const BTN_HEIGHT = 52;
const BTN_RADIUS = 6;

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: "LobbyScene" });
  }

  create() {
    const { width, height } = this.scale;

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(0, 0, width, height, 0x1a1008).setOrigin(0);

    // ── Splash image — scale to fill 75 % of canvas height ───────────────────
    const img = this.add.image(width / 2, height * 0.44, "splash");
    const scale = (height * 0.75) / img.height;
    img.setScale(scale);

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnY = img.y + (img.height * scale) / 2 + 44;

    this.makeButton(width / 2 - BTN_WIDTH / 2 - 20, btnY, "New Game", () => {
      this.scene.start("SetupScene");
    });

    this.makeButton(width / 2 + BTN_WIDTH / 2 + 20, btnY, "Join Game", () => {
      this.scene.start("MatchmakingScene");
    });
  }

  private makeButton(cx: number, cy: number, label: string, onClick: () => void) {
    const bg = this.add.graphics();
    const draw = (fill: number) => {
      bg.clear();
      bg.fillStyle(fill, 1);
      bg.fillRoundedRect(-BTN_WIDTH / 2, -BTN_HEIGHT / 2, BTN_WIDTH, BTN_HEIGHT, BTN_RADIUS);
      bg.lineStyle(2, 0xd4a044, 1);
      bg.strokeRoundedRect(-BTN_WIDTH / 2, -BTN_HEIGHT / 2, BTN_WIDTH, BTN_HEIGHT, BTN_RADIUS);
    };

    draw(0x3a1f00);
    bg.setPosition(cx, cy);

    const text = this.add
      .text(cx, cy, label, {
        fontSize: "22px",
        color: "#d4a044",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Hit area
    const zone = this.add
      .zone(cx, cy, BTN_WIDTH, BTN_HEIGHT)
      .setInteractive({ useHandCursor: true });

    zone.on("pointerover", () => { draw(0x5a3200); bg.setPosition(cx, cy); });
    zone.on("pointerout",  () => { draw(0x3a1f00); bg.setPosition(cx, cy); });
    zone.on("pointerup",   onClick);

    return { bg, text, zone };
  }
}
