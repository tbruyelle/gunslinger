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

const THUMB_CELL_W  = 92;
const THUMB_IMG_W   = 80;
const THUMB_IMG_H   = 104;
const THUMB_LABEL_H = 16;
const STRIP_PAD_L   = 10;

const ROT_DURATION  = 250;
const HANDLE_OFFSET = 20; // px outside board edge for "+" buttons

// ── Types ──────────────────────────────────────────────────────────────────────

interface PlacedBoard {
  id:       number;
  key:      string;
  rotation: number; // 0 | 90 | 180 | 270
  lx:       number; // top-left x in layout-space (source pixels)
  ly:       number; // top-left y in layout-space
}

type SlotDir = "right" | "left" | "bottom" | "top";

interface Slot {
  lx:     number;
  ly:     number;
  fromId: number; // id of the board this slot attaches to
  dir:    SlotDir;
}

interface PlacedEntry {
  id:        number;
  img:       Phaser.GameObjects.Image;
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

// ── Scene ──────────────────────────────────────────────────────────────────────

export class SetupScene extends Phaser.Scene {
  // State
  private placed:          PlacedBoard[] = [];
  private nextId           = 0;
  private pendingKey:      string | null = null;
  private pendingRotation  = 0;
  private rotating         = new Set<number>(); // board ids animating

  // Dynamic display objects (rebuilt in refreshDisplay)
  private placedEntries:   PlacedEntry[] = [];
  private dynObjects:      Phaser.GameObjects.GameObject[] = []; // handles, hints, previews

  // Strip
  private thumbs:          ThumbItem[] = [];
  private stripOffset      = 0;

  // Persistent UI
  private placeholder!:    Phaser.GameObjects.Text;
  private nextBtn!:        Phaser.GameObjects.Text;

  constructor() { super({ key: "SetupScene" }); }

  // ── Preload ────────────────────────────────────────────────────────────────

  preload() {
    const barW = 680, bx = CW / 2 - barW / 2, by = CH / 2;
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
    this.placed          = [];
    this.nextId          = 0;
    this.pendingKey      = null;
    this.pendingRotation = 0;
    this.rotating.clear();
    this.placedEntries   = [];
    this.dynObjects      = [];
    this.stripOffset     = 0;

    this.add.rectangle(0, 0,           CW, CH,    0x1a1008).setOrigin(0);
    this.add.rectangle(0, ARR_Y,       CW, ARR_H, 0x120b04).setOrigin(0);
    this.add.rectangle(0, STRIP_Y - 2, CW, 2,     0x3a2510).setOrigin(0);

    this.placeholder = this.add
      .text(CW / 2, ARR_Y + ARR_H / 2, "Select a board below to start building the map", {
        fontSize: "16px", color: "#444",
      })
      .setOrigin(0.5);

    this.buildStrip();
    this.buildTopBar();
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
      if (this.placed.length > 0) {
        this.scene.start("MatchmakingScene", { boards: this.placed });
      }
    });
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────

  /** Effective displayed dimensions after rotation (w↔h swapped at 90°/270°). */
  private effSize(key: string, rot: number): { effW: number; effH: number } {
    const d = BOARD_DIMS[key];
    return rot % 180 === 0 ? { effW: d.w, effH: d.h } : { effW: d.h, effH: d.w };
  }

  /** Would a rect at (lx,ly) size (w,h) overlap any placed board (except excludeId)? */
  private overlaps(lx: number, ly: number, w: number, h: number, excludeId?: number): boolean {
    for (const b of this.placed) {
      if (b.id === excludeId) continue;
      const { effW, effH } = this.effSize(b.key, b.rotation);
      if (lx < b.lx + effW && lx + w > b.lx && ly < b.ly + effH && ly + h > b.ly) return true;
    }
    return false;
  }

  /**
   * Display transform: maps layout-space coordinates to screen pixels.
   * Returns uniform scale + origin so that all placed boards fit the arrangement area.
   */
  private displayTransform(): { scale: number; ox: number; oy: number } {
    if (this.placed.length === 0) return { scale: 1, ox: CW / 2, oy: ARR_Y + ARR_H / 2 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of this.placed) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      if (b.lx < minX) minX = b.lx;
      if (b.ly < minY) minY = b.ly;
      if (b.lx + effW > maxX) maxX = b.lx + effW;
      if (b.ly + effH > maxY) maxY = b.ly + effH;
    }

    const lw    = maxX - minX;
    const lh    = maxY - minY;
    const scale = Math.min((ARR_H - 30) / lh, (CW - 30) / lw);
    const ox    = (CW - lw * scale) / 2 - minX * scale;
    const oy    = ARR_Y + (ARR_H - lh * scale) / 2 - minY * scale;
    return { scale, ox, oy };
  }

  /** Convert layout-space rect to screen center. */
  private layoutToScreen(
    lx: number, ly: number, effW: number, effH: number,
    scale: number, ox: number, oy: number,
  ) {
    return {
      cx: ox + (lx + effW / 2) * scale,
      cy: oy + (ly + effH / 2) * scale,
      dw: effW * scale,
      dh: effH * scale,
    };
  }

  // ── Valid attachment slots ─────────────────────────────────────────────────

  private computeSlots(): Slot[] {
    if (!this.pendingKey) return [];
    const { effW: pW, effH: pH } = this.effSize(this.pendingKey, this.pendingRotation);

    const slots: Slot[] = [];
    for (const b of this.placed) {
      const { effW: bW, effH: bH } = this.effSize(b.key, b.rotation);

      // Right: pending left edge (pH) must match board right edge (bH)
      if (pH === bH && !this.overlaps(b.lx + bW, b.ly, pW, pH))
        slots.push({ lx: b.lx + bW, ly: b.ly, fromId: b.id, dir: "right" });

      // Left
      if (pH === bH && !this.overlaps(b.lx - pW, b.ly, pW, pH))
        slots.push({ lx: b.lx - pW, ly: b.ly, fromId: b.id, dir: "left" });

      // Bottom: pending top edge (pW) must match board bottom edge (bW)
      if (pW === bW && !this.overlaps(b.lx, b.ly + bH, pW, pH))
        slots.push({ lx: b.lx, ly: b.ly + bH, fromId: b.id, dir: "bottom" });

      // Top
      if (pW === bW && !this.overlaps(b.lx, b.ly - pH, pW, pH))
        slots.push({ lx: b.lx, ly: b.ly - pH, fromId: b.id, dir: "top" });
    }

    // Deduplicate slots at the same position (multiple boards can generate the same slot)
    const seen = new Set<string>();
    return slots.filter(s => {
      const k = `${s.lx},${s.ly}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ── Display ────────────────────────────────────────────────────────────────

  private refreshDisplay() {
    // Tear down dynamic objects
    this.rotating.clear();
    this.placedEntries.forEach(e => {
      this.tweens.killTweensOf(e.img);
      e.img.destroy(); e.closeBg.destroy(); e.closeTxt.destroy(); e.closeZone.destroy();
    });
    this.placedEntries = [];
    this.dynObjects.forEach(o => o.destroy());
    this.dynObjects = [];

    const n          = this.placed.length;
    const hasPending = !!this.pendingKey;

    this.placeholder.setVisible(n === 0 && !hasPending);
    this.nextBtn.setColor(n > 0 ? "#d4a044" : "#555");

    // ── First-board placement preview ──────────────────────────────────────
    if (n === 0 && hasPending) {
      this.drawFirstBoardPreview();
      return;
    }
    if (n === 0) return;

    // ── Draw placed boards ────────────────────────────────────────────────
    const { scale, ox, oy } = this.displayTransform();

    for (const b of this.placed) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      const { cx, cy, dw, dh } = this.layoutToScreen(b.lx, b.ly, effW, effH, scale, ox, oy);

      const img = this.add.image(cx, cy, b.key).setScale(scale).setAngle(b.rotation);

      const xr  = cx + dw / 2 - 9;
      const yt  = cy - dh / 2 + 9;
      const closeBg  = this.add.circle(xr, yt, 8, 0x550000, 0.9);
      const closeTxt = this.add.text(xr, yt, "×", {
        fontSize: "12px", color: "#fff", fontStyle: "bold",
      }).setOrigin(0.5);
      const closeZone = this.add.zone(xr, yt, 20, 20).setInteractive({ useHandCursor: true });

      const boardId = b.id;
      closeZone.on("pointerup", () => {
        this.placed = this.placed.filter(p => p.id !== boardId);
        this.refreshDisplay();
        this.refreshStripBorders();
      });

      this.placedEntries.push({ id: b.id, img, closeBg, closeTxt, closeZone });
    }

    // ── Handles for pending board ─────────────────────────────────────────
    if (hasPending) {
      this.drawHandles(scale, ox, oy);
    }
  }

  // ── First board: show a clickable preview centered ─────────────────────

  private drawFirstBoardPreview() {
    const key = this.pendingKey!;
    const { effW, effH } = this.effSize(key, this.pendingRotation);
    const previewScale = Math.min((ARR_H - 60) / effH, (CW - 60) / effW);
    const cx = CW / 2;
    const cy = ARR_Y + ARR_H / 2;

    const img = this.add.image(cx, cy, key)
      .setScale(previewScale)
      .setAngle(this.pendingRotation)
      .setAlpha(0.6);

    const label = this.add.text(cx, cy + effH * previewScale / 2 + 14,
      "Click to place  ·  scroll to rotate", {
        fontSize: "14px", color: "#d4a044",
      }).setOrigin(0.5);

    const zone = this.add
      .zone(cx, cy, effW * previewScale, effH * previewScale)
      .setInteractive({ useHandCursor: true });
    zone.on("pointerup", () => {
      this.placed.push({
        id: this.nextId++, key, rotation: this.pendingRotation, lx: 0, ly: 0,
      });
      this.pendingKey = null;
      this.pendingRotation = 0;
      this.refreshDisplay();
      this.refreshStripBorders();
    });

    this.dynObjects.push(img, label, zone);
  }

  // ── Attachment handles ("+") ───────────────────────────────────────────

  private drawHandles(scale: number, ox: number, oy: number) {
    const slots = this.computeSlots();

    if (slots.length === 0) {
      const hint = this.add.text(CW / 2, STRIP_Y - 18,
        "No valid position — try rotating the pending board (scroll in empty area)", {
          fontSize: "12px", color: "#666",
        }).setOrigin(0.5, 1);
      this.dynObjects.push(hint);
      return;
    }

    // Pending info
    const name = this.pendingKey!.replace("board_", "");
    const info = this.add.text(CW / 2, STRIP_Y - 18,
      `Placing: Board ${name}  ·  ${this.pendingRotation}°  ·  scroll in empty area to rotate`, {
        fontSize: "11px", color: "#777",
      }).setOrigin(0.5, 1);
    this.dynObjects.push(info);

    const { effW: pW, effH: pH } = this.effSize(this.pendingKey!, this.pendingRotation);

    for (const slot of slots) {
      const fromB = this.placed.find(b => b.id === slot.fromId)!;
      const { effW: bW, effH: bH } = this.effSize(fromB.key, fromB.rotation);

      // Preview outline where the board would go
      const { cx: px, cy: py, dw: pw, dh: ph } = this.layoutToScreen(
        slot.lx, slot.ly, pW, pH, scale, ox, oy,
      );
      const g = this.add.graphics();
      g.fillStyle(0xd4a044, 0.08);
      g.fillRect(px - pw / 2, py - ph / 2, pw, ph);
      g.lineStyle(1, 0xd4a044, 0.35);
      g.strokeRect(px - pw / 2, py - ph / 2, pw, ph);
      this.dynObjects.push(g);

      // "+" handle at the midpoint of the attachment edge, just outside the board
      const bScreen = this.layoutToScreen(fromB.lx, fromB.ly, bW, bH, scale, ox, oy);
      let hx: number, hy: number;
      switch (slot.dir) {
        case "right":  hx = bScreen.cx + bScreen.dw / 2 + HANDLE_OFFSET; hy = bScreen.cy; break;
        case "left":   hx = bScreen.cx - bScreen.dw / 2 - HANDLE_OFFSET; hy = bScreen.cy; break;
        case "bottom": hx = bScreen.cx; hy = bScreen.cy + bScreen.dh / 2 + HANDLE_OFFSET; break;
        case "top":    hx = bScreen.cx; hy = bScreen.cy - bScreen.dh / 2 - HANDLE_OFFSET; break;
      }

      const hBg = this.add.circle(hx, hy, 13, 0xd4a044, 0.9);
      const hTx = this.add.text(hx, hy, "+", {
        fontSize: "18px", color: "#000", fontStyle: "bold",
      }).setOrigin(0.5);
      const hZone = this.add.zone(hx, hy, 30, 30).setInteractive({ useHandCursor: true });

      hZone.on("pointerover", () => {
        hBg.setScale(1.25);
        g.clear();
        g.fillStyle(0xd4a044, 0.18);
        g.fillRect(px - pw / 2, py - ph / 2, pw, ph);
        g.lineStyle(2, 0xd4a044, 0.7);
        g.strokeRect(px - pw / 2, py - ph / 2, pw, ph);
      });
      hZone.on("pointerout", () => {
        hBg.setScale(1);
        g.clear();
        g.fillStyle(0xd4a044, 0.08);
        g.fillRect(px - pw / 2, py - ph / 2, pw, ph);
        g.lineStyle(1, 0xd4a044, 0.35);
        g.strokeRect(px - pw / 2, py - ph / 2, pw, ph);
      });
      hZone.on("pointerup", () => this.placeBoard(slot));

      this.dynObjects.push(hBg, hTx, hZone);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private placeBoard(slot: Slot) {
    if (!this.pendingKey) return;
    this.placed.push({
      id: this.nextId++,
      key: this.pendingKey,
      rotation: this.pendingRotation,
      lx: slot.lx,
      ly: slot.ly,
    });
    this.pendingKey = null;
    this.pendingRotation = 0;
    this.refreshDisplay();
    this.refreshStripBorders();
  }

  /**
   * Animate a 180° rotation of a placed board.
   * Once connected, rotating 90° would swap portrait↔landscape and break the
   * edge-length match with neighbours.  Only 180° preserves all connections.
   */
  private rotatePlacedBoard(boardId: number, delta: number) {
    if (this.rotating.has(boardId)) return;
    const board = this.placed.find(b => b.id === boardId);
    if (!board) return;

    this.rotating.add(boardId);
    board.rotation = ((board.rotation + delta) % 360 + 360) % 360;

    const entry = this.placedEntries.find(e => e.id === boardId);
    if (!entry) { this.rotating.delete(boardId); return; }

    // Tween angle in place; rebuild display after animation settles
    this.tweens.add({
      targets: entry.img,
      angle: entry.img.angle + delta,
      duration: ROT_DURATION,
      ease: "Power2.Out",
      onComplete: () => {
        this.rotating.delete(boardId);
        this.refreshDisplay();
      },
    });

    // Hide handles + overlays during rotation (positions are stale)
    this.dynObjects.forEach(o => o.destroy());
    this.dynObjects = [];
  }

  /** Return board id at screen (px, py), or -1. */
  private placedBoardAt(px: number, py: number): number {
    if (this.placed.length === 0) return -1;
    const { scale, ox, oy } = this.displayTransform();
    for (const b of this.placed) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      const sx = ox + b.lx * scale;
      const sy = oy + b.ly * scale;
      if (px >= sx && px < sx + effW * scale && py >= sy && py < sy + effH * scale) return b.id;
    }
    return -1;
  }

  // ── Strip ──────────────────────────────────────────────────────────────────

  private buildStrip() {
    this.add.rectangle(0, STRIP_Y, CW, STRIP_H, 0x0d0704).setOrigin(0);
    const thumbCY = STRIP_Y + (STRIP_H - THUMB_LABEL_H) / 2;

    this.thumbs = BOARDS.map(key => {
      const d     = BOARD_DIMS[key];
      const scale = Math.min(THUMB_IMG_W / d.w, THUMB_IMG_H / d.h);

      const border = this.add
        .rectangle(0, thumbCY, THUMB_IMG_W + 4, THUMB_IMG_H + 4, 0x000000, 0)
        .setStrokeStyle(2, 0xd4a044, 0);
      const img   = this.add.image(0, thumbCY, key).setScale(scale);
      const label = this.add
        .text(0, thumbCY + THUMB_IMG_H / 2 + 5, key.replace("board_", ""), {
          fontSize: "11px", color: "#777",
        }).setOrigin(0.5, 0);
      const zone = this.add
        .zone(0, thumbCY, THUMB_IMG_W, THUMB_IMG_H)
        .setInteractive({ useHandCursor: true });

      zone.on("pointerover", () => { if (this.pendingKey !== key) img.setTint(0xcccccc); });
      zone.on("pointerout",  () => img.clearTint());
      zone.on("pointerup",   () => this.selectPending(key));

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
      t.img.setX(wx); t.border.setX(wx); t.label.setX(wx); t.zone.setX(wx);
    });
  }

  private refreshStripBorders() {
    this.thumbs.forEach(t => {
      const isPending = this.pendingKey === t.key;
      const isPlaced  = this.placed.some(b => b.key === t.key);
      if (isPending)     t.border.setStrokeStyle(2, 0xffffff, 1);
      else if (isPlaced) t.border.setStrokeStyle(2, 0xd4a044, 1);
      else               t.border.setStrokeStyle(2, 0xd4a044, 0);
    });
  }

  private selectPending(key: string) {
    if (this.pendingKey === key) {
      this.pendingKey = null; // cancel
    } else {
      this.pendingKey = key;
      this.pendingRotation = 0;
    }
    this.refreshDisplay();
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
          return;
        }
        if (pointer.y < ARR_Y) return;

        const delta = dy > 0 ? 90 : -90;

        // Over a placed board → rotate 180° (preserves edge connections)
        const boardId = this.placedBoardAt(pointer.x, pointer.y);
        if (boardId >= 0) {
          const placedDelta = delta > 0 ? 180 : -180;
          this.rotatePlacedBoard(boardId, placedDelta);
          return;
        }

        // Over empty area with pending → rotate 90° (free to choose orientation before placing)
        if (this.pendingKey) {
          this.pendingRotation = ((this.pendingRotation + delta) % 360 + 360) % 360;
          this.refreshDisplay();
        }
      },
    );
  }
}
