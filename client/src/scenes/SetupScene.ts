import Phaser from "phaser";

// ── Board registry ─────────────────────────────────────────────────────────────

interface Dims { w: number; h: number }

const BOARD_DIMS: Record<string, Dims> = {
  board_A:    { w: 1600, h: 2232 }, board_AA:   { w: 1600, h: 2232 },
  board_B:    { w: 1600, h: 2232 }, board_BB:   { w: 1600, h: 2232 },
  board_C:    { w: 1600, h: 2232 }, board_CC:   { w: 1600, h: 2232 },
  board_D:    { w: 1600, h: 2232 }, board_DD:   { w: 1600, h: 2232 },
  board_E:    { w: 1600, h: 2232 }, board_EE:   { w: 1600, h: 2232 },
  board_F:    { w: 1600, h: 2232 }, board_FF:   { w: 1600, h: 2232 },
  board_G:    { w: 1600, h: 2232 }, board_GG:   { w: 1600, h: 2232 },
  board_H:    { w: 1600, h: 2232 }, board_HH:   { w: 1600, h: 2232 },
  board_UFC:  { w: 1176, h: 1490 },
  board_UFCC: { w:  852, h: 1102 },
  board_UFDD: { w: 1280, h: 1286 },
};

const BOARDS = Object.keys(BOARD_DIMS);

// ── Layout constants ───────────────────────────────────────────────────────────

const CW         = 1280;
const CH         = 800;
const TOPBAR_H   = 50;
const STRIP_H    = 158;
const ARR_Y      = TOPBAR_H;
const ARR_H      = CH - TOPBAR_H - STRIP_H; // 592
const STRIP_Y    = ARR_Y + ARR_H;           // 642
const BOARD_GAP  = 6;

const THUMB_CELL_W  = 92;
const THUMB_IMG_W   = 80;
const THUMB_IMG_H   = 104;
const THUMB_LABEL_H = 16;
const STRIP_PAD_L   = 10;

const ROT_DURATION = 250; // ms

// ── Types ──────────────────────────────────────────────────────────────────────

interface SelectedBoard {
  key:      string;
  rotation: number; // target: 0 | 90 | 180 | 270
}

/** Persistent display objects for one board in the arrangement area. */
interface ArrEntry {
  img:       Phaser.GameObjects.Image;
  hint:      Phaser.GameObjects.Text;
  closeBg:   Phaser.GameObjects.Arc;
  closeTxt:  Phaser.GameObjects.Text;
  closeZone: Phaser.GameObjects.Zone;
}

interface ThumbItem {
  img:    Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  label:  Phaser.GameObjects.Text;
  zone:   Phaser.GameObjects.Zone;
  key:    string;
}

/** Per-board layout (in the arrangement area). */
interface BoardSlot {
  cx:    number; // center x
  cy:    number; // center y (constant: vertical center of arrangement area)
  scale: number; // uniform scale applied to the image
  effW:  number; // effective displayed width  (after rotation)
  effH:  number; // effective displayed height (after rotation)
}

// ── Scene ──────────────────────────────────────────────────────────────────────

export class SetupScene extends Phaser.Scene {
  private selected:    SelectedBoard[] = [];
  private stripOffset  = 0;
  private thumbs:      ThumbItem[]  = [];
  private arrEntries:  ArrEntry[]   = [];
  private rotating     = new Set<number>(); // indices currently mid-animation
  private placeholder!: Phaser.GameObjects.Text;
  private nextBtn!:     Phaser.GameObjects.Text;

  constructor() { super({ key: "SetupScene" }); }

  // ── Preload ────────────────────────────────────────────────────────────────

  preload() {
    const barW = 680;
    const bx   = CW / 2 - barW / 2;
    const by   = CH / 2;

    const bg   = this.add.rectangle(CW / 2, by, barW + 4, 20, 0x2a1500);
    const fill = this.add.rectangle(bx, by, 2, 18, 0xd4a044).setOrigin(0, 0.5);
    const lbl  = this.add.text(CW / 2, by - 30, "Loading boards…", {
      fontSize: "17px", color: "#d4a044",
    }).setOrigin(0.5);

    this.load.on("progress", (v: number) => { fill.width = Math.max(2, barW * v); });
    this.load.on("complete", () => { bg.destroy(); fill.destroy(); lbl.destroy(); });

    BOARDS.forEach(k => {
      if (!this.textures.exists(k)) this.load.image(k, `${k}.png`);
    });
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  create() {
    this.selected    = [];
    this.stripOffset = 0;
    this.arrEntries  = [];
    this.rotating.clear();

    this.add.rectangle(0, 0,        CW, CH,     0x1a1008).setOrigin(0);
    this.add.rectangle(0, ARR_Y,    CW, ARR_H,  0x120b04).setOrigin(0);
    this.add.rectangle(0, STRIP_Y - 2, CW, 2,   0x3a2510).setOrigin(0);

    this.placeholder = this.add
      .text(CW / 2, ARR_Y + ARR_H / 2, "Click a board below to add it to the map", {
        fontSize: "16px", color: "#444",
      })
      .setOrigin(0.5);

    this.buildStrip();
    this.buildTopBar(); // built last → on top

    this.setupInput();
  }

  // ── Top bar ────────────────────────────────────────────────────────────────

  private buildTopBar() {
    this.add.rectangle(0, 0, CW, TOPBAR_H, 0x0f0804).setOrigin(0);
    this.add.text(CW / 2, TOPBAR_H / 2, "Setup — Board Selection", {
      fontSize: "20px", color: "#d4a044", fontStyle: "bold",
    }).setOrigin(0.5);

    const back = this.add
      .text(20, TOPBAR_H / 2, "← Back", { fontSize: "17px", color: "#d4a044" })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    back.on("pointerover", () => back.setColor("#fff"));
    back.on("pointerout",  () => back.setColor("#d4a044"));
    back.on("pointerup",   () => this.scene.start("LobbyScene"));

    this.nextBtn = this.add
      .text(CW - 20, TOPBAR_H / 2, "Next →", { fontSize: "17px", color: "#555" })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    this.nextBtn.on("pointerup", () => {
      if (this.selected.length > 0) {
        this.scene.start("MatchmakingScene", { boards: this.selected });
      }
    });
  }

  // ── Arrangement — full rebuild (add / remove) ──────────────────────────────

  private refreshArrangement() {
    this.rotating.clear();
    this.arrEntries.forEach(e => {
      this.tweens.killTweensOf(e.img);
      e.img.destroy(); e.hint.destroy();
      e.closeBg.destroy(); e.closeTxt.destroy(); e.closeZone.destroy();
    });
    this.arrEntries = [];

    const n = this.selected.length;
    this.placeholder.setVisible(n === 0);
    this.nextBtn.setColor(n > 0 ? "#d4a044" : "#555");
    if (n === 0) return;

    const slots = this.computeSlots();

    slots.forEach(({ cx, cy, scale, effW, effH }, i) => {
      const { key, rotation } = this.selected[i];
      const top = cy - effH * scale / 2;

      const img = this.add.image(cx, cy, key)
        .setScale(scale)
        .setAngle(rotation);

      const hint = this.add
        .text(cx, top + effH * scale - 5, "scroll to rotate", {
          fontSize: "9px", color: "#666", stroke: "#000", strokeThickness: 2,
        })
        .setOrigin(0.5, 1);

      const xr = cx + effW * scale / 2 - 9;
      const yt = top + 9;

      const closeBg  = this.add.circle(xr, yt, 8, 0x550000, 0.9);
      const closeTxt = this.add
        .text(xr, yt, "×", { fontSize: "12px", color: "#fff", fontStyle: "bold" })
        .setOrigin(0.5);
      const closeZone = this.add
        .zone(xr, yt, 20, 20)
        .setInteractive({ useHandCursor: true });

      closeZone.on("pointerup", () => {
        this.selected.splice(i, 1);
        this.refreshArrangement();
        this.refreshStripBorders();
      });

      this.arrEntries.push({ img, hint, closeBg, closeTxt, closeZone });
    });
  }

  // ── Arrangement — animated rotation ───────────────────────────────────────

  private rotateBoard(idx: number, delta: number) {
    if (this.rotating.has(idx)) return; // ignore while already rotating
    this.rotating.add(idx);

    this.selected[idx].rotation =
      ((this.selected[idx].rotation + delta) % 360 + 360) % 360;

    const slots = this.computeSlots();

    this.arrEntries.forEach((entry, i) => {
      const { cx, cy, scale, effW, effH } = slots[i];
      const top = cy - effH * scale / 2;
      const xr  = cx + effW * scale / 2 - 9;
      const yt  = top + 9;

      // Rotate the target board; reposition all boards simultaneously
      const targetAngle = i === idx
        ? entry.img.angle + delta   // additive → always a 90° arc, no short-path ambiguity
        : entry.img.angle;

      this.tweens.killTweensOf(entry.img);
      this.tweens.add({
        targets:  entry.img,
        angle:    targetAngle,
        x:        cx,
        scaleX:   scale,
        scaleY:   scale,
        duration: ROT_DURATION,
        ease:     "Power2.Out",
        onComplete: i === idx ? () => this.rotating.delete(idx) : undefined,
      });

      // Animate hint and close button to their new positions
      this.tweens.killTweensOf(entry.hint);
      this.tweens.add({
        targets: entry.hint,
        x: cx, y: top + effH * scale - 5,
        duration: ROT_DURATION, ease: "Power2.Out",
      });

      this.tweens.killTweensOf(entry.closeBg);
      this.tweens.killTweensOf(entry.closeTxt);
      this.tweens.add({
        targets:  [entry.closeBg, entry.closeTxt],
        x: xr, y: yt,
        duration: ROT_DURATION, ease: "Power2.Out",
      });

      // Snap zone immediately (invisible, no need to animate hit area)
      entry.closeZone.setPosition(xr, yt);
    });
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  /**
   * Effective displayed dimensions of a board at a given rotation.
   * At 90°/270° the board is in landscape, so w and h are swapped.
   */
  private effSize(key: string, rotation: number): { effW: number; effH: number } {
    const d = BOARD_DIMS[key];
    return rotation % 180 === 0
      ? { effW: d.w, effH: d.h }
      : { effW: d.h, effH: d.w };
  }

  /**
   * Compute a uniform scale that fits all selected boards side-by-side in the
   * arrangement area, then return each board's center + scale.
   */
  private computeSlots(): BoardSlot[] {
    const n = this.selected.length;
    if (n === 0) return [];

    const effSizes = this.selected.map(({ key, rotation }) => this.effSize(key, rotation));

    // Largest effective height drives the height constraint
    const maxEffH  = Math.max(...effSizes.map(e => e.effH));
    const scaleByH = (ARR_H - 20) / maxEffH;

    // Sum of effective widths drives the width constraint
    const totalEffW = effSizes.reduce((s, e) => s + e.effW, 0);
    const scaleByW  = (CW - (n - 1) * BOARD_GAP) / totalEffW;

    const scale  = Math.min(scaleByH, scaleByW);
    const totalW = totalEffW * scale + (n - 1) * BOARD_GAP;
    const cy     = ARR_Y + ARR_H / 2;

    let curX = (CW - totalW) / 2;
    return effSizes.map(({ effW, effH }) => {
      const cx = curX + effW * scale / 2;
      curX += effW * scale + BOARD_GAP;
      return { cx, cy, scale, effW, effH };
    });
  }

  /** Return the arrangement index of the board at (px, py), or -1. */
  private arrBoardAt(px: number, py: number): number {
    return this.arrEntries.findIndex((entry, i) => {
      const { key, rotation } = this.selected[i];
      const { effW, effH } = this.effSize(key, rotation);
      const s = entry.img.scaleX;
      return (
        Math.abs(px - entry.img.x) < (effW * s) / 2 &&
        Math.abs(py - entry.img.y) < (effH * s) / 2
      );
    });
  }

  // ── Strip ──────────────────────────────────────────────────────────────────

  private buildStrip() {
    this.add.rectangle(0, STRIP_Y, CW, STRIP_H, 0x0d0704).setOrigin(0);

    const thumbCY = STRIP_Y + (STRIP_H - THUMB_LABEL_H) / 2;

    this.thumbs = BOARDS.map(key => {
      const d      = BOARD_DIMS[key];
      const scale  = Math.min(THUMB_IMG_W / d.w, THUMB_IMG_H / d.h);

      const border = this.add
        .rectangle(0, thumbCY, THUMB_IMG_W + 4, THUMB_IMG_H + 4, 0x000000, 0)
        .setStrokeStyle(2, 0xd4a044, 0);

      const img = this.add.image(0, thumbCY, key).setScale(scale);

      const label = this.add
        .text(0, thumbCY + THUMB_IMG_H / 2 + 5, key.replace("board_", ""), {
          fontSize: "11px", color: "#777",
        })
        .setOrigin(0.5, 0);

      const zone = this.add
        .zone(0, thumbCY, THUMB_IMG_W, THUMB_IMG_H)
        .setInteractive({ useHandCursor: true });

      zone.on("pointerover", () => { if (!this.isSelected(key)) img.setTint(0xcccccc); });
      zone.on("pointerout",  () => img.clearTint());
      zone.on("pointerup",   () => this.toggleBoard(key));

      return { img, border, label, zone, key };
    });

    this.refreshStripPositions();
  }

  private refreshStripPositions() {
    const totalW     = BOARDS.length * THUMB_CELL_W + STRIP_PAD_L;
    const maxOffset  = Math.max(0, totalW - CW);
    this.stripOffset = Phaser.Math.Clamp(this.stripOffset, 0, maxOffset);

    this.thumbs.forEach((t, i) => {
      const wx = STRIP_PAD_L + i * THUMB_CELL_W + THUMB_CELL_W / 2 - this.stripOffset;
      t.img.setX(wx);
      t.border.setX(wx);
      t.label.setX(wx);
      t.zone.setX(wx);
    });
  }

  private refreshStripBorders() {
    this.thumbs.forEach(t => {
      t.border.setStrokeStyle(2, 0xd4a044, this.isSelected(t.key) ? 1 : 0);
    });
  }

  // ── State ──────────────────────────────────────────────────────────────────

  private isSelected(key: string): boolean {
    return this.selected.some(b => b.key === key);
  }

  private toggleBoard(key: string) {
    const idx = this.selected.findIndex(b => b.key === key);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else {
      this.selected.push({ key, rotation: 0 });
    }
    this.refreshArrangement();
    this.refreshStripBorders();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private setupInput() {
    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _: unknown, _dx: number, dy: number) => {
        if (pointer.y >= STRIP_Y) {
          this.stripOffset += dy * 0.5;
          this.refreshStripPositions();
        } else if (pointer.y >= ARR_Y) {
          const idx = this.arrBoardAt(pointer.x, pointer.y);
          if (idx >= 0) {
            const delta = dy > 0 ? 90 : -90;
            this.rotateBoard(idx, delta);
          }
        }
      },
    );
  }
}
