import type { ChainConfig } from "../config";
import { ChainError, type ChainErrorKind } from "./errors";

/** Gas limit sent with every call when VITE_GAS_WANTED is not set. */
export const DEFAULT_GAS_WANTED = 100_000_000;

/** Response envelope of every injected Adena method. */
export interface AdenaResponse<D> {
  code: number;
  status: "success" | "failure";
  type: string;
  message: string;
  data: D | null;
}

/** A /vm.m_call message, as Adena signs it. Args are always strings. */
export interface VmCall {
  caller: string;
  send: string;
  pkg_path: string;
  func: string;
  args: string[];
}

export interface ContractParams {
  messages: { type: "/vm.m_call"; value: VmCall }[];
  memo?: string;
  gasFee?: number;
  gasWanted?: number;
}

/** The subset of window.adena the game uses (adena-extension/src/inject.ts). */
export interface AdenaApi {
  AddEstablish(name: string, chainIds?: string | string[]): Promise<AdenaResponse<unknown>>;
  GetAccount(): Promise<AdenaResponse<{ address: string; chainId: string; coins: string; status: string }>>;
  GetNetwork(): Promise<AdenaResponse<{ chainId: string; networkName: string; rpcUrl: string }>>;
  DoContract(
    params: ContractParams,
    options?: { withNotification?: boolean; isVisibleResult?: boolean },
  ): Promise<AdenaResponse<{ hash: string }>>;
  AddNetwork(network: { chainId: string; chainName: string; rpcUrl: string }): Promise<AdenaResponse<unknown>>;
  SwitchNetwork(chainId: string): Promise<AdenaResponse<{ chainId: string }>>;
  On(event: "changedAccount" | "changedNetwork", callback: (value: string) => void): void;
}

declare global {
  interface Window {
    adena?: AdenaApi;
  }
}

/** A connected account that can sign realm calls. */
export interface Wallet {
  readonly address: string;
  /** Signs and broadcasts (sync) a call; resolves with the tx hash once it is in the mempool. */
  doContract(call: VmCall): Promise<{ hash: string }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a wallet popup may stay unanswered before the app gives up on it. */
export const WALLET_TIMEOUT_MS = 3 * 60_000;

/** How long a wallet call may stay unanswered before the page says it is waiting for Adena. */
export const WALLET_NOTICE_MS = 6_000;

/** Rejects with a ChainError("timeout") if the promise takes longer than ms. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ChainError("timeout", `${what} after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/** Waits for the extension to inject window.adena. */
export async function detectAdena(timeoutMs = 1500): Promise<AdenaApi> {
  const start = Date.now();
  while (!window.adena) {
    if (Date.now() - start > timeoutMs) throw new ChainError("no-wallet", "Adena wallet not detected");
    await sleep(100);
  }
  return window.adena;
}

/** Maps an Adena failure response to a ChainError. */
export function adenaError(res: AdenaResponse<unknown>, fallback: ChainErrorKind, chainId?: string): ChainError {
  switch (res.type) {
    case "TRANSACTION_REJECTED":
      return new ChainError("rejected", "Transaction cancelled");
    case "WALLET_LOCKED":
      return new ChainError("locked", "Adena is locked");
    case "NO_ACCOUNT":
      return new ChainError("locked", "No account in Adena");
    case "NOT_CONNECTED":
      return new ChainError("not-connected", "This site is not connected to the current Adena account");
    case "ACCOUNT_MISMATCH":
      return new ChainError("wrong-account", "Adena is on another account");
    case "UNADDED_NETWORK":
      return new ChainError("wrong-network", "Network not added in Adena", chainId);
    case "TRANSACTION_FAILED": {
      const data = res.data as { error?: unknown } | null;
      const detail = data?.error ? String(data.error) : res.message;
      return new ChainError("checktx", `Transaction refused: ${detail}`, detail);
    }
    default:
      return new ChainError(fallback, res.message || res.type || "Adena error", res.type);
  }
}

/** Makes Adena point at the configured chain, adding the network if needed. */
export async function ensureNetwork(adena: AdenaApi, cfg: ChainConfig): Promise<void> {
  const net = await adena.GetNetwork();
  if (net.status === "success" && net.data?.chainId === cfg.chainId) return;
  let sw = await adena.SwitchNetwork(cfg.chainId);
  if (sw.status === "failure" && sw.type === "UNADDED_NETWORK") {
    const add = await adena.AddNetwork({ chainId: cfg.chainId, chainName: cfg.chainName, rpcUrl: cfg.rpcUrl });
    if (add.status === "failure") throw adenaError(add, "wrong-network", cfg.chainId);
    sw = await adena.SwitchNetwork(cfg.chainId);
  }
  if (sw.status === "failure" && sw.type !== "REDUNDANT_CHANGE_REQUEST") {
    throw new ChainError("wrong-network", `Adena is not on the "${cfg.chainId}" network`, cfg.chainId);
  }
}

class AdenaWallet implements Wallet {
  constructor(
    private readonly adena: AdenaApi,
    readonly address: string,
    private readonly cfg: ChainConfig,
  ) {}

  async doContract(call: VmCall): Promise<{ hash: string }> {
    // Adena only opens its approval popup when the *current* account is
    // connected to this site, so check the account and re-establish first;
    // otherwise DoContract answers NOT_CONNECTED without any popup.
    // Older Adena versions close their approval popup on any other request
    // from the page, so the account poll is paused while a call is in flight.
    inFlight++;
    try {
      const current = await currentAccount(this.adena);
      notifyLocked(current === null);
      if (current === null) throw new ChainError("locked", "Adena is locked");
      if (current !== this.address) {
        throw new ChainError("wrong-account", "Adena is on another account", shortAddr(current));
      }
      const params: ContractParams = { messages: [{ type: "/vm.m_call", value: call }], memo: "" };
      // Left to itself Adena simulates the call and uses the result as the gas
      // limit, with no margin. A SubmitPlan that resolves the turn shuffles the
      // deck from a seed that includes the block height, so the real block can
      // draw more cards than the simulation and run out of gas. A fixed, ample
      // limit avoids that (the dev chain allows 10e9 per block).
      params.gasWanted = this.cfg.gasWanted ?? DEFAULT_GAS_WANTED;
      if (this.cfg.gasFee) params.gasFee = this.cfg.gasFee;
      // Adena's defaults: it shows its result screen and a notification after
      // broadcasting, and answers the page once the result screen is closed.
      // The realm client also watches the chain, so that wait costs nothing.
      // Adena's popup can open behind the browser window or on another
      // screen (or land on its unlock page), and the page has nothing to show
      // meanwhile: past a few seconds, say what the wallet is waiting for.
      const notice = setTimeout(() => notifyWaiting(true), WALLET_NOTICE_MS);
      let res: AdenaResponse<{ hash: string }>;
      try {
        res = await withTimeout(
          this.adena.DoContract(params, { withNotification: true, isVisibleResult: true }),
          WALLET_TIMEOUT_MS,
          "No answer from Adena",
        );
      } finally {
        clearTimeout(notice);
        notifyWaiting(false);
      }
      if (res.status === "failure" || !res.data?.hash) throw adenaError(res, "checktx");
      return { hash: res.data.hash };
    } finally {
      inFlight--;
    }
  }
}

/**
 * The address of Adena's current account, establishing the site for that
 * account when needed (Adena tracks connections per account). Null when the
 * wallet is locked or has no account.
 */
export async function currentAccount(adena: AdenaApi): Promise<string | null> {
  let acc = await adena.GetAccount();
  if (acc.status === "failure" && acc.type === "NOT_CONNECTED") {
    const est = await adena.AddEstablish("Gunslinger");
    if (est.status === "failure" && est.type !== "ALREADY_CONNECTED") throw adenaError(est, "locked");
    acc = await adena.GetAccount();
  }
  if (acc.status === "failure" || !acc.data?.address) {
    if (acc.type === "WALLET_LOCKED" || acc.type === "NO_ACCOUNT") return null;
    throw adenaError(acc, "locked");
  }
  return acc.data.address;
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** Connects the site to Adena, switches it to the configured chain and returns the active account. */
export async function connectWallet(cfg: ChainConfig): Promise<Wallet> {
  const adena = await detectAdena();
  const est = await adena.AddEstablish("Gunslinger");
  if (est.status === "failure" && est.type !== "ALREADY_CONNECTED") throw adenaError(est, "locked");
  await ensureNetwork(adena, cfg);
  const address = await currentAccount(adena);
  if (!address) throw new ChainError("locked", "Unlock Adena and pick an account");
  lastSeenAddress = address;
  return new AdenaWallet(adena, address, cfg);
}

// Adena's On() cannot unsubscribe, so it is registered once and fanned out.
const accountListeners = new Set<(address: string) => void>();
const lockListeners = new Set<(locked: boolean) => void>();
const waitingListeners = new Set<(waiting: boolean) => void>();
let lastLocked = false;
let waiting = false;
const networkListeners = new Set<(chainId: string) => void>();
let listening = false;
let lastSeenAddress: string | null = null;
let accountPoll: ReturnType<typeof setInterval> | null = null;
let inFlight = 0; // wallet calls in progress

const ACCOUNT_POLL_MS = 3000;

function notifyAccount(address: string) {
  if (address === lastSeenAddress) return;
  lastSeenAddress = address;
  accountListeners.forEach((cb) => cb(address));
}

function notifyLocked(locked: boolean) {
  if (locked === lastLocked) return;
  lastLocked = locked;
  lockListeners.forEach((cb) => cb(locked));
}

function notifyWaiting(w: boolean) {
  if (w === waiting) return;
  waiting = w;
  waitingListeners.forEach((cb) => cb(w));
}

function listen() {
  if (listening || !window.adena) return;
  listening = true;
  window.adena.On("changedAccount", (address) => notifyAccount(address));
  window.adena.On("changedNetwork", (chainId) => networkListeners.forEach((cb) => cb(chainId)));
}

// Adena's changedAccount event does not always reach the page (it depends on
// the extension version and on the account being connected to the site), so
// the current account is also polled while someone listens.
function pollAccounts() {
  if (accountPoll || !window.adena) return;
  accountPoll = setInterval(async () => {
    if (accountListeners.size + lockListeners.size === 0 || document.hidden || !window.adena || inFlight > 0) return;
    try {
      const acc = await window.adena.GetAccount();
      notifyLocked(acc.status === "failure" && acc.type === "WALLET_LOCKED");
      if (acc.status === "success" && acc.data?.address) notifyAccount(acc.data.address);
      else if (acc.status === "failure" && acc.type === "NOT_CONNECTED") notifyAccount("");
    } catch {
      // ignore: the next tick retries
    }
  }, ACCOUNT_POLL_MS);
}

/** Calls cb when the user switches account in Adena; returns an unsubscribe function. */
export function subscribeAccountChanged(cb: (address: string) => void): () => void {
  listen();
  pollAccounts();
  accountListeners.add(cb);
  return () => accountListeners.delete(cb);
}

/**
 * Calls cb when Adena gets locked or unlocked (seen by the account poll, so
 * within a few seconds); returns an unsubscribe function. A locked Adena
 * answers every call from the page with WALLET_LOCKED.
 */
export function subscribeWalletLocked(cb: (locked: boolean) => void): () => void {
  pollAccounts();
  lockListeners.add(cb);
  return () => lockListeners.delete(cb);
}

/** Whether the account poll last saw Adena locked. */
export function walletLocked(): boolean {
  return lastLocked;
}

/**
 * Calls cb(true) when a wallet call has been waiting for Adena for a few
 * seconds (WALLET_NOTICE_MS) and cb(false) once it answers; returns an
 * unsubscribe function.
 */
export function subscribeWalletWaiting(cb: (waiting: boolean) => void): () => void {
  waitingListeners.add(cb);
  return () => waitingListeners.delete(cb);
}

/** Calls cb when the user switches network in Adena; returns an unsubscribe function. */
export function subscribeNetworkChanged(cb: (chainId: string) => void): () => void {
  listen();
  networkListeners.add(cb);
  return () => networkListeners.delete(cb);
}
