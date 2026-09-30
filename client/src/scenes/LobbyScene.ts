import Phaser from "phaser";
import { CHAR_ARROW_DIR } from "../rules";
import { CONFIG } from "../config";
import { initChain, resetChain, type Chain } from "../chain";
import { subscribeAccountChanged, subscribeNetworkChanged } from "../chain/adena";
import { userMessage } from "../chain/errors";
import { shortAddr, type GameSummary, type GamesView } from "../chain/types";
import { showToast } from "../ui/toast";

/** All character tokens, for the picker that will come back later. */
export const CHARACTERS = Object.keys(CHAR_ARROW_DIR);

/** Default characters until players can pick their own: creator and joiner. */
export const CREATOR_CHAR = "marshal";
export const JOINER_CHAR = "fast_eddie";

const TOPBAR_H = 56;
const BOTTOM_H = 72;
const ROW_H = 34;
const GOLD = 0xd4a044;
const GOLD_STR = "#d4a044";
const DIM_STR = "#8a7150";

interface Row {
  label: string;
  sub?: string;
  button?: { text: string; onClick: () => void };
}

/**
 * Lobby: connects Adena, lists open games to join and the player's own games
 * to resume, and creates a game.
 */
export class LobbyScene extends Phaser.Scene {
  private chain: Chain | null = null;
  private status: "connecting" | "ready" | "error" = "connecting";
  private errorMsg = "";
  private games: GamesView | null = null;
  private gamesKey = "";
  private busy = false;
  private refreshTimer: Phaser.Time.TimerEvent | null = null;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    super({ key: "LobbyScene" });
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
    void this.connect();
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
            if (this.scene.isActive()) void this.connect();
          }),
          subscribeNetworkChanged(() => {
            if (this.scene.isActive()) void this.connect();
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
    this.buildTopBar();
    if (this.status === "ready") this.buildLists();
    this.buildBottomBar();
  }

  private buildTopBar() {
    const w = this.scale.width;
    this.add.rectangle(0, 0, w, TOPBAR_H, 0x0f0804).setOrigin(0);
    this.add.text(16, TOPBAR_H / 2, "GUNSLINGER", { fontSize: "24px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0, 0.5);
    this.add
      .text(170, TOPBAR_H / 2, "showdowns on the gno.land chain", { fontSize: "13px", color: DIM_STR })
      .setOrigin(0, 0.5);

    if (this.status === "ready" && this.chain) {
      const addr = this.chain.wallet.address;
      this.add
        .text(w - 16, TOPBAR_H / 2, `${shortAddr(addr)}  ·  ${this.chain.config.chainId}`, { fontSize: "14px", color: GOLD_STR })
        .setOrigin(1, 0.5);
    } else if (this.status === "connecting") {
      this.add.text(w - 16, TOPBAR_H / 2, "Connecting to Adena…", { fontSize: "14px", color: DIM_STR }).setOrigin(1, 0.5);
    } else {
      this.makeButton(w - 60, TOPBAR_H / 2, 88, 32, "Retry", () => void this.connect());
      this.add
        .text(w - 116, TOPBAR_H / 2, this.errorMsg, { fontSize: "13px", color: "#ff8866", wordWrap: { width: Math.max(160, w - 400) } })
        .setOrigin(1, 0.5);
    }
  }

  private buildLists() {
    const w = this.scale.width;
    const h = this.scale.height;
    const top = TOPBAR_H + 16;
    const bottom = h - BOTTOM_H - 12;
    const colW = Math.floor((w - 48) / 2);
    const me = this.chain?.wallet.address ?? "";
    const games = this.games;

    const open: Row[] = (games?.open ?? [])
      .filter((g) => g.players[0]?.addr !== me)
      .map((g) => ({
        label: `Game ${g.id}`,
        sub: `${charName(g.players[0]?.char)} by ${shortAddr(g.players[0]?.addr ?? "")}`,
        button: this.busy ? undefined : { text: `Join as ${charName(JOINER_CHAR)}`, onClick: () => this.joinGame(g.id) },
      }));
    const mine: Row[] = (games?.mine ?? []).map((g) => ({
      label: `Game ${g.id}  ·  ${summaryLine(g)}`,
      sub: `${charName(g.players[0]?.char)} vs ${g.players[1]?.addr ? charName(g.players[1].char) : "?"}${seatNote(g, me)}`,
      button: this.busy ? undefined : { text: "Open", onClick: () => this.scene.start("GameScene", { gameID: g.id }) },
    }));

    this.drawList(16, top, colW, bottom - top, "Open games", games ? open : null, "No game is waiting for an opponent.");
    this.drawList(32 + colW, top, colW, bottom - top, "My games", games ? mine : null, "You have no game yet.");
  }

  private drawList(x: number, y: number, w: number, h: number, title: string, rows: Row[] | null, empty: string) {
    this.add.rectangle(x, y, w, h, 0x120b04).setOrigin(0).setStrokeStyle(1, 0x3a2510);
    this.add.text(x + 12, y + 10, title, { fontSize: "18px", color: GOLD_STR, fontStyle: "bold" });
    if (!rows) {
      this.add.text(x + 12, y + 44, "Loading…", { fontSize: "14px", color: DIM_STR });
      return;
    }
    if (rows.length === 0) {
      this.add.text(x + 12, y + 44, empty, { fontSize: "14px", color: DIM_STR });
      return;
    }
    const max = Math.max(1, Math.floor((h - 44) / (ROW_H + 8)));
    rows.slice(0, max).forEach((row, i) => {
      const ry = y + 44 + i * (ROW_H + 8);
      this.add.rectangle(x + 8, ry, w - 16, ROW_H + 2, 0x1f1207).setOrigin(0);
      this.add.text(x + 16, ry + 4, row.label, { fontSize: "14px", color: "#e8d5b0" });
      if (row.sub) this.add.text(x + 16, ry + 20, row.sub, { fontSize: "11px", color: DIM_STR });
      if (row.button) {
        const bw = Math.min(170, w / 2.6);
        this.makeButton(x + w - 16 - bw / 2, ry + ROW_H / 2 + 1, bw, 28, row.button.text, row.button.onClick);
      }
    });
    if (rows.length > max) {
      this.add.text(x + 12, y + h - 20, `+${rows.length - max} more`, { fontSize: "11px", color: DIM_STR });
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
        wordWrap: { width: Math.max(160, w - 260) },
      })
      .setOrigin(0, 0.5);
    if (this.status === "ready") {
      this.makeButton(w - 16 - 90, y + BOTTOM_H / 2, 180, 34, this.busy ? "Signing…" : "Create a game", () => {
        if (!this.busy) this.createGame();
      });
    }
  }

  private makeButton(cx: number, cy: number, bw: number, bh: number, label: string, onClick: () => void) {
    const bg = this.add.graphics();
    const draw = (fill: number) => {
      bg.clear();
      bg.fillStyle(fill, 1);
      bg.fillRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 5);
      bg.lineStyle(1.5, GOLD, 1);
      bg.strokeRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 5);
    };
    draw(0x3a1f00);
    this.add.text(cx, cy, label, { fontSize: `${Math.min(15, bh - 12)}px`, color: GOLD_STR, fontStyle: "bold" }).setOrigin(0.5);
    const zone = this.add.zone(cx, cy, bw, bh).setInteractive({ useHandCursor: true });
    zone.on("pointerover", () => draw(0x5a3200));
    zone.on("pointerout", () => draw(0x3a1f00));
    zone.on("pointerup", onClick);
  }
}

function charName(key: string | undefined): string {
  return (key ?? "?").replace(/_/g, " ");
}

function summaryLine(g: GameSummary): string {
  switch (g.phase) {
    case "waiting":
      return "waiting for an opponent";
    case "planning":
      return `turn ${g.turn}/${g.maxTurns}`;
    default:
      return "finished";
  }
}

function seatNote(g: GameSummary, me: string): string {
  const seat = g.players.findIndex((p) => p.addr === me);
  return seat >= 0 ? `  (you: ${charName(g.players[seat].char)})` : "";
}
