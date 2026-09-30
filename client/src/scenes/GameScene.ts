import Phaser from "phaser";
import type { CardNumber, CardSide, ChoiceType, RelativeDirection } from "../rules";
import { AHEAD_DIRS, BACK_DIRS, dirIndexToAngle, getActionCardAsset, getActionDef, relativeToAbsoluteDir } from "../rules";
import { BOARD_A } from "../board/boardA";
import { getChain, type Chain } from "../chain";
import { subscribeAccountChanged, subscribeNetworkChanged } from "../chain/adena";
import { userMessage } from "../chain/errors";
import { GamePoller } from "../chain/poller";
import { seatOf, shortAddr, type GameView, type TurnResult } from "../chain/types";
import {
  describeEvent,
  endOfTurnEvents,
  eventsForSegment,
  snapshotAfterSegment,
  startOfTurn,
  stepBack,
  stepForward,
  type ReplayPos,
} from "../game/playback";
import { MAX_ACTION_POINTS, encodePlan, isEnabled, planCost, validatePlan, type PlanEntry } from "../game/plan";
import { replayPlan, type CharView } from "../game/replay";
import { showToast } from "../ui/toast";
import { charName } from "./LobbyScene";

// ── Layout constants ────────────────────────────────────────────────────────

const HUD_H = 48;
const PANEL_H = 340;
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
const HEX_SPACING = 185; // approximate centre-to-centre distance in board pixels
const SEGMENTS = 5;
const GOLD = 0xd4a044;
const GOLD_STR = "#d4a044";
const DIM_STR = "#8a7150";

/** Screen angle (degrees) of each absolute direction, y down. */
const DIR_ANGLE = [270, 330, 30, 90, 150, 210];

type Mode = "sync" | "select" | "submitting" | "waiting" | "playback" | "ended" | "spectate";

const BTN_STYLE = { fontSize: "16px", color: GOLD_STR, backgroundColor: "#2a1500", padding: { x: 16, y: 8 } };

/** Groups the display objects of one character token. */
class CharacterToken {
  private overlay: Phaser.GameObjects.Image | null = null;

  constructor(
    readonly charKey: string,
    readonly sprite: Phaser.GameObjects.Image,
    readonly highlight: Phaser.GameObjects.Arc,
  ) {}

  private get parts(): Phaser.GameObjects.GameObject[] {
    const list: Phaser.GameObjects.GameObject[] = [this.sprite, this.highlight];
    if (this.overlay) list.push(this.overlay);
    return list;
  }

  killTweens(tweens: Phaser.Tweens.TweenManager) {
    for (const p of this.parts) tweens.killTweensOf(p);
  }

  moveTo(tweens: Phaser.Tweens.TweenManager, sx: number, sy: number, duration: number) {
    for (const p of this.parts) tweens.add({ targets: p, x: sx, y: sy, duration, ease: "Cubic.easeInOut" });
  }

  rotateTo(tweens: Phaser.Tweens.TweenManager, targetAngle: number, duration: number) {
    let diff = targetAngle - this.sprite.angle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) > 0.5) {
      tweens.add({ targets: this.sprite, angle: this.sprite.angle + diff, duration, ease: "Cubic.easeInOut" });
    }
  }

  setDown(scene: Phaser.Scene, down: boolean, mask: Phaser.Display.Masks.GeometryMask) {
    if (!down) {
      this.overlay?.destroy();
      this.overlay = null;
      return;
    }
    if (!this.overlay) {
      this.overlay = scene.add
        .image(this.sprite.x, this.sprite.y, "state_down")
        .setScale(this.sprite.scaleX)
        .setOrigin(0.5)
        .setMask(mask);
    }
  }

  setHighlight(color: number, alpha: number, width = 3) {
    this.highlight.setStrokeStyle(width, color, alpha);
  }
}

/**
 * The game board: renders the state the realm holds, lets the player build a
 * plan with a live preview, submits it through Adena, and replays the
 * resolution log segment by segment when a turn resolves.
 */
export class GameScene extends Phaser.Scene {
  private gameID = "";
  private chain!: Chain;
  private poller: GamePoller | null = null;
  private unsubscribe: (() => void)[] = [];

  // Chain state
  private view: GameView | null = null;
  private myIndex = -1;
  private renderedTurn = -1;
  private shownResultTurn = 0;
  private committed: CharView[] = [];
  private mode: Mode = "sync";
  private netError: string | null = null;

  // Plan being built
  private selectionOrder: PlanEntry[] = [];
  private pendingChoices: Map<number, RelativeDirection> = new Map();
  private preview: CharView | null = null;
  private choiceMode: {
    card: CardNumber;
    side: CardSide;
    choiceType: ChoiceType;
    options: { rel: RelativeDirection; hex: string | null; x: number; y: number }[];
  } | null = null;
  private choiceOverlays: Phaser.GameObjects.GameObject[] = [];

  // Playback of the last resolved turn
  // Replay of resolved turns: a turn that just resolved (live) or the history.
  private playback: { turns: TurnResult[]; index: number; seg: number; live: boolean; auto: Phaser.Time.TimerEvent | null } | null = null;
  /** The plan being built when a history replay was opened, restored on close. */
  private stashedPlan: { turn: number; order: PlanEntry[]; choices: Map<number, RelativeDirection> } | null = null;

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
  private boardImage: Phaser.GameObjects.Image | null = null;
  private tokens: (CharacterToken | null)[] = [];
  private arrMask!: Phaser.Display.Masks.GeometryMask;
  private arrMaskGfx!: Phaser.GameObjects.Graphics;
  private turnText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private rightText!: Phaser.GameObjects.Text;
  private cardContainer!: Phaser.GameObjects.Container;
  private cardImages: Phaser.GameObjects.Image[] = [];
  private cardHighlights: Phaser.GameObjects.Rectangle[] = [];
  private selectedDisplay!: Phaser.GameObjects.Text;
  private sendBtn!: Phaser.GameObjects.Text;
  private infoContainer!: Phaser.GameObjects.Container;
  private infoText!: Phaser.GameObjects.Text;
  private sequenceContainer!: Phaser.GameObjects.Container;
  private seqTitle!: Phaser.GameObjects.Text;
  private seqDots: Phaser.GameObjects.Text[] = [];
  private seqLog!: Phaser.GameObjects.Text;
  private prevSeqBtn!: Phaser.GameObjects.Text;
  private nextSeqBtn!: Phaser.GameObjects.Text;
  private prevTurnBtn!: Phaser.GameObjects.Text;
  private nextTurnBtn!: Phaser.GameObjects.Text;
  private playBtn!: Phaser.GameObjects.Text;
  private closeReplayBtn!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { gameID: string }) {
    this.gameID = data.gameID;
    this.view = null;
    this.myIndex = -1;
    this.renderedTurn = -1;
    this.shownResultTurn = 0;
    this.committed = [];
    this.mode = "sync";
    this.netError = null;
    this.clearSelection();
    this.playback = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.tokens = [];
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  private get cw() {
    return this.scale.width;
  }
  private get ch() {
    return this.scale.height;
  }
  private get arrH() {
    return this.ch - HUD_H - PANEL_H;
  }
  private get panelY() {
    return this.ch - PANEL_H;
  }

  // ── Preload / create ──────────────────────────────────────────────────────

  preload() {
    if (!this.textures.exists("board_A")) this.load.image("board_A", "board_A.png");
    for (let i = 1; i <= 12; i++) {
      const n = i as CardNumber;
      const fKey = `action_card_a${n}`;
      const bKey = `action_card_a${n}_back`;
      if (!this.textures.exists(fKey)) this.load.image(fKey, getActionCardAsset(n, "front"));
      if (!this.textures.exists(bKey)) this.load.image(bKey, getActionCardAsset(n, "back"));
    }
    if (!this.textures.exists("state_down")) this.load.image("state_down", "local/state_down.png");
  }

  create() {
    this.chain = getChain();
    this.buildAll();
    this.setupInput();

    const onResize = () => this.buildAll();
    this.scale.on("resize", onResize);

    this.poller = new GamePoller(
      this.chain.realm,
      this.gameID,
      (v) => void this.onGame(v),
      (e) => this.onPollError(e),
      this.chain.config.pollMs,
    );
    this.poller.start();

    const leave = (why: string) => {
      if (!this.scene.isActive()) return;
      showToast(this, why, "info");
      this.scene.start("LobbyScene", { splash: false });
    };
    this.unsubscribe.push(
      subscribeAccountChanged(() => leave("Account changed")),
      subscribeNetworkChanged(() => leave("Network changed")),
    );

    this.events.once("shutdown", () => {
      this.scale.off("resize", onResize);
      this.poller?.stop();
      this.poller = null;
      for (const u of this.unsubscribe) u();
      this.unsubscribe = [];
    });
  }

  // ── Chain sync ────────────────────────────────────────────────────────────

  private async onGame(view: GameView) {
    if (!this.scene.isActive()) return;
    const first = this.view === null;
    this.view = view;
    this.netError = null;
    this.myIndex = seatOf(view, this.chain.wallet.address);
    await this.ensureTextures(view);
    if (!this.scene.isActive()) return;

    if (first) {
      this.shownResultTurn = view.lastTurn?.turn ?? 0;
      this.applyState(true);
      return;
    }
    // A turn we have not shown yet resolved: replay it from the positions we
    // were showing before the change.
    if (view.lastTurn && view.lastTurn.turn !== this.shownResultTurn && this.committed.length === 2 && !this.playback) {
      this.startPlayback([view.lastTurn], true);
      return;
    }
    if (!this.playback) this.applyState(false);
  }

  private onPollError(e: unknown) {
    const msg = userMessage(e);
    if (msg !== this.netError) {
      this.netError = msg;
      if (this.scene.isActive()) {
        showToast(this, msg, "error");
        if (/game not found|invalid game id/.test(msg)) this.scene.start("LobbyScene", { splash: false });
      }
    }
    this.refreshHUD();
  }

  private ensureTextures(view: GameView): Promise<void> {
    const missing = view.players.map((p) => p.char).filter((c) => c && !this.textures.exists(`char_${c}`));
    if (missing.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      for (const c of missing) this.load.image(`char_${c}`, `char_${c}.png`);
      this.load.once("complete", () => resolve());
      this.load.start();
    });
  }

  /** Makes the scene reflect the chain state; the plan in progress survives unless the turn changed. */
  private applyState(reset: boolean) {
    const view = this.view;
    if (!view) return;
    const turnChanged = view.turn !== this.renderedTurn;
    this.committed = view.players.map((p) => ({ hex: p.hex, facing: p.facing, down: p.down, delay: p.delay }));
    this.renderedTurn = view.turn;
    this.shownResultTurn = view.lastTurn?.turn ?? 0;

    if (reset || turnChanged || this.mode === "waiting" || this.mode === "playback") {
      this.clearSelection();
    }
    const me = this.myIndex >= 0 ? view.players[this.myIndex] : null;
    if (view.phase === "finished") this.mode = "ended";
    else if (!me) this.mode = "spectate";
    else if (view.phase === "waiting") this.mode = "waiting";
    else if (me.submitted) this.mode = "waiting";
    else if (this.mode !== "submitting") this.mode = "select";
    if (this.mode !== "select") this.clearSelection();

    this.buildTokens();
    this.refreshTokens(!reset);
    this.refreshPanels();
    this.refreshHUD();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private buildAll() {
    this.children.removeAll(true);
    this.tokens = [];
    this.cardImages = [];
    this.cardHighlights = [];
    this.choiceOverlays = [];

    const w = this.cw;
    const h = this.ch;
    this.add.rectangle(0, 0, w, h, 0x1a1008).setOrigin(0);
    this.add.rectangle(0, HUD_H, w, this.arrH, 0x120b04).setOrigin(0);

    if (this.arrMaskGfx) this.arrMaskGfx.destroy();
    this.arrMaskGfx = this.make.graphics();
    this.arrMaskGfx.fillRect(0, HUD_H, w, this.arrH);
    this.arrMask = this.arrMaskGfx.createGeometryMask();

    this.buildBoard();
    this.buildTokens();
    this.refreshTokens(false);
    this.buildHUD();
    this.buildCardStrip();
    this.buildInfoPanel();
    this.buildSequencePanel();
    this.refreshPanels();
    this.refreshHUD();
    if (this.choiceMode) this.showChoiceOverlays();
    this.input.mouse?.disableContextMenu();
  }

  // ── Board & tokens ────────────────────────────────────────────────────────

  private baseTransform(): { scale: number; ox: number; oy: number } {
    const lw = BOARD_A.w;
    const lh = BOARD_A.h;
    const scale = Math.min((this.arrH - 30) / lh, (this.cw - 30) / lw);
    return { scale, ox: (this.cw - lw * scale) / 2, oy: HUD_H + (this.arrH - lh * scale) / 2 };
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

  private boardToScreen(x: number, y: number): { sx: number; sy: number } {
    const { scale, ox, oy } = this.displayTransform();
    return { sx: ox + x * scale, sy: oy + y * scale };
  }

  private hexToScreen(hex: string): { sx: number; sy: number } {
    const p = BOARD_A.hexPos(hex);
    return this.boardToScreen(p.x, p.y);
  }

  private buildBoard() {
    this.boardImage?.destroy();
    const { scale, ox, oy } = this.displayTransform();
    this.boardImage = this.add
      .image(ox + (BOARD_A.w / 2) * scale, oy + (BOARD_A.h / 2) * scale, "board_A")
      .setScale(scale)
      .setMask(this.arrMask);
  }

  /** The characters as they should be drawn right now. */
  private displayChars(): CharView[] {
    if (this.playback) {
      const t = this.playback.turns[this.playback.index];
      return snapshotAfterSegment(startOfTurn(t, this.committed), t.events, this.playback.seg);
    }
    return this.committed.map((c, i) => (i === this.myIndex && this.preview ? this.preview : c));
  }

  private buildTokens() {
    for (const t of this.tokens) {
      if (t) {
        t.killTweens(this.tweens);
        t.sprite.destroy();
        t.highlight.destroy();
        t.setDown(this, false, this.arrMask);
      }
    }
    this.tokens = [];
    const view = this.view;
    if (!view) return;
    const { scale } = this.displayTransform();
    const tokenScale = scale * TOKEN_SCALE_FACTOR;
    const chars = this.displayChars();
    view.players.forEach((p, i) => {
      if (!p.char || !this.textures.exists(`char_${p.char}`)) {
        this.tokens.push(null);
        return;
      }
      const c = chars[i];
      const { sx, sy } = this.hexToScreen(c.hex);
      const hl = this.add
        .circle(sx, sy, (95 * tokenScale) / 2 + 4, GOLD, 0)
        .setStrokeStyle(3, GOLD, 0)
        .setMask(this.arrMask);
      const img = this.add
        .image(sx, sy, `char_${p.char}`)
        .setScale(tokenScale)
        .setAngle(dirIndexToAngle(c.facing, p.char))
        .setOrigin(0.5)
        .setMask(this.arrMask);
      const token = new CharacterToken(p.char, img, hl);
      token.setDown(this, c.down, this.arrMask);
      this.tokens.push(token);
    });
  }

  /** Moves the tokens to the current display state, animated or not. */
  private refreshTokens(animate: boolean) {
    const chars = this.displayChars();
    this.tokens.forEach((t, i) => {
      if (!t || !chars[i]) return;
      const c = chars[i];
      const { sx, sy } = this.hexToScreen(c.hex);
      const angle = dirIndexToAngle(c.facing, t.charKey);
      t.killTweens(this.tweens);
      if (animate) {
        t.moveTo(this.tweens, sx, sy, 450);
        t.rotateTo(this.tweens, angle, 300);
      } else {
        t.sprite.setPosition(sx, sy).setAngle(angle);
        t.highlight.setPosition(sx, sy);
      }
      t.setDown(this, c.down, this.arrMask);
      if (i === this.myIndex) t.setHighlight(0xffffff, this.mode === "select" ? 0.9 : 0.4);
      else t.setHighlight(GOLD, 0);
    });
  }

  private refreshView() {
    this.buildBoard();
    this.buildTokens();
    this.refreshTokens(false);
    this.clearChoiceOverlays();
    if (this.choiceMode) this.showChoiceOverlays();
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private buildHUD() {
    const w = this.cw;
    this.add.rectangle(0, 0, w, HUD_H, 0x0f0804).setOrigin(0);
    this.turnText = this.add.text(16, HUD_H / 2, "", { fontSize: "20px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0, 0.5);
    this.statusText = this.add.text(w / 2, HUD_H / 2, "", { fontSize: "17px", color: "#c4935a" }).setOrigin(0.5);
    this.rightText = this.add.text(w - 16, HUD_H / 2, "", { fontSize: "13px", color: DIM_STR }).setOrigin(1, 0.5);
  }

  private refreshHUD() {
    const view = this.view;
    if (!this.turnText || !view) {
      this.turnText?.setText(`Game ${this.gameID}`);
      this.statusText?.setText("Loading…");
      return;
    }
    this.turnText.setText(`Game ${view.id}  ·  Turn ${view.turn}/${view.maxTurns}`);
    this.statusText.setText(this.statusLine());
    const seats = view.players
      .map((p, i) => {
        if (!p.addr) return "empty seat";
        const who = i === this.myIndex ? "you" : shortAddr(p.addr);
        return `${charName(p.char)} (${who})`;
      })
      .join("  vs  ");
    this.rightText.setText(this.netError ? `RPC offline: ${this.netError}` : seats);
    this.rightText.setColor(this.netError ? "#ff8866" : DIM_STR);
  }

  private statusLine(): string {
    const view = this.view!;
    switch (this.mode) {
      case "sync":
        return "Loading…";
      case "select":
        return "Your move: pick your action cards";
      case "submitting":
        return "Signing your plan…";
      case "waiting":
        return view.phase === "waiting" ? "Waiting for a second player…" : "Plan sent, waiting for the opponent…";
      case "playback":
        return this.playback?.live ? `Turn ${this.playback.turns[0].turn} resolution` : "Replay";
      case "spectate":
        return "Spectating";
      case "ended": {
        const w = view.winner >= 0 ? `${charName(view.players[view.winner].char)} wins` : "no winner";
        return `Game over (${view.endReason.replace(/_/g, " ")}): ${w}`;
      }
    }
  }

  // ── Bottom panels ─────────────────────────────────────────────────────────

  private refreshPanels() {
    if (!this.cardContainer) return;
    this.cardContainer.setVisible(this.mode === "select" || this.mode === "submitting");
    this.sequenceContainer.setVisible(this.mode === "playback");
    this.infoContainer.setVisible(!(this.mode === "select" || this.mode === "submitting" || this.mode === "playback"));
    if (this.mode === "select" || this.mode === "submitting") {
      this.refreshSelectionDisplay();
      this.refreshCardHighlights();
    } else if (this.mode === "playback") {
      this.refreshSequencePanel();
    } else {
      this.refreshInfoPanel();
    }
  }

  private buildInfoPanel() {
    const w = this.cw;
    const y = this.panelY;
    this.infoContainer = this.add.container(0, 0).setVisible(false);
    this.infoContainer.add(this.add.rectangle(0, y, w, PANEL_H, 0x0d0704).setOrigin(0));
    this.infoContainer.add(this.add.rectangle(0, y - 1, w, 1, 0x3a2510).setOrigin(0));
    this.infoText = this.add
      .text(w / 2, y + 60, "", { fontSize: "20px", color: GOLD_STR, align: "center", wordWrap: { width: w - 80 } })
      .setOrigin(0.5);
    this.infoContainer.add(this.infoText);
  }

  private refreshInfoPanel() {
    const view = this.view;
    if (!view) return;
    // Rebuild the buttons each time: they depend on the mode.
    this.infoContainer.each((o: Phaser.GameObjects.GameObject) => {
      if (o.getData("button")) o.destroy();
    });
    this.infoText.setText(this.statusLine());
    const y = this.panelY + 130;
    const buttons: { label: string; onClick: () => void }[] = [];
    if (this.mode === "waiting" && this.myIndex >= 0) {
      if (view.phase === "planning") buttons.push({ label: "Resign", onClick: () => void this.resign() });
      if (view.timeoutAt > 0 && Date.now() / 1000 > view.timeoutAt) {
        buttons.push({ label: view.phase === "waiting" ? "Cancel game" : "Claim timeout", onClick: () => void this.claimTimeout() });
      }
      if (view.phase === "waiting") buttons.push({ label: "Cancel game", onClick: () => void this.cancelGame() });
    }
    if (view.lastTurn) buttons.push({ label: "Replay", onClick: () => void this.openReplay() });
    buttons.push({ label: "Back to lobby", onClick: () => this.scene.start("LobbyScene", { splash: false }) });
    const gap = 24;
    const widths = buttons.map((b) => b.label.length * 9 + 40);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (buttons.length - 1);
    let x = this.cw / 2 - total / 2;
    buttons.forEach((b, i) => {
      const t = this.add
        .text(x + widths[i] / 2, y, b.label, BTN_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setData("button", true);
      t.on("pointerup", b.onClick);
      this.infoContainer.add(t);
      x += widths[i] + gap;
    });
    if (this.mode === "waiting" && view.phase === "planning" && view.timeoutAt > 0) {
      const t = this.add
        .text(this.cw / 2, y + 60, `Timeout can be claimed after ${new Date(view.timeoutAt * 1000).toLocaleTimeString()}`, {
          fontSize: "13px",
          color: DIM_STR,
        })
        .setOrigin(0.5)
        .setData("button", true);
      this.infoContainer.add(t);
    }
  }

  // ── Card strip ────────────────────────────────────────────────────────────

  private buildCardStrip() {
    const w = this.cw;
    const stripY = this.panelY;
    this.cardContainer = this.add.container(0, 0).setVisible(false);
    this.cardContainer.add(this.add.rectangle(0, stripY, w, PANEL_H, 0x0d0704).setOrigin(0));
    this.cardContainer.add(this.add.rectangle(0, stripY - 1, w, 1, 0x3a2510).setOrigin(0));

    this.selectedDisplay = this.add.text(16, stripY + 8, "", { fontSize: "14px", color: "#888", wordWrap: { width: w - 260 } });
    this.cardContainer.add(this.selectedDisplay);

    this.sendBtn = this.add
      .text(w - 16, stripY + 6, "Send plan", { fontSize: "15px", color: GOLD_STR, backgroundColor: "#2a1500", padding: { x: 12, y: 5 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.sendBtn.on("pointerup", () => void this.sendPlan());
    this.cardContainer.add(this.sendBtn);

    const resign = this.add
      .text(w - 130, stripY + 6, "Resign", { fontSize: "13px", color: DIM_STR, backgroundColor: "#2a1500", padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    resign.on("pointerup", () => void this.resign());
    this.cardContainer.add(resign);

    const replay = this.add
      .text(w - 200, stripY + 6, "Replay", { fontSize: "13px", color: DIM_STR, backgroundColor: "#2a1500", padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    replay.on("pointerup", () => void this.openReplay());
    this.cardContainer.add(replay);

    const totalCardsW = 12 * (CARD_W + CARD_GAP) - CARD_GAP;
    const startX = (w - totalCardsW) / 2;
    const frontY = stripY + 34;
    const backY = frontY + CARD_H + CARD_ROW_GAP;
    for (let row = 0; row < 2; row++) {
      const side: CardSide = row === 0 ? "front" : "back";
      const cardY = row === 0 ? frontY : backY;
      for (let i = 0; i < 12; i++) {
        const card = (i + 1) as CardNumber;
        const x = startX + i * (CARD_W + CARD_GAP);
        const hl = this.add
          .rectangle(x + CARD_W / 2, cardY + CARD_H / 2, CARD_W + 4, CARD_H + 4, 0x000000, 0)
          .setStrokeStyle(2, GOLD, 0);
        this.cardContainer.add(hl);
        this.cardHighlights.push(hl);
        const texKey = side === "front" ? `action_card_a${card}` : `action_card_a${card}_back`;
        const img = this.add.image(x + CARD_W / 2, cardY + CARD_H / 2, texKey).setDisplaySize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
        img.setData("card", card);
        img.setData("side", side);
        img.on("pointerup", () => {
          if (this.mode === "select") this.toggleCard(card, side);
        });
        this.cardContainer.add(img);
        this.cardImages.push(img);
      }
    }
  }

  private cardIdx(card: CardNumber, side: CardSide): number {
    return side === "front" ? card - 1 : 12 + card - 1;
  }

  private isSelected(card: CardNumber, side: CardSide): boolean {
    return this.selectionOrder.some((e) => e.card === card && e.side === side);
  }

  /** The plan in selection order, with the committed directions. */
  private currentPlan(): PlanEntry[] {
    return this.selectionOrder.map((e) => {
      const dir = this.pendingChoices.get(e.card);
      return dir ? { ...e, dir } : { card: e.card, side: e.side };
    });
  }

  private budget(): number {
    const me = this.myIndex >= 0 ? this.committed[this.myIndex] : null;
    return Math.max(0, MAX_ACTION_POINTS - (me?.delay ?? 0));
  }

  private clearSelection() {
    this.selectionOrder = [];
    this.pendingChoices.clear();
    this.preview = null;
    this.choiceMode = null;
    this.clearChoiceOverlays();
  }

  private toggleCard(card: CardNumber, side: CardSide) {
    // While a choice is pending, only that card can be touched (to deselect it).
    if (this.choiceMode && !(card === this.choiceMode.card && side === this.choiceMode.side)) return;
    const def = getActionDef({ card, side });
    const wasSelected = this.isSelected(card, side);
    const otherSelected = this.isSelected(card, side === "front" ? "back" : "front");
    if (!wasSelected) {
      if (otherSelected || !isEnabled({ card, side })) return;
      if (planCost(this.currentPlan()) + def.cost > this.budget()) return;
    }
    this.exitChoiceMode();

    if (wasSelected) {
      // Only the last selected card can be deselected: choices are relative to the state before it.
      const last = this.selectionOrder[this.selectionOrder.length - 1];
      if (!last || last.card !== card || last.side !== side) return;
      this.selectionOrder.pop();
      this.pendingChoices.delete(card);
    } else {
      this.selectionOrder.push({ card, side });
      if (def.choiceType !== "none") this.enterChoiceMode(card, side, def.choiceType);
    }
    this.updatePreview();
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private refreshSelectionDisplay() {
    if (!this.selectedDisplay) return;
    const plan = this.currentPlan();
    const cost = planCost(plan);
    const budget = this.budget();
    const me = this.myIndex >= 0 ? this.view?.players[this.myIndex] : null;
    const name = me ? charName(me.char) : "";
    if (this.mode === "submitting") {
      this.selectedDisplay.setText("Signing your plan in Adena…").setColor(GOLD_STR);
    } else if (this.choiceMode) {
      this.selectedDisplay.setText(`${name}: ${choicePrompt(this.choiceMode.choiceType)}`).setColor("#ff9944");
    } else if (plan.length === 0) {
      const carry = me && me.delay > 0 ? ` (${me.delay} carried delay)` : "";
      this.selectedDisplay.setText(`${name}: select action cards, or send an empty plan to pass (0/${budget} points${carry})`).setColor("#888");
    } else {
      const names = plan.map((e) => {
        const def = getActionDef(e);
        return e.dir ? `${def.name}(${def.cost})→${e.dir.replace(/_/g, " ")}` : `${def.name}(${def.cost})`;
      });
      const problem = validatePlan(plan, budget);
      this.selectedDisplay.setText(`${name}: ${names.join(" + ")} = ${cost}/${budget} points${problem ? `  ⚠ ${problem}` : ""}`);
      this.selectedDisplay.setColor(problem ? "#ff9944" : GOLD_STR);
    }
    const canSend = this.mode === "select" && !this.choiceMode && validatePlan(plan, budget) === null;
    this.sendBtn.setColor(canSend ? GOLD_STR : "#555");
  }

  private refreshCardHighlights() {
    const plan = this.currentPlan();
    const cost = planCost(plan);
    const budget = this.budget();
    const last = this.selectionOrder[this.selectionOrder.length - 1];
    for (let i = 0; i < this.cardImages.length; i++) {
      const img = this.cardImages[i];
      const hl = this.cardHighlights[i];
      const card = img.getData("card") as CardNumber;
      const side = img.getData("side") as CardSide;
      const def = getActionDef({ card, side });
      const selected = this.isSelected(card, side);
      const otherSelected = this.isSelected(card, side === "front" ? "back" : "front");
      const needsChoice = def.choiceType !== "none" && !this.pendingChoices.has(card);
      const wouldExceed = !selected && cost + def.cost > budget;
      const blockedByChoice = !!this.choiceMode && !(card === this.choiceMode.card && side === this.choiceMode.side);
      const isLast = selected && !!last && last.card === card && last.side === side;
      hl.setFillStyle(0x000000, 0);
      if (selected && needsChoice) {
        hl.setStrokeStyle(3, 0xff6600, 1);
        hl.setFillStyle(0xff6600, 0.15);
        img.setAlpha(1);
      } else if (selected && isLast) {
        hl.setStrokeStyle(3, GOLD, 1);
        hl.setFillStyle(GOLD, 0.15);
        img.setAlpha(blockedByChoice ? 0.5 : 1);
      } else if (selected) {
        hl.setStrokeStyle(2, GOLD, 0.5);
        hl.setFillStyle(GOLD, 0.1);
        img.setAlpha(0.6);
      } else {
        hl.setStrokeStyle(2, GOLD, 0);
        const usable = !blockedByChoice && !otherSelected && !wouldExceed && isEnabled({ card, side });
        img.setAlpha(usable ? 1 : 0.3);
      }
    }
  }

  // ── Choice mode ───────────────────────────────────────────────────────────

  private enterChoiceMode(card: CardNumber, side: CardSide, choiceType: ChoiceType) {
    this.exitChoiceMode();
    const me = this.preview ?? (this.myIndex >= 0 ? this.committed[this.myIndex] : null);
    if (!me) return;
    const rels = choiceType === "move_ahead" || choiceType === "turn_ahead" ? AHEAD_DIRS : BACK_DIRS;
    const isTurn = choiceType === "turn_ahead" || choiceType === "turn_back";
    const from = BOARD_A.hexPos(me.hex);
    const options = rels
      .map((rel) => {
        const abs = relativeToAbsoluteDir(me.facing, rel);
        const hex = BOARD_A.neighbor(me.hex, abs);
        const a = (DIR_ANGLE[abs] * Math.PI) / 180;
        const pos = hex ? BOARD_A.hexPos(hex) : { x: from.x + Math.cos(a) * HEX_SPACING, y: from.y + Math.sin(a) * HEX_SPACING };
        return { rel, hex, x: pos.x, y: pos.y };
      })
      .filter((o) => isTurn || o.hex !== null);
    this.choiceMode = { card, side, choiceType, options };
    this.showChoiceOverlays();
  }

  private showChoiceOverlays() {
    this.clearChoiceOverlays();
    if (!this.choiceMode) return;
    const { scale } = this.displayTransform();
    const r = Math.max(12, HEX_HIGHLIGHT_R * scale * 3);
    for (const opt of this.choiceMode.options) {
      const { sx, sy } = this.boardToScreen(opt.x, opt.y);
      const circle = this.add
        .circle(sx, sy, r, 0x44cc44, 0.35)
        .setStrokeStyle(2, 0x44cc44, 0.9)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true })
        .setDepth(500);
      const label = this.add
        .text(sx, sy, opt.rel.replace(/_/g, "\n"), { fontSize: "10px", color: "#fff", align: "center" })
        .setOrigin(0.5)
        .setMask(this.arrMask)
        .setDepth(501);
      circle.on("pointerup", () => this.resolveChoice(opt.rel));
      this.choiceOverlays.push(circle, label);
    }
  }

  private clearChoiceOverlays() {
    for (const o of this.choiceOverlays) o.destroy();
    this.choiceOverlays = [];
  }

  private resolveChoice(rel: RelativeDirection) {
    if (!this.choiceMode) return;
    this.pendingChoices.set(this.choiceMode.card, rel);
    this.exitChoiceMode();
    this.updatePreview();
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private exitChoiceMode() {
    this.choiceMode = null;
    this.clearChoiceOverlays();
  }

  /** Recomputes where the plan leaves my character and animates the token there. */
  private updatePreview() {
    if (this.myIndex < 0 || !this.committed[this.myIndex]) return;
    this.preview = replayPlan(this.committed[this.myIndex], this.currentPlan(), BOARD_A);
    this.refreshTokens(true);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private async sendPlan() {
    if (this.mode !== "select" || this.choiceMode || !this.view) return;
    const plan = this.currentPlan();
    const problem = validatePlan(plan, this.budget());
    if (problem) {
      showToast(this, problem, "error");
      return;
    }
    this.mode = "submitting";
    this.refreshPanels();
    this.refreshHUD();
    try {
      await this.chain.realm.submitPlan(this.gameID, encodePlan(plan));
      if (!this.scene.isActive()) return;
      this.clearSelection();
      this.mode = "waiting";
      this.refreshTokens(true);
      this.refreshPanels();
      this.refreshHUD();
      await this.poller?.pokeNow();
    } catch (e) {
      if (!this.scene.isActive()) return;
      showToast(this, userMessage(e), "error");
      this.mode = "select";
      this.refreshPanels();
      this.refreshHUD();
      void this.poller?.pokeNow();
    }
  }

  private async resign() {
    await this.act(() => this.chain.realm.resign(this.gameID), "Resigned");
  }

  private async claimTimeout() {
    await this.act(() => this.chain.realm.claimTimeout(this.gameID), "Timeout claimed");
  }

  private async cancelGame() {
    await this.act(() => this.chain.realm.cancelGame(this.gameID), "Game cancelled");
  }

  private async act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      if (this.scene.isActive()) showToast(this, done, "info");
    } catch (e) {
      if (this.scene.isActive()) showToast(this, userMessage(e), "error");
    }
    await this.poller?.pokeNow();
  }

  // ── Replay of resolved turns ──────────────────────────────────────────────

  private buildSequencePanel() {
    const w = this.cw;
    const y = this.panelY;
    this.sequenceContainer = this.add.container(0, 0).setVisible(false);
    this.sequenceContainer.add(this.add.rectangle(0, y, w, PANEL_H, 0x0d0704).setOrigin(0));
    this.sequenceContainer.add(this.add.rectangle(0, y - 1, w, 1, 0x3a2510).setOrigin(0));
    this.seqTitle = this.add.text(w / 2, y + 26, "", { fontSize: "22px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0.5);
    // One dot per segment; clicking a dot jumps to the state after that segment.
    this.seqDots = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const dot = this.add
        .text(w / 2 + (i - (SEGMENTS - 1) / 2) * 36, y + 62, "○", { fontSize: "30px", color: GOLD_STR })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      dot.on("pointerup", () => {
        if (this.playback) this.stepTo({ index: this.playback.index, seg: i + 1 });
      });
      this.seqDots.push(dot);
    }
    this.seqLog = this.add
      .text(w / 2, y + 100, "", { fontSize: "14px", color: "#e8d5b0", align: "center", wordWrap: { width: w - 80 } })
      .setOrigin(0.5, 0);
    this.sequenceContainer.add([this.seqTitle, ...this.seqDots, this.seqLog]);

    const btn = (x: number, by: number, label: string, onClick: () => void) => {
      const t = this.add.text(x, by, label, BTN_STYLE).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on("pointerup", onClick);
      this.sequenceContainer.add(t);
      return t;
    };
    const row1 = y + PANEL_H - 96;
    const row2 = y + PANEL_H - 46;
    this.prevTurnBtn = btn(w / 2 - 150, row1, "◀ Turn", () => this.jumpTurn(-1));
    this.playBtn = btn(w / 2, row1, "Play", () => this.toggleAuto());
    this.nextTurnBtn = btn(w / 2 + 150, row1, "Turn ▶", () => this.jumpTurn(1));
    this.prevSeqBtn = btn(w / 2 - 150, row2, "Previous", () => this.stepPlayback(-1));
    this.nextSeqBtn = btn(w / 2, row2, "Next", () => this.stepPlayback(1));
    this.closeReplayBtn = btn(w / 2 + 150, row2, "Close", () => this.finishPlayback());
  }

  /**
   * Shows the given turns from the start of the first one. live is a turn
   * that just resolved: closing it re-syncs the board and moves on.
   */
  private startPlayback(turns: TurnResult[], live: boolean) {
    this.stopAuto();
    this.clearSelection();
    this.playback = { turns, index: 0, seg: 0, live, auto: null };
    this.mode = "playback";
    this.refreshTokens(true);
    this.refreshPanels();
    this.refreshHUD();
  }

  /** Replays the whole showdown so far, from the chain's history. */
  private async openReplay() {
    if (!this.view || this.mode === "playback" || this.mode === "submitting") return;
    try {
      const history = await this.chain.realm.getHistory(this.gameID);
      if (!this.scene.isActive() || this.playback) return;
      if (history.turns.length === 0) {
        showToast(this, "No turn has been played yet", "info");
        return;
      }
      if (this.mode === "select" && this.selectionOrder.length > 0) {
        this.stashedPlan = { turn: this.view.turn, order: [...this.selectionOrder], choices: new Map(this.pendingChoices) };
      }
      this.startPlayback(history.turns, false);
    } catch (e) {
      if (this.scene.isActive()) showToast(this, userMessage(e), "error");
    }
  }

  private stepTo(pos: ReplayPos | null) {
    if (!this.playback || !pos) return;
    this.playback.index = pos.index;
    this.playback.seg = pos.seg;
    this.refreshTokens(true);
    this.refreshSequencePanel();
  }

  private stepPlayback(delta: 1 | -1) {
    const pb = this.playback;
    if (!pb) return;
    const pos = { index: pb.index, seg: pb.seg };
    this.stepTo(delta > 0 ? stepForward(pos, pb.turns.length) : stepBack(pos));
  }

  private jumpTurn(delta: 1 | -1) {
    const pb = this.playback;
    if (!pb) return;
    const index = Phaser.Math.Clamp(pb.index + delta, 0, pb.turns.length - 1);
    if (index !== pb.index) this.stepTo({ index, seg: 0 });
  }

  private toggleAuto() {
    const pb = this.playback;
    if (!pb) return;
    if (pb.auto) {
      this.stopAuto();
    } else {
      pb.auto = this.time.addEvent({
        delay: 900,
        loop: true,
        callback: () => {
          const cur = this.playback;
          if (!cur) return;
          const next = stepForward({ index: cur.index, seg: cur.seg }, cur.turns.length);
          if (next) this.stepTo(next);
          else this.stopAuto();
        },
      });
    }
    this.refreshSequencePanel();
  }

  private stopAuto() {
    if (this.playback?.auto) {
      this.playback.auto.remove();
      this.playback.auto = null;
    }
  }

  private refreshSequencePanel() {
    const pb = this.playback;
    if (!pb || !this.seqTitle) return;
    const t = pb.turns[pb.index];
    const names = this.view?.players.map((p) => charName(p.char)) ?? [];
    const which = pb.turns.length > 1 ? `Turn ${t.turn} of ${pb.turns[pb.turns.length - 1].turn}` : `Turn ${t.turn}`;
    this.seqTitle.setText(pb.seg === 0 ? `${which}: start` : `${which}: segment ${pb.seg} of ${SEGMENTS}`);
    this.seqDots.forEach((dot, i) => dot.setText(i < pb.seg ? "●" : "○").setAlpha(i + 1 === pb.seg ? 1 : 0.7));
    let lines: string[];
    if (pb.seg === 0) {
      lines = ["Plans: " + t.plans.map((p, i) => `${names[i]}: ${p || "pass"}`).join("  ·  ")];
    } else {
      lines = eventsForSegment(t.events, pb.seg).map((e) => describeEvent(e, names));
      if (pb.seg === SEGMENTS) lines.push(...endOfTurnEvents(t.events).map((e) => describeEvent(e, names)));
      if (lines.length === 0) lines = ["Nothing happens."];
    }
    this.seqLog.setText(lines.join("\n"));
    const pos = { index: pb.index, seg: pb.seg };
    this.prevSeqBtn.setAlpha(stepBack(pos) ? 1 : 0.3);
    this.nextSeqBtn.setAlpha(stepForward(pos, pb.turns.length) ? 1 : 0.3);
    this.prevTurnBtn.setAlpha(pb.index > 0 ? 1 : 0.3);
    this.nextTurnBtn.setAlpha(pb.index < pb.turns.length - 1 ? 1 : 0.3);
    this.playBtn.setText(pb.auto ? "Pause" : "Play");
    this.closeReplayBtn.setText(pb.live ? "End turn" : "Close");
  }

  /** Leaves the replay: a live turn is marked as shown, then the board re-syncs. */
  private finishPlayback() {
    const pb = this.playback;
    if (!pb) return;
    this.stopAuto();
    if (pb.live) this.shownResultTurn = pb.turns[pb.turns.length - 1].turn;
    this.playback = null;
    const view = this.view;
    // A turn resolved while the history was open: show it live now.
    if (!pb.live && view?.lastTurn && view.lastTurn.turn !== this.shownResultTurn) {
      this.stashedPlan = null;
      this.startPlayback([view.lastTurn], true);
      return;
    }
    this.applyState(false);
    const stash = this.stashedPlan;
    this.stashedPlan = null;
    if (stash && this.mode === "select" && view && stash.turn === view.turn) {
      this.selectionOrder = stash.order;
      this.pendingChoices = stash.choices;
      this.updatePreview();
      this.refreshSelectionDisplay();
      this.refreshCardHighlights();
    }
  }

  // ── Input (zoom, pan) ─────────────────────────────────────────────────────

  private setupInput() {
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (pointer.y <= HUD_H || pointer.y >= this.panelY) return;
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
      if (this.zoom > MIN_ZOOM && pointer.isDown && pointer.y > HUD_H && pointer.y < this.panelY) {
        const dx = pointer.x - this.dragStartX;
        const dy = pointer.y - this.dragStartY;
        if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) this.isDragging = true;
        if (this.isDragging) {
          this.panX = this.panStartX + dx;
          this.panY = this.panStartY + dy;
          this.refreshView();
        }
      }
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > HUD_H && pointer.y < this.panelY) {
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.panStartX = this.panX;
        this.panStartY = this.panY;
        this.isDragging = false;
      }
    });
    this.input.on("pointerup", () => {
      this.isDragging = false;
    });
  }
}

function choicePrompt(ct: ChoiceType): string {
  switch (ct) {
    case "move_ahead":
      return "click a highlighted hex to move to";
    case "move_back":
      return "click a highlighted hex to back up to";
    case "turn_ahead":
    case "turn_back":
      return "click a highlighted hex to face toward";
    default:
      return "choose a target";
  }
}
