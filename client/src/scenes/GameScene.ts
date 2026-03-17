import Phaser from "phaser";
import { Room } from "colyseus.js";
import type {
  GameState,
  PlacedBoardSetup,
  PlacedTokenSetup,
  ActionCardSelection,
  CardNumber,
  CardSide,
} from "@gunslinger/shared";
import {
  ACTION_CARDS,
  getActionDef,
  getActionCardAsset,
  SEQUENCES_PER_TURN,
} from "@gunslinger/shared";

// ── Board registry (same as TokenPlacementScene) ────────────────────────────

interface Dims { w: number; h: number }

const BOARD_DIMS: Record<string, Dims> = {
  board_A: { w: 1600, h: 2232 }, board_AA: { w: 1600, h: 2232 },
  board_B: { w: 1600, h: 2232 }, board_BB: { w: 1600, h: 2232 },
  board_C: { w: 1600, h: 2232 }, board_CC: { w: 1600, h: 2232 },
  board_D: { w: 1600, h: 2232 }, board_DD: { w: 1600, h: 2232 },
  board_E: { w: 1600, h: 2232 }, board_EE: { w: 1600, h: 2232 },
  board_F: { w: 1600, h: 2232 }, board_FF: { w: 1600, h: 2232 },
  board_G: { w: 1600, h: 2232 }, board_GG: { w: 1600, h: 2232 },
  board_H: { w: 1600, h: 2232 }, board_HH: { w: 1600, h: 2232 },
  board_UFC: { w: 1176, h: 1490 },
  board_UFCC: { w: 852, h: 1102 },
  board_UFDD: { w: 1280, h: 1286 },
};

// ── Layout constants ────────────────────────────────────────────────────────

const HUD_H = 48;
const CHAR_TAB_H = 50;
const CARD_STRIP_H = 340;
const BOTTOM_H = CHAR_TAB_H + CARD_STRIP_H;
const CARD_W = 108;
const CARD_H = 147;
const CARD_GAP = 6;
const CARD_ROW_GAP = 6;
const TOKEN_SCALE_FACTOR = 1.7;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_FACTOR = 0.12;
const DRAG_THRESHOLD = 4;

export class GameScene extends Phaser.Scene {
  private room!: Room<GameState>;

  // Setup data
  private boards: PlacedBoardSetup[] = [];
  private tokens: PlacedTokenSetup[] = [];

  // Zoom & pan
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private panStartX = 0;
  private panStartY = 0;

  // Display objects
  private boardImages: Phaser.GameObjects.Image[] = [];
  private tokenSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private tokenHighlights: Map<string, Phaser.GameObjects.Arc> = new Map();
  private arrMask!: Phaser.Display.Masks.GeometryMask;
  private arrMaskGfx!: Phaser.GameObjects.Graphics;

  // HUD
  private turnText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private sequenceText!: Phaser.GameObjects.Text;

  // Character selection
  private selectedCharKey: string | null = null;
  private charTabItems: Map<string, {
    bg: Phaser.GameObjects.Rectangle;
    img: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    check: Phaser.GameObjects.Text;
    zone: Phaser.GameObjects.Zone;
  }> = new Map();

  // Per-character card selections
  private characterCards: Map<string, ActionCardSelection[]> = new Map();
  private confirmedChars: Set<string> = new Set();

  // Card strip UI — front row [0..11], back row [12..23]
  private cardContainer!: Phaser.GameObjects.Container;
  private cardImages: Phaser.GameObjects.Image[] = [];
  private cardHighlights: Phaser.GameObjects.Rectangle[] = [];
  private selectedDisplay!: Phaser.GameObjects.Text;
  private confirmBtn!: Phaser.GameObjects.Text;
  private sendAllBtn!: Phaser.GameObjects.Text;

  // Phase tracking
  private lastPhase: string = "";

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { room: Room<GameState>; boards?: PlacedBoardSetup[]; tokens?: PlacedTokenSetup[] }) {
    this.room = data.room;
    this.boards = data.boards ?? [];
    this.tokens = data.tokens ?? [];
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.selectedCharKey = null;
    this.characterCards.clear();
    this.confirmedChars.clear();
    this.lastPhase = "";
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  private get cw() { return this.scale.width; }
  private get ch() { return this.scale.height; }
  private get arrH() { return this.ch - HUD_H - BOTTOM_H; }
  private get charTabY() { return this.ch - BOTTOM_H; }
  private get cardStripY() { return this.ch - CARD_STRIP_H; }

  // ── Preload ───────────────────────────────────────────────────────────────

  preload() {
    // Action card textures
    for (let i = 1; i <= 12; i++) {
      const n = i as CardNumber;
      const fKey = `action_card_a${n}`;
      const bKey = `action_card_a${n}_back`;
      if (!this.textures.exists(fKey)) this.load.image(fKey, getActionCardAsset(n, "front"));
      if (!this.textures.exists(bKey)) this.load.image(bKey, getActionCardAsset(n, "back"));
    }
    // Character textures for placed tokens
    for (const t of this.tokens) {
      const key = `char_${t.charKey}`;
      if (!this.textures.exists(key)) this.load.image(key, `${key}.png`);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  create() {
    this.buildAll();
    this.setupInput();

    const onResize = () => this.buildAll();
    this.scale.on("resize", onResize);
    this.events.on("shutdown", () => this.scale.off("resize", onResize));

    this.room.onStateChange((state) => this.onStateChange(state));
    this.room.onMessage("error", (msg: string) => console.warn("Server error:", msg));

    // Send ready to start
    this.room.send("ready");
  }

  private buildAll() {
    this.children.removeAll(true);
    this.boardImages = [];
    this.tokenSprites.clear();
    this.tokenHighlights.clear();
    this.charTabItems.clear();
    this.cardImages = [];
    this.cardHighlights = [];

    const w = this.cw, h = this.ch;

    // Backgrounds
    this.add.rectangle(0, 0, w, h, 0x1a1008).setOrigin(0);
    this.add.rectangle(0, HUD_H, w, this.arrH, 0x120b04).setOrigin(0);

    // Clip mask for board area
    if (this.arrMaskGfx) this.arrMaskGfx.destroy();
    this.arrMaskGfx = this.make.graphics();
    this.arrMaskGfx.fillRect(0, HUD_H, w, this.arrH);
    this.arrMask = this.arrMaskGfx.createGeometryMask();

    this.buildBoardDisplay();
    this.buildTokenDisplay();
    this.buildHUD();
    this.buildCharacterTabs();
    this.buildCardStrip();

    this.input.mouse?.disableContextMenu();
  }

  // ── Board display ─────────────────────────────────────────────────────────

  private effSize(key: string, rot: number): { effW: number; effH: number } {
    const d = BOARD_DIMS[key];
    if (!d) return { effW: 0, effH: 0 };
    return rot % 180 === 0 ? { effW: d.w, effH: d.h } : { effW: d.h, effH: d.w };
  }

  private baseTransform(): { scale: number; ox: number; oy: number } {
    if (this.boards.length === 0)
      return { scale: 1, ox: this.cw / 2, oy: HUD_H + this.arrH / 2 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of this.boards) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      if (b.lx < minX) minX = b.lx;
      if (b.ly < minY) minY = b.ly;
      if (b.lx + effW > maxX) maxX = b.lx + effW;
      if (b.ly + effH > maxY) maxY = b.ly + effH;
    }

    const lw = maxX - minX;
    const lh = maxY - minY;
    const scale = Math.min((this.arrH - 30) / lh, (this.cw - 30) / lw);
    const ox = (this.cw - lw * scale) / 2 - minX * scale;
    const oy = HUD_H + (this.arrH - lh * scale) / 2 - minY * scale;
    return { scale, ox, oy };
  }

  private displayTransform(): { scale: number; ox: number; oy: number } {
    const base = this.baseTransform();
    const cx = this.cw / 2;
    const cy = HUD_H + this.arrH / 2;
    return {
      scale: base.scale * this.zoom,
      ox: cx + (base.ox - cx) * this.zoom + this.panX,
      oy: cy + (base.oy - cy) * this.zoom + this.panY,
    };
  }

  private buildBoardDisplay() {
    this.boardImages.forEach(img => img.destroy());
    this.boardImages = [];
    if (this.boards.length === 0) return;

    const { scale, ox, oy } = this.displayTransform();
    for (const b of this.boards) {
      const { effW, effH } = this.effSize(b.key, b.rotation);
      const cx = ox + (b.lx + effW / 2) * scale;
      const cy = oy + (b.ly + effH / 2) * scale;
      const img = this.add.image(cx, cy, b.key).setScale(scale).setAngle(b.rotation);
      img.setMask(this.arrMask);
      this.boardImages.push(img);
    }
  }

  // ── Token display ─────────────────────────────────────────────────────────

  private buildTokenDisplay() {
    this.tokenSprites.forEach(s => s.destroy());
    this.tokenHighlights.forEach(h => h.destroy());
    this.tokenSprites.clear();
    this.tokenHighlights.clear();

    if (this.tokens.length === 0) return;

    const { scale, ox, oy } = this.displayTransform();
    const tokenScale = scale * TOKEN_SCALE_FACTOR;

    for (const t of this.tokens) {
      const sx = ox + t.lx * scale;
      const sy = oy + t.ly * scale;

      // Selection highlight ring (behind token)
      const hlRadius = (95 * tokenScale) / 2 + 4;
      const hl = this.add.circle(sx, sy, hlRadius, 0xd4a044, 0)
        .setStrokeStyle(3, 0xd4a044, 0)
        .setMask(this.arrMask);
      this.tokenHighlights.set(t.charKey, hl);

      // Token image
      const img = this.add.image(sx, sy, `char_${t.charKey}`)
        .setScale(tokenScale)
        .setAngle(t.angle)
        .setOrigin(0.5)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true });

      img.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (this.isDragging) return;
        if (pointer.rightButtonDown()) return;
        this.selectCharacter(t.charKey);
      });

      this.tokenSprites.set(t.charKey, img);
    }

    this.refreshTokenHighlights();
  }

  private refreshTokenHighlights() {
    for (const [charKey, hl] of this.tokenHighlights) {
      const isSelected = this.selectedCharKey === charKey;
      const isConfirmed = this.confirmedChars.has(charKey);
      if (isSelected) {
        hl.setStrokeStyle(3, 0xffffff, 1);
      } else if (isConfirmed) {
        hl.setStrokeStyle(3, 0x44aa44, 0.8);
      } else {
        hl.setStrokeStyle(3, 0xd4a044, 0);
      }
    }
  }

  private refreshView() {
    this.buildBoardDisplay();
    this.buildTokenDisplay();
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private buildHUD() {
    const w = this.cw;
    this.add.rectangle(0, 0, w, HUD_H, 0x0f0804).setOrigin(0);

    this.turnText = this.add
      .text(16, HUD_H / 2, "Turn 1", { fontSize: "20px", color: "#d4a044", fontStyle: "bold" })
      .setOrigin(0, 0.5);

    this.phaseText = this.add
      .text(w / 2, HUD_H / 2, "Lobby", { fontSize: "18px", color: "#c4935a" })
      .setOrigin(0.5);

    this.sequenceText = this.add
      .text(w - 16, HUD_H / 2, "", { fontSize: "18px", color: "#d4a044" })
      .setOrigin(1, 0.5);
  }

  // ── Character tabs (bottom bar, above cards) ──────────────────────────────

  private buildCharacterTabs() {
    const y = this.charTabY;
    const w = this.cw;

    this.add.rectangle(0, y, w, CHAR_TAB_H, 0x0f0804).setOrigin(0);
    this.add.rectangle(0, y - 1, w, 1, 0x3a2510).setOrigin(0);

    const tabW = Math.min(120, (w - 20) / Math.max(this.tokens.length, 1));

    this.tokens.forEach((t, i) => {
      const tx = 10 + i * tabW + tabW / 2;
      const ty = y + CHAR_TAB_H / 2;

      const bg = this.add.rectangle(tx, ty, tabW - 4, CHAR_TAB_H - 6, 0x2a1500)
        .setStrokeStyle(1, 0x3a2510);

      const imgScale = 32 / 95;
      const img = this.add.image(tx - tabW / 2 + 22, ty, `char_${t.charKey}`)
        .setScale(imgScale);

      const label = this.add.text(tx + 6, ty, t.charKey.replace(/_/g, " "), {
        fontSize: "11px", color: "#c4935a",
      }).setOrigin(0, 0.5);

      const check = this.add.text(tx + tabW / 2 - 14, ty, "", {
        fontSize: "14px", color: "#44aa44",
      }).setOrigin(0.5);

      const zone = this.add.zone(tx, ty, tabW - 4, CHAR_TAB_H - 6)
        .setInteractive({ useHandCursor: true });
      zone.on("pointerup", () => this.selectCharacter(t.charKey));

      this.charTabItems.set(t.charKey, { bg, img, label, check, zone });
    });
  }

  private refreshCharacterTabs() {
    for (const [charKey, item] of this.charTabItems) {
      const isSelected = this.selectedCharKey === charKey;
      const isConfirmed = this.confirmedChars.has(charKey);

      item.bg.setFillStyle(isSelected ? 0x4a2800 : 0x2a1500);
      item.bg.setStrokeStyle(1, isSelected ? 0xd4a044 : 0x3a2510);
      item.check.setText(isConfirmed ? "\u2713" : "");
    }
  }

  // ── Character selection ───────────────────────────────────────────────────

  private selectCharacter(charKey: string) {
    if (this.selectedCharKey === charKey) return;

    // Save current character's card state
    this.saveCurrentCardState();

    this.selectedCharKey = charKey;
    this.refreshCharacterTabs();
    this.refreshTokenHighlights();
    this.refreshCardStripForCharacter();
  }

  private saveCurrentCardState() {
    if (!this.selectedCharKey) return;
    this.characterCards.set(this.selectedCharKey, this.getCurrentCardSelection());
  }

  // ── Card strip ────────────────────────────────────────────────────────────
  // Two rows: front (top) and back (bottom) for each of 12 cards.
  // cardImages[0..11] = front row, cardImages[12..23] = back row.
  // Selecting one side of a card deselects the other side automatically.

  private buildCardStrip() {
    const w = this.cw;
    const stripY = this.cardStripY;

    this.cardContainer = this.add.container(0, 0);

    // Background
    this.cardContainer.add(this.add.rectangle(0, stripY, w, CARD_STRIP_H, 0x0d0704).setOrigin(0));
    this.cardContainer.add(this.add.rectangle(0, stripY - 1, w, 1, 0x3a2510).setOrigin(0));

    // Selection summary bar
    this.selectedDisplay = this.add
      .text(16, stripY + 6, "Click a character to select actions", {
        fontSize: "14px", color: "#888",
      });
    this.cardContainer.add(this.selectedDisplay);

    // Confirm button (per-character)
    this.confirmBtn = this.add
      .text(w - 180, stripY + 4, "Confirm", {
        fontSize: "15px", color: "#d4a044",
        backgroundColor: "#2a1500", padding: { x: 10, y: 4 },
      })
      .setInteractive({ useHandCursor: true });
    this.confirmBtn.on("pointerup", () => this.confirmCharacter());
    this.cardContainer.add(this.confirmBtn);

    // Send All button
    this.sendAllBtn = this.add
      .text(w - 80, stripY + 4, "Send All", {
        fontSize: "15px", color: "#555",
        backgroundColor: "#2a1500", padding: { x: 10, y: 4 },
      })
      .setInteractive({ useHandCursor: true });
    this.sendAllBtn.on("pointerup", () => this.sendAllCards());
    this.cardContainer.add(this.sendAllBtn);

    // Two rows of 12 cards: front row on top, back row below
    const totalCardsW = 12 * (CARD_W + CARD_GAP) - CARD_GAP;
    const startX = (w - totalCardsW) / 2;
    const frontY = stripY + 28;
    const backY = frontY + CARD_H + CARD_ROW_GAP;

    for (let row = 0; row < 2; row++) {
      const side: CardSide = row === 0 ? "front" : "back";
      const cardY = row === 0 ? frontY : backY;

      for (let i = 0; i < 12; i++) {
        const cardNum = (i + 1) as CardNumber;
        const x = startX + i * (CARD_W + CARD_GAP);
        const idx = row * 12 + i; // 0..23

        const hl = this.add
          .rectangle(x + CARD_W / 2, cardY + CARD_H / 2, CARD_W + 4, CARD_H + 4, 0x000000, 0)
          .setStrokeStyle(2, 0xd4a044, 0);
        this.cardContainer.add(hl);
        this.cardHighlights.push(hl);

        const texKey = side === "front"
          ? `action_card_a${cardNum}`
          : `action_card_a${cardNum}_back`;
        const img = this.add.image(x + CARD_W / 2, cardY + CARD_H / 2, texKey)
          .setDisplaySize(CARD_W, CARD_H)
          .setInteractive({ useHandCursor: true });
        img.setData("cardNum", cardNum);
        img.setData("side", side);
        img.setData("idx", idx);

        img.on("pointerup", () => {
          if (!this.selectedCharKey) return;
          if (this.confirmedChars.has(this.selectedCharKey)) return;
          this.toggleCard(cardNum, side);
        });

        this.cardContainer.add(img);
        this.cardImages.push(img);
      }
    }
  }

  /** Get the image index for a card+side. Front: cardNum-1, Back: 12+cardNum-1. */
  private cardIdx(cardNum: CardNumber, side: CardSide): number {
    return side === "front" ? cardNum - 1 : 12 + cardNum - 1;
  }

  private getCurrentCardSelection(): ActionCardSelection[] {
    const cards: ActionCardSelection[] = [];
    for (const img of this.cardImages) {
      if (img.getData("selected") as boolean) {
        cards.push({
          card: img.getData("cardNum") as CardNumber,
          side: img.getData("side") as CardSide,
        });
      }
    }
    return cards;
  }

  private getCurrentCost(): number {
    return this.getCurrentCardSelection().reduce(
      (sum, sel) => sum + getActionDef(sel).cost, 0
    );
  }

  private toggleCard(cardNum: CardNumber, side: CardSide) {
    const idx = this.cardIdx(cardNum, side);
    const otherIdx = this.cardIdx(cardNum, side === "front" ? "back" : "front");
    const img = this.cardImages[idx];
    const wasSelected = img.getData("selected") as boolean;

    if (wasSelected) {
      // Deselect
      img.setData("selected", false);
    } else {
      // Deselect the opposite side of the same card first
      this.cardImages[otherIdx].setData("selected", false);
      // Select this side
      img.setData("selected", true);
    }

    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private refreshCardStripForCharacter() {
    if (!this.selectedCharKey) return;

    const isConfirmed = this.confirmedChars.has(this.selectedCharKey);
    const savedCards = this.characterCards.get(this.selectedCharKey) ?? [];

    // Reset all
    for (const img of this.cardImages) {
      img.setData("selected", false);
      img.setAlpha(isConfirmed ? 0.5 : 1);
    }

    // Restore saved selections
    for (const sel of savedCards) {
      const idx = this.cardIdx(sel.card, sel.side);
      this.cardImages[idx].setData("selected", true);
    }

    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private refreshSelectionDisplay() {
    const cost = this.getCurrentCost();
    const cards = this.getCurrentCardSelection();
    const charName = this.selectedCharKey?.replace(/_/g, " ") ?? "";

    if (!this.selectedCharKey) {
      this.selectedDisplay.setText("Click a character to select actions");
      this.selectedDisplay.setColor("#888");
    } else if (this.confirmedChars.has(this.selectedCharKey)) {
      this.selectedDisplay.setText(`${charName}: confirmed \u2713`);
      this.selectedDisplay.setColor("#44aa44");
    } else if (cards.length === 0) {
      this.selectedDisplay.setText(`${charName}: select action cards (${cost}/${SEQUENCES_PER_TURN} seq)`);
      this.selectedDisplay.setColor("#888");
    } else {
      const names = cards.map(sel => `${getActionDef(sel).name}(${getActionDef(sel).cost})`);
      this.selectedDisplay.setText(`${charName}: ${names.join(" + ")} = ${cost}/${SEQUENCES_PER_TURN} seq`);
      this.selectedDisplay.setColor("#d4a044");
    }

    // Confirm is always available (even with 0 cards)
    const canConfirm = !!this.selectedCharKey && !this.confirmedChars.has(this.selectedCharKey);
    this.confirmBtn.setColor(canConfirm ? "#d4a044" : "#555");

    const allConfirmed = this.tokens.every(t => this.confirmedChars.has(t.charKey));
    this.sendAllBtn.setColor(allConfirmed ? "#d4a044" : "#555");
  }

  private refreshCardHighlights() {
    for (let i = 0; i < this.cardImages.length; i++) {
      const img = this.cardImages[i];
      const hl = this.cardHighlights[i];
      const selected = img.getData("selected") as boolean;

      if (selected) {
        hl.setStrokeStyle(3, 0xd4a044, 1);
        hl.setFillStyle(0xd4a044, 0.15);
      } else {
        hl.setStrokeStyle(2, 0xd4a044, 0);
        hl.setFillStyle(0x000000, 0);
      }
    }
  }

  private confirmCharacter() {
    if (!this.selectedCharKey) return;
    if (this.confirmedChars.has(this.selectedCharKey)) return;

    this.characterCards.set(this.selectedCharKey, this.getCurrentCardSelection());
    this.confirmedChars.add(this.selectedCharKey);

    this.refreshCharacterTabs();
    this.refreshTokenHighlights();
    this.refreshCardStripForCharacter();

    // Auto-select next unconfirmed character
    const next = this.tokens.find(t => !this.confirmedChars.has(t.charKey));
    if (next) {
      this.selectCharacter(next.charKey);
    }
  }

  private sendAllCards() {
    const allConfirmed = this.tokens.every(t => this.confirmedChars.has(t.charKey));
    if (!allConfirmed) return;

    // Build bulk message: { charKey: cards[] }
    const msg: Record<string, ActionCardSelection[]> = {};
    for (const t of this.tokens) {
      msg[t.charKey] = this.characterCards.get(t.charKey) ?? [];
    }

    this.room.send("select_cards", msg);
    console.log("Sent card selections for all characters");
  }

  // ── Input (zoom, pan) ────────────────────────────────────────────────────

  private setupInput() {
    this.input.on("wheel", (_pointer: Phaser.Input.Pointer, _: unknown, _dx: number, dy: number) => {
      const pointer = _pointer;
      if (pointer.y <= HUD_H || pointer.y >= this.charTabY) return;

      const dir = dy > 0 ? -1 : 1;
      const oldZoom = this.zoom;
      this.zoom = Phaser.Math.Clamp(this.zoom * (1 + dir * ZOOM_FACTOR), MIN_ZOOM, MAX_ZOOM);
      const factor = this.zoom / oldZoom;

      const cx = this.cw / 2;
      const cy = HUD_H + this.arrH / 2;
      if (this.zoom <= MIN_ZOOM) {
        this.panX = 0;
        this.panY = 0;
      } else {
        this.panX = (pointer.x - cx - this.panX) * (1 - factor) + this.panX;
        this.panY = (pointer.y - cy - this.panY) * (1 - factor) + this.panY;
      }
      this.refreshView();
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.zoom > MIN_ZOOM && pointer.isDown && pointer.y > HUD_H && pointer.y < this.charTabY) {
        const dx = pointer.x - this.dragStartX;
        const dy = pointer.y - this.dragStartY;
        if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
          this.isDragging = true;
        }
        if (this.isDragging) {
          this.panX = this.panStartX + dx;
          this.panY = this.panStartY + dy;
          this.refreshView();
        }
      }
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > HUD_H && pointer.y < this.charTabY) {
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.panStartX = this.panX;
        this.panStartY = this.panY;
        this.isDragging = false;
      }
    });

    this.input.on("pointerup", () => {
      if (this.isDragging) {
        this.isDragging = false;
      }
    });
  }

  // ── State sync ────────────────────────────────────────────────────────────

  private onStateChange(state: GameState) {
    this.turnText.setText(`Turn ${state.turn}/${state.maxTurns}`);
    this.updatePhaseDisplay(state);

    // When entering action_selection, reset local card state
    if (state.phase === "action_selection" && this.lastPhase !== "action_selection") {
      this.characterCards.clear();
      this.confirmedChars.clear();
      this.selectedCharKey = null;
      // Auto-select first character
      if (this.tokens.length > 0) {
        this.selectCharacter(this.tokens[0].charKey);
      }
      this.refreshCharacterTabs();
      this.refreshTokenHighlights();
    }

    // Show/hide card UI
    const showCards = state.phase === "action_selection";
    this.cardContainer.setVisible(showCards);

    this.lastPhase = state.phase;
  }

  private updatePhaseDisplay(state: GameState) {
    const phaseLabels: Record<string, string> = {
      lobby: "Waiting for players...",
      action_selection: "Select action cards for each character",
      sequence: `Sequence ${state.currentSequence} of 5`,
      turn_end: "Turn ending...",
      end: "Game Over",
    };

    this.phaseText.setText(phaseLabels[state.phase] ?? state.phase);

    if (state.phase === "sequence") {
      const dots = Array.from({ length: 5 }, (_, i) =>
        i < state.currentSequence ? "\u25cf" : "\u25cb"
      ).join(" ");
      this.sequenceText.setText(dots);
    } else if (state.phase === "action_selection") {
      this.sequenceText.setText("\u25cb \u25cb \u25cb \u25cb \u25cb");
    } else {
      this.sequenceText.setText("");
    }
  }
}
