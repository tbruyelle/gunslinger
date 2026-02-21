#!/usr/bin/env python3
"""
Download all image assets from a Tabletop Simulator mod file.

Usage:
    python scripts/fetch_assets.py [--mod tts_mod.json] [--out assets]
                                   [--concurrency 10] [--dry-run] [--verbose]
"""
import argparse
import asyncio
import json
import logging
import re
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import httpx
from tqdm.asyncio import tqdm as atqdm

log = logging.getLogger("fetch_assets")

# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def clean_url(url: str) -> str:
    """Strip TTS-specific markers like {Unique} and whitespace."""
    return re.sub(r"\{[^}]*\}", "", url).strip()


def url_stem(url: str) -> str:
    """Extract a human-meaningful, filesystem-safe ID from a URL.

    Examples:
        http://i.imgur.com/UgOkLTf.jpg  ->  UgOkLTf
        https://cloud-3.steamusercontent.com/ugc/.../2256A5C.../  ->  2256A5C...
    """
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    stem = PurePosixPath(path).stem
    return stem or parsed.netloc


def guess_ext_from_url(url: str) -> str:
    """Guess file extension from URL path; default .jpg."""
    parsed = urlparse(url)
    suffix = PurePosixPath(parsed.path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".jpg"


def ext_from_content_type(ct: str) -> str:
    """Map a Content-Type value to a file extension."""
    ct = ct.split(";")[0].strip().lower()
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }.get(ct, ".jpg")


def sanitize_name(s: str) -> str:
    """Convert a TTS Nickname to a safe filename fragment."""
    s = re.sub(r"[^\w\-]", "_", s.strip())
    s = re.sub(r"_+", "_", s).strip("_").lower()
    return s if s else "unnamed"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def collect_objects(data: dict) -> tuple[dict, list]:
    """Recursively walk ObjectStates and collect asset information.

    Returns:
        sprite_sheets: dict keyed by (face_url, back_url) →
            {face_url, back_url, num_width, num_height, unique_back,
             back_is_hidden, cards: [...]}
        custom_images: list of
            {guid, nickname, type, image_url, secondary_url}
    """
    sprite_sheets: dict[tuple, dict] = {}
    custom_images: list[dict] = []
    skipped_cards = 0

    def walk(obj: dict, inherited_cd: dict) -> None:
        nonlocal skipped_cards

        name = obj.get("Name", "")

        # Merge inherited CustomDeck with this object's own (local wins)
        local_cd = obj.get("CustomDeck") or {}
        effective_cd = {**inherited_cd, **local_cd}

        # --- Cards ---
        if name in ("Card", "CardCustom"):
            raw_id = obj.get("CardID")
            if raw_id is None:
                log.warning("Card %s has no CardID, skipping", obj.get("GUID"))
                skipped_cards += 1
            else:
                card_id = int(raw_id)
                deck_key = str(card_id // 100)
                si = effective_cd.get(deck_key)
                if si is None:
                    log.warning(
                        "Card %s CardID=%s: deck_key '%s' not in effective CustomDeck, skipping",
                        obj.get("GUID"), card_id, deck_key,
                    )
                    skipped_cards += 1
                else:
                    face = clean_url(si.get("FaceURL", ""))
                    back = clean_url(si.get("BackURL", ""))
                    if not face:
                        log.warning("Card %s has empty FaceURL", obj.get("GUID"))
                    else:
                        pair = (face, back)
                        if pair not in sprite_sheets:
                            sprite_sheets[pair] = {
                                "face_url": face,
                                "back_url": back,
                                "num_width": int(si.get("NumWidth", 10)),
                                "num_height": int(si.get("NumHeight", 7)),
                                "unique_back": bool(si.get("UniqueBack", False)),
                                "back_is_hidden": bool(si.get("BackIsHidden", False)),
                                "cards": [],
                            }
                        sheet = sprite_sheets[pair]
                        nw = sheet["num_width"]
                        idx = card_id % 100
                        sheet["cards"].append({
                            "guid": obj.get("GUID", ""),
                            "nickname": obj.get("Nickname", ""),
                            "card_id": card_id,
                            "sheet_index": idx,
                            "row": idx // nw,
                            "col": idx % nw,
                        })

        # --- Custom image objects ---
        elif name in ("Custom_Token", "Custom_Tile"):
            ci = obj.get("CustomImage") or {}
            img_url = clean_url(ci.get("ImageURL", ""))
            sec_url = clean_url(ci.get("ImageSecondaryURL", "")) or None
            if img_url:
                custom_images.append({
                    "guid": obj.get("GUID", ""),
                    "nickname": obj.get("Nickname", ""),
                    "type": name,
                    "image_url": img_url,
                    "secondary_url": sec_url,
                })
            else:
                log.warning("%s %s has empty ImageURL", name, obj.get("GUID"))

        # --- Recurse into children ---
        for child in obj.get("ContainedObjects") or []:
            walk(child, effective_cd)

    for obj in data.get("ObjectStates", []):
        walk(obj, {})

    if skipped_cards:
        log.warning("Skipped %d cards due to missing CardID or deck definition", skipped_cards)

    return sprite_sheets, custom_images


# ---------------------------------------------------------------------------
# Download planning
# ---------------------------------------------------------------------------

def build_download_plan(
    sprite_sheets: dict,
    custom_images: list,
    assets_dir: Path,
) -> dict[str, Path]:
    """Build a deduplicated {url: target_path} map for all downloads."""
    url_to_path: dict[str, Path] = {}

    # Sprite sheets
    for (face_url, back_url), sheet in sprite_sheets.items():
        face_stem = url_stem(face_url)

        if face_url not in url_to_path:
            ext = guess_ext_from_url(face_url)
            url_to_path[face_url] = assets_dir / f"{face_stem}_face{ext}"

        if back_url and back_url not in url_to_path:
            if back_url == face_url:
                # Same URL → same file; back_file in catalog will mirror face_file
                url_to_path[back_url] = url_to_path[face_url]
            else:
                back_stem = url_stem(back_url)
                ext = guess_ext_from_url(back_url)
                url_to_path[back_url] = assets_dir / f"{back_stem}_back{ext}"

    # Custom images
    for ci in custom_images:
        guid = ci["guid"]
        nick = sanitize_name(ci["nickname"])
        img_url = ci["image_url"]
        sec_url = ci["secondary_url"]
        has_secondary = bool(sec_url)

        if img_url not in url_to_path:
            ext = guess_ext_from_url(img_url)
            suffix = "_face" if has_secondary else ""
            url_to_path[img_url] = assets_dir / f"{guid}_{nick}{suffix}{ext}"

        if sec_url and sec_url not in url_to_path:
            ext = guess_ext_from_url(sec_url)
            url_to_path[sec_url] = assets_dir / f"{guid}_{nick}_back{ext}"

    return url_to_path


# ---------------------------------------------------------------------------
# Downloading
# ---------------------------------------------------------------------------

async def download_one(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    url: str,
    path: Path,
    dry_run: bool,
) -> tuple[str, Path, bool, str | None]:
    """Download url to path. Returns (url, final_path, success, error_msg)."""
    async with semaphore:
        if dry_run:
            return url, path, True, None

        if path.exists():
            log.debug("Skip (exists): %s", path.name)
            return url, path, True, None

        try:
            async with client.stream("GET", url, follow_redirects=True) as resp:
                resp.raise_for_status()

                # Correct extension from actual Content-Type
                ct = resp.headers.get("content-type", "")
                true_ext = ext_from_content_type(ct)
                if true_ext != path.suffix.lower():
                    path = path.with_suffix(true_ext)
                    if path.exists():
                        return url, path, True, None

                chunks = []
                async for chunk in resp.aiter_bytes(65536):
                    chunks.append(chunk)
                data = b"".join(chunks)

                await asyncio.to_thread(path.write_bytes, data)
                log.debug("OK %s → %s (%d B)", url[-50:], path.name, len(data))
                return url, path, True, None

        except httpx.HTTPStatusError as exc:
            msg = f"HTTP {exc.response.status_code}"
            log.warning("FAIL %s: %s", url, msg)
            return url, path, False, msg
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            log.warning("FAIL %s: %s", url, msg)
            return url, path, False, msg


async def download_all(
    url_to_path: dict[str, Path],
    concurrency: int,
    dry_run: bool,
) -> dict[str, Path]:
    """Download all URLs concurrently; return {url: final_path} with corrected exts."""
    semaphore = asyncio.Semaphore(concurrency)
    limits = httpx.Limits(max_keepalive_connections=concurrency, max_connections=concurrency * 2)
    headers = {"User-Agent": "gunslinger-asset-fetcher/1.0"}
    timeout = httpx.Timeout(30.0, connect=10.0)

    results: dict[str, Path] = {}
    failed: list[tuple[str, str]] = []

    async with httpx.AsyncClient(timeout=timeout, headers=headers, limits=limits) as client:
        coros = [
            download_one(client, semaphore, url, path, dry_run)
            for url, path in url_to_path.items()
        ]
        for coro in atqdm.as_completed(coros, total=len(coros), desc="Downloading"):
            url, final_path, success, err = await coro
            if success:
                results[url] = final_path
            else:
                failed.append((url, err or "unknown"))

    if failed:
        log.error("%d download(s) failed:", len(failed))
        for furl, ferr in failed:
            log.error("  %s  →  %s", furl, ferr)

    return results


# ---------------------------------------------------------------------------
# Catalog assembly
# ---------------------------------------------------------------------------

def build_catalog(
    sprite_sheets: dict,
    custom_images: list,
    url_to_final: dict[str, Path],
) -> dict:
    catalog: dict = {"sprite_sheets": [], "images": []}

    for (face_url, back_url), sheet in sprite_sheets.items():
        face_path = url_to_final.get(face_url)
        back_path = url_to_final.get(back_url) if back_url else None
        catalog["sprite_sheets"].append({
            "id": url_stem(face_url),
            "face_file": str(face_path) if face_path else None,
            "back_file": str(back_path) if back_path else None,
            "num_width": sheet["num_width"],
            "num_height": sheet["num_height"],
            "unique_back": sheet["unique_back"],
            "cards": sheet["cards"],
        })

    for ci in custom_images:
        img_url = ci["image_url"]
        sec_url = ci["secondary_url"]
        face_path = url_to_final.get(img_url)
        back_path = url_to_final.get(sec_url) if sec_url else None
        entry: dict = {
            "guid": ci["guid"],
            "nickname": ci["nickname"],
            "type": ci["type"],
            "face_file": str(face_path) if face_path else None,
        }
        if back_path:
            entry["back_file"] = str(back_path)
        catalog["images"].append(entry)

    return catalog


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mod", default="tts_mod.json", help="Path to tts_mod.json")
    p.add_argument("--out", default="assets", help="Output directory for assets")
    p.add_argument("--concurrency", type=int, default=10, help="Max simultaneous downloads")
    p.add_argument("--dry-run", action="store_true", help="Plan without downloading")
    p.add_argument("--verbose", action="store_true", help="Enable DEBUG logging")
    return p.parse_args()


async def async_main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    mod_path = Path(args.mod)
    assets_dir = Path(args.out)
    catalog_path = assets_dir / "catalog.json"

    # Load mod
    log.info("Loading %s …", mod_path)
    try:
        data = json.loads(mod_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        log.error("File not found: %s", mod_path)
        return 1
    except json.JSONDecodeError as exc:
        log.error("JSON parse error: %s", exc)
        return 1

    # Collect assets
    sprite_sheets, custom_images = collect_objects(data)
    total_cards = sum(len(s["cards"]) for s in sprite_sheets.values())
    log.info(
        "Found %d sprite sheet(s) covering %d card(s), %d custom image object(s)",
        len(sprite_sheets), total_cards, len(custom_images),
    )

    # Plan downloads
    url_to_path = build_download_plan(sprite_sheets, custom_images, assets_dir)
    log.info("%d distinct URL(s) to download", len(url_to_path))

    if args.dry_run:
        log.info("Dry-run: skipping downloads")
        url_to_final = {url: path for url, path in url_to_path.items()}
    else:
        assets_dir.mkdir(parents=True, exist_ok=True)
        url_to_final = await download_all(url_to_path, args.concurrency, dry_run=False)

    # Write catalog
    catalog = build_catalog(sprite_sheets, custom_images, url_to_final)
    assets_dir.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Catalog written → %s", catalog_path)

    ok = len(url_to_final)
    total = len(url_to_path)
    failed = total - ok
    print(f"\nDone: {ok}/{total} file(s) downloaded" + (f", {failed} failed" if failed else ""))
    print(f"Catalog: {catalog_path}")
    return 1 if failed else 0


def main() -> None:
    sys.exit(asyncio.run(async_main()))


if __name__ == "__main__":
    main()
