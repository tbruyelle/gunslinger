import Phaser from "phaser";

const SHOW_DELAY_MS = 250;

/**
 * Shows a small text box under the target while the pointer hovers it.
 * target must be interactive; the tooltip is destroyed with the scene.
 */
export function attachTooltip(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject & { x: number; y: number }, text: string, offsetY = 24): void {
  let box: Phaser.GameObjects.Text | null = null;
  let timer: Phaser.Time.TimerEvent | null = null;
  const hide = () => {
    timer?.remove();
    timer = null;
    box?.destroy();
    box = null;
  };
  target.on("pointerover", () => {
    hide();
    timer = scene.time.delayedCall(SHOW_DELAY_MS, () => {
      const w = scene.scale.width;
      box = scene.add
        .text(target.x, target.y + offsetY, text, {
          fontSize: "12px",
          color: "#f3e7ce",
          backgroundColor: "#0d0704",
          padding: { x: 10, y: 6 },
          wordWrap: { width: Math.min(300, w - 32) },
          align: "center",
        })
        .setOrigin(0.5, 0)
        .setDepth(500);
      // Keep it inside the window.
      const half = box.width / 2;
      box.setX(Phaser.Math.Clamp(target.x, half + 8, w - half - 8));
    });
  });
  target.on("pointerout", hide);
  target.on("pointerdown", hide);
  target.once("destroy", hide);
}
