import type { Wallet, VmCall } from "./adena";
import { ChainError } from "./errors";
import { Rpc, unwrapQevalString, type TxResult } from "./rpc";
import { parseGameView, parseGamesView, type GameView, type GamesView } from "./types";

/** Typed access to the gunslinger realm: reads through Render, writes through Adena. */
export class RealmClient {
  private busy = false;

  constructor(
    readonly rpc: Rpc,
    readonly wallet: Wallet,
    readonly pkgPath: string,
  ) {}

  async getGame(id: string): Promise<GameView> {
    return parseGameView(await this.rpc.qrender(this.pkgPath, `json/game/${id}`));
  }

  async listGames(addr: string): Promise<GamesView> {
    return parseGamesView(await this.rpc.qrender(this.pkgPath, `json/games/${addr}`));
  }

  /** Creates a game; gameID is null only if the tx result could not be fetched in time. */
  async createGame(charKey: string, maxTurns: number): Promise<{ hash: string; gameID: string | null }> {
    const { hash, tx } = await this.send("CreateGame", [charKey, String(maxTurns)]);
    return { hash, gameID: tx?.data ? unwrapQevalString(tx.data) : null };
  }

  async joinGame(id: string, charKey: string): Promise<{ hash: string }> {
    return this.send("JoinGame", [id, charKey]);
  }

  async cancelGame(id: string): Promise<{ hash: string }> {
    return this.send("CancelGame", [id]);
  }

  /** Submits the ordered plan string, e.g. "1f:ahead_left,2f:ahead,3f" ("" passes). */
  async submitPlan(id: string, plan: string): Promise<{ hash: string }> {
    return this.send("SubmitPlan", [id, plan]);
  }

  async resign(id: string): Promise<{ hash: string }> {
    return this.send("Resign", [id]);
  }

  async claimTimeout(id: string): Promise<{ hash: string }> {
    return this.send("ClaimTimeout", [id]);
  }

  /**
   * Signs and broadcasts one call, then waits for its result: Adena
   * broadcasts sync, so success from the wallet only means "in the mempool"
   * and a realm panic is only known from the tx result. One call at a time,
   * because two quick calls race on the account sequence number.
   */
  private async send(func: string, args: string[]): Promise<{ hash: string; tx: TxResult | null }> {
    if (this.busy) throw new ChainError("busy", "A transaction is still pending");
    this.busy = true;
    try {
      const call: VmCall = { caller: this.wallet.address, send: "", pkg_path: this.pkgPath, func, args };
      const { hash } = await this.wallet.doContract(call);
      const tx = await this.rpc.waitForTx(hash);
      if (tx?.error) throw new ChainError("delivertx", tx.error, tx.log);
      return { hash, tx };
    } finally {
      this.busy = false;
    }
  }
}
