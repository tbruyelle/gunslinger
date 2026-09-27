import { CONFIG, type ChainConfig } from "../config";
import { connectWallet, type Wallet } from "./adena";
import { RealmClient } from "./realm";
import { Rpc } from "./rpc";

export interface Chain {
  config: ChainConfig;
  rpc: Rpc;
  wallet: Wallet;
  realm: RealmClient;
}

let chain: Chain | null = null;

/** Connects Adena and builds the realm client; the result is shared by all scenes. */
export async function initChain(cfg: ChainConfig = CONFIG): Promise<Chain> {
  const rpc = new Rpc(cfg.rpcUrl);
  const wallet = await connectWallet(cfg);
  chain = { config: cfg, rpc, wallet, realm: new RealmClient(rpc, wallet, cfg.realmPath) };
  return chain;
}

export function getChain(): Chain {
  if (!chain) throw new Error("chain not initialised: connect in the lobby first");
  return chain;
}

export function currentChain(): Chain | null {
  return chain;
}

export function resetChain(): void {
  chain = null;
}
