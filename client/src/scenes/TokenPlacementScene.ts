import Phaser from "phaser";

// ── Board registry (duplicated from SetupScene — extract later) ──────────────

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

// ── Character registry ──────────────────────────────────────────────────────

const CHARACTERS = [
  "andy", "axe", "banker", "barkeep", "border_rider", "cattle_baron",
  "chief", "clerk", "driver", "dude", "eagle", "el_jefe", "fast_draw",
  "fast_eddie", "floozy", "foreman", "gambler", "guard", "gun_artist",
  "happy", "hawk", "ike", "innocente", "john_henry", "lady", "lightning",
  "ling_ho", "little_ernie", "lucky", "marshal", "mountain_man", "nco",
  "old_man", "owner", "prospector", "quiet_man", "reb", "running_boy",
  "slim", "smith", "sodbuster", "texas", "the_drifter", "the_kid",
  "u_s_scout", "veteran", "woman", "yankee",
];

// ── Fixed layout sizes ──────────────────────────────────────────────────────

const TOPBAR_H     = 50;
const STRIP_H      = 140;
const THUMB_CELL_W = 80;
const THUMB_IMG_SZ = 70;
const STRIP_PAD_L  = 10;
const TOKEN_SIZE   = 40;
const CLOSE_R      = 8;

// ── Types ───────────────────────────────────────────────────────────────────

interface PlacedBoard {
  id: number; key: string; rotation: number; lx: number; ly: number;
}
interface PlacedToken {
  id: number; charKey: string; lx: number; ly: number; angle: number;
}
interface TokenEntry {
  id: number;
  img: Phaser.GameObjects.Image;
  closeBg: Phaser.GameObjects.Arc;
  closeTxt: Phaser.GameObjects.Text;
  closeZone: Phaser.GameObjects.Zone;
}
interface ThumbItem {
  img: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  charKey: string;
}

// ── Scene ───────────────────────────────────────────────────────────────────

export class TokenPlacementScene extends Phaser.Scene {
  // State (preserved across resize)
  private boards:       PlacedBoard[] = [];
  private placed:       PlacedToken[] = [];
  private nextId        = 0;
  private pendingChar:  string | null = null;
  private pendingAngle  = 0;
  private rawAngle      = 0;   // unwrapped accumulator for smooth tweening
  private stripOffset   = 0;

  // Display objects
  private tokenEntries: TokenEntry[] = [];
  private thumbs:       ThumbItem[] = [];
  private placeholder!: Phaser.GameObjects.Text;
  private nextBtn!:     Phaser.GameObjects.Text;
  private cursorSprite: Phaser.GameObjects.Image | null = null;

  constructor() { super({ key: "TokenPlacementScene" }); }

  // ── Responsive helpers ──────────────────────────────────────────────────

  private get cw()     { return this.scale.width; }
  private get ch()     { return this.scale.height; }
  private get stripY() { return this.ch - STRIP_H; }
  private get arrH()   { return this.ch - TOPBAR_H - STRIP_H; }

  // ── Init (receive data from SetupScene) ─────────────────────────────────

  init(data: { boards?: PlacedBoard[]; tokens?: PlacedToken[]; nextTokenId?: number }) {
    this.boards      = data.boards ?? [];
    this.placed      = data.tokens ?? [];
    this.nextId      = data.nextTokenId ?? 0;
    this.pendingChar = null;
    this.stripOffset = 0;
  }

  // ── Preload ─────────────────────────────────────────────────────────────

  preload() {
    let count = 0;
    for (const ch of CHARACTERS) {
      const key = `char_${ch}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `${key}.png`);
        count++;
      }
    }
    if (count === 0) return;

    const w = this.scale.width, h = this.scale.height;
    const barW = Math.min(680, w - 40);
    const bx = w / 2 - barW / 2, by = h / 2;

    const bg   = this.add.rectangle(w / 2, by, barW + 4, 20, 0x2a1500);
    const fill = this.add.rectangle(bx, by, 2, 18, 0xd4a044).setOrigin(0, 0.5);
    const lbl  = this.add.text(w / 2, by - 30, "Loading characters…", {
      fontSize: "17px", color: "#d4a044",
    }).setOrigin(0.5);

    this.load.on("progress", (v: number) => { fill.width = Math.max(2, barW * v); });
    this.load.on("complete", () => { bg.destroy(); fill.destroy(); lbl.destroy(); });
  }

  // ── Create ──────────────────────────────────────────────────────────────

  create() {
    this.buildAll();
    this.setupInput();

    const onResize = () => this.buildAll();
    this.scale.on("resize", onResize);
    this.events.on("shutdown", () => {
      this.scale.off("resize", onResize);
      this.input.setDefaultCursor("default");
    });
  }

  private buildAll() {
    this.children.removeAll(true);
    this.tokenEntries = [];
    this.thumbs       = [];

    const w = this.cw, h = this.ch;

    // Backgrounds
    this.add.rectangle(0, 0,               w, h,         0x1a1008).setOrigin(0);
    this.add.rectangle(0, TOPBAR_H,        w, this.arrH, 0x120b04).setOrigin(0);
    this.add.rectangle(0, this.stripY - 2, w, 2,         0x3a2510).setOrigin(0);

    this.placeholder = this.add
      .text(w / 2, TOPBAR_H + this.arrH / 2,
        "Select a character below, then click on the board to place", {
          fontSize: "16px", color: "#444",
        })
      .setOrigin(0.5);

    this.cursorSprite = null;

    this.buildBoardDisplay();
    this.buildStrip();
    this.buildTopBar();
    this.refreshTokenDisplay();
    this.refreshStripBorders();
    this.updateCursorSprite();
  }

  // ── Board geometry (duplicated from SetupScene) ─────────────────────────

  private effSize(key: string, rot: number): { effW: number; effH: number } {
    const d = BOARD_DIMS[key];
    return rot % 180 === 0 ? { effW: d.w, effH: d.h } : { effW: d.h, effH: d.w };
  }

  private displayTransform(): { scale: number; ox: number; oy: number } {
    if (this.boards.length === 0)
      return { scale: 1, ox: this.cw / 2, oy: TOPBAR_H + this.arrH / 2 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of this.boards) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      if (b.lx < minX) minX = b.lx;
      if (b.ly < minY) minY = b.ly;
      if (b.lx + effW > maxX) maxX = b.lx + effW;
      if (b.ly + effH > maxY) maxY = b.ly + effH;
    }

    const lw    = maxX - minX;
    const lh    = maxY - minY;
    const scale = Math.min((this.arrH - 30) / lh, (this.cw - 30) / lw);
    const ox    = (this.cw - lw * scale) / 2 - minX * scale;
    const oy    = TOPBAR_H + (this.arrH - lh * scale) / 2 - minY * scale;
    return { scale, ox, oy };
  }

  // ── Board display (static, no interaction) ──────────────────────────────

  private buildBoardDisplay() {
    if (this.boards.length === 0) return;

    const { scale, ox, oy } = this.displayTransform();

    for (const b of this.boards) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      const cx = ox + (b.lx + effW / 2) * scale;
      const cy = oy + (b.ly + effH / 2) * scale;
      this.add.image(cx, cy, b.key).setScale(scale).setAngle(b.rotation);
    }
  }

  // ── Token display ─────────────────────────────────────────────────────

  private refreshTokenDisplay() {
    this.tokenEntries.forEach(e => {
      e.img.destroy(); e.closeBg.destroy(); e.closeTxt.destroy(); e.closeZone.destroy();
    });
    this.tokenEntries = [];

    const n = this.placed.length;
    this.placeholder.setVisible(n === 0 && this.boards.length > 0);
    this.nextBtn.setColor(n >= 2 ? "#d4a044" : "#555");

    if (n === 0) return;

    const { scale, ox, oy } = this.displayTransform();
    const tokenScale = scale * 1.7;

    for (const t of this.placed) {
      const sx = ox + t.lx * scale;
      const sy = oy + t.ly * scale;

      const img = this.add.image(sx, sy, `char_${t.charKey}`)
        .setScale(tokenScale)
        .setAngle(t.angle)
        .setOrigin(0.5);

      const hw = (95 * tokenScale) / 2;
      const xr = sx + hw - 3;
      const yt = sy - hw + 3;
      const closeBg  = this.add.circle(xr, yt, CLOSE_R, 0x550000, 0.9);
      const closeTxt = this.add.text(xr, yt, "×", {
        fontSize: "12px", color: "#fff", fontStyle: "bold",
      }).setOrigin(0.5);
      const closeZone = this.add.zone(xr, yt, 20, 20).setInteractive({ useHandCursor: true });

      const tokenId = t.id;
      closeZone.on("pointerup", () => {
        this.placed = this.placed.filter(p => p.id !== tokenId);
        this.refreshTokenDisplay();
        this.refreshStripBorders();
      });

      this.tokenEntries.push({ id: t.id, img, closeBg, closeTxt, closeZone });
    }
  }

  // ── Hit-test: is a screen point inside any board? ─────────────────────

  private screenToLayout(sx: number, sy: number): { lx: number; ly: number } | null {
    if (this.boards.length === 0) return null;
    const { scale, ox, oy } = this.displayTransform();
    const lx = (sx - ox) / scale;
    const ly = (sy - oy) / scale;

    for (const b of this.boards) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      if (lx >= b.lx && lx < b.lx + effW && ly >= b.ly && ly < b.ly + effH) {
        return { lx, ly };
      }
    }
    return null;
  }

  // ── Top bar ─────────────────────────────────────────────────────────────

  private buildTopBar() {
    this.add.rectangle(0, 0, this.cw, TOPBAR_H, 0x0f0804).setOrigin(0);
    this.add.text(this.cw / 2, TOPBAR_H / 2, "Setup — Token Placement", {
      fontSize: "20px", color: "#d4a044", fontStyle: "bold",
    }).setOrigin(0.5);

    const back = this.add
      .text(20, TOPBAR_H / 2, "← Back", { fontSize: "17px", color: "#d4a044" })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    back.on("pointerover", () => back.setColor("#fff"));
    back.on("pointerout",  () => back.setColor("#d4a044"));
    back.on("pointerup",   () => this.scene.start("SetupScene", { boards: this.boards }));

    this.nextBtn = this.add
      .text(this.cw - 20, TOPBAR_H / 2, "Next →", { fontSize: "17px", color: "#555" })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    this.nextBtn.on("pointerup", () => {
      if (this.placed.length >= 2)
        this.scene.start("MatchmakingScene", { boards: this.boards, tokens: this.placed });
    });
  }

  // ── Character strip ───────────────────────────────────────────────────

  private buildStrip() {
    this.add.rectangle(0, this.stripY, this.cw, STRIP_H, 0x0d0704).setOrigin(0);
    const thumbCY = this.stripY + (STRIP_H - 18) / 2;

    this.thumbs = CHARACTERS.map(ch => {
      const key = `char_${ch}`;
      const scale = THUMB_IMG_SZ / 95;

      const border = this.add
        .rectangle(0, thumbCY, THUMB_IMG_SZ + 4, THUMB_IMG_SZ + 4, 0x000000, 0)
        .setStrokeStyle(2, 0xd4a044, 0);
      const img   = this.add.image(0, thumbCY, key).setScale(scale);
      const label = this.add
        .text(0, thumbCY + THUMB_IMG_SZ / 2 + 4,
          ch.replace(/_/g, " "), {
            fontSize: "13px", color: "#c4935a",
          }).setOrigin(0.5, 0);
      const zone = this.add
        .zone(0, thumbCY, THUMB_IMG_SZ, THUMB_IMG_SZ)
        .setInteractive({ useHandCursor: true });

      zone.on("pointerover", () => { if (this.pendingChar !== ch) img.setTint(0xcccccc); });
      zone.on("pointerout",  () => img.clearTint());
      zone.on("pointerup",   () => this.selectPending(ch));

      return { img, border, label, zone, charKey: ch };
    });

    this.refreshStripPositions();
  }

  private refreshStripPositions() {
    const totalW     = CHARACTERS.length * THUMB_CELL_W + STRIP_PAD_L;
    const maxOffset  = Math.max(0, totalW - this.cw);
    this.stripOffset = Phaser.Math.Clamp(this.stripOffset, 0, maxOffset);

    this.thumbs.forEach((t, i) => {
      const wx = STRIP_PAD_L + i * THUMB_CELL_W + THUMB_CELL_W / 2 - this.stripOffset;
      t.img.setX(wx); t.border.setX(wx); t.label.setX(wx); t.zone.setX(wx);
    });
  }

  private refreshStripBorders() {
    this.thumbs.forEach(t => {
      const isPending = this.pendingChar === t.charKey;
      const isPlaced  = this.placed.some(p => p.charKey === t.charKey);
      if (isPending)     t.border.setStrokeStyle(2, 0xffffff, 1);
      else if (isPlaced) t.border.setStrokeStyle(2, 0xd4a044, 1);
      else               t.border.setStrokeStyle(2, 0xd4a044, 0);
    });
  }

  private selectPending(ch: string) {
    if (this.pendingChar === ch) {
      this.pendingChar = null;
    } else {
      this.pendingChar = ch;
      this.pendingAngle = 0;
      this.rawAngle = 0;
    }
    this.refreshStripBorders();
    this.updateCursorSprite();
  }

  private updateCursorSprite() {
    if (this.cursorSprite) {
      this.cursorSprite.destroy();
      this.cursorSprite = null;
    }

    if (!this.pendingChar) {
      this.input.setDefaultCursor("default");
      return;
    }

    this.input.setDefaultCursor("none");

    const { scale } = this.displayTransform();
    const tokenScale = scale * 1.7;

    this.cursorSprite = this.add
      .image(this.input.activePointer.x, this.input.activePointer.y,
        `char_${this.pendingChar}`)
      .setScale(tokenScale)
      .setAlpha(0.7)
      .setAngle(this.pendingAngle)
      .setDepth(1000)
      .setOrigin(0.5);
  }

  // ── Input ─────────────────────────────────────────────────────────────

  private setupInput() {
    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _: unknown, _dx: number, dy: number) => {
        if (pointer.y >= this.stripY) {
          this.stripOffset += dy * 0.5;
          this.refreshStripPositions();
          return;
        }
        if (this.cursorSprite && this.pendingChar && pointer.y > TOPBAR_H) {
          const delta = dy > 0 ? 60 : -60;
          this.rawAngle += delta;
          this.pendingAngle = ((this.rawAngle % 360) + 360) % 360;
          this.tweens.killTweensOf(this.cursorSprite);
          this.tweens.add({
            targets: this.cursorSprite,
            angle: this.rawAngle,
            duration: 150,
            ease: "Power2.Out",
          });
        }
      },
    );

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.cursorSprite) {
        this.cursorSprite.setPosition(pointer.x, pointer.y);
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!this.pendingChar) return;
      if (pointer.y < TOPBAR_H || pointer.y >= this.stripY) return;

      const hit = this.screenToLayout(pointer.x, pointer.y);
      if (!hit) return;

      this.placed.push({
        id: this.nextId++,
        charKey: this.pendingChar,
        lx: hit.lx,
        ly: hit.ly,
        angle: this.pendingAngle,
      });
      this.pendingChar  = null;
      this.pendingAngle = 0;
      this.rawAngle     = 0;
      this.updateCursorSprite();
      this.refreshTokenDisplay();
      this.refreshStripBorders();
    });
  }
}
