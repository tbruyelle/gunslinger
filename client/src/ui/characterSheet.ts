import { dirIndexToAngle } from "../rules";
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
}

const DIRS = ["N", "NE", "SE", "S", "SW", "NW"];
/** Accent colour per seat, from the design's palette. */
const ACCENTS = ["#33307F", "#8E2F1A"];
const SHEET_W = 1100;
const SHEET_H = 850;

let backdrop: HTMLDivElement | null = null;
let onClose: (() => void) | null = null;

/**
 * Opens the character sheet as an HTML overlay above the game canvas.
 * onClosed runs once the sheet is closed, however it was closed.
 */
export function openCharacterSheet(d: SheetData, onClosed?: () => void): void {
  closeCharacterSheet();
  onClose = onClosed ?? null;
  const accent = ACCENTS[d.seat] ?? ACCENTS[0];
  const html = template
    .replace(/{{accent}}/g, accent)
    .replace("{{characterName}}", escapeHtml(d.name))
    .replace("{{tokenImage}}", tokenImage(d))
    .replace("{{statusRow}}", statusRow(d, accent));

  backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(10,6,2,.72);cursor:pointer";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeCharacterSheet();
  });
  // Keep every pointer event on the overlay away from the game canvas.
  for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "touchstart", "touchend", "wheel"]) {
    backdrop.addEventListener(type, (e) => e.stopPropagation(), { passive: type === "wheel" });
  }

  const frame = document.createElement("div");
  frame.style.cssText = "position:relative;cursor:default;transform-origin:center center";
  frame.innerHTML = html;
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.style.cssText =
    "position:absolute;top:22px;right:26px;width:40px;height:40px;border-radius:50%;border:3px solid #2A1C14;background:#F3E7CE;color:#2A1C14;font:700 26px/1 'Zilla Slab',Rockwell,serif;cursor:pointer";
  close.addEventListener("click", closeCharacterSheet);
  frame.appendChild(close);
  backdrop.appendChild(frame);
  document.body.appendChild(backdrop);

  const fit = () => {
    const h = Math.max(SHEET_H, frame.querySelector<HTMLElement>(".gs-sheet")?.offsetHeight ?? SHEET_H);
    const s = Math.min(1, (window.innerWidth - 32) / SHEET_W, (window.innerHeight - 32) / h);
    frame.style.transform = `scale(${s})`;
  };
  fit();
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

export function closeCharacterSheet(): void {
  if (!backdrop) return;
  cleanup?.();
  cleanup = null;
  backdrop.remove();
  backdrop = null;
  const cb = onClose;
  onClose = null;
  cb?.();
}

export function isCharacterSheetOpen(): boolean {
  return backdrop !== null;
}

function tokenImage(d: SheetData): string {
  const angle = dirIndexToAngle(d.facing, d.charKey);
  return `<img src="/char_${escapeHtml(d.charKey)}.png" alt="" style="width: 84px; height: 84px; border-radius: 50%; border: 3px solid #2A1C14; background: #FBF4E4; transform: rotate(${angle}deg); flex: none">`;
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
    chip("STATUS", escapeHtml(d.status.toUpperCase())),
    chip("PLAN", plan),
  ];
  if (d.isMe) chips.push(`<div style="margin-left: auto; font-family: Rye, Georgia, serif; font-size: 22px; color: ${accent}; letter-spacing: 1px">YOUR CHARACTER</div>`);
  return `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px">${chips.join("")}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
