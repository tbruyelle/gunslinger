import Phaser from "phaser";
import { Room } from "colyseus.js";
import type {
  GameState,
  PlacedBoardSetup,
  PlacedTokenSetup,
  ActionCardSelection,
  CardNumber,
  CardSide,
  CardChoice,
  ChoiceType,
  RelativeDirection,
  CharacterStatus,
} from "@gunslinger/shared";
import {
  ACTION_CARDS,
  getActionDef,
  getActionCardAsset,
  SEQUENCES_PER_TURN,
  AHEAD_DIRS,
  BACK_DIRS,
  angleToDirIndex,
  relativeToAbsoluteDir,
  dirIndexToAngle,
} from "@gunslinger/shared";
import { HexNeighborMap, type LayoutHex } from "../hex/neighbors";

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
const HEX_HIGHLIGHT_R = 18;

// ── Hex grid data type ──────────────────────────────────────────────────────

interface HexPoint { id: string; x: number; y: number }
interface HexGridData { boards: Record<string, { hexes: HexPoint[] }> }

/** Local character state tracked during card selection preview. */
interface CharacterState {
  lx: number;
  ly: number;
  angle: number;
  hexId: string;
  status: CharacterStatus;
}

/** Statuses that show a VASSAL-style overlay on the token. */
const STATUS_OVERLAY_ASSETS: Record<string, string> = {
  down: "state_down",
  passed_out: "state_passed_out",
  surrendered: "state_surrendered",
  dead: "state_dead",
};

/** Groups all Phaser display objects for a single character token. */
class CharacterToken {
  constructor(
    readonly charKey: string,
    readonly sprite: Phaser.GameObjects.Image,
    readonly highlight: Phaser.GameObjects.Arc,
    private statusOverlay: Phaser.GameObjects.Image | null = null,
  ) {}

  /** All current game objects (for tweening, destroying, etc.). */
  private get parts(): Phaser.GameObjects.GameObject[] {
    const list: Phaser.GameObjects.GameObject[] = [this.sprite, this.highlight];
    if (this.statusOverlay) list.push(this.statusOverlay);
    return list;
  }

  destroy() {
    for (const p of this.parts) p.destroy();
    this.statusOverlay = null;
  }

  /** Kill all running tweens on this token's parts. */
  killTweens(tweens: Phaser.Tweens.TweenManager) {
    for (const p of this.parts) tweens.killTweensOf(p);
  }

  /** Tween all parts to a screen position. */
  moveTo(tweens: Phaser.Tweens.TweenManager, sx: number, sy: number, duration: number) {
    for (const p of this.parts) {
      tweens.add({ targets: p, x: sx, y: sy, duration, ease: "Cubic.easeInOut" });
    }
  }

  /** Tween the sprite rotation via shortest path. */
  rotateTo(tweens: Phaser.Tweens.TweenManager, targetAngle: number, duration: number) {
    let diff = targetAngle - this.sprite.angle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) > 0.5) {
      tweens.add({
        targets: this.sprite,
        angle: this.sprite.angle + diff,
        duration,
        ease: "Cubic.easeInOut",
      });
    }
  }

  /** Update the status overlay (create, swap texture, or remove). */
  setStatus(scene: Phaser.Scene, status: CharacterStatus, mask: Phaser.Display.Masks.GeometryMask) {
    const overlayKey = STATUS_OVERLAY_ASSETS[status];

    if (!overlayKey) {
      if (this.statusOverlay) {
        this.statusOverlay.destroy();
        this.statusOverlay = null;
      }
      return;
    }

    if (this.statusOverlay) {
      if (this.statusOverlay.texture.key !== overlayKey) {
        this.statusOverlay.setTexture(overlayKey);
      }
    } else {
      this.statusOverlay = scene.add.image(this.sprite.x, this.sprite.y, overlayKey)
        .setScale(this.sprite.scaleX)
        .setOrigin(0.5)
        .setMask(mask);
    }
  }

  /** Update the highlight ring style. */
  setHighlight(color: number, alpha: number, width = 3) {
    this.highlight.setStrokeStyle(width, color, alpha);
  }
}

export class GameScene extends Phaser.Scene {
  private room!: Room<GameState>;

  // Setup data
  private boards: PlacedBoardSetup[] = [];
  private tokens: PlacedTokenSetup[] = [];

  // Hex neighbor map (built once from hex_grid.json + boards)
  private hexMap: HexNeighborMap | null = null;
  private hexGridData: HexGridData | null = null;

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
  private characterTokens: Map<string, CharacterToken> = new Map();
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

  // Per-character card selections (with choices)
  private characterCards: Map<string, ActionCardSelection[]> = new Map();
  private confirmedChars: Set<string> = new Set();

  // Card strip UI — front row [0..11], back row [12..23]
  private cardContainer!: Phaser.GameObjects.Container;
  private cardImages: Phaser.GameObjects.Image[] = [];
  private cardHighlights: Phaser.GameObjects.Rectangle[] = [];
  private selectedDisplay!: Phaser.GameObjects.Text;
  private confirmBtn!: Phaser.GameObjects.Text;
  private sendAllBtn!: Phaser.GameObjects.Text;

  // Choice mode state
  private choiceMode: {
    cardNum: CardNumber;
    side: CardSide;
    choiceType: ChoiceType;
    options: { relDir: RelativeDirection; hex: LayoutHex | null; charKey?: string }[];
  } | null = null;
  private choiceOverlays: Phaser.GameObjects.GameObject[] = [];
  private choicePromptText: Phaser.GameObjects.Text | null = null;

  // Pending choices stored per card (cardNum → choice)
  private pendingChoices: Map<number, CardChoice> = new Map();

  // Per-character state: original (from placement) and current (after foot actions preview)
  private originalState: Map<string, CharacterState> = new Map();
  private currentState: Map<string, CharacterState> = new Map();

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
    this.pendingChoices.clear();
    this.choiceMode = null;
    this.lastPhase = "";
    this.originalState.clear();
    this.currentState.clear();
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  private get cw() { return this.scale.width; }
  private get ch() { return this.scale.height; }
  private get arrH() { return this.ch - HUD_H - BOTTOM_H; }
  private get charTabY() { return this.ch - BOTTOM_H; }
  private get cardStripY() { return this.ch - CARD_STRIP_H; }

  // ── Preload ───────────────────────────────────────────────────────────────

  preload() {
    // Hex grid data
    if (!this.cache.json.has("hex_grid")) {
      this.load.json("hex_grid", "hex_grid.json");
    }
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
    // Status overlay textures (from VASSAL module)
    for (const texKey of Object.values(STATUS_OVERLAY_ASSETS)) {
      if (!this.textures.exists(texKey)) this.load.image(texKey, `local/${texKey}.png`);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  create() {
    // Build hex neighbor map
    this.hexGridData = this.cache.json.get("hex_grid") as HexGridData;
    if (this.hexGridData && this.boards.length > 0) {
      this.hexMap = new HexNeighborMap(this.hexGridData, this.boards);
    }

    // Store original character state from token placement
    for (const t of this.tokens) {
      const state: CharacterState = { lx: t.lx, ly: t.ly, angle: t.angle, hexId: t.hexId ?? "", status: "alive" };
      this.originalState.set(t.charKey, { ...state });
      this.currentState.set(t.charKey, { ...state });
    }

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
    this.characterTokens.clear();
    this.charTabItems.clear();
    this.cardImages = [];
    this.cardHighlights = [];
    this.choiceOverlays = [];
    this.choicePromptText = null;

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
    this.buildCharacterToken();
    this.buildHUD();
    this.buildCharacterTabs();
    this.buildCardStrip();

    // Re-show choice overlays if we were in choice mode
    if (this.choiceMode) {
      this.showChoiceOverlays();
    }

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

  /** Convert layout coords to screen coords. */
  private layoutToScreen(lx: number, ly: number): { sx: number; sy: number } {
    const { scale, ox, oy } = this.displayTransform();
    return { sx: ox + lx * scale, sy: oy + ly * scale };
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

  private buildCharacterToken() {
    this.characterTokens.forEach(td => td.destroy());
    this.characterTokens.clear();

    if (this.tokens.length === 0) return;

    const { scale } = this.displayTransform();
    const tokenScale = scale * TOKEN_SCALE_FACTOR;

    for (const t of this.tokens) {
      const charState = this.currentState.get(t.charKey);
      const pos = charState ?? t;
      const { sx, sy } = this.layoutToScreen(pos.lx, pos.ly);

      const hlRadius = (95 * tokenScale) / 2 + 4;
      const hl = this.add.circle(sx, sy, hlRadius, 0xd4a044, 0)
        .setStrokeStyle(3, 0xd4a044, 0)
        .setMask(this.arrMask);

      const img = this.add.image(sx, sy, `char_${t.charKey}`)
        .setScale(tokenScale)
        .setAngle(pos.angle)
        .setOrigin(0.5)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true });

      img.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (this.isDragging) return;
        if (pointer.rightButtonDown()) return;

        if (this.choiceMode && this.isTargetChoice(this.choiceMode.choiceType)) {
          this.resolveTargetChoice(t.charKey);
          return;
        }

        this.selectCharacter(t.charKey);
      });

      const td = new CharacterToken(t.charKey, img, hl);
      if (charState && charState.status !== "alive") {
        td.setStatus(this, charState.status, this.arrMask);
      }
      this.characterTokens.set(t.charKey, td);
    }

    this.refreshTokenHighlights();
  }

  private refreshTokenHighlights() {
    for (const [charKey, td] of this.characterTokens) {
      const isSelected = this.selectedCharKey === charKey;
      const isConfirmed = this.confirmedChars.has(charKey);

      if (this.choiceMode && this.isTargetChoice(this.choiceMode.choiceType) && !isSelected) {
        td.setHighlight(0xff4444, 0.9);
      } else if (isSelected) {
        td.setHighlight(0xffffff, 1);
      } else if (isConfirmed) {
        td.setHighlight(0x44aa44, 0.8);
      } else {
        td.setHighlight(0xd4a044, 0);
      }
    }
  }

  private refreshView() {
    this.buildBoardDisplay();
    this.buildCharacterToken();
    this.clearChoiceOverlays();
    if (this.choiceMode) this.showChoiceOverlays();
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

    // Exit choice mode if active
    this.exitChoiceMode();

    // Save current character's card state
    this.saveCurrentCardState();

    this.selectedCharKey = charKey;
    this.pendingChoices.clear();

    // Restore pending choices for this character
    const saved = this.characterCards.get(charKey) ?? [];
    for (const sel of saved) {
      if (sel.choice) this.pendingChoices.set(sel.card, sel.choice);
    }

    this.refreshCharacterTabs();
    this.refreshTokenHighlights();
    this.refreshCardStripForCharacter();
  }

  private saveCurrentCardState() {
    if (!this.selectedCharKey) return;
    const cards = this.getCurrentCardSelection();
    // Attach pending choices
    for (const sel of cards) {
      const choice = this.pendingChoices.get(sel.card);
      if (choice) sel.choice = choice;
    }
    this.characterCards.set(this.selectedCharKey, cards);
  }

  // ── Card strip ────────────────────────────────────────────────────────────

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

    // Confirm button
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

  private cardIdx(cardNum: CardNumber, side: CardSide): number {
    return side === "front" ? cardNum - 1 : 12 + cardNum - 1;
  }

  private getCurrentCardSelection(): ActionCardSelection[] {
    const cards: ActionCardSelection[] = [];
    for (const img of this.cardImages) {
      if (img.getData("selected") as boolean) {
        const sel: ActionCardSelection = {
          card: img.getData("cardNum") as CardNumber,
          side: img.getData("side") as CardSide,
        };
        const choice = this.pendingChoices.get(sel.card);
        if (choice) sel.choice = choice;
        cards.push(sel);
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
    // Block card selection while a choice is pending (must resolve or deselect first)
    if (this.choiceMode && !(cardNum === this.choiceMode.cardNum && side === this.choiceMode.side)) return;

    const idx = this.cardIdx(cardNum, side);
    const otherIdx = this.cardIdx(cardNum, side === "front" ? "back" : "front");
    const img = this.cardImages[idx];
    const otherImg = this.cardImages[otherIdx];
    const wasSelected = img.getData("selected") as boolean;
    const otherSelected = otherImg.getData("selected") as boolean;

    // Can't select this side if the opposite side is already selected
    if (!wasSelected && otherSelected) return;

    // Can't select if it would exceed the cost limit
    if (!wasSelected) {
      const def2 = getActionDef({ card: cardNum, side });
      if (this.getCurrentCost() + def2.cost > SEQUENCES_PER_TURN) return;
    }

    // Exit any active choice mode (deselecting the choice card)
    this.exitChoiceMode();

    const def = getActionDef({ card: cardNum, side });

    if (wasSelected) {
      img.setData("selected", false);
      this.pendingChoices.delete(cardNum);
      // Recompute position if a foot card was deselected
      if (def.category === "foot" && this.selectedCharKey) {
        this.updateCharState(this.selectedCharKey);
      }
    } else {
      img.setData("selected", true);

      // If foot card with no choice (Sprint), auto-execute immediately
      if (def.category === "foot" && def.choiceType === "none" && this.selectedCharKey) {
        this.updateCharState(this.selectedCharKey);
      }

      // Check if this card needs a choice
      if (def.choiceType !== "none") {
        this.enterChoiceMode(cardNum, side, def.choiceType);
      }
    }

    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private refreshCardStripForCharacter() {
    if (!this.selectedCharKey) return;

    const isConfirmed = this.confirmedChars.has(this.selectedCharKey);
    const savedCards = this.characterCards.get(this.selectedCharKey) ?? [];

    for (const img of this.cardImages) {
      img.setData("selected", false);
      img.setAlpha(isConfirmed ? 0.5 : 1);
    }

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

    if (this.choiceMode) {
      const prompt = this.getChoicePrompt(this.choiceMode.choiceType);
      this.selectedDisplay.setText(`${charName}: ${prompt}`);
      this.selectedDisplay.setColor("#ff9944");
    } else if (!this.selectedCharKey) {
      this.selectedDisplay.setText("Click a character to select actions");
      this.selectedDisplay.setColor("#888");
    } else if (this.confirmedChars.has(this.selectedCharKey)) {
      this.selectedDisplay.setText(`${charName}: confirmed \u2713`);
      this.selectedDisplay.setColor("#44aa44");
    } else if (cards.length === 0) {
      this.selectedDisplay.setText(`${charName}: select action cards (${cost}/${SEQUENCES_PER_TURN} seq)`);
      this.selectedDisplay.setColor("#888");
    } else {
      const names = cards.map(sel => {
        const def = getActionDef(sel);
        const choiceLabel = this.getChoiceLabel(sel);
        return choiceLabel ? `${def.name}(${def.cost})\u2192${choiceLabel}` : `${def.name}(${def.cost})`;
      });
      this.selectedDisplay.setText(`${charName}: ${names.join(" + ")} = ${cost}/${SEQUENCES_PER_TURN} seq`);
      this.selectedDisplay.setColor("#d4a044");
    }

    const canConfirm = !!this.selectedCharKey && !this.confirmedChars.has(this.selectedCharKey) && !this.choiceMode;
    this.confirmBtn.setColor(canConfirm ? "#d4a044" : "#555");

    const allConfirmed = this.tokens.every(t => this.confirmedChars.has(t.charKey));
    this.sendAllBtn.setColor(allConfirmed ? "#d4a044" : "#555");
  }

  private getChoiceLabel(sel: ActionCardSelection): string {
    const choice = this.pendingChoices.get(sel.card);
    if (!choice) return "";
    if (choice.moveDir) return choice.moveDir.replace(/_/g, " ");
    if (choice.newFacing) return choice.newFacing.replace(/_/g, " ");
    if (choice.targetCharKey) return choice.targetCharKey.replace(/_/g, " ");
    return "";
  }

  private refreshCardHighlights() {
    const cost = this.getCurrentCost();

    for (let i = 0; i < this.cardImages.length; i++) {
      const img = this.cardImages[i];
      const hl = this.cardHighlights[i];
      const selected = img.getData("selected") as boolean;
      const cardNum = img.getData("cardNum") as CardNumber;
      const side = img.getData("side") as CardSide;
      const def = getActionDef({ card: cardNum, side });
      const hasChoice = this.pendingChoices.has(cardNum);
      const needsChoice = def.choiceType !== "none";

      // Check if opposite side is selected (blocked)
      const otherSide: CardSide = side === "front" ? "back" : "front";
      const otherIdx = this.cardIdx(cardNum, otherSide);
      const otherSelected = this.cardImages[otherIdx].getData("selected") as boolean;

      // Check if selecting this card would exceed the cost limit
      const wouldExceed = !selected && (cost + def.cost > SEQUENCES_PER_TURN);

      // During choice mode, dim all cards except the one awaiting a choice
      const blockedByChoice = !!this.choiceMode &&
        !(cardNum === this.choiceMode.cardNum && side === this.choiceMode.side);

      if (selected && needsChoice && !hasChoice) {
        hl.setStrokeStyle(3, 0xff6600, 1);
        hl.setFillStyle(0xff6600, 0.15);
        img.setAlpha(1);
      } else if (selected) {
        hl.setStrokeStyle(3, 0xd4a044, 1);
        hl.setFillStyle(0xd4a044, 0.15);
        img.setAlpha(blockedByChoice ? 0.5 : 1);
      } else if (blockedByChoice || otherSelected) {
        hl.setStrokeStyle(2, 0xd4a044, 0);
        hl.setFillStyle(0x000000, 0);
        img.setAlpha(0.3);
      } else if (wouldExceed) {
        // Would exceed cost limit — dim
        hl.setStrokeStyle(2, 0xd4a044, 0);
        hl.setFillStyle(0x000000, 0);
        img.setAlpha(0.4);
      } else {
        hl.setStrokeStyle(2, 0xd4a044, 0);
        hl.setFillStyle(0x000000, 0);
        img.setAlpha(1);
      }
    }
  }

  private confirmCharacter() {
    if (!this.selectedCharKey) return;
    if (this.confirmedChars.has(this.selectedCharKey)) return;
    if (this.choiceMode) return;

    this.characterCards.set(this.selectedCharKey, this.getCurrentCardSelection());
    this.confirmedChars.add(this.selectedCharKey);

    // Animate token back to original state (movement/status was just a preview)
    const charKey = this.selectedCharKey;
    const orig = this.originalState.get(charKey);
    if (orig) {
      this.animateTokenTo(charKey, orig);
      this.currentState.set(charKey, { ...orig });
    }
    this.characterTokens.get(charKey)?.setStatus(this, "alive", this.arrMask);

    this.refreshCharacterTabs();
    this.refreshTokenHighlights();
    this.refreshCardStripForCharacter();

    const next = this.tokens.find(t => !this.confirmedChars.has(t.charKey));
    if (next) {
      this.selectCharacter(next.charKey);
    }
  }

  private sendAllCards() {
    const allConfirmed = this.tokens.every(t => this.confirmedChars.has(t.charKey));
    if (!allConfirmed) return;

    const msg: Record<string, ActionCardSelection[]> = {};
    for (const t of this.tokens) {
      msg[t.charKey] = this.characterCards.get(t.charKey) ?? [];
    }

    this.room.send("select_cards", msg);
    console.log("Sent card selections for all characters");
  }

  // ── Choice mode ───────────────────────────────────────────────────────────

  private isTargetChoice(ct: ChoiceType): boolean {
    return ct === "target_ranged" || ct === "target_melee" || ct === "target_defend";
  }

  private getChoicePrompt(ct: ChoiceType): string {
    switch (ct) {
      case "move_ahead": return "Click a highlighted hex to move to";
      case "move_back": return "Click a highlighted hex to back up to";
      case "turn_ahead": return "Click a highlighted hex to face toward";
      case "turn_back": return "Click a highlighted hex to face toward";
      case "target_ranged": return "Click a target character";
      case "target_melee": return "Click an adjacent character";
      case "target_defend": return "Click an attacker to defend against";
      default: return "";
    }
  }

  private enterChoiceMode(cardNum: CardNumber, side: CardSide, choiceType: ChoiceType) {
    this.exitChoiceMode();

    if (!this.selectedCharKey) return;

    if (choiceType === "move_ahead" || choiceType === "turn_ahead") {
      const options = this.getHexOptionsForChar(this.selectedCharKey, AHEAD_DIRS);
      this.choiceMode = { cardNum, side, choiceType, options };
    } else if (choiceType === "move_back" || choiceType === "turn_back") {
      const options = this.getHexOptionsForChar(this.selectedCharKey, BACK_DIRS);
      this.choiceMode = { cardNum, side, choiceType, options };
    } else if (this.isTargetChoice(choiceType)) {
      // For target choices, options are other characters
      const options: { relDir: RelativeDirection; hex: LayoutHex | null; charKey?: string }[] = [];
      for (const t of this.tokens) {
        if (t.charKey === this.selectedCharKey) continue;
        // For melee, could filter by adjacency — for now show all
        options.push({ relDir: "ahead", hex: null, charKey: t.charKey });
      }
      this.choiceMode = { cardNum, side, choiceType, options };
    }

    this.showChoiceOverlays();
    this.refreshSelectionDisplay();
    this.refreshTokenHighlights();
  }

  private getHexOptionsForChar(charKey: string, dirs: RelativeDirection[]): { relDir: RelativeDirection; hex: LayoutHex | null }[] {
    const pos = this.currentState.get(charKey);
    if (!this.hexMap || !pos?.hexId) return [];
    return this.hexMap.getRelativeNeighbors(pos.hexId, pos.angle, dirs, charKey);
  }

  private showChoiceOverlays() {
    this.clearChoiceOverlays();
    if (!this.choiceMode) return;

    const { choiceType, options } = this.choiceMode;

    if (this.isTargetChoice(choiceType)) {
      // Token highlights handled in refreshTokenHighlights
      return;
    }

    // Show hex highlight circles on the board
    for (const opt of options) {
      if (!opt.hex) continue;
      const { sx, sy } = this.layoutToScreen(opt.hex.lx, opt.hex.ly);
      const { scale } = this.displayTransform();
      const r = Math.max(12, HEX_HIGHLIGHT_R * scale * 3);

      const circle = this.add.circle(sx, sy, r, 0x44cc44, 0.35)
        .setStrokeStyle(2, 0x44cc44, 0.9)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true })
        .setDepth(500);

      const label = this.add.text(sx, sy, opt.relDir.replace(/_/g, "\n"), {
        fontSize: "10px", color: "#fff", align: "center",
      }).setOrigin(0.5).setMask(this.arrMask).setDepth(501);

      circle.on("pointerup", () => {
        this.resolveHexChoice(opt.relDir, opt.hex!);
      });

      this.choiceOverlays.push(circle, label);
    }
  }

  private clearChoiceOverlays() {
    for (const obj of this.choiceOverlays) obj.destroy();
    this.choiceOverlays = [];
  }

  private resolveHexChoice(relDir: RelativeDirection, _hex: LayoutHex) {
    if (!this.choiceMode || !this.selectedCharKey) return;
    const { cardNum, choiceType } = this.choiceMode;

    if (choiceType === "move_ahead" || choiceType === "move_back") {
      this.pendingChoices.set(cardNum, { moveDir: relDir });
    } else if (choiceType === "turn_ahead" || choiceType === "turn_back") {
      this.pendingChoices.set(cardNum, { newFacing: relDir });
    }

    this.exitChoiceMode();
    this.updateCharState(this.selectedCharKey);
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private resolveTargetChoice(targetCharKey: string) {
    if (!this.choiceMode) return;
    const { cardNum } = this.choiceMode;

    this.pendingChoices.set(cardNum, { targetCharKey });
    this.exitChoiceMode();
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private exitChoiceMode() {
    this.choiceMode = null;
    this.clearChoiceOverlays();
    this.refreshTokenHighlights();
  }

  // ── Position replay (execute foot actions immediately) ────────────────────

  /**
   * Replay all selected foot cards for a character to compute current position.
   * Cards are replayed in card number order (1→12).
   */
  private recomputeState(charKey: string) {
    const orig = this.originalState.get(charKey);
    if (!orig) return;

    // Start from original state (alive and upright)
    const state: CharacterState = { ...orig, status: "alive" };

    // Get selected cards for this character, sorted by card number
    const cards = (charKey === this.selectedCharKey)
      ? this.getCurrentCardSelection()
      : (this.characterCards.get(charKey) ?? []);

    const sorted = [...cards].sort((a, b) => a.card - b.card);

    for (const sel of sorted) {
      const def = getActionDef(sel);
      if (def.category !== "foot") continue;

      const choice = this.pendingChoices.get(sel.card) ?? sel.choice;

      if (def.choiceType === "move_ahead" || def.choiceType === "move_back") {
        // Move one hex in the chosen relative direction
        if (choice?.moveDir && this.hexMap && state.hexId) {
          const targetHex = this.hexMap.getRelativeNeighbor(state.hexId, state.angle, choice.moveDir, charKey);
          if (targetHex) {
            state.lx = targetHex.lx;
            state.ly = targetHex.ly;
            state.hexId = targetHex.id;
          }
        }
      } else if (def.choiceType === "turn_ahead" || def.choiceType === "turn_back") {
        // Change facing
        if (choice?.newFacing) {
          const currentFacing = angleToDirIndex(state.angle, charKey);
          const newFacingDir = relativeToAbsoluteDir(currentFacing, choice.newFacing);
          state.angle = dirIndexToAngle(newFacingDir, charKey);
        }
      } else if (def.name === "Sprint") {
        // Auto-move straight ahead
        if (this.hexMap && state.hexId) {
          const aheadHex = this.hexMap.getRelativeNeighbor(state.hexId, state.angle, "ahead", charKey);
          if (aheadHex) {
            state.lx = aheadHex.lx;
            state.ly = aheadHex.ly;
            state.hexId = aheadHex.id;
          }
        }
      }
      // Leap/Drop or Get Up/Down: toggle down state
      if (def.name === "Leap/Drop" || def.name === "Get Up/Down") {
        state.status = state.status === "down" ? "alive" : "down";
      }
      // Head Out/Back: no position change
    }

    this.currentState.set(charKey, state);
  }

  /**
   * Recompute position and animate the token sprite to the new location.
   * Uses tweens instead of rebuilding the entire view.
   */
  private updateCharState(charKey: string) {
    const oldState = this.currentState.get(charKey);
    this.recomputeState(charKey);
    const newState = this.currentState.get(charKey);
    const td = this.characterTokens.get(charKey);

    if (!oldState || !newState || !td) return;

    const { sx, sy } = this.layoutToScreen(newState.lx, newState.ly);
    const moved = oldState.lx !== newState.lx || oldState.ly !== newState.ly;
    const rotated = oldState.angle !== newState.angle;

    if (moved || rotated) td.killTweens(this.tweens);
    if (moved) td.moveTo(this.tweens, sx, sy, 300);
    if (rotated) td.rotateTo(this.tweens, newState.angle, 250);
    td.setStatus(this, newState.status, this.arrMask);
  }

  /** Animate a token back to a target position/angle (e.g. on confirm). */
  private animateTokenTo(charKey: string, target: { lx: number; ly: number; angle: number }) {
    const td = this.characterTokens.get(charKey);
    if (!td) return;

    const { sx, sy } = this.layoutToScreen(target.lx, target.ly);
    td.killTweens(this.tweens);
    td.moveTo(this.tweens, sx, sy, 350);
    td.rotateTo(this.tweens, target.angle, 250);
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
      this.pendingChoices.clear();
      this.exitChoiceMode();
      this.selectedCharKey = null;

      // Reset state to originals for the new turn
      // (in the future, server state will update after sequence resolution)
      for (const t of this.tokens) {
        const orig = this.originalState.get(t.charKey);
        if (orig) this.currentState.set(t.charKey, { ...orig });
        this.characterTokens.get(t.charKey)?.setStatus(this, "alive", this.arrMask);
      }

      if (this.tokens.length > 0) {
        this.selectCharacter(this.tokens[0].charKey);
      }
      this.refreshCharacterTabs();
      this.refreshTokenHighlights();
      this.refreshView();
    }

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
