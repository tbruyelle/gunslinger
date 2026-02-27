#!/usr/bin/env python3
"""
Parse hex grid snap-point data from a VASSAL module buildFile.xml.

Extracts hex center coordinates from Region definitions, scales them to
match the high-res board images (1600x2232), and writes assets/hex_grid.json.

Usage:
    python scripts/parse_hex_grid.py                  # parse and write
    python scripts/parse_hex_grid.py --dry-run         # show stats only
    python scripts/parse_hex_grid.py --verbose         # debug logging
"""
import argparse
import json
import logging
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

log = logging.getLogger("parse_hex_grid")

VMOD_PATH = Path("assets/vassal_v2/Gunslinger_v2.0.vmod")
OUTPUT_PATH = Path("assets/hex_grid.json")

# VASSAL images are 800x1116; our board images are 1600x2232.
SCALE_FACTOR = 2.0

# Fully-qualified VASSAL XML tag names
TAG_BOARD = "VASSAL.build.module.map.boardPicker.Board"
TAG_REGION = "VASSAL.build.module.map.boardPicker.board.Region"


def derive_board_key(name: str) -> str:
    """Derive a board key from the VASSAL board name attribute.

    Board names follow the pattern "CODE: Description", e.g.:
        "A: Corral"           → "board_A"
        "AA: Gunsmith"        → "board_AA"
        "UFC: Stable"         → "board_UFC"
        "NN: Warehouse 2nd Floor" → "board_NN_floor2"
        "SM2:  2nd Floor"     → "board_SM2_floor2"
    """
    code, _, desc = name.partition(":")
    code = code.strip()
    desc = desc.strip()

    key = f"board_{code}"

    # Append floor suffix for overlay boards
    floor_match = re.search(r"(\d+)(?:st|nd|rd|th)\s+[Ff]loor", desc)
    if floor_match:
        key += f"_floor{floor_match.group(1)}"

    return key


def parse_vmod(vmod_path: Path) -> dict:
    """Extract hex grid data from a VASSAL .vmod file."""
    with zipfile.ZipFile(vmod_path) as zf:
        data = zf.read("buildFile.xml")

    root = ET.fromstring(data)
    boards = {}

    for board_elem in root.iter(TAG_BOARD):
        image = board_elem.get("image", "")
        name = board_elem.get("name", "")

        # Only process actual game boards (name has "CODE: desc" format)
        if ":" not in name:
            log.debug("Skipping %r (%s): not a game board", name, image)
            continue

        regions = list(board_elem.iter(TAG_REGION))
        if not regions:
            log.debug("Skipping %s (%s): no regions", name, image)
            continue

        key = derive_board_key(name)

        hexes = []
        for region in regions:
            hex_id = region.get("name", "")
            ox = int(region.get("originx", "0"))
            oy = int(region.get("originy", "0"))
            hexes.append({
                "id": hex_id,
                "x": round(ox * SCALE_FACTOR),
                "y": round(oy * SCALE_FACTOR),
            })

        boards[key] = {
            "name": name,
            "image": image,
            "hexes": hexes,
        }
        log.debug("  %s: %d hexes", key, len(hexes))

    return {
        "scale_factor": SCALE_FACTOR,
        "source": "Gunslinger_v2.0.vmod/buildFile.xml",
        "boards": boards,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Parse hex grid data from VASSAL module"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Show stats only, don't write output"
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Enable debug logging"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    if not VMOD_PATH.exists():
        log.error("VMOD file not found: %s", VMOD_PATH)
        sys.exit(1)

    result = parse_vmod(VMOD_PATH)
    boards = result["boards"]

    total_hexes = sum(len(b["hexes"]) for b in boards.values())
    log.info("Parsed %d boards with %d total hexes", len(boards), total_hexes)

    for key in sorted(boards):
        b = boards[key]
        log.info("  %-30s %-35s %4d hexes", key, b["name"], len(b["hexes"]))

    if args.dry_run:
        log.info("Dry run — no output written")
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f, indent=2)
    log.info(
        "Wrote %s (%.1f KB)", OUTPUT_PATH, OUTPUT_PATH.stat().st_size / 1024
    )


if __name__ == "__main__":
    main()
