import type Phaser from "phaser";

/**
 * Toasts are DOM elements over the canvas, not Phaser objects: the scenes
 * rebuild their whole display list on every refresh or resize
 * (`children.removeAll`), which used to destroy a toast the moment it
 * appeared (an error caught right before a rebuild was never seen).
 */
let stack: HTMLDivElement | null = null;
const byKey = new Map<string, HTMLDivElement>();

function container(): HTMLDivElement {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement("div");
  Object.assign(stack.style, {
    position: "fixed",
    left: "50%",
    bottom: "70px",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column-reverse",
    alignItems: "center",
    gap: "8px",
    zIndex: "2000",
    pointerEvents: "none",
    maxWidth: "calc(100vw - 32px)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(stack);
  return stack;
}

export interface ToastOptions {
  /** A toast with the same key replaces the previous one instead of stacking (default: the text). */
  key?: string;
}

/** A short message at the bottom of the screen that fades away; click it to dismiss. */
export function showToast(
  _scene: Phaser.Scene | null,
  text: string,
  kind: "info" | "error" = "info",
  ms = kind === "error" ? 7000 : 4000,
  opts: ToastOptions = {},
): void {
  opts = { key: text, ...opts };
  if (opts.key) hideToast(opts.key);
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    background: kind === "error" ? "#7a1f1f" : "#2d4a1f",
    color: "#ffffff",
    font: "16px sans-serif",
    padding: "8px 14px",
    textAlign: "center",
    whiteSpace: "pre-line",
    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
    pointerEvents: "auto",
    cursor: "pointer",
    opacity: "1",
    transition: "opacity 0.5s",
  } satisfies Partial<CSSStyleDeclaration>);
  const remove = () => {
    el.remove();
    if (opts.key && byKey.get(opts.key) === el) byKey.delete(opts.key);
  };
  el.addEventListener("click", remove);
  container().appendChild(el);
  if (opts.key) byKey.set(opts.key, el);
  setTimeout(() => (el.style.opacity = "0"), Math.max(0, ms - 500));
  setTimeout(remove, ms);
}

/** Removes the toast shown with that key, if it is still there. */
export function hideToast(key: string): void {
  byKey.get(key)?.remove();
  byKey.delete(key);
}
