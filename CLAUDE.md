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

### `assets/vassal/` (from VASSAL module v1.9.2)
Extracted from `Gunslinger_v_1.9.2.vmod` (ZIP). Named by parsing `buildFile.xml` piece definitions. All **296 PNGs + 17 JPGs**. Key groups:
- `result_card_NNN.png` — 108 individual result cards (180×245 px)
- `action_card_a{N}[_back].png` — action cards A1–A12
- `char_*.png` — 40 character tokens (95×95 px); names derived from `piece;C;X;IMG;NAME` XML pattern
- `animal_*.png` — 9 animal tokens
- `counter_*.png` — 22 counters
- `activity_*.png` — 9 activity markers (aim, facing, load, move, etc.)
- `legend_sheet_{N}[_back].png` — 5 legend sheets (1100×1204 px)
- `state_*.png` — 4 state markers (down, passed_out, surrendered, dead)
- `obj_*.png` — 3 objects (bale, chair, table)

**Note on transparency**: VASSAL GIFs were converted to PNG. Source images have binary transparency ([0, 255] alpha only — no anti-aliasing). Smooth edges would require post-processing the alpha channel.

## Current Repository Contents

- `tts_mod.json` — Tabletop Simulator mod save (v12.0.4); source of all image URLs.
- `rules.pdf` — The 36-page original Gunslinger rulebook (primary design reference).
- `assets/` — Downloaded game artwork and `catalog.json`.
- `assets/vassal/` — VASSAL module assets (tokens, cards, markers).
- `scripts/fetch_assets.py` — Asset download script.

## TODO

- **Merge asset sources**: `assets/` (TTS) and `assets/vassal/` contain overlapping images (same cards/tokens from two sources). Consolidate into a single flat directory to avoid duplication and simplify asset references in game code. Prefer the higher-resolution source per image type.

## Key Design Reference

The `rules.pdf` is the authoritative source for game mechanics. Core systems to be aware of:

- **Hex-grid movement** with facing and terrain effects.
- **Action-point economy** — each character has a limited pool of points per turn spent on move, aim, draw, fire, etc.
- **Hit resolution** — shots resolve against body-location tables, producing wound effects that degrade character stats over time.
- **Multiple weapon types** with different range, accuracy, and rate-of-fire profiles.
- **Simultaneous-ish turns** — actions are declared and resolved in a specific sequence (not pure alternating).
