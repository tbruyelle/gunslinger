# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

This repository is the starting point for a digital game inspired by the 1982 AH board game **Gunslinger** — a tactical Old West gunfight simulation with hex-based movement, action-point economy, and a detailed hit-location/wound system.

The technology stack has not been chosen yet. When it is, update this file with build/run/test commands.

## Asset Pipeline

```bash
pip install -r requirements.txt          # httpx, tqdm
python scripts/fetch_assets.py           # download all images to assets/
python scripts/fetch_assets.py --dry-run # preview plan without downloading
```

`fetch_assets.py` parses `tts_mod.json` recursively, deduplicates the ~166 image URLs, downloads them concurrently, and writes `assets/catalog.json`.

**Catalog structure** (`assets/catalog.json`):
- `sprite_sheets[]` — card sprite sheets with `face_file`, `back_file`, `num_width`/`num_height` (all 10×7 except one 1×1), and a `cards[]` list with `guid`, `card_id`, `sheet_index`, `row`, `col`.
- `images[]` — individual token/tile images with `face_file` and optional `back_file`.

**Naming convention**: `{guid}_{type}[_face|_back].{ext}` for tokens/tiles (type = `custom_token` or `custom_tile`); `{url_stem}_face.{ext}` / `{url_stem}_back.{ext}` for sprite sheets.

**CardID math**: `sheet_index = card_id % 100`, `row = sheet_index // num_width`, `col = sheet_index % num_width`.

## Asset Inventory

All assets are already downloaded. Do not re-run the full pipeline unless `tts_mod.json` changes.

### `assets/` (from TTS mod)
- ~161 images (imgur + Steam CDN); 5 Steam CDN tiles inaccessible (403, `face_file: null` in catalog)
- Board maps: `board_A.png` … `board_H.png` + `board_AA.png` … `board_HH.png` + `board_UFC*.png` — high-res scans at **1600×2232** (sourced from cryhavocgames.net GSL Maps pack, higher quality than TTS mod)
- Card sprite sheets: 14 sheets, largest at 6030×5516 (603×788 per card)

### `assets/local/` (from VASSAL module v1.9.2, partially merged)
Extracted from `Gunslinger_v_1.9.2.vmod` (ZIP). Named by parsing `buildFile.xml` piece definitions. Originally `assets/vassal/`; merge into `assets/` is in progress. Currently contains:
- `animal_*.png` — 9 animal tokens + dead variants
- `activity_*.png` — 9 activity markers (aim, facing, load, move, etc.)
- `state_*.png` — 4 state markers (down, passed_out, surrendered, dead)
- `obj_*.png` — 3 objects (bale, chair, table)
- `legend_sheet_{N}[_back].png` — legend sheets (1100×1204 px)
- `card_back.png`, `token_stage.png`
- Player aid JPGs, Gunsmith tables, critters reference sheets
- Some unmerged `*_custom_token.jpg/png` files

Already moved to `assets/`: `char_*.png` (48 character tokens, 95×95 px), `result_card_NNN.png` (108 cards), `action_card_a{N}[_back].png`, `counter_b{N}[_*].png`, `splash_screen.png`.

**Note on transparency**: VASSAL GIFs were converted to PNG. Source images have binary transparency ([0, 255] alpha only — no anti-aliasing). Smooth edges would require post-processing the alpha channel.

## Current Repository Contents

- `tts_mod.json` — Tabletop Simulator mod save (v12.0.4); source of all image URLs.
- `rules.pdf` — The 36-page original Gunslinger rulebook (primary design reference).
- `assets/` — Downloaded game artwork and `catalog.json`.
- `assets/local/` — VASSAL module assets not yet merged (tokens, markers, player aids).
- `scripts/fetch_assets.py` — Asset download script.

## TODO

- **Finish merging asset sources**: `assets/local/` still contains animals, activity markers, states, objects, legend sheets, and some unmatched `*_custom_token` files. Consolidate remaining files into `assets/` and remove `assets/local/`. Prefer the higher-resolution source per image type.

## Setup Flow (client scenes)

`LobbyScene` → `SetupScene` (board selection) → `TokenPlacementScene` (character placement) → `MatchmakingScene` → `GameScene`

- **SetupScene**: Select and arrange board tiles into a composite map. Boards snap to adjacent edges. Scroll wheel rotates boards. Supports back-navigation from TokenPlacementScene (restores board state via `init(data)`).
- **TokenPlacementScene**: Place character tokens on the board composite. Click a character in the bottom strip to select it (appears as a cursor-following sprite), then click on a board to place. Scroll wheel rotates the pending token in 60° increments (hex facings) with animated tweens. Requires ≥2 tokens to proceed. Back returns to SetupScene preserving boards.

Both scenes use the `buildAll()` + resize-handler pattern for responsive layout (top bar, arrangement area, bottom strip).

## Key Design Reference

The `rules.pdf` is the authoritative source for game mechanics. Core systems to be aware of:

- **Hex-grid movement** with facing and terrain effects.
- **Action-point economy** — each character has a limited pool of points per turn spent on move, aim, draw, fire, etc.
- **Hit resolution** — shots resolve against body-location tables, producing wound effects that degrade character stats over time.
- **Multiple weapon types** with different range, accuracy, and rate-of-fire profiles.
- **Simultaneous-ish turns** — actions are declared and resolved in a specific sequence (not pure alternating).
