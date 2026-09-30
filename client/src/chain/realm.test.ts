import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "./adena";
import { ChainError } from "./errors";
import { RealmClient } from "./realm";
import type { Rpc, TxResult } from "./rpc";
import { utf8ToB64 } from "./rpc";

const ME = "g1me";
const PKG = "gno.land/r/x/gunslinger/v0";

function summary(id: string, addr = ME) {
  return { id, rev: 1, phase: "waiting", turn: 1, maxTurns: 10, createdAt: 0, updatedAt: 0, players: [{ addr, char: "marshal" }, { addr: "", char: "" }] };
}

/** A fake node: `render` answers Render(path); `txResult` answers tx queries. */
function fakeRpc(render: (path: string) => string, txResult: TxResult | null = null): Rpc {
  return {
    qrender: async (_pkg: string, path: string) => render(path),
    waitForTx: async () => txResult,
    abciQuery: async () => "",
  } as unknown as Rpc;
}

function fakeWallet(doContract: Wallet["doContract"]): Wallet {
  return { address: ME, doContract };
}

describe("RealmClient.send", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns once the chain shows the effect even if the wallet never answers", async () => {
    let mine = [summary("0000001")];
    const rpc = fakeRpc(() => JSON.stringify({ open: [], mine }));
    const wallet = fakeWallet(() => new Promise(() => {})); // Adena's result screen never dismissed
    const realm = new RealmClient(rpc, wallet, PKG);

    const p = realm.createGame("marshal", 10);
    await vi.advanceTimersByTimeAsync(1500); // first poll: nothing new yet
    mine = [summary("0000002"), summary("0000001")];
    await vi.advanceTimersByTimeAsync(1500); // second poll sees the new game
    await expect(p).resolves.toEqual({ hash: null, gameID: "0000002" });
  });

  it("uses the wallet answer and the tx result when they come first", async () => {
    const rpc = fakeRpc(
      () => JSON.stringify({ open: [], mine: [] }),
      { height: 3, error: null, log: "", data: '("0000007" string)\n', events: [] },
    );
    const wallet = fakeWallet(async () => ({ hash: utf8ToB64("h") }));
    const realm = new RealmClient(rpc, wallet, PKG);
    await expect(realm.createGame("marshal", 10)).resolves.toEqual({ hash: utf8ToB64("h"), gameID: "0000007" });
  });

  it("surfaces a realm panic from the tx result", async () => {
    const rpc = fakeRpc(() => JSON.stringify({ open: [], mine: [] }), {
      height: 3, error: "gunslinger: you cannot use both sides of a card", log: "", data: null, events: [],
    });
    const wallet = fakeWallet(async () => ({ hash: "x" }));
    const realm = new RealmClient(rpc, wallet, PKG);
    // A game view for the watcher: plan not submitted, so only the wallet path can settle.
    const game = { id: "1", rev: 1, phase: "planning", turn: 1, maxTurns: 10, board: "A", winner: -1, endReason: "", createdAt: 0, updatedAt: 0, timeoutAt: 0, lastTurn: null,
      players: [{ addr: ME, char: "marshal", hex: "A-F1", facing: 3, down: false, delay: 0, status: "alive", submitted: false, playedFoot: false, playedRun: false },
                { addr: "g1o", char: "dude", hex: "A-F12", facing: 0, down: false, delay: 0, status: "alive", submitted: false, playedFoot: false, playedRun: false }] };
    const rpc2 = fakeRpc((path) => (path.startsWith("json/game/") ? JSON.stringify(game) : "{}"), {
      height: 3, error: "gunslinger: you cannot use both sides of a card", log: "", data: null, events: [],
    });
    const realm2 = new RealmClient(rpc2, wallet, PKG);
    await expect(realm2.submitPlan("1", "1f:ahead,1b:back")).rejects.toThrow("both sides");
    void rpc;
  });

  it("rejects when the wallet rejects, and refuses a second call while one is pending", async () => {
    const rpc = fakeRpc(() => JSON.stringify({ open: [], mine: [] }));
    let reject!: (e: unknown) => void;
    const wallet = fakeWallet(() => new Promise((_, r) => (reject = r)));
    const realm = new RealmClient(rpc, wallet, PKG);
    const p = realm.createGame("marshal", 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(realm.cancelGame("1")).rejects.toThrow(ChainError);
    reject(new ChainError("rejected", "Transaction cancelled"));
    await expect(p).rejects.toThrow("Transaction cancelled");
  });
});
