import { Room, Client } from "colyseus";
import type {
  PlacedBoardSetup,
  PlacedTokenSetup,
  ActionCardSelection,
  SequenceNumber,
} from "@gunslinger/shared";
import { getActionDef } from "@gunslinger/shared";
import {
  GameStateSchema,
  PlayerSchema,
  CharacterSchema,
  CharacterStatsSchema,
  WeaponSchema,
  PlacedBoardSchema,
  ActionCardSelectionSchema,
  PlayerCardsSchema,
} from "./schema";

interface RoomOptions {
  boards?: PlacedBoardSetup[];
  tokens?: PlacedTokenSetup[];
  maxTurns?: number;
  winCondition?: "last_standing" | "team";
}

/** Bulk card selection message: charKey → cards[]. */
type SelectCardsMessage = Record<string, ActionCardSelection[]>;

export class GameRoom extends Room<GameStateSchema> {
  maxClients = 6;

  onCreate(options: RoomOptions) {
    const state = new GameStateSchema();
    state.phase = "lobby";
    state.turn = 1;
    state.currentSequence = 1;
    state.maxTurns = options.maxTurns ?? 20;
    state.winCondition = options.winCondition ?? "last_standing";

    // Create board layout
    if (options.boards) {
      for (const b of options.boards) {
        const bs = new PlacedBoardSchema();
        bs.key = b.key;
        bs.rotation = b.rotation;
        bs.lx = b.lx;
        bs.ly = b.ly;
        state.boards.push(bs);
      }
    }

    // Create players from placed tokens (order = player order)
    if (options.tokens) {
      for (const token of options.tokens) {
        const player = new PlayerSchema();
        player.charKey = token.charKey;
        player.ownerSessionId = ""; // assigned on join

        const character = new CharacterSchema();
        character.id = token.charKey;
        character.name = token.charKey.replace(/_/g, " ");
        const stats = new CharacterStatsSchema();
        character.baseStats = stats;
        player.character = character;

        player.lx = token.lx;
        player.ly = token.ly;
        player.angle = token.angle;
        player.hexId = token.hexId ?? "";
        player.actionPoints = 10;
        player.maxActionPoints = 10;

        const weapon = new WeaponSchema();
        player.weapons.push(weapon);
        player.status = "alive";

        state.players.set(token.charKey, player);
        state.playerOrder.push(token.charKey);
      }
    }

    this.setState(state);

    // Bulk card selection: { charKey: cards[] }
    this.onMessage<SelectCardsMessage>("select_cards", (client, msg) => {
      this.handleSelectCards(client.sessionId, msg);
    });

    this.onMessage("ready", (client) => {
      this.handleReady(client.sessionId);
    });

    console.log(`Room created with ${state.playerOrder.length} characters, ${state.boards.length} boards`);
  }

  onJoin(client: Client) {
    // Assign ownership of all unowned characters to the joining client
    this.state.players.forEach(player => {
      if (!player.ownerSessionId) {
        player.ownerSessionId = client.sessionId;
      }
    });
    console.log(`${client.sessionId} joined. Controls ${this.getOwnedCharKeys(client.sessionId).length} characters.`);
  }

  onLeave(client: Client) {
    // Clear ownership
    this.state.players.forEach(player => {
      if (player.ownerSessionId === client.sessionId) {
        player.ownerSessionId = "";
      }
    });
    console.log(`${client.sessionId} left.`);

    if (this.state.phase !== "lobby" && this.state.phase !== "end") {
      this.checkGameOver();
    }
  }

  // ── Card selection ─────────────────────────────────────────────────────────

  private handleSelectCards(sessionId: string, allCards: SelectCardsMessage) {
    if (this.state.phase !== "action_selection") {
      this.sendError(sessionId, "Cards can only be selected during the action selection phase.");
      return;
    }

    // Validate each character belongs to this session and cards are valid
    for (const [charKey, cards] of Object.entries(allCards)) {
      const player = this.state.players.get(charKey);
      if (!player || player.ownerSessionId !== sessionId) {
        this.sendError(sessionId, `You don't control character "${charKey}".`);
        return;
      }
      if (player.status === "dead") continue;

      // Validate: no duplicate card numbers (can't use both sides of same card)
      // Cost is not required to equal SEQUENCES_PER_TURN — players may under- or over-fill

      const usedCards = new Set<number>();
      for (const sel of cards) {
        if (usedCards.has(sel.card)) {
          this.sendError(sessionId, `${charKey}: cannot use both sides of card ${sel.card}.`);
          return;
        }
        usedCards.add(sel.card);
      }
    }

    // Check all alive characters owned by this session are included
    const ownedAlive = this.getOwnedAliveCharKeys(sessionId);
    for (const charKey of ownedAlive) {
      if (!allCards[charKey]) {
        this.sendError(sessionId, `Missing card selection for "${charKey}".`);
        return;
      }
    }

    // Store selections
    for (const [charKey, cards] of Object.entries(allCards)) {
      const playerCards = new PlayerCardsSchema();
      for (const sel of cards) {
        const s = new ActionCardSelectionSchema();
        s.card = sel.card;
        s.side = sel.side;
        playerCards.cards.push(s);
      }
      this.state.selectedCards.set(charKey, playerCards);
    }

    console.log(`${sessionId} submitted cards for ${Object.keys(allCards).length} characters.`);

    if (this.allAliveHaveCards()) {
      this.startSequences();
    }
  }

  private handleReady(sessionId: string) {
    if (this.state.phase !== "lobby") return;
    if (this.state.playerOrder.length >= 2) {
      this.startTurn();
    }
    void sessionId;
  }

  // ── Phase machine ─────────────────────────────────────────────────────────

  private startTurn() {
    this.state.phase = "action_selection";
    this.state.currentSequence = 1;
    this.state.selectedCards.clear();
    this.resetActionPoints();
    console.log(`Room ${this.roomId}: Turn ${this.state.turn} — action selection`);
  }

  private startSequences() {
    this.state.phase = "sequence";
    this.state.currentSequence = 1;
    console.log(`Room ${this.roomId}: Turn ${this.state.turn} — sequence 1`);
    this.advanceSequence();
  }

  private advanceSequence() {
    // TODO: resolve actions for the current sequence here

    const seq = this.state.currentSequence;
    if (seq < 5) {
      this.state.currentSequence = (seq + 1) as SequenceNumber;
      console.log(`Room ${this.roomId}: Turn ${this.state.turn} — sequence ${this.state.currentSequence}`);
      this.clock.setTimeout(() => this.advanceSequence(), 1500);
    } else {
      this.endTurn();
    }
  }

  private endTurn() {
    this.state.phase = "turn_end";
    console.log(`Room ${this.roomId}: Turn ${this.state.turn} — turn end`);

    if (this.checkGameOver()) return;

    if (this.state.turn >= this.state.maxTurns) {
      this.state.phase = "end";
      console.log(`Room ${this.roomId}: Game over — max turns reached`);
      return;
    }

    this.clock.setTimeout(() => {
      this.state.turn += 1;
      this.startTurn();
    }, 2000);
  }

  // ── Game-over check ───────────────────────────────────────────────────────

  private checkGameOver(): boolean {
    const alive: string[] = [];
    this.state.players.forEach(p => {
      if (p.status !== "dead") alive.push(p.charKey);
    });

    if (this.state.winCondition === "last_standing" && alive.length <= 1) {
      this.state.phase = "end";
      console.log(`Room ${this.roomId}: Game over — ${alive[0] ?? "no one"} wins`);
      return true;
    }

    return false;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private allAliveHaveCards(): boolean {
    let allDone = true;
    this.state.players.forEach(p => {
      if (p.status !== "dead" && !this.state.selectedCards.has(p.charKey)) {
        allDone = false;
      }
    });
    return allDone;
  }

  private getOwnedCharKeys(sessionId: string): string[] {
    const keys: string[] = [];
    this.state.players.forEach(p => {
      if (p.ownerSessionId === sessionId) keys.push(p.charKey);
    });
    return keys;
  }

  private getOwnedAliveCharKeys(sessionId: string): string[] {
    const keys: string[] = [];
    this.state.players.forEach(p => {
      if (p.ownerSessionId === sessionId && p.status !== "dead") keys.push(p.charKey);
    });
    return keys;
  }

  private resetActionPoints() {
    this.state.players.forEach(player => {
      player.actionPoints = player.maxActionPoints;
    });
  }

  private sendError(sessionId: string, message: string) {
    const client = this.clients.find(c => c.sessionId === sessionId);
    client?.send("error", message);
  }
}
