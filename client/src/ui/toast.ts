import Phaser from "phaser";

/** A short message at the bottom of the screen that fades away. */
export function showToast(scene: Phaser.Scene, text: string, kind: "info" | "error" = "info", ms = 4000): void {
  const { width, height } = scene.scale;
  const t = scene.add
    .text(width / 2, height - 90, text, {
      fontSize: "16px",
      color: "#ffffff",
      backgroundColor: kind === "error" ? "#7a1f1f" : "#2d4a1f",
      padding: { x: 14, y: 8 },
      wordWrap: { width: Math.max(200, width - 40) },
      align: "center",
    })
    .setOrigin(0.5)
    .setDepth(1000)
    .setScrollFactor(0);
  scene.tweens.add({ targets: t, alpha: 0, delay: Math.max(0, ms - 500), duration: 500, onComplete: () => t.destroy() });
}
