import { Room, Client } from "colyseus";
import type { Action, GameState, Player, HexCoord } from "@gunslinger/shared";

export class GameRoom extends Room<GameState> {
  maxClients = 6;

  onCreate(_options: Record<string, unknown>) {
    this.setState(this.initialState());

    this.onMessage<Action>("action", (client, action) => {
      this.handleAction(client.sessionId, action);
    });

    this.onMessage("ready", (client) => {
      this.handleReady(client.sessionId);
    });
  }

  onJoin(client: Client) {
    const position: HexCoord = { q: 0, r: 0 };
    const player: Player = {
      sessionId: client.sessionId,
      character: {
        id: client.sessionId,
        name: `Gunfighter #${Object.keys(this.state.players).length + 1}`,
        baseStats: { speed: 3, gunSpeed: 5, accuracy: 0, strength: 5 },
      },
      position,
      facing: 0,
      actionPoints: 10,
      maxActionPoints: 10,
      wounds: [],
      weapons: [{ type: "revolver", loaded: 6, capacity: 6 }],
      activeWeaponIndex: 0,
      status: "alive",
    };

    this.state.players[client.sessionId] = player;
    console.log(`${client.sessionId} joined. Players: ${Object.keys(this.state.players).length}`);
  }

  onLeave(client: Client) {
    delete this.state.players[client.sessionId];
    console.log(`${client.sessionId} left.`);
  }

  // ── Action handling ─────────────────────────────────────────────────────────

  private handleAction(sessionId: string, action: Action) {
    if (this.state.phase !== "declare") {
      this.sendError(sessionId, "Actions can only be declared during the declare phase.");
      return;
    }
    if (!this.state.declaredActions[sessionId]) {
      this.state.declaredActions[sessionId] = [];
    }
    this.state.declaredActions[sessionId].push(action);

    // Once all alive players have declared, advance to resolution
    const alivePlayers = Object.values(this.state.players).filter(
      (p) => p.status === "alive"
    );
    const allDeclared = alivePlayers.every(
      (p) => (this.state.declaredActions[p.sessionId]?.length ?? 0) > 0
    );
    if (allDeclared) this.advancePhase();
  }

  private handleReady(sessionId: string) {
    if (this.state.phase !== "lobby") return;
    const allReady = Object.keys(this.state.players).length >= 2;
    if (allReady) this.advancePhase();
    void sessionId; // will track per-player ready state later
  }

  // ── Phase machine ───────────────────────────────────────────────────────────

  private advancePhase() {
    const transitions: Record<string, GameState["phase"]> = {
      lobby: "declare",
      declare: "resolve_movement",
      resolve_movement: "resolve_fire",
      resolve_fire: "declare", // next turn
      end: "end",
    };

    const next = transitions[this.state.phase];
    if (!next) return;

    if (this.state.phase === "resolve_fire") {
      this.state.turn += 1;
      this.state.declaredActions = {};
      this.resetActionPoints();
    }

    this.state.phase = next;
    console.log(`Room ${this.roomId}: phase → ${next} (turn ${this.state.turn})`);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private resetActionPoints() {
    for (const player of Object.values(this.state.players)) {
      player.actionPoints = player.maxActionPoints;
    }
  }

  private sendError(sessionId: string, message: string) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send("error", message);
  }

  private initialState(): GameState {
    return {
      phase: "lobby",
      turn: 1,
      players: {},
      declaredActions: {},
    };
  }
}
