import { ChainError } from "./errors";

/** A JSON-RPC level failure (transport, or an `error` member in the reply). */
export class RpcError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) {
    super(message);
    this.name = "RpcError";
  }
}

/** A query the node answered with an error, typically a realm panic. */
export class QueryError extends Error {
  constructor(message: string, readonly log: string) {
    super(message);
    this.name = "QueryError";
  }
}

export interface TxResult {
  height: number;
  /** The realm's panic message when the transaction failed, else null. */
  error: string | null;
  log: string;
  /** The decoded return value of the call, if any. */
  data: string | null;
  events: unknown[];
}

interface ResponseBase {
  Error: { value?: string } | null;
  Data: string | null;
  Log: string | null;
  Events?: unknown[] | null;
}

type FetchFn = typeof fetch;

/**
 * The tiny slice of the Tendermint2 JSON-RPC surface the game needs:
 * abci_query (realm reads), status (chain id, height) and tx (result of a
 * broadcast transaction).
 */
export class Rpc {
  private nextId = 1;

  constructor(readonly url: string, private readonly fetchFn: FetchFn = (...a) => fetch(...a)) {}

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
      });
    } catch (e) {
      throw new RpcError(`cannot reach ${this.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string; data?: unknown } };
    if (body.error) {
      throw new RpcError(body.error.message ?? `${method} failed`, body.error.code, body.error.data);
    }
    return body.result as T;
  }

  async status(): Promise<{ chainId: string; latestBlockHeight: number }> {
    const r = await this.call<{ node_info: { network: string }; sync_info: { latest_block_height: string } }>("status", {});
    return { chainId: r.node_info.network, latestBlockHeight: Number(r.sync_info.latest_block_height) };
  }

  /** Runs an ABCI query and returns the decoded Data, or throws QueryError. */
  async abciQuery(path: string, data: string): Promise<string> {
    const r = await this.call<{ response: { ResponseBase: ResponseBase } }>("abci_query", {
      path,
      data: utf8ToB64(data),
    });
    const rb = r.response.ResponseBase;
    if (rb.Error) {
      throw new QueryError(rb.Error.value ?? extractPanic(rb.Log) ?? "query failed", rb.Log ?? "");
    }
    return rb.Data ? b64ToUtf8(rb.Data) : "";
  }

  /** Calls the realm's Render(path) and returns the raw string. */
  qrender(pkgPath: string, path: string): Promise<string> {
    return this.abciQuery("vm/qrender", `${pkgPath}:${path}`);
  }

  /** Evaluates an expression in the realm; string results come back Go-quoted. */
  qeval(pkgPath: string, expr: string): Promise<string> {
    return this.abciQuery("vm/qeval", `${pkgPath}.${expr}`);
  }

  /** Fetches a transaction by its base64 hash; null while it is not indexed yet. */
  async tx(hashB64: string): Promise<TxResult | null> {
    let r: { height: string; tx_result: { ResponseBase: ResponseBase } };
    try {
      r = await this.call("tx", { hash: hashB64 });
    } catch (e) {
      if (e instanceof RpcError && /could not find/i.test(`${e.data ?? ""} ${e.message}`)) return null;
      throw e;
    }
    const rb = r.tx_result.ResponseBase;
    return {
      height: Number(r.height),
      error: rb.Error ? rb.Error.value ?? extractPanic(rb.Log) ?? "transaction failed" : null,
      log: rb.Log ?? "",
      data: rb.Data ? b64ToUtf8(rb.Data) : null,
      events: rb.Events ?? [],
    };
  }

  /** Polls tx() until the transaction is indexed; null on timeout. */
  async waitForTx(hashB64: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<TxResult | null> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const r = await this.tx(hashB64);
      if (r) return r;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/** Pulls the realm's panic message out of a node log. */
export function extractPanic(log: string | null | undefined): string | undefined {
  if (!log) return undefined;
  const m = /(gunslinger: [^\n"]+)/.exec(log);
  if (m) return m[1];
  const data = /^Data: (.+)$/m.exec(log);
  return data ? data[1] : undefined;
}

/**
 * Unwraps a vm/qeval string result, which comes back Go-quoted as
 * `("hello" string)`, and the same shape as a MsgCall return value.
 */
export function unwrapQevalString(s: string): string {
  const m = /^\(("(?:[^"\\]|\\.)*") string\)\s*$/.exec(s.trim());
  if (!m) throw new Error(`not a quoted string result: ${s}`);
  return JSON.parse(m[1]) as string;
}

/** Converts a ChainError-worthy failure of a write into a ChainError. */
export function txResultError(r: TxResult): ChainError | null {
  return r.error ? new ChainError("delivertx", r.error, r.log) : null;
}

export function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
