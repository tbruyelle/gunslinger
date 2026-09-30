import Phaser from "phaser";
import { CHAR_ARROW_DIR } from "../rules";
import { CONFIG } from "../config";
import { initChain, resetChain, type Chain } from "../chain";
import { subscribeAccountChanged, subscribeNetworkChanged } from "../chain/adena";
import { userMessage } from "../chain/errors";
import { formatCoins } from "../chain/rpc";
import { shortAddr, type GameSummary, type GamesView } from "../chain/types";
import { showToast } from "../ui/toast";

/** All character tokens, for the picker that will come back later. */
export const CHARACTERS = Object.keys(CHAR_ARROW_DIR);

/** Default characters until players can pick their own: creator and joiner. */
export const CREATOR_CHAR = "marshal";
export const JOINER_CHAR = "fast_eddie";

const TOPBAR_H = 56;
const BOTTOM_H = 44;
const ROW_H = 34;
const PANEL_PAD = 16; // margin around and inside the game panels
const GOLD = 0xd4a044;
const GOLD_STR = "#d4a044";
const DIM_STR = "#8a7150";
const DIM_HEX = 0x8a7150;
const SUBTITLE = "showdowns on the gno.land chain";

interface Row {
  label: string;
  sub?: string;
  button?: { text: string; onClick: () => void };
}

/**
 * Lobby: shows the splash screen, then connects Adena, lists open games to
 * join and the player's own games to resume, and creates a game.
 */
export class LobbyScene extends Phaser.Scene {
  private screen: "splash" | "lobby" = "splash";
  private chain: Chain | null = null;
  private status: "connecting" | "ready" | "error" = "connecting";
  private errorMsg = "";
  private games: GamesView | null = null;
  private gamesKey = "";
  private busy = false;
  private accountPanel = false;
  private balance: string | null = null;
  private refreshTimer: Phaser.Time.TimerEvent | null = null;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    super({ key: "LobbyScene" });
  }

  /** Coming back from a game passes { splash: false } to land on the lists directly. */
  init(data?: { splash?: boolean }) {
    this.screen = data?.splash === false ? "lobby" : "splash";
    this.chain = null;
    this.status = "connecting";
    this.games = null;
    this.gamesKey = "";
    this.busy = false;
    this.accountPanel = false;
  }

  create() {
    this.buildAll();
    const onResize = () => this.buildAll();
    this.scale.on("resize", onResize);
    this.refreshTimer = this.time.addEvent({ delay: 5000, loop: true, callback: () => void this.refreshGames() });
    this.events.once("shutdown", () => {
      this.scale.off("resize", onResize);
      this.refreshTimer?.remove();
      for (const u of this.unsubscribe) u();
      this.unsubscribe = [];
    });
    if (this.screen === "lobby") void this.connect();
  }

  private enter() {
    this.screen = "lobby";
    void this.connect();
  }

  /** Forgets the connection in the app (Adena itself stays connected to the site) and shows the splash again. */
  private quit() {
    resetChain();
    this.chain = null;
    this.status = "connecting";
    this.games = null;
    this.gamesKey = "";
    this.accountPanel = false;
    this.screen = "splash";
    this.buildAll();
  }

  private async loadBalance(addr: string) {
    this.balance = null;
    try {
      const coins = await this.chain!.rpc.balance(addr);
      this.balance = formatCoins(coins);
    } catch (e) {
      this.balance = `unavailable (${userMessage(e)})`;
    }
    if (this.scene.isActive() && this.accountPanel) this.buildAll();
  }

  private async copyAddress(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      showToast(this, "Address copied", "info", 2000);
    } catch {
      showToast(this, "Could not copy: " + addr, "error", 6000);
    }
  }

  // ── Chain ─────────────────────────────────────────────────────────────────

  private async connect() {
    this.status = "connecting";
    this.errorMsg = "";
    this.chain = null;
    this.buildAll();
    try {
      resetChain();
      this.chain = await initChain(CONFIG);
      this.status = "ready";
      if (this.unsubscribe.length === 0) {
        this.unsubscribe.push(
          subscribeAccountChanged(() => {
            if (this.scene.isActive() && this.screen === "lobby") void this.connect();
          }),
          subscribeNetworkChanged(() => {
            if (this.scene.isActive() && this.screen === "lobby") void this.connect();
          }),
        );
      }
      this.buildAll();
      await this.refreshGames();
    } catch (e) {
      this.status = "error";
      this.errorMsg = userMessage(e);
      this.buildAll();
    }
  }

  private async refreshGames() {
    if (!this.chain || !this.scene.isActive()) return;
    try {
      const games = await this.chain.realm.listGames(this.chain.wallet.address);
      const key = JSON.stringify(games);
      if (key !== this.gamesKey) {
        this.gamesKey = key;
        this.games = games;
        this.buildAll();
      }
    } catch (e) {
      showToast(this, userMessage(e), "error");
    }
  }

  /** Runs a wallet action; a returned game id opens the game. */
  private async run(action: () => Promise<string | null>) {
    if (this.busy || !this.chain) return;
    this.busy = true;
    this.buildAll();
    try {
      const id = await action();
      if (id) {
        this.scene.start("GameScene", { gameID: id });
        return;
      }
    } catch (e) {
      showToast(this, userMessage(e), "error");
    } finally {
      this.busy = false;
      if (this.scene.isActive()) {
        this.buildAll();
        void this.refreshGames();
      }
    }
  }

  private createGame() {
    void this.run(async () => {
      const chain = this.chain!;
      const r = await chain.realm.createGame(CREATOR_CHAR, 10);
      if (r.gameID) return r.gameID;
      // The tx result was not indexed in time: the game is the newest of ours.
      const games = await chain.realm.listGames(chain.wallet.address);
      return games.mine[0]?.id ?? null;
    });
  }

  private joinGame(id: string) {
    void this.run(async () => {
      await this.chain!.realm.joinGame(id, JOINER_CHAR);
      return id;
    });
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private buildAll() {
    this.children.removeAll(true);
    const w = this.scale.width;
    const h = this.scale.height;
    this.add.rectangle(0, 0, w, h, 0x1a1008).setOrigin(0);
    if (this.screen === "splash") {
      this.buildSplash();
      return;
    }
    this.buildTopBar();
    if (this.status === "ready") this.buildLists();
    this.buildBottomBar();
  }

  private buildSplash() {
    const w = this.scale.width;
    const h = this.scale.height;
    let subtitleY = h * 0.6;
    if (this.textures.exists("splash")) {
      const img = this.add.image(w / 2, h * 0.42, "splash");
      const scale = Math.min((h * 0.7) / img.height, (w - 40) / img.width);
      img.setScale(scale);
      subtitleY = img.y + (img.height * scale) / 2 + 22;
    } else {
      this.add.text(w / 2, h * 0.4, "GUNSLINGER", { fontSize: "48px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0.5);
    }
    this.add.text(w / 2, subtitleY + 6, SUBTITLE.toUpperCase(), { fontSize: "24px", color: GOLD_STR, letterSpacing: 6 }).setOrigin(0.5);
    this.makeButton(w / 2, subtitleY + 70, 260, 52, "Connect with Adena", () => this.enter(), "adena_icon");
  }

  private buildTopBar() {
    const w = this.scale.width;
    this.add.rectangle(0, 0, w, TOPBAR_H, 0x0f0804).setOrigin(0);
    this.add.text(16, TOPBAR_H / 2, "GUNSLINGER", { fontSize: "24px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0, 0.5);
    this.add
      .text(170, TOPBAR_H / 2, SUBTITLE, { fontSize: "13px", color: DIM_STR })
      .setOrigin(0, 0.5);

    if (this.status === "ready" && this.chain) {
      const addr = this.chain.wallet.address;
      const t = this.add
        .text(w - 16, TOPBAR_H / 2, `${shortAddr(addr)}  ·  ${this.chain.config.chainId} ▾`, { fontSize: "14px", color: GOLD_STR })
        .setOrigin(1, 0.5)
        .setInteractive({ useHandCursor: true });
      t.on("pointerover", () => t.setColor("#ffe2a0"));
      t.on("pointerout", () => t.setColor(GOLD_STR));
      t.on("pointerup", () => {
        this.accountPanel = !this.accountPanel;
        if (this.accountPanel) void this.loadBalance(addr);
        this.buildAll();
      });
      if (this.accountPanel) this.buildAccountPanel(addr);
    } else if (this.status === "connecting") {
      this.add.text(w - 16, TOPBAR_H / 2, "Connecting to Adena…", { fontSize: "14px", color: DIM_STR }).setOrigin(1, 0.5);
    } else {
      this.makeButton(w - 60, TOPBAR_H / 2, 88, 32, "Retry", () => void this.connect());
      this.add
        .text(w - 116, TOPBAR_H / 2, this.errorMsg, { fontSize: "13px", color: "#ff8866", wordWrap: { width: Math.max(160, w - 400) } })
        .setOrigin(1, 0.5);
    }
  }

  private buildAccountPanel(addr: string) {
    const w = this.scale.width;
    const pw = Math.min(460, w - 32);
    const ph = 152;
    const x = w - 16 - pw;
    const y = TOPBAR_H + 8;
    const chainId = this.chain?.config.chainId ?? "";
    const depth = 30; // above the game lists
    // A click anywhere outside the panel closes it: an invisible catcher
    // under the panel takes those clicks, and the panel body swallows its own.
    const backdrop = this.add.zone(0, 0, this.scale.width, this.scale.height).setOrigin(0).setInteractive().setDepth(depth - 1);
    backdrop.on("pointerup", () => {
      this.accountPanel = false;
      this.buildAll();
    });
    this.add.rectangle(x, y, pw, ph, 0x1f1207).setOrigin(0).setStrokeStyle(1, GOLD).setInteractive().setDepth(depth);
    this.add.text(x + 14, y + 12, "Connected account", { fontSize: "13px", color: DIM_STR }).setDepth(depth);
    const addrText = this.add
      .text(x + 14, y + 34, addr, { fontSize: "14px", color: "#e8d5b0", wordWrap: { width: pw - 28 - 28 } })
      .setDepth(depth);
    this.drawCopyIcon(addrText.x + addrText.width + 14, addrText.y + 9, depth + 1, () => void this.copyAddress(addr));
    this.add.text(x + 14, y + 58, `network ${chainId}`, { fontSize: "12px", color: DIM_STR }).setDepth(depth);
    this.add.text(x + 14, y + 80, `balance: ${this.balance ?? "…"}`, { fontSize: "14px", color: GOLD_STR }).setDepth(depth);
    this.drawCloseIcon(x + pw - 16, y + 16, depth + 1, () => {
      this.accountPanel = false;
      this.buildAll();
    });
    this.makeButton(x + pw - 14 - 60, y + ph - 28, 120, 30, "Disconnect", () => this.quit(), undefined, depth + 1);
  }

  /** A small cross centred on (cx, cy). */
  private drawCloseIcon(cx: number, cy: number, depth: number, onClick: () => void) {
    const g = this.add.graphics().setDepth(depth);
    const draw = (color: number) => {
      g.clear();
      g.lineStyle(2, color, 1);
      g.beginPath();
      g.moveTo(cx - 5, cy - 5);
      g.lineTo(cx + 5, cy + 5);
      g.moveTo(cx + 5, cy - 5);
      g.lineTo(cx - 5, cy + 5);
      g.strokePath();
    };
    draw(DIM_HEX);
    const zone = this.add.zone(cx, cy, 24, 24).setInteractive({ useHandCursor: true }).setDepth(depth);
    zone.on("pointerover", () => draw(0xffe2a0));
    zone.on("pointerout", () => draw(DIM_HEX));
    zone.on("pointerup", onClick);
  }

  /** A small "two sheets" copy icon centred on (cx, cy). */
  private drawCopyIcon(cx: number, cy: number, depth: number, onClick: () => void) {
    const g = this.add.graphics().setDepth(depth);
    const draw = (color: number) => {
      g.clear();
      g.lineStyle(1.5, color, 1);
      g.strokeRoundedRect(cx - 7, cy - 3, 10, 10, 2); // front sheet
      g.beginPath();
      g.moveTo(cx - 3, cy - 3);
      g.lineTo(cx - 3, cy - 7);
      g.lineTo(cx + 7, cy - 7);
      g.lineTo(cx + 7, cy + 3);
      g.lineTo(cx + 3, cy + 3);
      g.strokePath(); // back sheet, behind the front one
    };
    draw(GOLD);
    const zone = this.add.zone(cx, cy, 22, 22).setInteractive({ useHandCursor: true }).setDepth(depth);
    zone.on("pointerover", () => draw(0xffe2a0));
    zone.on("pointerout", () => draw(GOLD));
    zone.on("pointerup", onClick);
  }

  private buildLists() {
    const w = this.scale.width;
    const h = this.scale.height;
    const top = TOPBAR_H + PANEL_PAD;
    const bottom = h - BOTTOM_H - PANEL_PAD;
    const colW = Math.floor((w - 3 * PANEL_PAD) / 2);
    const me = this.chain?.wallet.address ?? "";
    const games = this.games;

    const open: Row[] = (games?.open ?? [])
      .filter((g) => g.players[0]?.addr !== me)
      .map((g) => ({
        label: `Game ${g.id}`,
        sub: `${charName(g.players[0]?.char)} by ${shortAddr(g.players[0]?.addr ?? "")}`,
        button: this.busy ? undefined : { text: "Join", onClick: () => this.joinGame(g.id) },
      }));
    const mine: Row[] = (games?.mine ?? []).map((g) => ({
      label: `Game ${g.id}  ·  ${summaryLine(g, me)}`,
      sub: g.players.map((p) => (p.addr ? charName(p.char) + (p.addr === me ? " (you)" : "") : "?")).join(" vs "),
      button: this.busy ? undefined : { text: "Open", onClick: () => this.scene.start("GameScene", { gameID: g.id }) },
    }));

    const create = { text: this.busy ? "Signing…" : "Create a game", onClick: () => {
      if (!this.busy) this.createGame();
    } };
    this.drawList(PANEL_PAD, top, colW, bottom - top, "My games", games ? mine : null, "You have no game yet.", create);
    this.drawList(2 * PANEL_PAD + colW, top, colW, bottom - top, "Open games", games ? open : null, "No game is waiting for an opponent.");
  }

  private drawList(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    rows: Row[] | null,
    empty: string,
    header?: { text: string; onClick: () => void },
  ) {
    // Same 16px inside the panel as the panel keeps from the window.
    const pad = PANEL_PAD;
    const headerH = 56;
    this.add.rectangle(x, y, w, h, 0x120b04).setOrigin(0).setStrokeStyle(1, 0x3a2510);
    this.add.text(x + pad, y + headerH / 2, title, { fontSize: "18px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0, 0.5);
    if (header) {
      const bw = Math.min(160, w / 2.4);
      this.makeButton(x + w - pad - bw / 2, y + headerH / 2, bw, 30, header.text, header.onClick);
    }
    const rowsY = y + headerH;
    if (!rows) {
      this.add.text(x + pad, rowsY, "Loading…", { fontSize: "14px", color: DIM_STR });
      return;
    }
    if (rows.length === 0) {
      this.add.text(x + pad, rowsY, empty, { fontSize: "14px", color: DIM_STR });
      return;
    }
    const max = Math.max(1, Math.floor((h - headerH - pad) / (ROW_H + 8)));
    rows.slice(0, max).forEach((row, i) => {
      const ry = rowsY + i * (ROW_H + 8);
      this.add.rectangle(x + pad, ry, w - 2 * pad, ROW_H + 2, 0x1f1207).setOrigin(0);
      this.add.text(x + pad + 8, ry + 4, row.label, { fontSize: "14px", color: "#e8d5b0" });
      if (row.sub) this.add.text(x + pad + 8, ry + 20, row.sub, { fontSize: "11px", color: DIM_STR });
      if (row.button) {
        const bw = Math.min(170, w / 2.6);
        this.makeButton(x + w - pad - 8 - bw / 2, ry + ROW_H / 2 + 1, bw, 28, row.button.text, row.button.onClick);
      }
    });
    if (rows.length > max) {
      this.add.text(x + pad, y + h - pad - 12, `+${rows.length - max} more`, { fontSize: "11px", color: DIM_STR });
    }
  }

  private buildBottomBar() {
    const w = this.scale.width;
    const h = this.scale.height;
    const y = h - BOTTOM_H;
    this.add.rectangle(0, y, w, BOTTOM_H, 0x0d0704).setOrigin(0);
    this.add.rectangle(0, y - 1, w, 1, 0x3a2510).setOrigin(0);
    this.add
      .text(16, y + BOTTOM_H / 2, `You play ${charName(CREATOR_CHAR)} in a game you create, ${charName(JOINER_CHAR)} in a game you join.`, {
        fontSize: "13px",
        color: DIM_STR,
        wordWrap: { width: Math.max(160, w - 32) },
      })
      .setOrigin(0, 0.5);
  }

  private makeButton(cx: number, cy: number, bw: number, bh: number, label: string, onClick: () => void, icon?: string, depth = 0) {
    const bg = this.add.graphics();
    const draw = (fill: number) => {
      bg.clear();
      bg.fillStyle(fill, 1);
      bg.fillRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 5);
      bg.lineStyle(1.5, GOLD, 1);
      bg.strokeRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 5);
    };
    draw(0x3a1f00);
    const text = this.add.text(cx, cy, label, { fontSize: `${Math.min(15, bh - 12)}px`, color: GOLD_STR, fontStyle: "bold" }).setOrigin(0.5);
    if (icon && this.textures.exists(icon)) {
      // Icon on the left, text and icon centred together.
      const size = bh - 16;
      const gap = 10;
      const total = size + gap + text.width;
      const img = this.add.image(cx - total / 2 + size / 2, cy, icon).setDisplaySize(size, size).setDepth(depth + 1);
      text.setX(img.x + size / 2 + gap + text.width / 2);
    }
    const zone = this.add.zone(cx, cy, bw, bh).setInteractive({ useHandCursor: true });
    zone.on("pointerover", () => draw(0x5a3200));
    zone.on("pointerout", () => draw(0x3a1f00));
    zone.on("pointerup", onClick);
    bg.setDepth(depth);
    text.setDepth(depth + 1);
    zone.setDepth(depth + 1);
  }
}

/** "fast_eddie" -> "Fast Eddie". */
export function charName(key: string | undefined): string {
  if (!key) return "?";
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function summaryLine(g: GameSummary, me: string): string {
  const who = (seat: number) => {
    const p = g.players[seat];
    return p?.addr ? charName(p.char) + (p.addr === me ? " (you)" : "") : "?";
  };
  switch (g.phase) {
    case "waiting":
      return "waiting for an opponent";
    case "planning":
      return `turn ${g.turn}/${g.maxTurns}`;
  }
  switch (g.endReason) {
    case "cancelled":
      return `cancelled by ${who(0)}`;
    case "expired":
      return "expired, nobody joined";
    case "resign":
      return `${who(1 - g.winner)} resigned`;
    case "timeout":
      return `${who(1 - g.winner)} timed out`;
    case "abandoned":
      return "abandoned";
    default:
      return g.winner >= 0 ? `won by ${who(g.winner)}` : `finished after ${g.turn} turns, draw`;
  }
}
