import { describe, expect, it } from "vitest";
import { parseGameView, parseGamesView, parseHistoryView, seatOf, shortAddr } from "./types";

// Captured from gnodev after one resolved turn (see the realm's z2 filetest).
const GAME = `{"id":"0000001","rev":4,"phase":"planning","turn":2,"maxTurns":10,"board":"A","players":[{"addr":"g1ptjc8fdpsyx4j994u6m43w6me8k68dnez66vhn","char":"marshal","hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false,"ranLastTurn":true},{"addr":"g1m0we6cyrysucg68d0090qucm8sjs6x9yt85qpd","char":"dude","hex":"A-F12","facing":0,"down":true,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false}],"winner":-1,"endReason":"","createdAt":1790541791,"updatedAt":1790541830,"timeoutAt":1790543630,"lastTurn":{"turn":1,"seed":"f28e30d77de1002bb48eb261ff8d72589fec0143012ee65cad610a0c03bef3e3","plans":["1f:ahead,2f:ahead","5b"],"events":[{"seg":2,"p":0,"kind":"move","action":"advance","from":"A-F1","to":"A-F2","facing":3,"down":false,"n":0,"delay":0,"reason":""},{"seg":3,"p":0,"kind":"move","action":"run","from":"A-F2","to":"A-F3","facing":3,"down":false,"n":0,"delay":0,"reason":""},{"seg":3,"p":1,"kind":"flip","action":"get_up_down","from":"","to":"","facing":0,"down":true,"n":0,"delay":0,"reason":""}],"start":[{"hex":"A-F1","facing":3,"down":false,"delay":0,"status":"alive"},{"hex":"A-F12","facing":0,"down":false,"delay":0,"status":"alive"}]}}`;

const GAMES = `{"open":[],"mine":[{"id":"0000001","rev":4,"phase":"planning","turn":2,"maxTurns":10,"winner":-1,"endReason":"","createdAt":1790541791,"updatedAt":1790541830,"players":[{"addr":"g1ptjc8fdpsyx4j994u6m43w6me8k68dnez66vhn","char":"marshal"},{"addr":"g1m0we6cyrysucg68d0090qucm8sjs6x9yt85qpd","char":"dude"}]}]}`;

describe("parseGameView", () => {
  it("accepts the realm's JSON", () => {
    const g = parseGameView(GAME);
    expect(g.id).toBe("0000001");
    expect(g.phase).toBe("planning");
    expect(g.players[1].down).toBe(true);
    expect(g.lastTurn?.events).toHaveLength(3);
    expect(g.lastTurn?.events[2].kind).toBe("flip");
    expect(seatOf(g, "g1m0we6cyrysucg68d0090qucm8sjs6x9yt85qpd")).toBe(1);
    expect(seatOf(g, "g1nobody")).toBe(-1);
  });

  it("rejects wrong shapes", () => {
    expect(() => parseGameView("[]")).toThrow(/bad game JSON/);
    expect(() => parseGameView('{"id":"1","rev":1,"turn":1,"phase":"lobby","players":[]}')).toThrow(/phase/);
    expect(() => parseGameView(GAME.replace('"players":[', '"players":[{},'))).toThrow(/players/);
  });

  it("does not match an empty seat", () => {
    const g = parseGameView(GAME.replace("g1m0we6cyrysucg68d0090qucm8sjs6x9yt85qpd", ""));
    expect(seatOf(g, "")).toBe(-1);
  });
});

describe("parseHistoryView", () => {
  it("accepts the realm's JSON", () => {
    const g = parseGameView(GAME);
    const h = parseHistoryView(`{"id":"0000001","turn":2,"phase":"planning","players":[{"addr":"a","char":"marshal"},{"addr":"b","char":"dude"}],"turns":[${JSON.stringify(g.lastTurn)}]}`);
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0].start[1].hex).toBe("A-F12");
    expect(g.lastTurn?.start[0].facing).toBe(3);
  });
  it("rejects wrong shapes", () => {
    expect(() => parseHistoryView('{"id":"1","players":[],"turns":[{"turn":1}]}')).toThrow(/turn/);
  });
});

describe("parseGamesView", () => {
  it("accepts the realm's JSON", () => {
    const v = parseGamesView(GAMES);
    expect(v.open).toEqual([]);
    expect(v.mine[0].players[1].char).toBe("dude");
  });
  it("rejects wrong shapes", () => {
    expect(() => parseGamesView('{"open":[]}')).toThrow();
  });
});

describe("shortAddr", () => {
  it("shortens long addresses only", () => {
    expect(shortAddr("g1ptjc8fdpsyx4j994u6m43w6me8k68dnez66vhn")).toBe("g1ptjc…6vhn");
    expect(shortAddr("g1short")).toBe("g1short");
  });
});
