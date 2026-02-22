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

const CW = 1280;
const CH = 800;
const TOPBAR_H = 50;
const STRIP_H  = 158;
const ARR_Y    = TOPBAR_H;
const ARR_H    = CH - TOPBAR_H - STRIP_H; // 592
const STRIP_Y  = ARR_Y + ARR_H;           // 642
const BOARD_GAP = 6;

// Strip thumbnail cell: fixed size, image scaled to fit inside
const THUMB_CELL_W = 92;
const THUMB_CELL_H = 116;
const THUMB_IMG_W  = 80;
const THUMB_IMG_H  = 104;
const THUMB_LABEL_H = 16;
const STRIP_PAD_L  = 10;

// ── Types ──────────────────────────────────────────────────────────────────────

interface SelectedBoard { key: string; flipped: boolean }

interface ThumbItem {
  img:    Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  label:  Phaser.GameObjects.Text;
  zone:   Phaser.GameObjects.Zone;
  key:    string;
}

// ── Scene ──────────────────────────────────────────────────────────────────────

export class SetupScene extends Phaser.Scene {
  private selected:    SelectedBoard[] = [];
  private stripOffset  = 0;
  private thumbs:      ThumbItem[] = [];
  private arrObjects:  Phaser.GameObjects.GameObject[] = [];
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
    this.arrObjects  = [];

    this.add.rectangle(0, 0, CW, CH,      0x1a1008).setOrigin(0);
    this.add.rectangle(0, ARR_Y, CW, ARR_H, 0x120b04).setOrigin(0);
    this.add.rectangle(0, STRIP_Y - 2, CW, 2, 0x3a2510).setOrigin(0);

    this.placeholder = this.add
      .text(CW / 2, ARR_Y + ARR_H / 2, "Click a board below to add it to the map", {
        fontSize: "16px", color: "#444",
      })
      .setOrigin(0.5);

    this.buildStrip();
    this.buildTopBar(); // built last → renders on top of boards

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

  // ── Arrangement area ───────────────────────────────────────────────────────

  private refreshArrangement() {
    this.arrObjects.forEach(o => (o as Phaser.GameObjects.GameObject).destroy());
    this.arrObjects = [];

    const n = this.selected.length;
    this.placeholder.setVisible(n === 0);
    this.nextBtn.setColor(n > 0 ? "#d4a044" : "#555");
    if (n === 0) return;

    const rects  = this.arrBoardRects();
    const cy     = ARR_Y + ARR_H / 2;

    this.selected.forEach(({ key, flipped }, i) => {
      const { x: bx, bw, bh } = rects[i];
      const cx  = bx + bw / 2;
      const top = cy - bh / 2;

      const img = this.add.image(cx, cy, key).setDisplaySize(bw, bh).setFlipX(flipped);

      // "scroll to flip" hint — bottom-center of the board
      const hint = this.add
        .text(cx, top + bh - 5, "↔  scroll to flip", {
          fontSize: "9px", color: "#666",
          stroke: "#000", strokeThickness: 2,
        })
        .setOrigin(0.5, 1);

      // × remove button — top-right corner
      const xr  = bx + bw - 9;
      const yt  = top + 9;
      const xBg = this.add.circle(xr, yt, 8, 0x550000, 0.9);
      const xTx = this.add
        .text(xr, yt, "×", { fontSize: "12px", color: "#fff", fontStyle: "bold" })
        .setOrigin(0.5);
      const xZone = this.add
        .zone(xr, yt, 20, 20)
        .setInteractive({ useHandCursor: true });
      xZone.on("pointerup", () => {
        this.selected.splice(i, 1);
        this.refreshArrangement();
        this.refreshStripBorders();
      });

      this.arrObjects.push(img, hint, xBg, xTx, xZone);
    });
  }

  /**
   * Compute display rects for all selected boards, laid out side-by-side and
   * scaled to fill the arrangement area height (clamped by available width).
   */
  private arrBoardRects(): Array<{ x: number; bw: number; bh: number }> {
    const n       = this.selected.length;
    const maxH    = ARR_H - 20;
    const aspectSum = this.selected.reduce((s, { key }) => {
      const d = BOARD_DIMS[key];
      return s + d.w / d.h;
    }, 0);

    const totalWAtMaxH = aspectSum * maxH + (n - 1) * BOARD_GAP;
    const dispH = totalWAtMaxH <= CW
      ? maxH
      : (CW - (n - 1) * BOARD_GAP) / aspectSum;

    const sizes   = this.selected.map(({ key }) => {
      const d = BOARD_DIMS[key];
      return { bw: Math.round(d.w / d.h * dispH), bh: Math.round(dispH) };
    });
    const totalW  = sizes.reduce((s, sz) => s + sz.bw, 0) + (n - 1) * BOARD_GAP;
    const startX  = (CW - totalW) / 2;
    const cy      = ARR_Y + ARR_H / 2;

    let curX = startX;
    return sizes.map(({ bw, bh }) => {
      const rect = { x: curX, bw, bh };
      curX += bw + BOARD_GAP;
      void cy;
      return rect;
    });
  }

  /** Return index of the arrangement board under (px, py), or -1. */
  private arrBoardAt(px: number, py: number): number {
    if (this.selected.length === 0) return -1;
    const rects = this.arrBoardRects();
    const cy    = ARR_Y + ARR_H / 2;
    return rects.findIndex(({ x, bw, bh }) =>
      px >= x && px < x + bw &&
      py >= cy - bh / 2 && py < cy + bh / 2
    );
  }

  // ── Strip ──────────────────────────────────────────────────────────────────

  private buildStrip() {
    this.add.rectangle(0, STRIP_Y, CW, STRIP_H, 0x0d0704).setOrigin(0);

    const thumbCY = STRIP_Y + (STRIP_H - THUMB_LABEL_H) / 2;

    this.thumbs = BOARDS.map((key) => {
      const d      = BOARD_DIMS[key];
      const aspect = d.w / d.h;
      // Fit image inside THUMB_IMG_W × THUMB_IMG_H cell (letterbox)
      const scale  = Math.min(THUMB_IMG_W / d.w, THUMB_IMG_H / d.h);

      const border = this.add
        .rectangle(0, thumbCY, THUMB_IMG_W + 4, THUMB_IMG_H + 4, 0x000000, 0)
        .setStrokeStyle(2, 0xd4a044, 0);

      const img = this.add.image(0, thumbCY, key).setScale(scale);

      const name  = key.replace("board_", "");
      const label = this.add
        .text(0, thumbCY + THUMB_IMG_H / 2 + 5, name, { fontSize: "11px", color: "#777" })
        .setOrigin(0.5, 0);

      const zone = this.add
        .zone(0, thumbCY, THUMB_IMG_W, THUMB_IMG_H)
        .setInteractive({ useHandCursor: true });

      zone.on("pointerover", () => { if (!this.isSelected(key)) img.setTint(0xcccccc); });
      zone.on("pointerout",  () => img.clearTint());
      zone.on("pointerup",   () => this.toggleBoard(key));

      void aspect; // used only for doc purposes
      return { img, border, label, zone, key };
    });

    this.refreshStripPositions();
  }

  private refreshStripPositions() {
    const totalW    = BOARDS.length * THUMB_CELL_W + STRIP_PAD_L;
    const maxOffset = Math.max(0, totalW - CW);
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

  // ── State helpers ──────────────────────────────────────────────────────────

  private isSelected(key: string): boolean {
    return this.selected.some(b => b.key === key);
  }

  private toggleBoard(key: string) {
    const idx = this.selected.findIndex(b => b.key === key);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else {
      this.selected.push({ key, flipped: false });
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
          // Scroll the selection strip left/right
          this.stripOffset += dy * 0.5;
          this.refreshStripPositions();
        } else if (pointer.y >= ARR_Y) {
          // Flip the board under the cursor
          const idx = this.arrBoardAt(pointer.x, pointer.y);
          if (idx >= 0) {
            this.selected[idx].flipped = !this.selected[idx].flipped;
            this.refreshArrangement();
          }
        }
      },
    );
  }
}
