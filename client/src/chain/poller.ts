import type { RealmClient } from "./realm";
import type { GameView } from "./types";

/**
 * Polls a game's JSON view and reports it whenever its revision changes.
 * The node has no event subscription, so polling is the sync mechanism;
 * on gnodev blocks only happen on transactions, so the view is exact.
 */
export class GamePoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private lastRev = -1;
  private backoffMs = 0;

  constructor(
    private readonly realm: RealmClient,
    readonly gameID: string,
    private readonly onChange: (game: GameView) => void,
    private readonly onError: (e: unknown) => void,
    private readonly intervalMs = 2000,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.tick();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Polls right now, e.g. after our own transaction landed. */
  async pokeNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.tick();
  }

  private onVisibility = () => {
    if (!document.hidden) void this.pokeNow();
  };

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return;
    if (document.hidden) {
      this.schedule();
      return;
    }
    this.inFlight = true;
    try {
      const game = await this.realm.getGame(this.gameID);
      this.backoffMs = 0;
      if (game.rev !== this.lastRev) {
        this.lastRev = game.rev;
        this.onChange(game);
      }
    } catch (e) {
      this.backoffMs = Math.min(10_000, this.backoffMs ? this.backoffMs * 2 : this.intervalMs);
      this.onError(e);
    } finally {
      this.inFlight = false;
      this.schedule();
    }
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), this.backoffMs || this.intervalMs);
  }
}
