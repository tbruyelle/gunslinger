import type { ChainConfig } from "../config";
import { ChainError, type ChainErrorKind } from "./errors";

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
      return new ChainError("locked", "This site is not connected to Adena");
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
    const params: ContractParams = { messages: [{ type: "/vm.m_call", value: call }], memo: "" };
    if (this.cfg.gasWanted) params.gasWanted = this.cfg.gasWanted;
    if (this.cfg.gasFee) params.gasFee = this.cfg.gasFee;
    const res = await this.adena.DoContract(params, { withNotification: false, isVisibleResult: false });
    if (res.status === "failure" || !res.data?.hash) throw adenaError(res, "checktx");
    return { hash: res.data.hash };
  }
}

/** Connects the site to Adena, switches it to the configured chain and returns the active account. */
export async function connectWallet(cfg: ChainConfig): Promise<Wallet> {
  const adena = await detectAdena();
  const est = await adena.AddEstablish("Gunslinger");
  if (est.status === "failure" && est.type !== "ALREADY_CONNECTED") throw adenaError(est, "locked");
  await ensureNetwork(adena, cfg);
  const acc = await adena.GetAccount();
  if (acc.status === "failure" || !acc.data?.address) throw adenaError(acc, "locked");
  return new AdenaWallet(adena, acc.data.address, cfg);
}

// Adena's On() cannot unsubscribe, so it is registered once and fanned out.
const accountListeners = new Set<(address: string) => void>();
const networkListeners = new Set<(chainId: string) => void>();
let listening = false;

function listen() {
  if (listening || !window.adena) return;
  listening = true;
  window.adena.On("changedAccount", (address) => accountListeners.forEach((cb) => cb(address)));
  window.adena.On("changedNetwork", (chainId) => networkListeners.forEach((cb) => cb(chainId)));
}

/** Calls cb when the user switches account in Adena; returns an unsubscribe function. */
export function subscribeAccountChanged(cb: (address: string) => void): () => void {
  listen();
  accountListeners.add(cb);
  return () => accountListeners.delete(cb);
}

/** Calls cb when the user switches network in Adena; returns an unsubscribe function. */
export function subscribeNetworkChanged(cb: (chainId: string) => void): () => void {
  listen();
  networkListeners.add(cb);
  return () => networkListeners.delete(cb);
}
