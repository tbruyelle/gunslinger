import type { GunView } from "../chain/types";
import { CHAR_ARROW_DIR } from "../rules";
import template from "./characterSheet.html?raw";

/** What the sheet shows for one character. */
export interface SheetData {
  name: string;
  charKey: string;
  seat: number;
  hex: string;
  facing: number;
  down: boolean;
  delay: number;
  status: string;
  submitted: boolean;
  phase: string;
  isMe: boolean;
  guns: GunView[];
  /** AIM points and the hex the markers sit on ("" when they follow the opponent). */
  aim: number;
  aimHex: string;
  /** Endurance boxes left (20 at the start). */
  endurance: number;
  /** Permanent wounds. */
  serious: number;
  gunArm: number;
  otherArm: number;
  leg: number;
}

const DIRS = ["N", "NE", "SE", "S", "SW", "NW"];
/** Accent colour per seat, from the design's palette. */
const ACCENTS = ["#33307F", "#8E2F1A"];
const SHEET_W = 1100;
const SHEET_H = 850;
/** Length of the open/close animation. */
const ANIM_MS = 180;

/**
 * Lets the player pick a holstered gun by dragging it to a hand box (or
 * clicking it, which targets the gun hand); onPick gets the gun id and the
 * hand code (0 gun hand, 1 other hand, 2 both hands). Only the gun hand
 * accepts drops for now.
 */
export interface GunPick {
  prompt: string;
  onPick: (gunId: number, hand: number) => void;
}

const DROP_HANDS: { box: string; hand: number }[] = [{ box: "gun_hand", hand: 0 }];

let backdrop: HTMLDivElement | null = null;
let onClose: (() => void) | null = null;

/**
 * Opens the character sheet as an HTML overlay above the game canvas.
 * onClosed runs once the sheet is closed, however it was closed. With pick,
 * the holstered guns can be dragged to the GUN HAND box; dropping one calls
 * onPick(slot) and closes the sheet.
 */
export function openCharacterSheet(d: SheetData, onClosed?: () => void, pick?: GunPick): void {
  closeCharacterSheet();
  onClose = onClosed ?? null;
  const accent = ACCENTS[d.seat] ?? ACCENTS[0];
  const html = template
    .replace(/{{accent}}/g, accent)
    .replace("{{characterName}}", escapeHtml(d.name))
    .replace("{{tokenImage}}", tokenImage(d))
    .replace("{{statusRow}}", statusRow(d, accent))
    .replace("{{otherHand}}", gunBox(d.guns, "other_hand", pick))
    .replace("{{bothHands}}", gunBox(d.guns, "both_hands", pick))
    .replace("{{gunHand}}", gunBox(d.guns, "gun_hand", pick))
    .replace("{{holstered}}", gunBox(d.guns, "holstered", pick))
    .replace("{{serious}}", wound(d.serious, "fatigue card per turn"))
    .replace("{{gunArm}}", wound(d.gunArm, "aim time with the gun hand", "−"))
    .replace("{{otherArm}}", wound(d.otherArm, "aim time with the other hand", "−"))
    .replace("{{leg}}", wound(d.leg, "fatigue card per hex moved"));

  backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(10,6,2,.72);cursor:pointer;" +
    `opacity:0;transition:opacity ${ANIM_MS}ms ease-out`;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeCharacterSheet();
  });
  // Keep every pointer event on the overlay away from the game canvas.
  for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "touchstart", "touchend", "wheel"]) {
    backdrop.addEventListener(type, (e) => e.stopPropagation(), { passive: type === "wheel" });
  }

  const frame = document.createElement("div");
  frame.style.cssText =
    "position:relative;cursor:default;transform-origin:center center;" +
    `transition:transform ${ANIM_MS}ms cubic-bezier(.2,.8,.3,1.1),opacity ${ANIM_MS}ms ease-out;opacity:0`;
  frame.innerHTML = (pick ? promptBanner(pick.prompt) : "") + html;
  markEndurance(frame, d.endurance);
  if (pick) wirePick(frame, pick);
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.style.cssText =
    "position:absolute;top:22px;right:26px;width:40px;height:40px;border-radius:50%;border:3px solid #2A1C14;background:#F3E7CE;color:#2A1C14;font:700 26px/1 'Zilla Slab',Rockwell,serif;cursor:pointer";
  close.addEventListener("click", closeCharacterSheet);
  frame.appendChild(close);
  backdrop.appendChild(frame);
  document.body.appendChild(backdrop);

  let scale = 1;
  const fit = () => {
    const h = Math.max(SHEET_H, frame.querySelector<HTMLElement>(".gs-sheet")?.offsetHeight ?? SHEET_H);
    scale = Math.min(1, (window.innerWidth - 32) / SHEET_W, (window.innerHeight - 32) / h);
    frame.style.transform = `scale(${scale})`;
  };
  // Start slightly smaller and lower, then settle: the transition does the rest.
  fit();
  frame.style.transform = `scale(${scale * 0.94}) translateY(16px)`;
  requestAnimationFrame(() => {
    if (!backdrop) return;
    backdrop.style.opacity = "1";
    frame.style.opacity = "1";
    frame.style.transform = `scale(${scale})`;
  });
  exitAnimation = () => {
    frame.style.transform = `scale(${scale * 0.96}) translateY(8px)`;
    frame.style.opacity = "0";
  };
  window.addEventListener("resize", fit);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeCharacterSheet();
  };
  window.addEventListener("keydown", onKey);
  cleanup = () => {
    window.removeEventListener("resize", fit);
    window.removeEventListener("keydown", onKey);
  };
}

let cleanup: (() => void) | null = null;
let exitAnimation: (() => void) | null = null;

export function closeCharacterSheet(): void {
  const el = backdrop;
  if (!el) return;
  cleanup?.();
  cleanup = null;
  backdrop = null;
  // Fade out, then drop the element.
  el.style.pointerEvents = "none";
  el.style.opacity = "0";
  exitAnimation?.();
  exitAnimation = null;
  setTimeout(() => el.remove(), ANIM_MS + 20);
  const cb = onClose;
  onClose = null;
  cb?.();
}

export function isCharacterSheetOpen(): boolean {
  return backdrop !== null;
}

/** Rotation that stands the figure upright: the art is drawn 30° off, leaning toward the arrow's side. */
const SHEET_UPRIGHT_DEG = 30;

/**
 * The token turned to stand upright, an orientation the board never uses
 * (board facings are the six hex directions, 60° apart). Tokens whose arrow
 * points NE turn clockwise, those pointing NW counter-clockwise.
 */
function tokenImage(d: SheetData): string {
  const deg = CHAR_ARROW_DIR[d.charKey] === 5 ? -SHEET_UPRIGHT_DEG : SHEET_UPRIGHT_DEG;
  return `<img src="/char_${escapeHtml(d.charKey)}.png" alt="" style="width: 84px; height: 84px; border-radius: 50%; border: 3px solid #2A1C14; background: #FBF4E4; transform: rotate(${deg}deg); flex: none">`;
}

function statusRow(d: SheetData, accent: string): string {
  const chip = (label: string, value: string, strong = false) =>
    `<div style="display: flex; align-items: baseline; gap: 8px; border: 2px solid #2A1C14; border-radius: 8px; padding: 4px 12px; background: ${strong ? "#8E2F1A" : "#FBF4E4"}; color: ${strong ? "#F3E7CE" : "#2A1C14"}"><span style="font-size: 14px; letter-spacing: 2px; font-weight: 700">${label}</span><span style="font-size: 20px; font-weight: 700">${value}</span></div>`;
  const plan = d.phase === "planning" ? (d.submitted ? "SENT" : "PENDING") : d.phase.toUpperCase();
  const chips = [
    chip("HEX", escapeHtml(d.hex)),
    chip("FACING", DIRS[d.facing] ?? String(d.facing)),
    chip("DELAY", String(d.delay), d.delay > 0),
    d.down ? chip("BODY", "DOWN", true) : chip("BODY", "UPRIGHT"),
    chip("STATUS", escapeHtml(d.status.replace(/_/g, " ").toUpperCase()), d.status !== "alive"),
    chip("AIM", d.aim > 0 ? `${d.aim}${d.aimHex ? ` on ${escapeHtml(d.aimHex)}` : " on target"}` : "0", d.aim > 0),
    chip("END", String(d.endurance), d.endurance < 10),
    chip("PLAN", plan),
  ];
  if (d.isMe) chips.push(`<div style="margin-left: auto; font-family: Rye, Georgia, serif; font-size: 22px; color: ${accent}; letter-spacing: 1px">YOUR CHARACTER</div>`);
  return `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px">${chips.join("")}</div>`;
}

/** A permanent wound value, with its meaning; empty when none. */
function wound(n: number, meaning: string, sign = ""): string {
  if (n <= 0) return "";
  return `<span style="font-size: 26px; color: #8E2F1A">${sign}${n}</span><span style="margin-left: 12px; font-weight: 400; font-size: 15px; letter-spacing: 0">${escapeHtml(meaning)}${n > 1 && sign === "" ? "s" : ""}</span>`;
}

/** Crosses off the endurance boxes above the ones left. */
function markEndurance(frame: HTMLElement, endurance: number) {
  frame.querySelectorAll<HTMLElement>("[data-end]").forEach((box) => {
    const n = Number(box.dataset.end);
    if (n > endurance) {
      box.style.background = "repeating-linear-gradient(45deg, #2A1C14 0 3px, transparent 3px 9px)";
      box.style.color = "#8E2F1A";
    }
  });
}

/** The instruction shown above the sheet while a gun is being picked. */
function promptBanner(text: string): string {
  return (
    `<div style="margin: 0 0 12px; padding: 12px 20px; border-radius: 14px; background: #8E2F1A; color: #F3E7CE; ` +
    `font-family: 'Zilla Slab', Rockwell, serif; font-size: 22px; font-weight: 700; text-align: center">${escapeHtml(text)}</div>`
  );
}

/** Drag and drop (and click as a fallback) from the holstered guns to the GUN HAND box. */
function wirePick(frame: HTMLElement, pick: GunPick) {
  const choose = (gunId: number, hand: number) => {
    // Record the pick before closing: the close handler treats a sheet
    // closed without a pick as a cancelled choice.
    pick.onPick(gunId, hand);
    closeCharacterSheet();
  };
  const targets: HTMLElement[] = [];
  const highlightAll = (on: boolean) => {
    for (const t of targets) {
      t.style.background = on ? "#E9D6A8" : "";
      t.style.outline = on ? "3px dashed #8E2F1A" : "";
    }
  };
  for (const { box, hand } of DROP_HANDS) {
    const target = frame.querySelector<HTMLElement>(`[data-box="${box}"]`);
    if (!target) continue;
    targets.push(target);
    target.addEventListener("dragover", (e) => {
      e.preventDefault();
      target.style.background = "#E9D6A8";
      target.style.outline = "3px dashed #8E2F1A";
    });
    target.addEventListener("dragleave", () => highlightAll(false));
    target.addEventListener("drop", (e) => {
      e.preventDefault();
      const gunId = Number(e.dataTransfer?.getData("text/plain"));
      if (Number.isInteger(gunId) && gunId > 0) choose(gunId, hand);
    });
  }
  const highlight = highlightAll;
  frame.querySelectorAll<HTMLElement>("[data-drag-gun]").forEach((el) => {
    const gunId = Number(el.dataset.dragGun);
    el.addEventListener("dragstart", (e: DragEvent) => {
      e.dataTransfer?.setData("text/plain", String(gunId));
      el.style.opacity = "0.5";
    });
    el.addEventListener("dragend", () => {
      el.style.opacity = "";
      highlight(false);
    });
    el.addEventListener("click", () => choose(gunId, DROP_HANDS[0].hand));
  });
}

/** The guns kept at one location, as cards inside the sheet's box. */
function gunBox(guns: GunView[], location: GunView["location"], pick?: GunPick): string {
  const draggable = (g: GunView) => !!pick && g.location === "holstered";
  const cards = guns
    .filter((g) => g.location === location)
    .map(
      (g) =>
        `<div${draggable(g) ? ` draggable="true" data-drag-gun="${g.id}" title="Drag me to the gun hand"` : ""} ` +
        `style="display: flex; align-items: center; gap: 12px; border: 2px solid #2A1C14; border-radius: 10px; padding: 8px 14px; background: #F3E7CE; min-width: 220px${
          draggable(g) ? "; cursor: grab; box-shadow: 0 0 0 3px #8E2F1A" : ""
        }">` +
        `<img src="/guns/${escapeHtml(g.type)}.gif" alt="" style="width: 56px; height: 56px; image-rendering: pixelated; flex: none">` +
        `<div>` +
        `<div style="font-family: Rye, Georgia, serif; font-size: 22px; letter-spacing: 1px">${escapeHtml(g.name)}</div>` +
        `<div style="font-size: 16px; font-weight: 700">${g.cocked ? "cocked" : "uncocked"} · ${g.shells}/${g.capacity} shells</div>` +
        `</div></div>`,
    );
  const hint = pick && location === "gun_hand" && cards.length === 0 ? `<div style="font-size: 16px; font-style: italic; opacity: .7">drop the gun here</div>` : "";
  return `<div data-box="${location}" style="flex: 1; padding: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; min-height: 60px">${cards.join("")}${hint}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
