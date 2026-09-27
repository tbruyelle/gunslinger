import { describe, expect, it } from "vitest";
import { QueryError, Rpc, RpcError, extractPanic, unwrapQevalString, utf8ToB64 } from "./rpc";

function fakeFetch(replies: Record<string, unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: body.method, params: body.params });
    const reply = replies[body.method];
    const payload = typeof reply === "function" ? (reply as (p: Record<string, unknown>) => unknown)(body.params) : reply;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...(payload as object) }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("Rpc", () => {
  it("decodes abci_query data and encodes the request", async () => {
    const { fetchFn, calls } = fakeFetch({
      abci_query: { result: { response: { ResponseBase: { Error: null, Data: utf8ToB64('{"a":1}'), Log: "" } } } },
    });
    const rpc = new Rpc("http://x", fetchFn);
    expect(await rpc.qrender("gno.land/r/x/y", "json/game/1")).toBe('{"a":1}');
    expect(calls[0].params).toEqual({ path: "vm/qrender", data: utf8ToB64("gno.land/r/x/y:json/game/1") });
  });

  it("surfaces realm panics from queries", async () => {
    const { fetchFn } = fakeFetch({
      abci_query: {
        result: {
          response: {
            ResponseBase: {
              Error: { "@type": "/abci.StringError", value: "gunslinger: game not found" },
              Data: null,
              Log: "--= Error =--\nData: ...",
            },
          },
        },
      },
    });
    await expect(new Rpc("http://x", fetchFn).qrender("p", "q")).rejects.toThrow(QueryError);
    await expect(new Rpc("http://x", fetchFn).qrender("p", "q")).rejects.toThrow("gunslinger: game not found");
  });

  it("reports status and JSON-RPC errors", async () => {
    const { fetchFn } = fakeFetch({
      status: { result: { node_info: { network: "dev" }, sync_info: { latest_block_height: "42" } } },
      tx: { error: { code: -32603, message: "Internal error", data: "Could not find tx result for hash #00" } },
    });
    const rpc = new Rpc("http://x", fetchFn);
    expect(await rpc.status()).toEqual({ chainId: "dev", latestBlockHeight: 42 });
    expect(await rpc.tx("AAAA")).toBeNull();
    const { fetchFn: other } = fakeFetch({ tx: { error: { code: -1, message: "boom" } } });
    await expect(new Rpc("http://x", other).tx("AAAA")).rejects.toThrow(RpcError);
  });

  it("parses transaction results", async () => {
    const { fetchFn } = fakeFetch({
      tx: (p: Record<string, unknown>) => ({
        result: {
          height: "9",
          tx_result: {
            ResponseBase:
              p.hash === "ok"
                ? { Error: null, Data: utf8ToB64('("0000001" string)\n\n'), Log: "msg:0,success:true", Events: [{ type: "GameCreated" }] }
                : { Error: { value: "gunslinger: you cannot use both sides of a card" }, Data: null, Log: "" },
          },
        },
      }),
    });
    const rpc = new Rpc("http://x", fetchFn);
    const ok = await rpc.tx("ok");
    expect(ok?.height).toBe(9);
    expect(ok?.error).toBeNull();
    expect(unwrapQevalString(ok!.data!)).toBe("0000001");
    expect(ok?.events).toHaveLength(1);
    const bad = await rpc.tx("bad");
    expect(bad?.error).toBe("gunslinger: you cannot use both sides of a card");
  });
});

describe("helpers", () => {
  it("unwraps Go-quoted strings", () => {
    expect(unwrapQevalString('("hello" string)')).toBe("hello");
    expect(unwrapQevalString('("a \\"b\\"" string)')).toBe('a "b"');
    expect(() => unwrapQevalString("(3 int)")).toThrow();
  });

  it("extracts panic messages from logs", () => {
    expect(extractPanic('--= Error =--\nData: errors.FmtError{format:"gunslinger: game not found", args:[]}')).toBe(
      "gunslinger: game not found",
    );
    expect(extractPanic("Data: something else\nMsg Traces:")).toBe("something else");
    expect(extractPanic("")).toBeUndefined();
  });
});
