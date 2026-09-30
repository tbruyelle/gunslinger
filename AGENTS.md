# AGENTS.md

Guidance for AI agents working in this repository. `CLAUDE.md` is a symlink to
this file.

## Project Goal

A digital version of the 1982 Avalon Hill board game **Gunslinger** (tactical
Old West gunfight: hex movement, 5-segment action-point turns, action cards).
The game runs **on the gno.land chain**: a Gno realm holds every game and
resolves the turns; a Phaser web app is the interface and signs its
transactions with the **Adena** wallet. There is no game server.

Current milestone: **board A only, exactly 2 players, one character each, foot
actions only** (advance, back up, run, spin around, sprint, turn, leap/drop,
get up/down). Plans are submitted in clear (no commit-reveal yet); guns,
brawling, multi-board layouts and victory points come later.

## Tech Stack

- **Realm**: Gno (`gno.land/{p,r}/tbruyelle/gunslinger/...`), pinned gno
  toolchain through `go.mod` + `go tool` (like `~/src/aibgno`).
- **Client**: TypeScript + Phaser 3 + Vite (port 5173), tests with vitest,
  wallet through the injected `window.adena` API.
- **Reference rules engine**: `bga/` (separate git repo, gitignored) holds a
  Board Game Arena PHP implementation and `bga/doc/RULES.md`, the full rules
  transcription. Port rules from there, not from git history.

## Key Commands

```bash
make gnodev        # local chain: chain id "dev", RPC 127.0.0.1:26657, gnoweb :8888
                   # ADENA_ADDRS="g1... g1..." make gnodev  premines Adena accounts
make web           # vite dev server for the client
make dev           # both, with concurrently
make test          # go tool gno test ./gno.land/...   (unit tests + filetests)
make lint          # go tool gno lint ./gno.land/...
make fmt           # go tool gno fmt -w ./gno.land
make check         # tsc --noEmit + vitest for the client
make gen-board     # regenerate board A adjacency (realm + client) from assets/hex_grid.json
make mod-download  # sync ~/.config/gno/pkg/mod with the pinned gno (after update-fork)
make update-fork FORK_REF=<ref>   # re-pin gnolang/gno in go.mod
```

**Always use `go tool gno` / `go tool gnodev` / `go tool gnokey`**, never a
standalone binary: `go.mod` pins the gno commit the realm is written against.

Run one Gno package or test:
```bash
go tool gno test -v ./gno.land/p/tbruyelle/gunslinger/engine/v0
go tool gno test -run TestResolve_Seg5Cancel ./gno.land/p/tbruyelle/gunslinger/engine/v0
# a filetest needs its full path in -run:
go tool gno test -run ./gno.land/r/tbruyelle/gunslinger/v0/filetests/z2_ ./gno.land/r/tbruyelle/gunslinger/v0/
go tool gno test -update-golden-tests ./gno.land/r/tbruyelle/gunslinger/v0/   # refresh // Output: and // Events:
```

## Layout

```
gno.land/
  p/tbruyelle/gunslinger/hex/v0      directions, relative directions, Board adjacency (board_a.gno is generated)
  p/tbruyelle/gunslinger/cards/v0    the 12 action cards (24 sides), Enabled() = implemented actions
  p/tbruyelle/gunslinger/engine/v0   pure rules engine: plan DSL + validation, Resolve, EndTurn, dice
  r/tbruyelle/gunslinger/v0          the realm: games, lobby, SubmitPlan, JSON views, Render, filetests/
client/src/
  chain/      rpc.ts (abci_query/status/tx), adena.ts (wallet), realm.ts (typed calls), poller.ts, types.ts
  rules/      cards.ts, facing.ts (pure card data + facing math, mirrors the Gno packages)
  board/      board_A.json (generated) + boardA.ts (BoardMap)
  game/       plan.ts (encode/validate), replay.ts (preview), playback.ts (resolution log)
  scenes/     BootScene → LobbyScene → GameScene   (SetupScene/TokenPlacementScene are dormant, multi-board later)
  ui/toast.ts
scripts/gen_board_data.py   generates hex/v0/board_a.gno and client/src/board/board_A.json
assets/                     served as the Vite public dir (boards, tokens, cards, hex_grid.json)
```

## Realm

### Data
`Game{ID, Players[2]{Addr, Char}, State engine.State, Turn, MaxTurns, Phase,
Plans[2], Submitted[2], LastTurn *TurnResult, Winner, EndReason, Rev,
CreatedAt, UpdatedAt}` stored in an `avl.Tree` by zero-padded `seqid`;
`byPlayer` (address → ids) and `openGames` indexes. `Rev` is bumped on every
change and is what clients poll. Only the last `TurnResult` is kept.

### Crossing functions (called with MsgCall, args are strings)
| Function | Notes |
|---|---|
| `CreateGame(cur, charKey, maxTurns) string` | seat 0; 0 turns = 10; phase `waiting` |
| `JoinGame(cur, id, charKey)` | seat 1; phase `planning` |
| `CancelGame(cur, id)` | creator, while waiting |
| `SubmitPlan(cur, id, plan) int` | validates, stores; the **second** plan resolves the turn in the same tx; returns Rev |
| `Resign(cur, id)` | forfeit |
| `ClaimTimeout(cur, id)` | anyone, after 30 min without progress (`time.Now()`, lazy: no timers on chain); waiting → `expired`, one plan in → `timeout` (other forfeits), none → `abandoned` |

Errors are panics prefixed `gunslinger: `; the client extracts them from the
tx result log. Events: `GameCreated`, `PlayerJoined`, `PlanSubmitted`,
`TurnResolved`, `GameEnded` (informational; there is no event subscription on
the RPC, clients poll).

### Reads
`Render("json/game/{id}")` and `Render("json/games/{addr}")` return raw JSON
through `vm/qrender` (`vm/qeval` would Go-quote the string). `Render("")`,
`game/{id}`, `help` are gnoweb pages. `GameJSON`, `GamesJSON`, `GameRev` are
plain getters for tests and gnokey.

### Plan string
`entry("," entry)*`, `entry := <card 1-12><f|b>[:<dir>]`, dir ∈ `ahead_left
ahead ahead_right back_left back back_right`, at most 5 entries, empty = pass.
Example `1f:ahead_left,2f:ahead,3f`. Rules (engine `Plan.Validate`): one side
per card, dir required for move/turn cards and in the right set, no dir
otherwise, total cost ≤ 5 − carried delay, Run needs Advance, Sprint needs Run.

### Directions
Absolute 0=N 1=NE 2=SE 3=S 4=SW 5=NW (flat-top hexes, vertical columns).
Relative offsets from the facing: ahead=0, ahead_right=1, back_right=2,
back=3, back_left=4, ahead_left=5. **Left/right are the character's own sides
while it keeps facing forward** (facing N, back_right is SE). Note that
`bga/modules/php/Hex.php` swaps back_left/back_right; the realm and the client
use the convention above. Tokens are drawn rotated by
`dirIndexToAngle(facing, charKey)` (their arrow is baked into the PNG, see
`CHAR_ARROW_DIR`).

### Resolution (engine.Resolve, port of bga ResolveTurn.php)
For each segment 1–5 and each alive player, the next action executes once when
`usedTime + cost + delay ≤ segment`. Delay gained in a segment applies from the
next one. Moving while down costs 2 delay (crawl); Sprint goes straight ahead
and draws a delay card; Leap/Drop draws two; ending a move in an occupied hex
makes both characters draw one (rule 9.24). Off-board moves are cancelled but
still consume their time. Unexecuted actions are cancelled after segment 5.
End of turn removes half the delay, rounded up. Dice are a seeded PCG
(`engine.Seed` over realm path, id, turn, both plans, height, block time); the
seed is stored in `TurnResult` so the turn can be replayed. Delay cards draw
1–3 until the result deck is transcribed.

### Gno idioms in use (gno 0.9)
`func F(cur realm, ...)`, caller = `cur.Previous().Address()`, other realm
functions called with `cross(cur)`, `chain.Emit`, `chain/runtime`,
`time.Now()` = block time, `p/nt/{avl,seqid,mux,ufmt,markdown/sanitize}/v0`,
`p/moul/{md,txlink}/v0`. No `encoding/json` (JSON is hand-built in
`json.gno`). Tests: `testing.SetRealm(testing.NewUserRealm(addr))` **must be
called directly in the test function** (it rewrites that frame's `cur`; a
helper would set its own frame), then `F(cross(cur), ...)`;
`uassert.AbortsWithMessage(t, cur, msg, func(){...})` for panics of crossing
calls; `testing.SkipHeights(n)` advances block time 5 s per height.

## Client

- `chain/rpc.ts`: hand-rolled JSON-RPC (`abci_query` with base64 data,
  `status`, `tx` by hash, `waitForTx`). Query errors carry the realm panic.
- `chain/adena.ts`: `window.adena` (`AddEstablish`, `GetAccount`,
  `GetNetwork`/`SwitchNetwork`/`AddNetwork`, `DoContract`, `On`). **Adena
  broadcasts sync** (success only means "in the mempool") **and only answers
  `DoContract` when the user dismisses its result screen** (kept visible, with
  the notification, through `withNotification`/`isVisibleResult`), so `realm.ts`
  races the wallet answer against the chain: each write watches the game view
  for its own effect and returns as soon as it shows; the wallet answer, when
  it comes first, is followed by the tx result, which carries the realm's
  panic message if the call failed. One tx in flight per account. Adena
  tracks site connections **per account**: `DoContract` for an account not
  connected to the site answers `NOT_CONNECTED` without any popup, so
  `doContract` first checks `GetAccount` (re-establishing if needed) and
  throws `wrong-account` when Adena moved to another account. Account
  switches are detected through `On("changedAccount")` **and** a 3 s
  `GetAccount` poll, since the event is not always delivered.
- `chain/poller.ts`: polls `json/game/{id}` every `VITE_POLL_MS` (2 s) and
  fires on `rev` change; backs off on errors; pauses when the tab is hidden.
- `LobbyScene`: splash screen with an **Enter** button (skipped when a game
  hands back with `{ splash: false }`), then connect Adena (switching/adding
  the network from `VITE_CHAIN_ID`/`VITE_RPC_URL`), create / join / open games. Characters are
  fixed for now: the creator plays `marshal`, the joiner `fast_eddie`
  (`CREATOR_CHAR`/`JOINER_CHAR`); the realm still takes any character key.
- `GameScene`: renders `committed` state from the chain; card strip builds an
  ordered plan with a live preview (`replayPlan`) and relative-direction hex
  picks; **Send plan** → `SubmitPlan`; when `lastTurn.turn` changes, the
  resolution log is played back segment by segment (`playback.ts`) from the
  positions shown before, then the state re-syncs. Only the last selected card
  can be deselected (choices are relative to the state before it).
- Config: `client/.env.local` (see `.env.example`): `VITE_RPC_URL`,
  `VITE_CHAIN_ID`, `VITE_CHAIN_NAME`, `VITE_REALM_PATH`, `VITE_POLL_MS`,
  optional `VITE_GAS_WANTED`/`VITE_GAS_FEE`.

### Manual end-to-end test
1. Two accounts in Adena; `ADENA_ADDRS="g1... g1..." make gnodev` (premines
   them); `make web`; open http://localhost:5173, approve connect / add
   network `dev` / switch.
2. Account A: **Create a game**. Switch account in Adena (the app
   reconnects): **Join** from "Open games". Both see the marshal at A-F3
   (facing S) and Fast Eddie at A-F9 (facing N).
3. Each account picks cards and sends its plan; the second submission
   resolves the turn, both tabs replay it, positions match
   `go tool gnokey query vm/qrender -remote 127.0.0.1:26657 -data 'gno.land/r/tbruyelle/gunslinger/v0:json/game/0000001'`.
4. CLI alternative: `go tool gnokey maketx call -pkgpath gno.land/r/tbruyelle/gunslinger/v0 -func SubmitPlan -args 0000001 -args "1f:ahead" -gas-fee 1000000ugnot -gas-wanted 20000000 -broadcast -chainid dev -remote 127.0.0.1:26657 <key>`.

## Game Rules (quick reference)

Turn: 5 segments. Players secretly pick up to 5 time points of action cards
(minus carried delay), in play order; actions resolve by time (shots first
once combat lands); effects apply at segment end. Full rules:
`bga/doc/RULES.md`; decisions: `bga/doc/ASSUMPTIONS.md` (`[Hx]` ids).

| Card | Front (cost) | Back (cost) |
|------|--------------|-------------|
| 1 | Advance (2) | Back Up (3) |
| 2 | Run (1) | Spin Around (2) |
| 3 | Sprint (1) | Turn (1) |
| 4 | Sprint (1) | Leap/Drop (1) |
| 5 | Cock/Aim/Shoot (2) | Get Up/Down (3) |
| 6 | Cock/Aim/Shoot (2) | Throw (2) |
| 7 | Shoot (1) | Strength (2) |
| 8 | Load (3) | Head Out/Back (2) |
| 9 | Draw & Cock (3) | Head Out/Back (2) |
| 10 | Jab (2) | Duck (1) |
| 11 | Swing (3) | Block (2) |
| 12 | Belt (3) | Guard (2) |

## Assets

`assets/` (TTS mod dump, served by Vite): boards 1600×2232 (`board_A.png` …),
character tokens `char_*.png` 95×95, action cards `action_card_a{1-12}[_back].png`,
`hex_grid.json` (hex centres, scaled 2×). `assets/local/` (VASSAL): status
overlays `state_*.png`, markers. `python scripts/fetch_assets.py` re-downloads
(not needed, everything is present).

## TODO

- Commit-reveal for plans (`PhaseCommit`/`PhaseReveal` reserved): secret
  simultaneous selection and dice seeded from revealed salts.
- Guns and brawling: enable more `cards.Enabled`, shots first per segment,
  transcribe the 108 result cards and IMPACT tables.
  - revamp card design (more readable and fun to watch)
- Multi-board layouts (bring back SetupScene/TokenPlacementScene) and more
  characters per player; victory points.
- Session keys (`MsgCreateSession`) so Adena signs once per game.
- Replace the tbruyelle realm to sthing else
- Add profile page with specific token and linked reputation (check RPG rules)
- Add token placement during create/join phase
