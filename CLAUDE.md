# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

This repository is a digital game inspired by the 1982 AH board game **Gunslinger** — a tactical Old West gunfight simulation with hex-based movement, action-point economy, and a detailed hit-location/wound system.

## Tech Stack

- **Frontend**: TypeScript + Phaser 3 + Vite (port 5173)
- **Backend**: Colyseus 0.15 + Express + Node.js (port 2567)
- **Shared types**: `@gunslinger/shared` (plain TS, no build step)
- **Monorepo**: npm workspaces (`client/`, `server/`, `shared/`)

## Key Commands

```bash
npm run dev          # starts both client (Vite) and server (ts-node-dev) concurrently
```

Type-checking (no build step needed for dev):
```bash
npx tsc --noEmit -p client/tsconfig.json
npx tsc --noEmit -p server/tsconfig.json
```

## Architecture

### Server (authoritative)

- `server/src/rooms/schema.ts` — Colyseus `@colyseus/schema` classes (`GameStateSchema`, `PlayerSchema`, etc.). Server tsconfig requires `experimentalDecorators: true`.
- `server/src/rooms/GameRoom.ts` — Colyseus room. Players are created from setup tokens in `onCreate()` (keyed by `charKey`, not `sessionId`). A single client session controls all characters. Bulk card selection per character. Phase machine with sequence progression.

### Client scenes

`BootScene` → `LobbyScene` → `SetupScene` (board selection) → `TokenPlacementScene` (character placement) → `MatchmakingScene` → `GameScene`

- **SetupScene**: Select and arrange board tiles into a composite map. Boards snap to adjacent edges. Scroll wheel rotates boards.
- **TokenPlacementScene**: Place character tokens on the board composite. Click a character in the bottom strip to select, click board to place. Scroll wheel rotates in 60° increments. Requires ≥2 tokens to proceed.
- **MatchmakingScene**: Passes `boards` + `tokens` setup data to Colyseus room creation. Token placement order = player order.
- **GameScene**: Renders actual board composite + character tokens. Per-character action card selection with choice mode (hex picking, target selection). Card strip shows front/back rows (24 actions visible).

All scenes use the `buildAll()` + resize-handler pattern for responsive layout.

### Shared types (`shared/src/index.ts`)

- `Player` — keyed by `charKey` (e.g. `"marshal"`), has `ownerSessionId`, layout-space position (`lx`, `ly`, `angle`, `hexId`)
- `ActionCardDef` — 12 physical cards, each with `front` and `back` `ActionSideDef` (name, cost, category, choiceType)
- `ActionCardSelection` — card number + side + optional `CardChoice`
- `GameState` — phase, turn, currentSequence, playerOrder, players, selectedCards, boards
- `CHAR_ARROW_DIR` — per-character default arrow direction index (all tokens are either NE=1 or NW=5)

### Hex system (`client/src/hex/neighbors.ts`)

- `HexNeighborMap` — loads `hex_grid.json`, transforms all hex positions into unified layout space across boards, finds 6 neighbors by distance+angle classification
- Hex grid uses flat-top hexes with offset columns. Hex IDs: `{Board}-{Col}{Row}` (e.g. `A-C5`)
- 6 directions indexed 0–5: N, NE, SE, S, SW, NW
- `angleToDirIndex(angle, charKey)` accounts for per-character arrow offset

## Game Rules (from rules.pdf + card analysis)

### Turn Structure

1. **Action selection**: each player picks action cards for each character (cost sum ≤ 5 sequences)
2. **Sequences 1–5**: actions resolve in sequence order (TODO: resolution logic)
3. **Turn end**: check game-over conditions, advance to next turn
4. Game ends at max turns (default 20) or when no opposition remains (last standing or team)

### Action Cards

12 physical cards with front and back (24 possible actions). **Cannot use both sides of the same card in one turn.** Each side has a sequence cost (1–3). Total cost per turn ≤ 5.

| Card | Front (cost) | Back (cost) | Front choice | Back choice |
|------|-------------|-------------|--------------|-------------|
| 1 | Advance (2) | Back Up (3) | move_ahead | move_back |
| 2 | Run (1) | Spin Around (2) | move_ahead | turn_back |
| 3 | Sprint (1) | Turn (1) | none (auto straight) | turn_ahead |
| 4 | Sprint (1) | Leap/Drop (1) | none (auto straight) | none |
| 5 | Cock/Aim/Shoot (2) | Get Up/Down (3) | target_ranged | none |
| 6 | Cock/Aim/Shoot (2) | Throw (2) | target_ranged | target_ranged |
| 7 | Shoot (1) | Strength (2) | target_ranged | none |
| 8 | Load (3) | Head Out/Back (2) | none | none |
| 9 | Draw & Cock (3) | Head Out/Back (2) | none | none |
| 10 | Jab (2) | Duck (1) | target_melee | target_defend |
| 11 | Swing (3) | Block (2) | target_melee | target_defend |
| 12 | Belt (3) | Guard (2) | target_melee | target_defend |

### Movement Directions (relative to facing)

- **Ahead**: straight ahead, ahead_left, ahead_right (±60° from facing)
- **Back**: straight back, back_left, back_right (±60° from backward)
- `facingIndex = (CHAR_ARROW_DIR[charKey] + angle/60) % 6`
- Advance/Run: player picks 1 of 3 forward hexes
- Back Up: player picks 1 of 3 backward hexes
- Sprint: auto-moves straight ahead (no choice)
- Turn: player picks new facing from 3 forward directions
- Spin Around: player picks new facing from 3 backward directions

### Character Token Facing

Each character token has a black arrow baked into the PNG at a fixed angle. At `angle=0` (unrotated), tokens face either **NE (direction 1)** or **NW (direction 5)** — see `CHAR_ARROW_DIR` in shared types. When the token is rotated by 60° increments, the facing changes accordingly.

### Card Selection UX

- During action selection, foot cards **preview** movement (token moves on board to help pick hexes)
- On confirm, token **resets to original position** — actual resolution happens during sequences
- Cards are replayed in card number order (1→12) for deterministic preview
- Selecting a card blocks its opposite side (dimmed, unclickable)
- Cards that would exceed cost cap of 5 are dimmed

## Asset Pipeline

```bash
pip install -r requirements.txt          # httpx, tqdm
python scripts/fetch_assets.py           # download all images to assets/
python scripts/fetch_assets.py --dry-run # preview plan without downloading
```

All assets are already downloaded. Do not re-run unless `tts_mod.json` changes.

### `assets/` (from TTS mod)
- ~161 images (imgur + Steam CDN); 5 Steam CDN tiles inaccessible (403, `face_file: null` in catalog)
- Board maps: `board_A.png` … `board_H.png` + `board_AA.png` … `board_HH.png` + `board_UFC*.png` — high-res at **1600×2232**
- Card sprite sheets: 14 sheets, largest at 6030×5516 (603×788 per card)
- Action cards: `action_card_a{1-12}.png` (front) + `action_card_a{1-12}_back.png` (back), 180×245 px
- Character tokens: `char_*.png` (48 tokens, 95×95 px)
- Hex grid: `hex_grid.json` (coords scaled 2x to match 1600×2232 boards)

### `assets/local/` (from VASSAL module, partially merged)
- `animal_*.png`, `activity_*.png`, `state_*.png`, `obj_*.png`, legend sheets, player aids

## TODO

- **Sequence resolution**: implement actual action execution during sequences 1–5
- **Finish merging asset sources**: `assets/local/` still has unmerged tokens/markers
- **Board display extraction**: `BOARD_DIMS` and transform logic duplicated across SetupScene, TokenPlacementScene, GameScene — extract to shared module
