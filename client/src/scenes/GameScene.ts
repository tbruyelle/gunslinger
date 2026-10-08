import Phaser from "phaser";
import type { CardNumber, CardSide, ChoiceType, RelativeDirection } from "../rules";
import { AHEAD_DIRS, BACK_DIRS, dirIndexToAngle, getActionCardAsset, getActionDef, relativeToAbsoluteDir, CHAR_ARROW_DIR } from "../rules";
import { BOARD_A } from "../board/boardA";
import { getChain, type Chain } from "../chain";
import { subscribeAccountChanged, subscribeNetworkChanged } from "../chain/adena";
import { userMessage } from "../chain/errors";
import { GamePoller } from "../chain/poller";
import { seatOf, shortAddr, type GameView, type TurnResult, type PlayerStatus, type TurnEvent, type GunView, type GroundGunView } from "../chain/types";
import {
  describeEvent,
  endOfTurnEvents,
  eventsForSegment,
  snapshotAfterSegment,
  startOfTurn,
  stepBack,
  stepForward,
  type ReplayPos,
} from "../game/playback";
import { MAX_ACTION_POINTS, canPlay, drawDestinations, drawableGuns, encodePlan, planCost, validatePlan, type PlanEntry, isEnabled, decodePlan } from "../game/plan";
import { firingGun, gunInHand, replayPlan, type CharView } from "../game/replay";
import { COCK_AIM_SHOOT_AIM_TIME, SHOOT_AIM_TIME, shotOdds } from "../game/shotOdds";
import { SHOOT_OPTIONS, isShooting, type ShootOption } from "../game/plan";
import { closeCharacterSheet, openCharacterSheet, type GunPick } from "../ui/characterSheet";
import { showToast } from "../ui/toast";
import { charName } from "./LobbyScene";

// ── Layout constants ────────────────────────────────────────────────────────

const HUD_H = 48;
const PANEL_H = 380;
// Card images are 630×880; the strip shows them at 119×162.
const CARD_W = 119;
const CARD_H = 162;
const CARD_GAP = 6;
const CARD_ROW_GAP = 6;
const TOKEN_SCALE_FACTOR = 1.7;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_FACTOR = 0.12;
const DRAG_THRESHOLD = 4;
const HEX_HIGHLIGHT_R = 18;
const HEX_SPACING = 185; // approximate centre-to-centre distance in board pixels
const SEGMENTS = 5;
const GOLD = 0xd4a044;
const GOLD_STR = "#d4a044";
const DIM_STR = "#8a7150";

/** Screen angle (degrees) of each absolute direction, y down. */
const DIR_ANGLE = [270, 330, 30, 90, 150, 210];

type Mode = "sync" | "select" | "submitting" | "waiting" | "playback" | "ended" | "spectate";

const BTN_STYLE = { fontSize: "16px", color: GOLD_STR, backgroundColor: "#2a1500", padding: { x: 16, y: 8 } };

/** Highest delay marker available (DEL 1 to DEL 8). */
const MAX_DELAY_MARKER = 8;

/**
 * Tokens sharing a hex are fanned out along a diagonal, as fractions of the
 * token diameter: a small shift at rest, so the one below peeks out, and a
 * full one while the pointer is over the stack, so each token is wholly
 * visible and clickable.
 */
/** The status overlays drawn over a token (assets/local/<key>.png). */
const STATE_OVERLAYS = ["state_down", "state_dead", "state_passed_out"];
/** The overlay a character shows: killed or passed out first, else down. */
function overlayKey(c: CharView): string | null {
  if (c.status === "killed") return "state_dead";
  if (c.status === "passed_out") return "state_passed_out";
  return c.down ? "state_down" : null;
}

/** The AIM markers available (assets/aimN.gif, from the VASSAL module): aim comes by 2 points, up to 8. */
const AIM_MARKERS = [2, 4, 6, 8];
/** The marker texture for n AIM points: the closest one at or above n. */
function aimMarkerKey(n: number): string {
  return `aim_${AIM_MARKERS.find((m) => m >= n) ?? 8}`;
}
/** Size of an AIM marker as a fraction of the token diameter. */
const AIM_SIZE = 0.42;
/** Endurance boxes a character starts with (rule 14.2); the health bar shows only below that. */
const MAX_ENDURANCE = 20;
/** Colour of the aim line and the shot tracer. */
const AIM_LINE_COLOR = 0xff2020;

const STACK_REST = 0.12;
const STACK_SPREAD = 0.42;
const STACK_MS = 180;

/** Paints a gun icon: full colour when cocked, greyed out when not, and a red dot per loaded chamber along the bottom edge (dark once spent). */
function paintGun(gun: GunView, img: Phaser.GameObjects.Image, dots: Phaser.GameObjects.Graphics, size: number): number {
  img.setDisplaySize(size, size);
  const alpha = gun.cocked ? 1 : 0.7;
  if (gun.cocked) img.clearTint();
  else img.setTint(0xb4b4b4);
  dots.clear();
  const n = Math.max(gun.capacity, gun.shells, 1);
  const step = size / (n + 1);
  const radius = Math.max(1.5, size * 0.055);
  for (let i = 0; i < n; i++) {
    const loaded = i < gun.shells;
    dots.fillStyle(loaded ? 0xd81818 : 0x3a2510, loaded ? 1 : 0.6);
    dots.fillCircle(-size / 2 + step * (i + 1), size * 0.4, radius);
  }
  if (gun.exploded) {
    // Blown up (13.31): a red strike across the icon, the gun is useless.
    const r = size * 0.45;
    dots.lineStyle(Math.max(2, size * 0.1), 0xd81818, 1);
    dots.lineBetween(-r, r, r, -r);
  }
  return alpha;
}

/** The option buttons offered for each gun action (uncocking stays possible in the plan string, not in the menu). */
const MENU_OPTIONS: Record<string, ShootOption[]> = { "Cock/Aim/Shoot": ["cock", "aim", "shoot"], Shoot: ["shoot"] };

/** How far a gun on the ground lies from its hex centre toward the lower-right, as a fraction of the token diameter. */
const GROUND_ASIDE = 0.28;

/** Gun models with an icon in assets/guns/<type>.gif. */
const GUN_TYPES = ["colt45"];
/**
 * The gun-in-hand icon sits at the token's top-left or top-right corner, the
 * corner above the arrow once the figure stands upright (the art leans 30°
 * toward the arrow's side, see the sheet's SHEET_UPRIGHT_DEG): size and
 * distance from the centre as fractions of the token diameter.
 */
const GUN_SIZE = 0.4;
const GUN_RADIUS = 0.5;

/** Groups the display objects of one character token. */
class CharacterToken {
  private overlay: Phaser.GameObjects.Image | null = null;
  /** The "DEL n" marker at the bottom corner on the arrow's side (upright frame), when the character carries delay. */
  private badge: Phaser.GameObjects.Image | null = null;
  /** The icon of the gun held in a hand, at the token corner above the arrow, with its shells as red dots; greyed out while uncocked. */
  private gun: Phaser.GameObjects.Image | null = null;
  private shells: Phaser.GameObjects.Graphics | null = null;
  /** Progress of the gun icon's entrance (0 at the token centre, transparent and turning; 1 in place). */
  private gunIn = 1;
  /** The icon's opacity once in place (dimmed while uncocked). */
  private gunAlpha = 1;
  /** Extra rotation of the icon, for the recoil of a shot. */
  private recoil = 0;
  /** The opponent's AIM marker when it follows this token, at the corner mirroring the gun icon. */
  private aim: Phaser.GameObjects.Image | null = null;
  /** The endurance bar above the token, shown once boxes are crossed off; shown is the value it displays (tweened). */
  private bar: { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle } | null = null;
  private shown = MAX_ENDURANCE;
  private barTween: Phaser.Tweens.Tween | null = null;
  /** The sprite's resting tint (grey once out of the fight), which a hurt flash fades back to. */
  private baseTint = 0xffffff;

  /** In-flight position tweens, retargeted by moveTo without touching the rotation. */
  private posTweens: Phaser.Tweens.Tween[] = [];
  /** Hover handlers for the gun icon and the AIM marker, set by the scene. */
  onGunHover: ((over: boolean) => void) | null = null;
  onAimHover: ((over: boolean) => void) | null = null;

  /**
   * Each token owns a band of 5 depths (ring, sprite, DOWN overlay, gun, DEL
   * badge), later seats above earlier ones, so stacked tokens layer as units
   * and a hidden token's badge never shows over the token covering it.
   */
  constructor(
    readonly charKey: string,
    readonly sprite: Phaser.GameObjects.Image,
    readonly highlight: Phaser.GameObjects.Arc,
    private readonly depth: number,
  ) {
    highlight.setDepth(depth);
    sprite.setDepth(depth + 1);
  }

  static depthFor(seat: number): number {
    return 1 + seat * 5;
  }

  private get parts(): Phaser.GameObjects.GameObject[] {
    const list: Phaser.GameObjects.GameObject[] = [this.sprite, this.highlight];
    if (this.overlay) list.push(this.overlay);
    if (this.badge) list.push(this.badge);
    if (this.gun) list.push(this.gun);
    if (this.shells) list.push(this.shells);
    if (this.aim) list.push(this.aim);
    if (this.bar) list.push(this.bar.bg, this.bar.fill);
    return list;
  }

  killTweens(tweens: Phaser.Tweens.TweenManager) {
    for (const p of this.parts) tweens.killTweensOf(p);
    this.posTweens = [];
  }

  /** Tweens the sprite; the other parts follow it every frame. */
  moveTo(tweens: Phaser.Tweens.TweenManager, sx: number, sy: number, duration: number) {
    for (const tw of this.posTweens) tw.stop();
    this.posTweens = [tweens.add({ targets: this.sprite, x: sx, y: sy, duration, ease: "Cubic.easeInOut", onUpdate: () => this.follow() })];
  }

  setPosition(sx: number, sy: number) {
    this.sprite.setPosition(sx, sy);
    this.follow();
  }

  rotateTo(tweens: Phaser.Tweens.TweenManager, targetAngle: number, duration: number) {
    let diff = targetAngle - this.sprite.angle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) > 0.5) {
      tweens.add({ targets: this.sprite, angle: this.sprite.angle + diff, duration, ease: "Cubic.easeInOut", onUpdate: () => this.follow() });
    }
  }

  setAngle(angle: number) {
    this.sprite.setAngle(angle);
    this.follow();
  }

  /** Places the ring, overlay, badge and gun icon relative to the sprite. */
  private follow() {
    const { x, y } = this.sprite;
    this.highlight.setPosition(x, y);
    this.overlay?.setPosition(x, y);
    if (this.badge) {
      const a = Phaser.Math.DegToRad(this.badgeAngle());
      const r = this.sprite.displayWidth * GUN_RADIUS;
      this.badge.setPosition(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    if (this.gun) {
      const a = Phaser.Math.DegToRad(this.gunAngle());
      const r = this.sprite.displayWidth * GUN_RADIUS * this.gunIn; // slides out from the centre on entrance
      this.gun
        .setPosition(x + Math.cos(a) * r, y + Math.sin(a) * r)
        .setAlpha(this.gunAlpha * this.gunIn)
        .setAngle((1 - this.gunIn) * 360 + this.recoil);
      this.shells?.setPosition(this.gun.x, this.gun.y).setAlpha(this.gunIn).setAngle(this.gun.angle);
    }
    if (this.aim) {
      const a = Phaser.Math.DegToRad(this.aimAngle());
      const r = this.sprite.displayWidth * GUN_RADIUS;
      this.aim.setPosition(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    if (this.bar) {
      const d = this.sprite.displayWidth;
      const w = d * 0.9;
      const by = y - d * 0.66;
      this.bar.bg.setPosition(x - w / 2, by);
      const ratio = Phaser.Math.Clamp(this.shown / MAX_ENDURANCE, 0, 1);
      this.bar.fill.setPosition(x - w / 2 + 1, by + 1).setSize(Math.max(0, (w - 2) * ratio), this.bar.bg.height - 2);
      this.bar.fill.setFillStyle(Phaser.Display.Color.GetColor(Math.round(220 * (1 - ratio) + 40 * ratio), Math.round(190 * ratio + 30), 30), 1);
    }
  }

  /** Shows the endurance bar once boxes are crossed off (none at full endurance), shrinking it smoothly when it drops; animate off sets it outright. */
  setEndurance(scene: Phaser.Scene, n: number, mask: Phaser.Display.Masks.GeometryMask, animate = true) {
    if (n >= MAX_ENDURANCE) {
      this.bar?.bg.destroy();
      this.bar?.fill.destroy();
      this.bar = null;
      this.shown = n;
      return;
    }
    const d = this.sprite.displayWidth;
    const hurt = animate && this.bar !== null && n < this.shown; // a drop seen on screen, not the first display
    if (!this.bar) {
      this.bar = {
        bg: scene.add.rectangle(0, 0, d * 0.9, Math.max(6, d * 0.09), 0x1a0f07, 0.9).setOrigin(0, 0.5).setStrokeStyle(1, 0xffe2a0, 0.9).setMask(mask).setDepth(this.depth + 4),
        fill: scene.add.rectangle(0, 0, 1, 1, 0x40c040, 1).setOrigin(0, 0.5).setMask(mask).setDepth(this.depth + 4),
      };
      if (this.shown >= MAX_ENDURANCE) this.shown = MAX_ENDURANCE; // first drop: shrink from full
    }
    this.bar.bg.setSize(d * 0.9, Math.max(6, d * 0.09));
    this.barTween?.stop();
    if (animate) {
      this.barTween = scene.tweens.add({ targets: this, shown: n, duration: n < this.shown ? 500 : 250, ease: "Cubic.easeOut", onUpdate: () => this.follow() });
    } else {
      this.shown = n;
    }
    if (hurt) this.hurtFlash(scene);
    this.follow();
  }

  /** Flashes the token red, fading back to its resting tint: when endurance drops, and when a bullet lands. */
  hurtFlash(scene: Phaser.Scene) {
    const red = Phaser.Display.Color.ValueToColor(0x7a0c0a); // the blood stains' dark red
    const base = Phaser.Display.Color.ValueToColor(this.baseTint);
    const flash = { t: 0 };
    scene.tweens.add({
      targets: flash,
      t: 1,
      duration: 650,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(red, base, 100, flash.t * 100);
        this.sprite.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      },
      onComplete: () => this.applyBaseTint(),
    });
  }

  private applyBaseTint() {
    if (this.baseTint === 0xffffff) this.sprite.clearTint();
    else this.sprite.setTint(this.baseTint);
  }

  /**
   * Screen angle of the gun corner's mirror image across the vertical axis
   * of the upright figure: the other top corner, 135° from the arrow
   * toward the figure's head.
   */
  private aimAngle(): number {
    return this.arrowAngle() + (CHAR_ARROW_DIR[this.charKey] === 5 ? 135 : -135);
  }

  /** Screen angle of the bottom corner below the gun corner in the upright frame: 45° from the arrow toward the feet. */
  private badgeAngle(): number {
    return this.arrowAngle() + (CHAR_ARROW_DIR[this.charKey] === 5 ? -45 : 45);
  }

  /** Shows the AIM marker of the points the opponent holds on this character (none for 0). */
  setTargetAim(scene: Phaser.Scene, n: number, mask: Phaser.Display.Masks.GeometryMask) {
    const key = aimMarkerKey(n);
    if (n <= 0 || !scene.textures.exists(key)) {
      this.aim?.destroy();
      this.aim = null;
      return;
    }
    const size = this.sprite.displayWidth * AIM_SIZE;
    if (!this.aim) {
      this.aim = scene.add.image(this.sprite.x, this.sprite.y, key).setOrigin(0.5).setMask(mask).setDepth(this.depth + 4).setInteractive();
      this.aim.on("pointerover", () => this.onAimHover?.(true));
      this.aim.on("pointerout", () => this.onAimHover?.(false));
    } else if (this.aim.texture.key !== key) {
      this.aim.setTexture(key);
    }
    this.aim.setDisplaySize(size, size).setAlpha(1); // undo a fade-out if the aim came back
    this.follow();
  }

  /** Drifts the AIM marker up and fades it away, when the aim is lost. */
  fadeAim(tweens: Phaser.Tweens.TweenManager, duration: number) {
    if (!this.aim) return;
    tweens.add({ targets: this.aim, y: this.aim.y - this.sprite.displayWidth * 0.5, alpha: 0, duration, ease: "Cubic.easeIn" });
  }

  /** Drifts the DEL badge up and fades it away, when the delay is gone. */
  fadeBadge(tweens: Phaser.Tweens.TweenManager, duration: number) {
    if (!this.badge) return;
    tweens.add({ targets: this.badge, y: this.badge.y - this.sprite.displayWidth * 0.5, alpha: 0, duration, ease: "Cubic.easeIn" });
  }

  /** Zooms the DEL badge in and out once, when the delay changes. */
  pulseBadge(tweens: Phaser.Tweens.TweenManager) {
    if (!this.badge) return;
    const { scaleX, scaleY } = this.badge;
    tweens.add({ targets: this.badge, scaleX: scaleX * 1.35, scaleY: scaleY * 1.35, duration: 170, yoyo: true, ease: "Quad.easeOut" });
  }

  /** Zooms the AIM marker in and out once, when the aim grows. */
  pulseAim(tweens: Phaser.Tweens.TweenManager) {
    if (!this.aim) return;
    const { scaleX, scaleY } = this.aim;
    tweens.add({ targets: this.aim, scaleX: scaleX * 1.35, scaleY: scaleY * 1.35, duration: 170, yoyo: true, ease: "Quad.easeOut" });
  }

  /** Greys out a character that is out of the fight. */
  setStatus(status: PlayerStatus) {
    const out = status !== "alive";
    this.sprite.setAlpha(out ? 0.75 : 1);
    this.baseTint = out ? 0x808080 : 0xffffff;
    this.applyBaseTint();
  }

  /** The flinch of a hit: the token rocks quickly back and forth around its facing. */
  flinch(tweens: Phaser.Tweens.TweenManager) {
    const base = this.sprite.angle;
    tweens.add({
      targets: this.sprite,
      angle: base + 14,
      duration: 55,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
      onUpdate: () => this.follow(),
      onComplete: () => {
        this.sprite.setAngle(base);
        this.follow();
      },
    });
  }

  /** The recoil of a shot: a quick small kick of the gun icon. */
  kickGun(tweens: Phaser.Tweens.TweenManager) {
    if (!this.gun) return;
    tweens.add({ targets: this, recoil: -28, duration: 70, yoyo: true, ease: "Quad.easeOut", onUpdate: () => this.follow() });
  }

  /** Cocking the gun: the same swing as the recoil, slower. */
  cockGun(tweens: Phaser.Tweens.TweenManager) {
    if (!this.gun) return;
    tweens.add({ targets: this, recoil: -28, duration: 260, yoyo: true, ease: "Sine.easeInOut", onUpdate: () => this.follow() });
  }

  /** Where the gun icon sits, or the token centre without one. */
  gunCentre(): { x: number; y: number } {
    return this.gun ? { x: this.gun.x, y: this.gun.y } : { x: this.sprite.x, y: this.sprite.y };
  }

  /** Screen angle (degrees, clockwise from east) the token's baked-in arrow points at. */
  private arrowAngle(): number {
    return this.sprite.angle + 60 * (CHAR_ARROW_DIR[this.charKey] ?? 1) - 90;
  }

  /**
   * Screen angle of the corner above the arrow in the figure's upright
   * frame: 45° toward the figure's head from the arrow, which points to its
   * right (NE tokens) or its left (NW tokens).
   */
  private gunAngle(): number {
    return this.arrowAngle() + (CHAR_ARROW_DIR[this.charKey] === 5 ? 45 : -45);
  }

  private delay = 0;

  /** The delay points the badge shows (0 without a badge). */
  delayShown(): number {
    return this.delay;
  }

  /** Shows the delay marker for n points (none for 0), sized relative to the token. */
  setDelay(scene: Phaser.Scene, n: number, mask: Phaser.Display.Masks.GeometryMask) {
    this.delay = Math.max(0, n);
    if (n <= 0) {
      this.badge?.destroy();
      this.badge = null;
      return;
    }
    const key = `delay_${Math.min(n, MAX_DELAY_MARKER)}`;
    if (!scene.textures.exists(key)) return;
    const size = this.sprite.displayWidth * 0.42;
    if (!this.badge) {
      this.badge = scene.add.image(this.sprite.x, this.sprite.y, key).setOrigin(0.5).setMask(mask).setDepth(this.depth + 4);
    } else if (this.badge.texture.key !== key) {
      this.badge.setTexture(key);
    }
    this.badge.setDisplaySize(size, size).setAlpha(1); // undo a fade-out if delay came back
    this.follow();
  }

  /** Shows the icon of the gun held in a hand (none when every gun is holstered), its shells as red dots along the bottom; animate plays the entrance of a new icon. */
  setGun(scene: Phaser.Scene, gun: GunView | null, mask: Phaser.Display.Masks.GeometryMask, animate = true) {
    const key = `gun_${gun?.type}`;
    if (!gun || !scene.textures.exists(key)) {
      this.gun?.destroy();
      this.shells?.destroy();
      this.gun = this.shells = null;
      return;
    }
    const size = this.sprite.displayWidth * GUN_SIZE;
    if (!this.gun) {
      this.gun = scene.add.image(this.sprite.x, this.sprite.y, key).setOrigin(0.5).setMask(mask).setDepth(this.depth + 3).setInteractive();
      this.gun.on("pointerover", () => this.onGunHover?.(true));
      this.gun.on("pointerout", () => this.onGunHover?.(false));
      this.shells = scene.add.graphics().setMask(mask).setDepth(this.depth + 3);
      // Entrance: fades in while sliding and spinning from the token centre to its corner.
      this.gunIn = animate ? 0 : 1;
      if (animate) scene.tweens.add({ targets: this, gunIn: 1, duration: 450, ease: "Cubic.easeOut", onUpdate: () => this.follow() });
    } else if (this.gun.texture.key !== key) {
      this.gun.setTexture(key);
    }
    this.gunAlpha = paintGun(gun, this.gun, this.shells!, size);
    this.follow();
  }

  /** Shows the status overlay (DOWN, DEAD, PASSED OUT), or none. */
  setOverlay(scene: Phaser.Scene, key: string | null, mask: Phaser.Display.Masks.GeometryMask) {
    if (!key || !scene.textures.exists(key)) {
      this.overlay?.destroy();
      this.overlay = null;
      return;
    }
    if (!this.overlay) {
      this.overlay = scene.add
        .image(this.sprite.x, this.sprite.y, key)
        .setScale(this.sprite.scaleX)
        .setOrigin(0.5)
        .setMask(mask)
        .setDepth(this.depth + 2);
    } else if (this.overlay.texture.key !== key) {
      this.overlay.setTexture(key);
    }
  }

  setHighlight(color: number, alpha: number, width = 3) {
    this.highlight.setStrokeStyle(width, color, alpha);
  }
}

/**
 * The game board: renders the state the realm holds, lets the player build a
 * plan with a live preview, submits it through Adena, and replays the
 * resolution log segment by segment when a turn resolves.
 */
export class GameScene extends Phaser.Scene {
  private gameID = "";
  private chain!: Chain;
  private poller: GamePoller | null = null;
  private unsubscribe: (() => void)[] = [];

  // Chain state
  private view: GameView | null = null;
  private myIndex = -1;
  private renderedTurn = -1;
  private shownResultTurn = 0;
  private committed: CharView[] = [];
  private mode: Mode = "sync";
  private netError: string | null = null;

  // Plan being built
  private selectionOrder: PlanEntry[] = [];
  private pendingChoices: Map<number, RelativeDirection> = new Map();
  /** Gun id and destination hand chosen for cards that draw a gun (Draw & Cock). */
  private pendingGuns: Map<number, { gun?: number; ground?: number; hand: number }> = new Map();
  /** Shoot option picked for Cock/Aim/Shoot and Shoot cards. */
  private pendingOpts: Map<number, ShootOption> = new Map();
  /** The option buttons shown while a gun action waits for its option. */
  private optMenu: { card: CardNumber; side: CardSide; objects: Phaser.GameObjects.GameObject[] } | null = null;
  /** The target picked for each aim (a hex, or the seat of a character standing on the clicked hex); the pick overlays while one is pending. */
  private pendingAims: Map<number, { hex?: string; target?: number }> = new Map();
  private aimMode: { card: CardNumber; side: CardSide; objects: Phaser.GameObjects.GameObject[] } | null = null;
  /** The AIM markers on hexes, by the seat holding the aim. */
  private aimMarkers: Map<number, Phaser.GameObjects.Image> = new Map();
  /** The guns lying in hexes, as drawn (index = position in displayGround()). */
  private groundIcons: { img: Phaser.GameObjects.Image; dots: Phaser.GameObjects.Graphics }[] = [];
  /** The animated dotted line shown while hovering an AIM marker or an aiming gun, with its ends. */
  private aimLine: Phaser.GameObjects.Graphics | null = null;
  private aimLineEnds: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  private preview: CharView | null = null;
  private choiceMode: {
    card: CardNumber;
    side: CardSide;
    choiceType: ChoiceType;
    options: { rel: RelativeDirection; hex: string | null; x: number; y: number }[];
  } | null = null;
  private choiceOverlays: Phaser.GameObjects.GameObject[] = [];

  // Playback of the last resolved turn
  // Replay of resolved turns: a turn that just resolved (live) or the history.
  private playback: { turns: TurnResult[]; index: number; seg: number; live: boolean; auto: Phaser.Time.TimerEvent | null } | null = null;
  /** The plan being built when a history replay was opened, restored on close. */
  /** The plan sent this turn, shown while waiting: known from sending it, else read back from the chain. */
  private sentPlan: { turn: number; plan: string } | null = null;
  private stashedPlan: { turn: number; order: PlanEntry[]; choices: Map<number, RelativeDirection>; guns: Map<number, { gun?: number; ground?: number; hand: number }>; opts: Map<number, ShootOption>; aims: Map<number, { hex?: string; target?: number }> } | null = null;

  // Zoom & pan
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private panStartX = 0;
  private panStartY = 0;

  // Display objects
  private boardImage: Phaser.GameObjects.Image | null = null;
  private tokens: (CharacterToken | null)[] = [];
  /** The hex whose stacked tokens are fanned out under the pointer, if any. */
  private spreadHex: string | null = null;
  private arrMask!: Phaser.Display.Masks.GeometryMask;
  private arrMaskGfx!: Phaser.GameObjects.Graphics;
  private turnText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private rightText!: Phaser.GameObjects.Text;
  private cardContainer!: Phaser.GameObjects.Container;
  private cardImages: Phaser.GameObjects.Image[] = [];
  private cardHighlights: Phaser.GameObjects.Rectangle[] = [];
  private selectedDisplay!: Phaser.GameObjects.Text;
  private sendBtn!: Phaser.GameObjects.Text;
  /** Full-size copy of the hovered card, drawn over it. */
  private cardPreview: Phaser.GameObjects.Image | null = null;
  /** Set by a click on a card; cleared once the pointer leaves the card panel. */
  private previewSuppressed = false;
  private infoContainer!: Phaser.GameObjects.Container;
  private infoText!: Phaser.GameObjects.Text;
  private sequenceContainer!: Phaser.GameObjects.Container;
  private seqTitle!: Phaser.GameObjects.Text;
  private seqDots: Phaser.GameObjects.Text[] = [];
  private seqLog!: Phaser.GameObjects.Text;
  /** The resolution log scrolls inside its area when it overflows (wheel over it). */
  private seqLogArea = { top: 0, bottom: 0 };
  private seqScroll = 0;
  private seqScrollbar: { track: Phaser.GameObjects.Rectangle; thumb: Phaser.GameObjects.Rectangle } | null = null;
  /** A wide popup over the board: the resolution log (click on the log) or the plan sent this turn. */
  private logPopup: {
    kind: "log" | "plan";
    objects: Phaser.GameObjects.GameObject[];
    text: Phaser.GameObjects.Text;
    area: { top: number; bottom: number };
    scroll: number;
    track: Phaser.GameObjects.Rectangle;
    thumb: Phaser.GameObjects.Rectangle;
  } | null = null;
  private prevSeqBtn!: Phaser.GameObjects.Text;
  private nextSeqBtn!: Phaser.GameObjects.Text;
  private prevTurnBtn!: Phaser.GameObjects.Text;
  private nextTurnBtn!: Phaser.GameObjects.Text;
  private playBtn!: Phaser.GameObjects.Text;
  private closeReplayBtn!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { gameID: string }) {
    this.gameID = data.gameID;
    this.view = null;
    this.myIndex = -1;
    this.renderedTurn = -1;
    this.shownResultTurn = 0;
    this.committed = [];
    this.mode = "sync";
    this.netError = null;
    this.clearSelection();
    this.playback = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.tokens = [];
    this.spreadHex = null;
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  private get cw() {
    return this.scale.width;
  }
  private get ch() {
    return this.scale.height;
  }
  private get arrH() {
    return this.ch - HUD_H - PANEL_H;
  }
  private get panelY() {
    return this.ch - PANEL_H;
  }

  // ── Preload / create ──────────────────────────────────────────────────────

  preload() {
    if (!this.textures.exists("board_A")) this.load.image("board_A", "board_A.png");
    for (let i = 1; i <= 12; i++) {
      const n = i as CardNumber;
      const fKey = `action_card_a${n}`;
      const bKey = `action_card_a${n}_back`;
      if (!this.textures.exists(fKey)) this.load.image(fKey, getActionCardAsset(n, "front"));
      if (!this.textures.exists(bKey)) this.load.image(bKey, getActionCardAsset(n, "back"));
    }
    for (const key of STATE_OVERLAYS) {
      if (!this.textures.exists(key)) this.load.image(key, `local/${key}.png`);
    }
    for (let i = 1; i <= MAX_DELAY_MARKER; i++) {
      if (!this.textures.exists(`delay_${i}`)) this.load.image(`delay_${i}`, `del${i}.gif`);
    }
    for (const t of GUN_TYPES) {
      if (!this.textures.exists(`gun_${t}`)) this.load.image(`gun_${t}`, `guns/${t}.gif`);
    }
    for (const n of AIM_MARKERS) {
      if (!this.textures.exists(`aim_${n}`)) this.load.image(`aim_${n}`, `aim${n}.gif`);
    }
    for (const key of ["missed", "hit", "jammed", "exploded"]) {
      if (!this.textures.exists(key)) this.load.image(key, `${key}.png`);
    }
  }

  create() {
    this.chain = getChain();
    this.buildAll();
    this.setupInput();

    const onResize = () => this.buildAll();
    this.scale.on("resize", onResize);

    this.poller = new GamePoller(
      this.chain.realm,
      this.gameID,
      (v) => void this.onGame(v),
      (e) => this.onPollError(e),
      this.chain.config.pollMs,
    );
    this.poller.start();

    const leave = (why: string) => {
      if (!this.scene.isActive()) return;
      showToast(this, why, "info");
      this.scene.start("LobbyScene", { splash: false });
    };
    this.unsubscribe.push(
      subscribeAccountChanged(() => leave("Account changed")),
      subscribeNetworkChanged(() => leave("Network changed")),
    );

    this.events.once("shutdown", () => {
      closeCharacterSheet();
      this.scale.off("resize", onResize);
      this.poller?.stop();
      this.poller = null;
      for (const u of this.unsubscribe) u();
      this.unsubscribe = [];
    });
  }

  // ── Chain sync ────────────────────────────────────────────────────────────

  private async onGame(view: GameView) {
    if (!this.scene.isActive()) return;
    const first = this.view === null;
    this.view = view;
    this.netError = null;
    this.myIndex = seatOf(view, this.chain.wallet.address);
    await this.ensureTextures(view);
    if (!this.scene.isActive()) return;

    if (first) {
      this.shownResultTurn = view.lastTurn?.turn ?? 0;
      this.applyState(true);
      return;
    }
    // A turn we have not shown yet resolved: replay it from the positions we
    // were showing before the change.
    if (view.lastTurn && view.lastTurn.turn !== this.shownResultTurn && this.committed.length === 2 && !this.playback) {
      this.startPlayback([view.lastTurn], true);
      return;
    }
    if (!this.playback) this.applyState(false);
  }

  private onPollError(e: unknown) {
    const msg = userMessage(e);
    if (msg !== this.netError) {
      this.netError = msg;
      if (this.scene.isActive()) {
        showToast(this, msg, "error");
        if (/game not found|invalid game id/.test(msg)) this.scene.start("LobbyScene", { splash: false });
      }
    }
    this.refreshHUD();
  }

  private ensureTextures(view: GameView): Promise<void> {
    const missing = view.players.map((p) => p.char).filter((c) => c && !this.textures.exists(`char_${c}`));
    if (missing.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      for (const c of missing) this.load.image(`char_${c}`, `char_${c}.png`);
      this.load.once("complete", () => resolve());
      this.load.start();
    });
  }

  /** Makes the scene reflect the chain state; the plan in progress survives unless the turn changed. */
  private applyState(reset: boolean) {
    const view = this.view;
    if (!view) return;
    const turnChanged = view.turn !== this.renderedTurn;
    this.committed = view.players.map((p) => ({
      hex: p.hex, facing: p.facing, down: p.down, delay: p.delay, status: p.status,
      aim: p.aim, aimHex: p.aimHex, endurance: p.endurance, serious: p.serious, gunArm: p.gunArm, otherArm: p.otherArm, leg: p.leg,
      guns: p.guns.map((g) => ({ ...g })),
    }));
    this.renderedTurn = view.turn;
    this.shownResultTurn = view.lastTurn?.turn ?? 0;

    if (reset || turnChanged || this.mode === "waiting" || this.mode === "playback") {
      this.clearSelection();
    }
    const me = this.myIndex >= 0 ? view.players[this.myIndex] : null;
    if (view.phase === "finished") this.mode = "ended";
    else if (!me) this.mode = "spectate";
    else if (view.phase === "waiting") this.mode = "waiting";
    else if (me.submitted) this.mode = "waiting";
    else if (this.mode !== "submitting") this.mode = "select";
    if (this.mode !== "select") this.clearSelection();

    this.buildTokens();
    this.refreshTokens(!reset);
    this.refreshPanels();
    this.refreshHUD();
    if (this.mode === "waiting" && view.phase === "planning") void this.loadSentPlan();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private buildAll() {
    this.children.removeAll(true);
    this.tokens = [];
    this.cardImages = [];
    this.cardHighlights = [];
    this.choiceOverlays = [];
    this.cardPreview = null;
    // Everything above was destroyed with the children: drop the stale handles
    // (a destroyed Graphics would silently swallow the aim line).
    this.aimLine = null;
    this.aimLineEnds = null;
    this.aimMarkers = new Map();
    this.groundIcons = [];
    this.logPopup = null;
    if (this.optMenu) this.optMenu.objects = [];
    if (this.aimMode) this.aimMode.objects = [];

    const w = this.cw;
    const h = this.ch;
    this.add.rectangle(0, 0, w, h, 0x1a1008).setOrigin(0);
    this.add.rectangle(0, HUD_H, w, this.arrH, 0x120b04).setOrigin(0);

    if (this.arrMaskGfx) this.arrMaskGfx.destroy();
    this.arrMaskGfx = this.make.graphics();
    this.arrMaskGfx.fillRect(0, HUD_H, w, this.arrH);
    this.arrMask = this.arrMaskGfx.createGeometryMask();

    this.buildBoard();
    this.buildTokens();
    this.refreshTokens(false);
    this.buildHUD();
    this.buildCardStrip();
    this.buildInfoPanel();
    this.buildSequencePanel();
    this.refreshPanels();
    this.refreshHUD();
    if (this.choiceMode) this.showChoiceOverlays();
    if (this.optMenu) this.openOptMenu(this.optMenu.card, this.optMenu.side);
    if (this.aimMode) this.enterAimMode(this.aimMode.card, this.aimMode.side);
    this.input.mouse?.disableContextMenu();
  }

  // ── Board & tokens ────────────────────────────────────────────────────────

  private baseTransform(): { scale: number; ox: number; oy: number } {
    const lw = BOARD_A.w;
    const lh = BOARD_A.h;
    const scale = Math.min((this.arrH - 30) / lh, (this.cw - 30) / lw);
    return { scale, ox: (this.cw - lw * scale) / 2, oy: HUD_H + (this.arrH - lh * scale) / 2 };
  }

  private displayTransform(): { scale: number; ox: number; oy: number } {
    const base = this.baseTransform();
    const cx = this.cw / 2;
    const cy = HUD_H + this.arrH / 2;
    return {
      scale: base.scale * this.zoom,
      ox: cx + (base.ox - cx) * this.zoom + this.panX,
      oy: cy + (base.oy - cy) * this.zoom + this.panY,
    };
  }

  private boardToScreen(x: number, y: number): { sx: number; sy: number } {
    const { scale, ox, oy } = this.displayTransform();
    return { sx: ox + x * scale, sy: oy + y * scale };
  }

  private hexToScreen(hex: string): { sx: number; sy: number } {
    const p = BOARD_A.hexPos(hex);
    return this.boardToScreen(p.x, p.y);
  }

  private buildBoard() {
    this.boardImage?.destroy();
    const { scale, ox, oy } = this.displayTransform();
    this.boardImage = this.add
      .image(ox + (BOARD_A.w / 2) * scale, oy + (BOARD_A.h / 2) * scale, "board_A")
      .setScale(scale)
      .setMask(this.arrMask);
  }

  /** The guns lying in hexes as they should be drawn right now: the chain's, or those dropped by the segment shown. */
  private displayGround(): GroundGunView[] {
    const view = this.view;
    if (!view) return [];
    const pb = this.playback;
    if (!pb) {
      // A pick-up planned this turn lifts the gun off the ground in the preview.
      const picked = new Set(this.preview ? this.currentPlan().map((e) => e.groundGun) : []);
      return (view.ground ?? []).filter((g) => !picked.has(g.id));
    }
    const t = pb.turns[pb.index];
    const ground = this.groundBefore();
    snapshotAfterSegment(startOfTurn(t, this.committed), t.events, pb.seg, ground);
    return ground;
  }

  /** The guns lying in hexes when the replayed turn began (a fresh copy). */
  private groundBefore(): GroundGunView[] {
    const pb = this.playback;
    const view = this.view;
    if (!pb || !view) return [];
    const t = pb.turns[pb.index];
    let base: GroundGunView[];
    if (pb.live) {
      // The chain's ground, minus what this turn dropped, plus what it picked up.
      base = (view.ground ?? []).filter((g) => !t.events.some((e) => e.kind === "drop_gun" && e.n === g.id));
      for (const e of t.events) {
        if (e.kind !== "draw" || e.from !== "ground") continue;
        const owner = view.players[e.p]?.guns.find((x) => x.id === e.gunId);
        if (owner) base.push({ id: e.n, hex: t.start[e.p]?.hex ?? "", guns: [{ ...owner, location: "holstered", cocked: false }] });
      }
    } else {
      base = [];
      for (let i = 0; i < pb.index; i++) {
        const prev = pb.turns[i];
        snapshotAfterSegment(startOfTurn(prev, this.committed), prev.events, SEGMENTS, base);
      }
    }
    return base.map((g) => ({ id: g.id, hex: g.hex, guns: g.guns.map((x) => ({ ...x })) }));
  }

  /** The characters as they should be drawn right now. */
  private displayChars(): CharView[] {
    if (this.playback) {
      const t = this.playback.turns[this.playback.index];
      return snapshotAfterSegment(startOfTurn(t, this.committed), t.events, this.playback.seg, this.groundBefore());
    }
    return this.committed.map((c, i) => (i === this.myIndex && this.preview ? this.preview : c));
  }

  private buildTokens() {
    for (const t of this.tokens) {
      if (t) {
        t.killTweens(this.tweens);
        t.sprite.destroy();
        t.highlight.destroy();
        t.setOverlay(this, null, this.arrMask);
        t.setDelay(this, 0, this.arrMask);
        t.setGun(this, null, this.arrMask);
        t.setEndurance(this, MAX_ENDURANCE, this.arrMask);
        t.setTargetAim(this, 0, this.arrMask);
      }
    }
    this.tokens = [];
    const view = this.view;
    if (!view) return;
    const { scale } = this.displayTransform();
    const tokenScale = scale * TOKEN_SCALE_FACTOR;
    const chars = this.displayChars();
    view.players.forEach((p, i) => {
      if (!p.char || !this.textures.exists(`char_${p.char}`)) {
        this.tokens.push(null);
        return;
      }
      const c = chars[i];
      const { sx, sy } = this.tokenScreenPos(chars, i);
      const hl = this.add
        .circle(sx, sy, (95 * tokenScale) / 2 + 4, GOLD, 0)
        .setStrokeStyle(3, GOLD, 0)
        .setMask(this.arrMask);
      const img = this.add
        .image(sx, sy, `char_${p.char}`)
        .setScale(tokenScale)
        .setAngle(dirIndexToAngle(c.facing, p.char))
        .setOrigin(0.5)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true });
      img.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (this.isDragging || pointer.rightButtonReleased()) return;
        this.openSheet(i);
      });
      img.on("pointerover", () => this.tokens[i]?.setHighlight(0xffe2a0, 1, 4));
      img.on("pointerout", () => this.applyTokenHighlight(i));
      const token = new CharacterToken(p.char, img, hl, CharacterToken.depthFor(i));
      // The AIM marker on this token belongs to the opponent: the line runs from the aimer to here.
      token.onAimHover = (over) => (over ? this.showAimLine(this.gunCentre(1 - i), this.tokenCentre(i)) : this.hideAimLine());
      // The gun of an aiming character: the line runs from the aimer to its target.
      token.onGunHover = (over) => {
        const chars = this.displayChars();
        const c = chars[i];
        if (!over || !c || c.aim <= 0) return this.hideAimLine();
        const target = this.aimOnToken(chars, i) ? this.tokenCentre(1 - i) : this.hexCentre(c.aimHex);
        this.showAimLine(this.gunCentre(i), target);
      };
      token.setOverlay(this, overlayKey(c), this.arrMask);
      token.setDelay(this, c.delay, this.arrMask);
      token.setGun(this, gunInHand(c.guns), this.arrMask, false); // built in place: no entrance
      token.setEndurance(this, c.endurance, this.arrMask, false);
      token.setTargetAim(this, this.incomingAim(chars, i), this.arrMask);
      token.setStatus(c.status);
      this.tokens.push(token);
    });
  }

  /** Moves the tokens to the current display state, animated or not. */
  private refreshTokens(animate: boolean) {
    const chars = this.displayChars();
    this.hideAimLine();
    this.refreshAimMarkers(chars);
    this.refreshGround(chars, this.displayGround());
    this.tokens.forEach((t, i) => {
      if (!t || !chars[i]) return;
      const c = chars[i];
      const { sx, sy } = this.tokenScreenPos(chars, i);
      const angle = dirIndexToAngle(c.facing, t.charKey);
      t.killTweens(this.tweens);
      // Status, delay and gun first, so new markers travel with the token.
      t.setOverlay(this, overlayKey(c), this.arrMask);
      t.setDelay(this, c.delay, this.arrMask);
      t.setGun(this, gunInHand(c.guns), this.arrMask);
      t.setEndurance(this, c.endurance, this.arrMask);
      t.setTargetAim(this, this.incomingAim(chars, i), this.arrMask);
      t.setStatus(c.status);
      if (animate) {
        t.moveTo(this.tweens, sx, sy, 450);
        t.rotateTo(this.tweens, angle, 300);
      } else {
        t.setPosition(sx, sy);
        t.setAngle(angle);
      }
      this.applyTokenHighlight(i);
    });
  }

  // ── Stacked tokens (several characters in one hex) ────────────────────────

  private tokenDiameter(): number {
    return 95 * this.displayTransform().scale * TOKEN_SCALE_FACTOR;
  }

  /** The seats drawn in the same hex as seat i (including i), in seat order. */
  /**
   * What shares a hex, in stacking order: the tokens (by seat), then the
   * guns lying there (by their index in the ground list). Each occupant is
   * keyed "s<seat>" or "g<index>".
   */
  private occupantsAt(chars: CharView[], ground: GroundGunView[], hex: string): string[] {
    const players = this.view?.players ?? [];
    const out: string[] = [];
    chars.forEach((c, j) => {
      if (c && players[j]?.char && c.hex === hex) out.push(`s${j}`);
    });
    ground.forEach((g, j) => {
      if (g.hex === hex) out.push(`g${j}`);
    });
    return out;
  }

  /** The seats drawn in the same hex as seat i (including i), in seat order. */
  private stackMates(chars: CharView[], i: number): number[] {
    return this.occupantsAt(chars, this.displayGround(), chars[i].hex)
      .filter((k) => k[0] === "s")
      .map((k) => Number(k.slice(1)));
  }

  /**
   * Where an occupant of a hex goes: the hex centre, shifted along the
   * diagonal when the hex is shared; a gun on the ground also lies off to
   * the lower-right side of the hex rather than in its middle.
   */
  private occupantScreenPos(chars: CharView[], ground: GroundGunView[], hex: string, key: string): { sx: number; sy: number } {
    const { sx, sy } = this.hexToScreen(hex);
    const d = this.tokenDiameter();
    const aside = key[0] === "g" ? d * GROUND_ASIDE : 0;
    const all = this.occupantsAt(chars, ground, hex);
    if (all.length < 2) return { sx: sx + aside, sy: sy + aside };
    const frac = this.spreadHex === hex ? STACK_SPREAD : STACK_REST;
    const shift = d * frac * ((2 * all.indexOf(key)) / (all.length - 1) - 1);
    return { sx: sx + shift + aside, sy: sy + shift + aside };
  }

  /** Where seat i's token goes: its hex centre, shifted along the diagonal when it shares the hex. */
  private tokenScreenPos(chars: CharView[], i: number): { sx: number; sy: number } {
    return this.occupantScreenPos(chars, this.displayGround(), chars[i].hex, `s${i}`);
  }

  /** Draws the guns lying in hexes, below the tokens, with the token icon's rendering, stacked like a character sharing the hex. */
  private refreshGround(chars: CharView[], ground: GroundGunView[]) {
    for (const o of this.groundIcons) {
      o.img.destroy();
      o.dots.destroy();
    }
    this.groundIcons = [];
    const size = this.tokenDiameter() * GUN_SIZE;
    ground.forEach((g, j) => {
      const gun = g.guns[0];
      const key = `gun_${gun?.type}`;
      if (!gun || !this.textures.exists(key)) return;
      const { sx, sy } = this.occupantScreenPos(chars, ground, g.hex, `g${j}`);
      const img = this.add.image(sx, sy, key).setOrigin(0.5).setMask(this.arrMask).setDepth(0.8);
      const dots = this.add.graphics({ x: sx, y: sy }).setMask(this.arrMask).setDepth(0.8);
      img.setAlpha(paintGun(gun, img, dots, size));
      this.groundIcons.push({ img, dots });
    });
  }

  /** Fans out the stack under the pointer, within the disc the spread tokens cover. */
  private updateStackHover(pointer: Phaser.Input.Pointer) {
    if (this.isDragging || pointer.y <= HUD_H || pointer.y >= this.panelY) {
      this.setSpreadHex(null);
      return;
    }
    const chars = this.displayChars();
    const ground = this.displayGround();
    const radius = this.tokenDiameter() * (0.5 + STACK_SPREAD);
    let hit: string | null = null;
    const hexes = new Set<string>([...chars.filter((c) => c).map((c) => c.hex), ...ground.map((g) => g.hex)]);
    for (const hex of hexes) {
      if (this.occupantsAt(chars, ground, hex).length < 2) continue;
      const { sx, sy } = this.hexToScreen(hex);
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, sx, sy) <= radius) {
        hit = hex;
        break;
      }
    }
    this.setSpreadHex(hit);
  }

  private setSpreadHex(hex: string | null) {
    if (hex === this.spreadHex) return;
    this.spreadHex = hex;
    const chars = this.displayChars();
    const ground = this.displayGround();
    this.tokens.forEach((t, i) => {
      if (!t || !chars[i] || this.occupantsAt(chars, ground, chars[i].hex).length < 2) return;
      const { sx, sy } = this.occupantScreenPos(chars, ground, chars[i].hex, `s${i}`);
      t.moveTo(this.tweens, sx, sy, STACK_MS);
    });
    ground.forEach((g, j) => {
      const icon = this.groundIcons[j];
      if (!icon || this.occupantsAt(chars, ground, g.hex).length < 2) return;
      const { sx, sy } = this.occupantScreenPos(chars, ground, g.hex, `g${j}`);
      this.tweens.add({ targets: [icon.img, icon.dots], x: sx, y: sy, duration: STACK_MS, ease: "Cubic.easeInOut" });
    });
  }

  /** The resting highlight of a token: a white ring on my character, none on the others. */
  private applyTokenHighlight(i: number) {
    const t = this.tokens[i];
    if (!t) return;
    if (i === this.myIndex) t.setHighlight(0xffffff, this.mode === "select" ? 0.9 : 0.4);
    else t.setHighlight(GOLD, 0);
  }

  private refreshView() {
    this.buildBoard();
    this.buildTokens();
    this.refreshTokens(false);
    this.clearChoiceOverlays();
    if (this.choiceMode) this.showChoiceOverlays();
    if (this.optMenu) this.openOptMenu(this.optMenu.card, this.optMenu.side); // follows the token on zoom and pan
    if (this.aimMode) this.enterAimMode(this.aimMode.card, this.aimMode.side);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private buildHUD() {
    const w = this.cw;
    this.add.rectangle(0, 0, w, HUD_H, 0x0f0804).setOrigin(0);
    const lobby = this.add
      .text(16, HUD_H / 2, "◀ Lobby", { fontSize: "14px", color: DIM_STR, backgroundColor: "#2a1500", padding: { x: 10, y: 5 } })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    lobby.on("pointerover", () => lobby.setColor(GOLD_STR));
    lobby.on("pointerout", () => lobby.setColor(DIM_STR));
    lobby.on("pointerup", () => this.scene.start("LobbyScene", { splash: false }));
    this.turnText = this.add
      .text(lobby.x + lobby.width + 16, HUD_H / 2, "", { fontSize: "20px", color: GOLD_STR, fontStyle: "bold" })
      .setOrigin(0, 0.5);
    this.statusText = this.add.text(w / 2, HUD_H / 2, "", { fontSize: "17px", color: "#c4935a" }).setOrigin(0.5);
    this.rightText = this.add.text(w - 16, HUD_H / 2, "", { fontSize: "13px", color: DIM_STR }).setOrigin(1, 0.5);
  }

  private refreshHUD() {
    const view = this.view;
    if (!this.turnText || !view) {
      this.turnText?.setText(`Game ${this.gameID}`);
      this.statusText?.setText("Loading…");
      return;
    }
    this.turnText.setText(`Game ${view.id}  ·  Turn ${view.turn}/${view.maxTurns}`);
    this.statusText.setText(this.statusLine());
    const seats = view.players
      .map((p, i) => {
        if (!p.addr) return "empty seat";
        const who = i === this.myIndex ? "you" : shortAddr(p.addr);
        return `${charName(p.char)} (${who})`;
      })
      .join("  vs  ");
    this.rightText.setText(this.netError ? `RPC offline: ${this.netError}` : seats);
    this.rightText.setColor(this.netError ? "#ff8866" : DIM_STR);
  }

  private statusLine(): string {
    const view = this.view!;
    switch (this.mode) {
      case "sync":
        return "Loading…";
      case "select":
        return "Your move: pick your action cards";
      case "submitting":
        return "Signing your plan…";
      case "waiting": {
        if (view.phase === "waiting") return "Waiting for a second player…";
        const me = this.myIndex >= 0 ? view.players[this.myIndex] : null;
        if (me && me.delay >= MAX_ACTION_POINTS) return `Too much delay to act this turn (${me.delay}): you pass, waiting for the opponent…`;
        return "Plan sent, waiting for the opponent…";
      }
      case "playback":
        return this.playback?.live ? `Turn ${this.playback.turns[0].turn} resolution` : "Replay";
      case "spectate":
        return "Spectating";
      case "ended": {
        const w = view.winner >= 0 ? `${charName(view.players[view.winner].char)} wins` : "no winner";
        return `Game over (${view.endReason.replace(/_/g, " ")}): ${w}`;
      }
    }
  }

  // ── Bottom panels ─────────────────────────────────────────────────────────

  private refreshPanels() {
    if (!this.cardContainer) return;
    this.hideCardPreview();
    this.cardContainer.setVisible(this.mode === "select" || this.mode === "submitting");
    this.sequenceContainer.setVisible(this.mode === "playback");
    this.infoContainer.setVisible(!(this.mode === "select" || this.mode === "submitting" || this.mode === "playback"));
    if (this.mode === "select" || this.mode === "submitting") {
      this.refreshSelectionDisplay();
      this.refreshCardHighlights();
    } else if (this.mode === "playback") {
      this.refreshSequencePanel();
    } else {
      this.refreshInfoPanel();
    }
  }

  private buildInfoPanel() {
    const w = this.cw;
    const y = this.panelY;
    this.infoContainer = this.add.container(0, 0).setVisible(false);
    this.infoContainer.add(this.add.rectangle(0, y, w, PANEL_H, 0x0d0704).setOrigin(0));
    this.infoContainer.add(this.add.rectangle(0, y - 1, w, 1, 0x3a2510).setOrigin(0));
    this.infoText = this.add
      .text(w / 2, y + 60, "", { fontSize: "20px", color: GOLD_STR, align: "center", wordWrap: { width: w - 80 } })
      .setOrigin(0.5);
    this.infoContainer.add(this.infoText);
  }

  private refreshInfoPanel() {
    const view = this.view;
    if (!view) return;
    // Rebuild the buttons each time: they depend on the mode.
    this.infoContainer.each((o: Phaser.GameObjects.GameObject) => {
      if (o.getData("button")) o.destroy();
    });
    this.infoText.setText(this.statusLine());
    // "Plan sent" becomes a link to what was sent, when this session knows it.
    if (this.mode === "waiting" && view.phase === "planning" && this.sentPlanString() !== null) {
      const status = this.statusLine();
      const linkLabel = "Plan sent";
      const rest = status.startsWith(linkLabel) ? status.slice(linkLabel.length) : ` · ${status}`;
      this.infoText.setText("");
      const style = { fontSize: "20px", color: GOLD_STR };
      const link = this.add.text(0, this.panelY + 60, linkLabel, { ...style, color: "#ffe2a0" }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).setData("button", true);
      const tail = this.add.text(0, this.panelY + 60, rest, style).setOrigin(0, 0.5).setData("button", true);
      const underline = this.add.rectangle(0, this.panelY + 60 + 12, link.width, 1, 0xffe2a0, 1).setOrigin(0, 0.5).setData("button", true);
      const left = this.cw / 2 - (link.width + tail.width) / 2;
      link.setX(left);
      underline.setX(left);
      tail.setX(left + link.width);
      link.on("pointerover", () => link.setColor("#ffffff"));
      link.on("pointerout", () => link.setColor("#ffe2a0"));
      link.on("pointerup", () => this.openPlanPopup());
      this.infoContainer.add([link, underline, tail]);
    }
    const y = this.panelY + 130;
    const buttons: { label: string; onClick: () => void }[] = [];
    if (this.mode === "waiting" && this.myIndex >= 0) {
      if (view.phase === "planning") buttons.push({ label: "Resign", onClick: () => void this.resign() });
      if (view.timeoutAt > 0 && Date.now() / 1000 > view.timeoutAt) {
        buttons.push({ label: view.phase === "waiting" ? "Cancel game" : "Claim timeout", onClick: () => void this.claimTimeout() });
      }
      if (view.phase === "waiting") buttons.push({ label: "Cancel game", onClick: () => void this.cancelGame() });
    }
    if (view.lastTurn) buttons.push({ label: "Replay", onClick: () => void this.openReplay() });
    buttons.push({ label: "Back to lobby", onClick: () => this.scene.start("LobbyScene", { splash: false }) });
    const gap = 24;
    const widths = buttons.map((b) => b.label.length * 9 + 40);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (buttons.length - 1);
    let x = this.cw / 2 - total / 2;
    buttons.forEach((b, i) => {
      const t = this.add
        .text(x + widths[i] / 2, y, b.label, BTN_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setData("button", true);
      t.on("pointerup", b.onClick);
      this.infoContainer.add(t);
      x += widths[i] + gap;
    });
    if (this.mode === "waiting" && view.phase === "planning" && view.timeoutAt > 0) {
      const t = this.add
        .text(this.cw / 2, y + 60, `Timeout can be claimed after ${new Date(view.timeoutAt * 1000).toLocaleTimeString()}`, {
          fontSize: "13px",
          color: DIM_STR,
        })
        .setOrigin(0.5)
        .setData("button", true);
      this.infoContainer.add(t);
    }
  }

  // ── Card strip ────────────────────────────────────────────────────────────

  private buildCardStrip() {
    const w = this.cw;
    const stripY = this.panelY;
    this.cardContainer = this.add.container(0, 0).setVisible(false);
    this.cardContainer.add(this.add.rectangle(0, stripY, w, PANEL_H, 0x0d0704).setOrigin(0));
    this.cardContainer.add(this.add.rectangle(0, stripY - 1, w, 1, 0x3a2510).setOrigin(0));

    this.selectedDisplay = this.add.text(16, stripY + 8, "", { fontSize: "14px", color: "#888", wordWrap: { width: w - 260 } });
    this.cardContainer.add(this.selectedDisplay);

    this.sendBtn = this.add
      .text(w - 16, stripY + 6, "Send plan", { fontSize: "15px", color: GOLD_STR, backgroundColor: "#2a1500", padding: { x: 12, y: 5 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.sendBtn.on("pointerup", () => void this.sendPlan());
    this.cardContainer.add(this.sendBtn);

    const resign = this.add
      .text(w - 130, stripY + 6, "Resign", { fontSize: "13px", color: DIM_STR, backgroundColor: "#2a1500", padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    resign.on("pointerup", () => void this.resign());
    this.cardContainer.add(resign);

    const replay = this.add
      .text(w - 200, stripY + 6, "Replay", { fontSize: "13px", color: DIM_STR, backgroundColor: "#2a1500", padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    replay.on("pointerup", () => void this.openReplay());
    this.cardContainer.add(replay);

    const totalCardsW = 12 * (CARD_W + CARD_GAP) - CARD_GAP;
    const startX = (w - totalCardsW) / 2;
    const frontY = stripY + 34;
    const backY = frontY + CARD_H + CARD_ROW_GAP;
    for (let row = 0; row < 2; row++) {
      const side: CardSide = row === 0 ? "front" : "back";
      const cardY = row === 0 ? frontY : backY;
      for (let i = 0; i < 12; i++) {
        const card = (i + 1) as CardNumber;
        const x = startX + i * (CARD_W + CARD_GAP);
        const hl = this.add
          .rectangle(x + CARD_W / 2, cardY + CARD_H / 2, CARD_W + 4, CARD_H + 4, 0x000000, 0)
          .setStrokeStyle(2, GOLD, 0);
        this.cardContainer.add(hl);
        this.cardHighlights.push(hl);
        const texKey = side === "front" ? `action_card_a${card}` : `action_card_a${card}_back`;
        const img = this.add.image(x + CARD_W / 2, cardY + CARD_H / 2, texKey).setDisplaySize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
        img.setData("card", card);
        img.setData("side", side);
        img.on("pointerup", () => {
          this.previewSuppressed = true;
          this.hideCardPreview();
          if (this.mode === "select") this.toggleCard(card, side);
        });
        img.on("pointerover", () => this.showCardPreview(img));
        img.on("pointerout", () => this.hideCardPreview());
        this.cardContainer.add(img);
        this.cardImages.push(img);
      }
    }
  }

  /**
   * Shows the hovered card at its full image size just above it (the preview's
   * bottom sits on the card's top edge), shrunk only if the window is too short.
   */
  private showCardPreview(card: Phaser.GameObjects.Image) {
    this.hideCardPreview();
    if (!this.cardContainer.visible || this.previewSuppressed) return;
    const src = card.texture.getSourceImage() as { width: number; height: number };
    const top = card.y - card.displayHeight / 2;
    const h = Math.min(src.height, top - HUD_H - 8);
    const w = (h * src.width) / src.height;
    const x = Phaser.Math.Clamp(card.x, w / 2 + 4, this.cw - w / 2 - 4);
    this.cardPreview = this.add.image(x, top - 2, card.texture.key).setOrigin(0.5, 1).setDepth(900);
    this.cardPreview.setDisplaySize(w, h);
  }

  private hideCardPreview() {
    this.cardPreview?.destroy();
    this.cardPreview = null;
  }

  private cardIdx(card: CardNumber, side: CardSide): number {
    return side === "front" ? card - 1 : 12 + card - 1;
  }

  private isSelected(card: CardNumber, side: CardSide): boolean {
    return this.selectionOrder.some((e) => e.card === card && e.side === side);
  }

  /** The plan in selection order, with the committed directions. */
  private currentPlan(): PlanEntry[] {
    return this.selectionOrder.map((e) => {
      const entry: PlanEntry = { card: e.card, side: e.side };
      const dir = this.pendingChoices.get(e.card);
      if (dir) entry.dir = dir;
      const pick = this.pendingGuns.get(e.card);
      if (pick) {
        if (pick.ground !== undefined) entry.groundGun = pick.ground;
        else entry.gun = pick.gun;
        entry.hand = pick.hand;
      }
      const opt = this.pendingOpts.get(e.card);
      if (opt) entry.opt = opt;
      const aim = this.pendingAims.get(e.card);
      if (aim?.hex) entry.hex = aim.hex;
      if (aim?.target !== undefined) entry.target = aim.target;
      return entry;
    });
  }

  /** My character's guns as the plan leaves them before the next card (the chain's when nothing is planned). */
  private plannedGuns() {
    return this.preview?.guns ?? this.myGuns();
  }

  /**
   * The weapons lying in my character's hex, where the plan leaves it, as
   * the chain has them (a pick-up planned this turn must still find its gun
   * here, so the preview's lifting of it does not apply).
   */
  private groundHere(): GroundGunView[] {
    const me = this.preview ?? (this.myIndex >= 0 ? this.committed[this.myIndex] : null);
    return me ? (this.view?.ground ?? []).filter((g) => g.hex === me.hex) : [];
  }

  /** My character's guns, as the chain shows them. */
  private myGuns() {
    return (this.myIndex >= 0 ? this.view?.players[this.myIndex]?.guns : undefined) ?? [];
  }

  /** Shows the character sheet of a seat, with what the board currently displays for it. */
  private openSheet(seat: number, pick?: GunPick, onClosed?: () => void) {
    const view = this.view;
    const p = view?.players[seat];
    const c = this.displayChars()[seat];
    if (!view || !p || !c) return;
    // The overlay owns the pointer while it is open: no card or token reacts underneath.
    this.input.enabled = false;
    openCharacterSheet(
      {
      name: charName(p.char),
      charKey: p.char,
      seat,
      hex: c.hex,
      facing: c.facing,
      down: c.down,
      delay: c.delay,
      status: c.status,
      submitted: p.submitted,
      phase: view.phase,
      isMe: seat === this.myIndex,
      guns: c.guns,
      ground: this.displayGround().filter((g) => g.hex === c.hex),
      aim: c.aim,
      aimHex: c.aimHex,
      endurance: c.endurance,
      serious: c.serious,
      gunArm: c.gunArm,
      otherArm: c.otherArm,
      leg: c.leg,
      },
      () => {
        if (this.scene.isActive()) this.input.enabled = true;
        onClosed?.();
      },
      pick,
    );
  }

  /** Whether my character played a Run on the previous turn (needed to Sprint). */
  private ranLastTurn(): boolean {
    const me = this.myIndex >= 0 ? this.view?.players[this.myIndex] : null;
    return !!me?.ranLastTurn;
  }

  private budget(): number {
    const me = this.myIndex >= 0 ? this.committed[this.myIndex] : null;
    return Math.max(0, MAX_ACTION_POINTS - (me?.delay ?? 0));
  }

  private clearSelection() {
    this.selectionOrder = [];
    this.pendingChoices.clear();
    this.pendingGuns.clear();
    this.pendingOpts.clear();
    this.pendingAims.clear();
    this.preview = null;
    this.choiceMode = null;
    this.clearChoiceOverlays();
    this.closeOptMenu();
    this.closeAimMode();
  }

  private toggleCard(card: CardNumber, side: CardSide) {
    // While a choice is pending, only that card can be touched (to deselect it).
    if (this.choiceMode && !(card === this.choiceMode.card && side === this.choiceMode.side)) return;
    if (this.optMenu && !(card === this.optMenu.card && side === this.optMenu.side)) return;
    if (this.aimMode && !(card === this.aimMode.card && side === this.aimMode.side)) return;
    const def = getActionDef({ card, side });
    const wasSelected = this.isSelected(card, side);
    const otherSelected = this.isSelected(card, side === "front" ? "back" : "front");
    if (!wasSelected) {
      if (otherSelected || !canPlay({ card, side }, this.ranLastTurn(), this.plannedGuns(), this.groundHere())) return;
      if (planCost(this.currentPlan()) + def.cost > this.budget()) return;
    }
    this.exitChoiceMode();

    if (wasSelected) {
      // Only the last selected card can be deselected: choices are relative to the state before it.
      const last = this.selectionOrder[this.selectionOrder.length - 1];
      if (!last || last.card !== card || last.side !== side) return;
      this.selectionOrder.pop();
      this.pendingChoices.delete(card);
      this.pendingGuns.delete(card);
      this.pendingOpts.delete(card);
      this.pendingAims.delete(card);
    } else {
      this.selectionOrder.push({ card, side });
      if (isShooting({ card, side })) this.openOptMenu(card, side);
      else if (def.choiceType === "gun") this.enterGunChoice(card, side);
      else if (def.choiceType !== "none") this.enterChoiceMode(card, side, def.choiceType);
    }
    this.updatePreview();
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private refreshSelectionDisplay() {
    if (!this.selectedDisplay) return;
    const plan = this.currentPlan();
    const cost = planCost(plan);
    const budget = this.budget();
    const me = this.myIndex >= 0 ? this.view?.players[this.myIndex] : null;
    const name = me ? charName(me.char) : "";
    if (this.mode === "submitting") {
      this.selectedDisplay.setText("Signing your plan in Adena…").setColor(GOLD_STR);
    } else if (this.choiceMode) {
      this.selectedDisplay.setText(`${name}: ${choicePrompt(this.choiceMode.choiceType)}`).setColor("#ff9944");
    } else if (this.optMenu) {
      this.selectedDisplay.setText(`${name}: choose what to do with the gun`).setColor("#ff9944");
    } else if (this.aimMode) {
      const verb = this.pendingOpts.get(this.aimMode.card) === "shoot" ? "shoot" : "aim";
      const odds = verb === "shoot" ? " (chance of hitting, bullseye in red)" : "";
      this.selectedDisplay.setText(`${name}: click the hex to ${verb} at${odds}`).setColor("#ff9944");
    } else if (plan.length === 0) {
      const carry = me && me.delay > 0 ? ` (${me.delay} carried delay)` : "";
      this.selectedDisplay.setText(`${name}: select action cards, or send an empty plan to pass (0/${budget} points${carry})`).setColor("#888");
    } else {
      const guns = this.myGuns();
      const names = plan.map((e) => {
        const def = getActionDef(e);
        if (e.gun !== undefined) return `${def.name}(${def.cost})→${guns.find((g) => g.id === e.gun)?.name ?? "gun"}`;
        return e.dir ? `${def.name}(${def.cost})→${e.dir.replace(/_/g, " ")}` : `${def.name}(${def.cost})`;
      });
      const problem = validatePlan(plan, budget, this.ranLastTurn(), guns);
      this.selectedDisplay.setText(`${name}: ${names.join(" + ")} = ${cost}/${budget} points${problem ? `  ⚠ ${problem}` : ""}`);
      this.selectedDisplay.setColor(problem ? "#ff9944" : GOLD_STR);
    }
    const canSend = this.mode === "select" && !this.choiceMode && validatePlan(plan, budget, this.ranLastTurn(), this.myGuns(), this.groundHere()) === null;
    this.sendBtn.setColor(canSend ? GOLD_STR : "#555");
  }

  private refreshCardHighlights() {
    const plan = this.currentPlan();
    const cost = planCost(plan);
    const budget = this.budget();
    const last = this.selectionOrder[this.selectionOrder.length - 1];
    for (let i = 0; i < this.cardImages.length; i++) {
      const img = this.cardImages[i];
      const hl = this.cardHighlights[i];
      const card = img.getData("card") as CardNumber;
      const side = img.getData("side") as CardSide;
      // Actions the realm does not play yet are not shown at all; the ones
      // it plays but that cannot be picked right now are greyed out below.
      if (!isEnabled({ card, side })) {
        img.setVisible(false);
        hl.setVisible(false);
        continue;
      }
      const def = getActionDef({ card, side });
      const selected = this.isSelected(card, side);
      const otherSelected = this.isSelected(card, side === "front" ? "back" : "front");
      const needsChoice =
        def.choiceType !== "none" &&
        !this.pendingChoices.has(card) &&
        !this.pendingGuns.has(card) &&
        !(this.pendingOpts.has(card) && (!["aim", "shoot"].includes(this.pendingOpts.get(card) ?? "") || this.pendingAims.has(card)));
      const wouldExceed = !selected && cost + def.cost > budget;
      const pendingCard = this.choiceMode ?? this.optMenu ?? this.aimMode;
      const blockedByChoice = !!pendingCard && !(card === pendingCard.card && side === pendingCard.side);
      const isLast = selected && !!last && last.card === card && last.side === side;
      hl.setFillStyle(0x000000, 0);
      if (selected && needsChoice) {
        hl.setStrokeStyle(3, 0xff6600, 1);
        hl.setFillStyle(0xff6600, 0.15);
        img.setAlpha(1);
      } else if (selected && isLast) {
        hl.setStrokeStyle(3, GOLD, 1);
        hl.setFillStyle(GOLD, 0.15);
        img.setAlpha(blockedByChoice ? 0.5 : 1);
      } else if (selected) {
        hl.setStrokeStyle(2, GOLD, 0.5);
        hl.setFillStyle(GOLD, 0.1);
        img.setAlpha(0.6);
      } else {
        hl.setStrokeStyle(2, GOLD, 0);
        const usable = !blockedByChoice && !otherSelected && !wouldExceed && canPlay({ card, side }, this.ranLastTurn(), this.plannedGuns(), this.groundHere());
        img.setAlpha(usable ? 1 : 0.3);
      }
    }
  }

  // ── Choice mode ───────────────────────────────────────────────────────────

  /**
   * Draw & Cock: the player picks the gun on the character sheet by dragging
   * it from the holster to the gun hand. Closing the sheet without a pick
   * drops the card again.
   */
  private enterGunChoice(card: CardNumber, side: CardSide) {
    if (this.myIndex < 0) return;
    const guns = drawableGuns(this.plannedGuns());
    const ground = this.groundHere();
    if (guns.length === 0 && ground.length === 0) return;
    let picked = false;
    this.input.enabled = false;
    const planned = this.plannedGuns();
    const what = guns.length > 0 && ground.length > 0 ? "your gun or the one on the ground" : guns.length > 0 ? "your gun" : "the gun from the ground";
    this.openSheet(
      this.myIndex,
      {
        prompt: `Draw & Cock: drag ${what} to the gun hand, or to both hands to load it`,
        destinations: (pick) => {
          if (pick.ground !== undefined) return ground.some((g) => g.id === pick.ground) ? drawDestinations(planned) : [];
          const gun = planned.find((g) => g.id === pick.gun);
          return gun ? drawDestinations(planned, gun) : [];
        },
        onPick: (pick, hand) => {
          picked = true;
          this.pendingGuns.set(card, { ...pick, hand });
          this.updatePreview(); // the gun icon joins the token right away
          this.refreshSelectionDisplay();
          this.refreshCardHighlights();
        },
      },
      () => {
        if (!picked && this.isSelected(card, side)) {
          const last = this.selectionOrder[this.selectionOrder.length - 1];
          if (last && last.card === card && last.side === side) this.selectionOrder.pop();
          this.refreshSelectionDisplay();
          this.refreshCardHighlights();
        }
      },
    );
  }

  private enterChoiceMode(card: CardNumber, side: CardSide, choiceType: ChoiceType) {
    this.exitChoiceMode();
    const me = this.preview ?? (this.myIndex >= 0 ? this.committed[this.myIndex] : null);
    if (!me) return;
    const rels = choiceType === "move_ahead" || choiceType === "turn_ahead" ? AHEAD_DIRS : BACK_DIRS;
    const isTurn = choiceType === "turn_ahead" || choiceType === "turn_back";
    const from = BOARD_A.hexPos(me.hex);
    const options = rels
      .map((rel) => {
        const abs = relativeToAbsoluteDir(me.facing, rel);
        const hex = BOARD_A.neighbor(me.hex, abs);
        const a = (DIR_ANGLE[abs] * Math.PI) / 180;
        const pos = hex ? BOARD_A.hexPos(hex) : { x: from.x + Math.cos(a) * HEX_SPACING, y: from.y + Math.sin(a) * HEX_SPACING };
        return { rel, hex, x: pos.x, y: pos.y };
      })
      .filter((o) => isTurn || o.hex !== null);
    this.choiceMode = { card, side, choiceType, options };
    this.showChoiceOverlays();
  }

  private showChoiceOverlays() {
    this.clearChoiceOverlays();
    if (!this.choiceMode) return;
    const { scale } = this.displayTransform();
    const r = Math.max(12, HEX_HIGHLIGHT_R * scale * 3);
    for (const opt of this.choiceMode.options) {
      const { sx, sy } = this.boardToScreen(opt.x, opt.y);
      const circle = this.add
        .circle(sx, sy, r, 0x44cc44, 0.35)
        .setStrokeStyle(2, 0x44cc44, 0.9)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true })
        .setDepth(500);
      const label = this.add
        .text(sx, sy, opt.rel.replace(/_/g, "\n"), { fontSize: "10px", color: "#fff", align: "center" })
        .setOrigin(0.5)
        .setMask(this.arrMask)
        .setDepth(501);
      circle.on("pointerup", () => this.resolveChoice(opt.rel));
      this.choiceOverlays.push(circle, label);
    }
  }

  private clearChoiceOverlays() {
    for (const o of this.choiceOverlays) o.destroy();
    this.choiceOverlays = [];
  }

  private resolveChoice(rel: RelativeDirection) {
    if (!this.choiceMode) return;
    this.pendingChoices.set(this.choiceMode.card, rel);
    this.exitChoiceMode();
    this.updatePreview();
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  private exitChoiceMode() {
    this.choiceMode = null;
    this.clearChoiceOverlays();
    this.closeOptMenu();
    this.closeAimMode();
  }

  /** Highlights every hex of my aim zone; clicking one is where the aim or the shot goes. */
  private enterAimMode(card: CardNumber, side: CardSide) {
    this.closeAimMode();
    const chars = this.displayChars();
    const me = this.myIndex >= 0 ? chars[this.myIndex] : null;
    if (!me) return;
    const { scale } = this.displayTransform();
    const r = Math.max(12, HEX_HIGHLIGHT_R * scale * 3);
    const objects: Phaser.GameObjects.GameObject[] = [];
    // When shooting, the chance of hitting each hex.
    const shooting = this.pendingOpts.get(card) === "shoot";
    const cardAimTime = getActionDef({ card, side }).name === "Shoot" ? SHOOT_AIM_TIME : COCK_AIM_SHOOT_AIM_TIME;
    const opp = chars[1 - this.myIndex];
    const markersHex = me.aimHex || (opp?.hex ?? "");
    const fontPx = Math.round(Phaser.Math.Clamp(r * 0.62, 10, 22));
    for (const hex of BOARD_A.aimZone(me.hex, me.facing)) {
      const { sx, sy } = this.hexToScreen(hex);
      const odds = shooting ? shotOdds(me, cardAimTime, hex, markersHex, BOARD_A) : null;
      const circle = this.add
        .circle(sx, sy, r, 0xb01010, 0.3)
        .setStrokeStyle(2, 0xff6040, 0.9)
        .setMask(this.arrMask)
        .setInteractive({ useHandCursor: true })
        .setDepth(500);
      // The chance shows on the hovered hex only.
      const labels: Phaser.GameObjects.Text[] = [];
      if (odds) {
        const pct = this.add
          .text(sx, sy, `${odds.hit}%`, { fontSize: `${fontPx}px`, color: "#ffffff", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 })
          .setOrigin(0.5)
          .setMask(this.arrMask)
          .setDepth(501);
        labels.push(pct);
        if (odds.bullseye > 0) {
          labels.push(
            this.add
              .text(sx + pct.width / 2, sy - pct.height / 2, `${odds.bullseye}`, { fontSize: `${Math.round(fontPx * 0.7)}px`, color: "#ff4030", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 })
              .setOrigin(0.2, 0.6)
              .setMask(this.arrMask)
              .setDepth(501),
          );
        }
        for (const l of labels) l.setVisible(false);
        objects.push(...labels);
      }
      let detail: Phaser.GameObjects.Text | null = null;
      circle.on("pointerover", () => {
        circle.setFillStyle(0xb01010, 0.6);
        this.showAimLine(this.gunCentre(this.myIndex), { x: sx, y: sy }); // where the aim would go
        for (const l of labels) l.setVisible(true);
        if (!odds) return;
        const lines = [
          `Hit ${odds.hit}%  ·  bullseye ${odds.bullseye}%`,
          `range ${odds.range}  ·  aim time ${odds.aimTime}`,
        ];
        detail = this.add
          .text(sx, sy - r - 6, lines.join("\n"), { fontSize: "13px", color: "#f3e7ce", backgroundColor: "#0d0704", padding: { x: 8, y: 5 }, align: "center" })
          .setOrigin(0.5, 1)
          .setDepth(502);
        detail.setX(Phaser.Math.Clamp(sx, detail.width / 2 + 8, this.scale.width - detail.width / 2 - 8));
        if (detail.y - detail.height < 4) detail.setOrigin(0.5, 0).setY(sy + r + 6);
        objects.push(detail);
      });
      circle.on("pointerout", () => {
        circle.setFillStyle(0xb01010, 0.3);
        this.hideAimLine();
        for (const l of labels) l.setVisible(false);
        detail?.destroy();
        detail = null;
      });
      circle.on("pointerup", () => this.resolveAim(hex));
      objects.push(circle);
    }
    this.aimMode = { card, side, objects };
  }

  private closeAimMode() {
    if (!this.aimMode) return;
    for (const o of this.aimMode.objects) o.destroy();
    this.aimMode = null;
  }

  /** A click on a hex with a character on it targets the character, else the hex. */
  private resolveAim(hex: string) {
    if (!this.aimMode) return;
    const chars = this.displayChars();
    const seat = chars.findIndex((c, i) => c && i !== this.myIndex && c.hex === hex && c.status === "alive");
    this.pendingAims.set(this.aimMode.card, seat >= 0 ? { target: seat } : { hex });
    this.closeAimMode();
    this.updatePreview();
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  /** Draws the AIM markers on aimed hexes; markers following the opponent ride on its token (setTargetAim). */
  private refreshAimMarkers(chars: CharView[]) {
    for (const o of this.aimMarkers.values()) o.destroy();
    this.aimMarkers = new Map();
    const size = this.tokenDiameter() * AIM_SIZE;
    chars.forEach((c, seat) => {
      if (!c || c.aim <= 0 || this.aimOnToken(chars, seat) || !this.textures.exists(aimMarkerKey(c.aim))) return;
      const { sx, sy } = this.hexToScreen(c.aimHex);
      const marker = this.add.image(sx, sy, aimMarkerKey(c.aim)).setOrigin(0.5).setDisplaySize(size, size).setMask(this.arrMask).setDepth(30).setInteractive();
      marker.on("pointerover", () => this.showAimLine(this.gunCentre(seat), { x: sx, y: sy }));
      marker.on("pointerout", () => this.hideAimLine());
      this.aimMarkers.set(seat, marker);
    });
  }

  /** Drifts seat's AIM marker up and fades it away, wherever it sits. */
  private fadeAim(seat: number, duration: number) {
    const marker = this.aimMarkers.get(seat);
    if (marker) {
      this.tweens.add({ targets: marker, y: marker.y - this.tokenDiameter() * 0.5, alpha: 0, duration, ease: "Cubic.easeIn" });
      return;
    }
    this.tokens[1 - seat]?.fadeAim(this.tweens, duration);
  }

  /** Zooms seat's AIM marker in and out once, wherever it sits. */
  private pulseAim(seat: number) {
    const marker = this.aimMarkers.get(seat);
    if (marker) {
      const { scaleX, scaleY } = marker;
      this.tweens.add({ targets: marker, scaleX: scaleX * 1.35, scaleY: scaleY * 1.35, duration: 170, yoyo: true, ease: "Quad.easeOut" });
      return;
    }
    this.tokens[1 - seat]?.pulseAim(this.tweens);
  }

  /**
   * Blood squirting from the impact point, sprayed onward along the bullet's
   * path with a little gravity, plus a few stains that linger on the board
   * under the tokens before fading.
   */
  private spurtBlood(at: { sx: number; sy: number }, along: { x: number; y: number }) {
    if (!this.textures.exists("blood")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xb0120e, 1).fillCircle(4, 4, 4);
      g.generateTexture("blood", 8, 8);
      g.destroy();
    }
    const d = this.tokenDiameter();
    const dir = Phaser.Math.RadToDeg(Math.atan2(along.y, along.x));
    const emitter = this.add
      .particles(at.sx, at.sy, "blood", {
        angle: { min: dir - 35, max: dir + 35 },
        speed: { min: d * 1.2, max: d * 3.5 },
        lifespan: { min: 250, max: 650 },
        scale: { start: Math.max(0.5, d / 110), end: 0.15 },
        alpha: { start: 1, end: 0 },
        gravityY: d * 2.5,
        emitting: false,
      })
      .setMask(this.arrMask)
      .setDepth(35);
    emitter.explode(30);
    this.time.delayedCall(1200, () => emitter.destroy());
    this.bloodStains(at, 7, along);
  }

  /**
   * Blood stains on the board under the tokens, fading slowly: splattered
   * a little past the point along a direction, or around it without one
   * (a wound bleeding where the character stands).
   */
  private bloodStains(at: { sx: number; sy: number }, count: number, along?: { x: number; y: number }) {
    const d = this.tokenDiameter();
    const len = along ? Math.hypot(along.x, along.y) || 1 : 1;
    for (let i = 0; i < count; i++) {
      let x: number;
      let y: number;
      if (along) {
        const spread = (Math.random() - 0.5) * d * 0.8;
        const ahead = Math.random() * d * 0.9;
        x = at.sx + (along.x / len) * ahead - (along.y / len) * spread;
        y = at.sy + (along.y / len) * ahead + (along.x / len) * spread;
      } else {
        // Around the token's rim, so the stains show beside the character rather than under it.
        const a = Math.random() * Math.PI * 2;
        const r = d * (0.4 + Math.random() * 0.4);
        x = at.sx + Math.cos(a) * r;
        y = at.sy + Math.sin(a) * r;
      }
      const stain = this.add.circle(x, y, d * (0.03 + Math.random() * 0.06), 0x7a0c0a, 0.85).setMask(this.arrMask).setDepth(0.6);
      this.tweens.add({ targets: stain, alpha: 0, duration: 5000, delay: 2500 + Math.random() * 1500, onComplete: () => stain.destroy() });
    }
  }

  /**
   * A "HIT!", "MISSED!", "JAMMED!" or "EXPLODED!" burst beside a token, off to the side of the
   * bullet's path (perpendicular to it, on whichever side has more room):
   * pops up, holds, fades.
   */
  private popBurst(key: "hit" | "missed" | "jammed" | "exploded", at: { sx: number; sy: number }, along: { x: number; y: number }) {
    if (!this.textures.exists(key)) return;
    const d = this.tokenDiameter();
    const len = Math.hypot(along.x, along.y) || 1;
    const nx = -along.y / len;
    const ny = along.x / len;
    const room = (x: number, y: number) => Math.min(x, this.cw - x, y - HUD_H, this.panelY - y);
    const side = room(at.sx + nx * d, at.sy + ny * d) >= room(at.sx - nx * d, at.sy - ny * d) ? 1 : -1;
    const img = this.add
      .image(at.sx + nx * d * 1.1 * side, at.sy + ny * d * 1.1 * side, key)
      .setOrigin(0.5)
      .setScale(0)
      .setMask(this.arrMask)
      .setDepth(40);
    const scale = (d * 1.8) / img.width;
    this.tweens.add({ targets: img, scale, duration: 260, ease: "Back.easeOut" });
    this.tweens.add({ targets: img, alpha: 0, y: img.y - d * 0.3, duration: 450, delay: 900, ease: "Cubic.easeIn", onComplete: () => img.destroy() });
  }

  /** Where the ray from one point through another leaves the board area (the arena between the HUD and the panel). */
  private beyondTheBoard(from: { sx: number; sy: number }, through: { sx: number; sy: number }): { sx: number; sy: number } {
    const dx = through.sx - from.sx;
    const dy = through.sy - from.sy;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return through;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (this.cw - from.sx) / dx);
    if (dx < 0) t = Math.min(t, (0 - from.sx) / dx);
    if (dy > 0) t = Math.min(t, (this.panelY - from.sy) / dy);
    if (dy < 0) t = Math.min(t, (HUD_H - from.sy) / dy);
    if (!Number.isFinite(t) || t < 1) return through;
    return { sx: from.sx + dx * t, sy: from.sy + dy * t };
  }

  private tokenCentre(seat: number): { x: number; y: number } {
    const { sx, sy } = this.tokenScreenPos(this.displayChars(), seat);
    return { x: sx, y: sy };
  }

  /** The aim line starts at the aimer's gun icon. */
  private gunCentre(seat: number): { x: number; y: number } {
    return this.tokens[seat]?.gunCentre() ?? this.tokenCentre(seat);
  }

  private hexCentre(hex: string): { x: number; y: number } {
    const { sx, sy } = this.hexToScreen(hex);
    return { x: sx, y: sy };
  }

  /** A red dotted line whose dashes march from one end to the other, redrawn every frame. */
  private showAimLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    this.aimLineEnds = { from, to };
    if (!this.aimLine) this.aimLine = this.add.graphics().setMask(this.arrMask);
    this.aimLine.setDepth(this.lineDepth(from, to));
    this.drawAimLine(this.time.now);
  }

  /**
   * Lines between characters go under the tokens (their depth bands start
   * at 1), except when the ends are so close that the tokens would hide
   * the whole line: adjacent or shared hexes get it drawn on top.
   */
  private lineDepth(from: { x: number; y: number }, to: { x: number; y: number }): number {
    return Math.hypot(to.x - from.x, to.y - from.y) < this.tokenDiameter() * 1.4 ? 20 : 0.5;
  }

  private hideAimLine() {
    this.aimLineEnds = null;
    this.aimLine?.clear();
  }

  private drawAimLine(time: number) {
    const g = this.aimLine;
    const ends = this.aimLineEnds;
    if (!g || !ends) return;
    g.clear();
    const dx = ends.to.x - ends.from.x;
    const dy = ends.to.y - ends.from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const dash = 10;
    const period = dash + 8;
    g.lineStyle(3, AIM_LINE_COLOR, 1);
    g.beginPath();
    for (let p = ((time / 20) % period) - period; p < len; p += period) {
      const a = Math.max(p, 0);
      const b = Math.min(p + dash, len);
      if (b <= a) continue;
      g.moveTo(ends.from.x + ux * a, ends.from.y + uy * a);
      g.lineTo(ends.from.x + ux * b, ends.from.y + uy * b);
    }
    g.strokePath();
  }

  update(time: number) {
    if (this.aimLineEnds) this.drawAimLine(time);
  }

  /** Whether seat i's AIM markers ride on the opponent's token (an aim at the character, no hex). */
  private aimOnToken(chars: CharView[], i: number): boolean {
    const c = chars[i];
    return !!c && c.aim > 0 && !c.aimHex && !!chars[1 - i];
  }

  /** The AIM points the opponent of seat i holds on seat i's token (markers that ride on it). */
  private incomingAim(chars: CharView[], i: number): number {
    return this.aimOnToken(chars, 1 - i) ? chars[1 - i].aim : 0;
  }

  /**
   * Buttons for the option of a gun action, in a column to the right of my
   * token: Cock / Aim / Shoot for Cock/Aim/Shoot; the Shoot card has a
   * single option and goes straight to its target. With the gun uncocked (as the plan leaves it before this card)
   * only Cock is enabled; cocked, Cock is disabled and the others enabled.
   */
  private openOptMenu(card: CardNumber, side: CardSide) {
    this.closeOptMenu();
    const chars = this.displayChars();
    const me = this.myIndex >= 0 ? chars[this.myIndex] : null;
    const gun = me ? firingGun(me.guns) : undefined;
    const name = getActionDef({ card, side }).name;
    const opts = MENU_OPTIONS[name] ?? [];
    if (opts.length === 1) {
      // A single option (Shoot): straight to the target pick, no menu.
      this.optMenu = { card, side, objects: [] };
      this.resolveOpt(opts[0]);
      return;
    }
    // A jammed gun cannot be cocked until completely reloaded (13.31).
    const enabled = (o: ShootOption) => !gun || (o === "cock" ? !gun.cocked && !gun.jammed : o === "nothing" ? true : gun.cocked);
    const labels: Record<ShootOption, string> = { cock: "Cock", uncock: "Uncock", aim: "Aim", shoot: "Shoot", nothing: "Do nothing" };
    const objects: Phaser.GameObjects.GameObject[] = [];
    const center = me ? this.tokenScreenPos(chars, this.myIndex) : { sx: this.cw / 2, sy: HUD_H + this.arrH / 2 };
    const x = center.sx + this.tokenDiameter() * 0.8;
    const gap = 6;
    const texts = opts.map((o) =>
      this.add
        .text(x, 0, labels[o], { fontSize: "18px", fontStyle: "bold", color: "#F3E7CE", padding: { x: 14, y: 8 } })
        .setOrigin(0, 0.5)
        .setMask(this.arrMask)
        .setDepth(602),
    );
    const width = Math.max(...texts.map((t) => t.width));
    const total = texts.reduce((h, t) => h + t.height, 0) + gap * (texts.length - 1);
    let y = center.sy - total / 2;
    opts.forEach((o, i) => {
      const text = texts[i];
      y += text.height / 2;
      text.setY(y);
      const box = this.add.rectangle(x, y, width, text.height, 0x8e2f1a, 1).setOrigin(0, 0.5).setStrokeStyle(3, GOLD, 1).setMask(this.arrMask).setDepth(601);
      y += text.height / 2 + gap;
      if (enabled(o)) {
        box.setInteractive({ useHandCursor: true });
        box.on("pointerover", () => box.setFillStyle(0xb8442a, 1));
        box.on("pointerout", () => box.setFillStyle(0x8e2f1a, 1));
        box.on("pointerup", () => this.resolveOpt(o));
      } else {
        // Dimmed but opaque, so nothing on the board shows through it.
        box.setFillStyle(0x3a1d12, 1).setStrokeStyle(3, 0x6b5a3a, 1);
        text.setColor("#8a7a66");
      }
      objects.push(box, text);
    });
    this.optMenu = { card, side, objects };
  }

  private closeOptMenu() {
    if (!this.optMenu) return;
    for (const o of this.optMenu.objects) o.destroy();
    this.optMenu = null;
  }

  private resolveOpt(opt: ShootOption) {
    if (!this.optMenu) return;
    const { card, side } = this.optMenu;
    this.pendingOpts.set(card, opt);
    this.closeOptMenu();
    if (opt === "aim" || opt === "shoot") this.enterAimMode(card, side);
    this.updatePreview();
    if (opt === "cock") this.tokens[this.myIndex]?.cockGun(this.tweens);
    this.refreshSelectionDisplay();
    this.refreshCardHighlights();
  }

  /** Recomputes where the plan leaves my character and animates the token there. */
  private updatePreview() {
    if (this.myIndex < 0 || !this.committed[this.myIndex]) return;
    const me = this.committed[this.myIndex];
    this.preview = replayPlan(me, this.currentPlan(), BOARD_A, this.displayGround().filter((g) => g.hex === me.hex));
    this.refreshTokens(true);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private async sendPlan() {
    if (this.mode !== "select" || this.choiceMode || this.optMenu || this.aimMode || !this.view) return;
    const plan = this.currentPlan();
    const problem = validatePlan(plan, this.budget(), this.ranLastTurn(), this.myGuns(), this.groundHere());
    if (problem) {
      showToast(this, problem, "error");
      return;
    }
    this.mode = "submitting";
    this.refreshPanels();
    this.refreshHUD();
    try {
      const encoded = encodePlan(plan);
      await this.chain.realm.submitPlan(this.gameID, encoded);
      if (!this.scene.isActive()) return;
      this.rememberSentPlan(encoded);
      // While the wallet was answering (its result screen stays open until
      // closed), the poll may already have seen the resolved turn and started
      // its playback: leave that alone.
      if (!this.playback) {
        this.clearSelection();
        this.mode = "waiting";
        this.refreshTokens(true);
        this.refreshPanels();
        this.refreshHUD();
      }
      await this.poller?.pokeNow();
    } catch (e) {
      if (!this.scene.isActive()) return;
      showToast(this, userMessage(e), "error");
      if (!this.playback) {
        this.mode = "select";
        this.refreshPanels();
        this.refreshHUD();
      }
      void this.poller?.pokeNow();
    }
  }

  private async resign() {
    await this.act(() => this.chain.realm.resign(this.gameID), "Resigned");
  }

  private async claimTimeout() {
    await this.act(() => this.chain.realm.claimTimeout(this.gameID), "Timeout claimed");
  }

  private async cancelGame() {
    await this.act(() => this.chain.realm.cancelGame(this.gameID), "Game cancelled");
  }

  private async act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      if (this.scene.isActive()) showToast(this, done, "info");
    } catch (e) {
      if (this.scene.isActive()) showToast(this, userMessage(e), "error");
    }
    await this.poller?.pokeNow();
  }

  // ── Replay of resolved turns ──────────────────────────────────────────────

  private buildSequencePanel() {
    const w = this.cw;
    const y = this.panelY;
    this.sequenceContainer = this.add.container(0, 0).setVisible(false);
    this.sequenceContainer.add(this.add.rectangle(0, y, w, PANEL_H, 0x0d0704).setOrigin(0));
    this.sequenceContainer.add(this.add.rectangle(0, y - 1, w, 1, 0x3a2510).setOrigin(0));
    this.seqTitle = this.add.text(w / 2, y + 26, "", { fontSize: "22px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0.5);
    // One dot per segment; clicking a dot jumps to the state after that segment.
    this.seqDots = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const dot = this.add
        .text(w / 2 + (i - (SEGMENTS - 1) / 2) * 36, y + 62, "○", { fontSize: "30px", color: GOLD_STR })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      dot.on("pointerup", () => {
        if (this.playback) this.stepTo({ index: this.playback.index, seg: i + 1 });
      });
      this.seqDots.push(dot);
    }
    const row1 = y + PANEL_H - 96;
    const row2 = y + PANEL_H - 46;
    // The log lives between the dots and the buttons, clipped and scrollable.
    this.seqLogArea = { top: y + 92, bottom: row1 - 22 };
    const logH = this.seqLogArea.bottom - this.seqLogArea.top;
    this.seqLog = this.add
      .text(w / 2, this.seqLogArea.top, "", { fontSize: "14px", color: "#e8d5b0", align: "center", wordWrap: { width: w - 100 } })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.openLogPopup())
      .setMask(this.make.graphics({ x: 0, y: 0 }, false).fillRect(0, this.seqLogArea.top, w, logH).createGeometryMask());
    this.seqScrollbar = {
      track: this.add.rectangle(w - 30, this.seqLogArea.top, 6, logH, 0x3a2510, 1).setOrigin(0.5, 0).setVisible(false),
      thumb: this.add.rectangle(w - 30, this.seqLogArea.top, 6, 20, GOLD, 0.8).setOrigin(0.5, 0).setVisible(false),
    };
    this.sequenceContainer.add([this.seqTitle, ...this.seqDots, this.seqLog, this.seqScrollbar.track, this.seqScrollbar.thumb]);

    const btn = (x: number, by: number, label: string, onClick: () => void) => {
      const t = this.add.text(x, by, label, BTN_STYLE).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on("pointerup", onClick);
      this.sequenceContainer.add(t);
      return t;
    };
    this.prevTurnBtn = btn(w / 2 - 150, row1, "◀ Turn", () => this.jumpTurn(-1));
    this.playBtn = btn(w / 2, row1, "Play", () => this.toggleAuto());
    this.nextTurnBtn = btn(w / 2 + 150, row1, "Turn ▶", () => this.jumpTurn(1));
    this.prevSeqBtn = btn(w / 2 - 150, row2, "Previous", () => this.stepPlayback(-1));
    this.nextSeqBtn = btn(w / 2, row2, "Next", () => this.stepPlayback(1));
    this.closeReplayBtn = btn(w / 2 + 150, row2, "Close", () => this.finishPlayback());
  }

  /**
   * Shows the given turns from the start of the first one. live is a turn
   * that just resolved: closing it re-syncs the board and moves on.
   */
  private startPlayback(turns: TurnResult[], live: boolean) {
    this.stopAuto();
    this.clearSelection();
    this.playback = { turns, index: 0, seg: 0, live, auto: null };
    this.mode = "playback";
    this.refreshTokens(true);
    this.refreshPanels();
    this.refreshHUD();
  }

  /** Replays the whole showdown so far, from the chain's history. */
  private async openReplay() {
    if (!this.view || this.mode === "playback" || this.mode === "submitting") return;
    try {
      const history = await this.chain.realm.getHistory(this.gameID);
      if (!this.scene.isActive() || this.playback) return;
      if (history.turns.length === 0) {
        showToast(this, "No turn has been played yet", "info");
        return;
      }
      if (this.mode === "select" && this.selectionOrder.length > 0) {
        this.stashedPlan = { turn: this.view.turn, order: [...this.selectionOrder], choices: new Map(this.pendingChoices), guns: new Map(this.pendingGuns), opts: new Map(this.pendingOpts), aims: new Map(this.pendingAims) };
      }
      this.startPlayback(history.turns, false);
    } catch (e) {
      if (this.scene.isActive()) showToast(this, userMessage(e), "error");
    }
  }

  private stepTo(pos: ReplayPos | null) {
    if (!this.playback || !pos) return;
    this.playback.index = pos.index;
    this.playback.seg = pos.seg;
    const events = eventsForSegment(this.playback.turns[pos.index].events, pos.seg);
    const same = () => !!this.playback && this.playback.index === pos.index && this.playback.seg === pos.seg;
    const after = this.displayChars();
    // DEL badges: one that goes away drifts up and fades first; one that
    // appears or changes pulses once the new state is shown.
    const vanishing = this.tokens.filter((t, i) => t && t.delayShown() > 0 && (after[i]?.delay ?? 0) === 0);
    for (const t of vanishing) t?.fadeBadge(this.tweens, 400);
    const settle = () => {
      const before = this.tokens.map((t) => t?.delayShown() ?? 0);
      this.refreshTokens(true);
      this.displayChars().forEach((c, i) => {
        if (c && c.delay !== before[i] && c.delay > 0) this.tokens[i]?.pulseBadge(this.tweens);
      });
      for (const e of events) {
        if (e.kind === "cock") this.tokens[e.p]?.cockGun(this.tweens);
      }
    };
    // An aim lost this segment: its marker drifts up and fades before the state moves on.
    const lost = events.filter((e) => e.kind === "lose_aim");
    const fade = lost.length > 0 || vanishing.length > 0 ? 400 : 0;
    for (const e of lost) this.fadeAim(e.p, fade);
    // An aim taken this segment gets its line and pulse, unless the same
    // segment takes it away again (a hit's DROP, say): nothing to land then.
    const aim = events.find((e) => e.kind === "aim" && (after[e.p]?.aim ?? 0) > 0);
    const land = () => {
      if (!same()) return;
      if (!aim) {
        settle();
        return;
      }
      // An aim taken this segment: the dotted line shows where it goes; a
      // beat later the markers land there with a zoom pulse while the line
      // is still on, then the line clears.
      // Both ends are fixed up front: the gun may be gone from the token by the
      // end of the segment (dropped by a hit), which would jump the line.
      const from = this.gunCentre(aim.p);
      const target = aim.target >= 0 ? this.tokenCentre(aim.target) : this.hexCentre(aim.to);
      this.showAimLine(from, target);
      this.time.delayedCall(150, () => {
        if (!same()) return;
        settle();
        this.showAimLine(from, target); // refreshTokens cleared it
        this.pulseAim(aim.p);
      });
      this.time.delayedCall(470, () => {
        if (same()) this.hideAimLine();
      });
    };
    if (fade > 0) this.time.delayedCall(fade, land);
    else land();
    this.refreshSequencePanel();
    this.flashShots(events);
    // SERIOUS wounds bleed where the character stands as their fatigue cards cost endurance.
    const chars = this.displayChars();
    for (const e of events) {
      if (e.kind === "delay" && e.reason === "serious" && e.endurance > 0 && chars[e.p]) this.bloodStains(this.tokenScreenPos(chars, e.p), 2 * e.endurance);
    }
  }

  /**
   * A bullet flying from the shooter to the target for each shot of the
   * segment: a red tracer grows from the shooter with a bright head, then
   * fades out. Drawn under the tokens like the aim line.
   */
  private flashShots(events: TurnEvent[]) {
    const chars = this.displayChars();
    for (const e of events) {
      if (e.kind === "malfunction" && (e.result === "jams" || e.result === "explodes") && chars[e.p]) {
        // A jam or an explosion: no bullet, the "JAMMED!" or "EXPLODED!"
        // burst pops beside the shooter, off the line towards what it shot at.
        const shot = events.find((x) => x.kind === "shot" && x.p === e.p);
        const at = this.tokenScreenPos(chars, e.p);
        const aimAt = shot ? (shot.target >= 0 && chars[shot.target] ? this.tokenScreenPos(chars, shot.target) : this.hexToScreen(shot.to)) : null;
        const along = aimAt && (aimAt.sx !== at.sx || aimAt.sy !== at.sy) ? { x: aimAt.sx - at.sx, y: aimAt.sy - at.sy } : { x: 1, y: 0 };
        this.popBurst(e.result === "jams" ? "jammed" : "exploded", at, along);
        continue;
      }
      if (e.kind !== "shot" || !chars[e.p]) continue;
      // A misfire shows as a missed shot, unless the second card jams or blows
      // up the gun: then no bullet, the jam has its own burst.
      if (e.reason === "misfire" && events.some((x) => x.kind === "malfunction" && x.p === e.p && (x.result === "jams" || x.result === "explodes"))) continue;
      // The bullet leaves the shooter's gun icon, like the aim line.
      const gun = this.gunCentre(e.p);
      const from = { sx: gun.x, sy: gun.y };
      // The bullet lands somewhere on the target's token, not dead centre;
      // a shot at an empty hex goes for the hex.
      const atToken = e.target >= 0 && !!chars[e.target];
      const centre = atToken ? this.tokenScreenPos(chars, e.target) : this.hexToScreen(e.to);
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * this.tokenDiameter() * 0.4;
      const hit = e.hit !== "-";
      const near = { sx: centre.sx + Math.cos(angle) * spread, sy: centre.sy + Math.sin(angle) * spread };
      let to = near;
      if (!hit) to = this.beyondTheBoard(from, near); // a miss flies on past the target and off the board
      // A miss flies over the target, so its tracer is drawn above the tokens.
      const g = this.add.graphics().setMask(this.arrMask).setDepth(hit ? this.lineDepth({ x: from.sx, y: from.sy }, { x: to.sx, y: to.sy }) : 20);
      const bullet = { t: 0 };
      const draw = () => {
        const x = from.sx + (to.sx - from.sx) * bullet.t;
        const y = from.sy + (to.sy - from.sy) * bullet.t;
        g.clear();
        g.lineStyle(3, AIM_LINE_COLOR, 1);
        g.beginPath();
        g.moveTo(from.sx, from.sy);
        g.lineTo(x, y);
        g.strokePath();
        g.fillStyle(0xffd860, 1);
        g.fillCircle(x, y, 5);
      };
      const length = Math.hypot(to.sx - from.sx, to.sy - from.sy);
      const flight = Math.min(700, 60 + length / 4);
      // The gunshot kicks the gun and shakes the view as the bullet leaves, harder on a hit.
      this.tokens[e.p]?.kickGun(this.tweens);
      this.cameras.main.shake(hit ? 250 : 120, hit ? 0.006 : 0.0025);
      // "HIT!" or "MISSED!" bursts beside the target as the bullet reaches it; a hit bleeds.
      const passing = length > 0 ? Math.hypot(near.sx - from.sx, near.sy - from.sy) / length : 1;
      const along = { x: to.sx - from.sx, y: to.sy - from.sy };
      this.time.delayedCall(flight * passing, () => {
        this.popBurst(hit ? "hit" : "missed", centre, along);
        if (hit) {
          this.spurtBlood(near, along);
          if (atToken) {
            this.tokens[e.target]?.flinch(this.tweens);
            this.tokens[e.target]?.hurtFlash(this);
          }
        }
      });
      this.tweens.add({
        targets: bullet,
        t: 1,
        duration: flight,
        ease: "Linear",
        onUpdate: draw,
        onComplete: () => this.tweens.add({ targets: g, alpha: 0, duration: 600, delay: 150, ease: "Cubic.easeIn", onComplete: () => g.destroy() }),
      });
    }
  }

  private stepPlayback(delta: 1 | -1) {
    const pb = this.playback;
    if (!pb) return;
    const pos = { index: pb.index, seg: pb.seg };
    this.stepTo(delta > 0 ? stepForward(pos, pb.turns.length) : stepBack(pos));
  }

  private jumpTurn(delta: 1 | -1) {
    const pb = this.playback;
    if (!pb) return;
    const index = Phaser.Math.Clamp(pb.index + delta, 0, pb.turns.length - 1);
    if (index !== pb.index) this.stepTo({ index, seg: 0 });
  }

  private toggleAuto() {
    const pb = this.playback;
    if (!pb) return;
    if (pb.auto) {
      this.stopAuto();
    } else {
      pb.auto = this.time.addEvent({
        delay: 900,
        loop: true,
        callback: () => {
          const cur = this.playback;
          if (!cur) return;
          const next = stepForward({ index: cur.index, seg: cur.seg }, cur.turns.length);
          if (next) this.stepTo(next);
          else this.stopAuto();
        },
      });
    }
    this.refreshSequencePanel();
  }

  private stopAuto() {
    if (this.playback?.auto) {
      this.playback.auto.remove();
      this.playback.auto = null;
    }
  }

  /** Scrolls the resolution log by dy pixels, clamped to its overflow, and lays out the scrollbar. */
  private scrollLog(dy: number) {
    const { top, bottom } = this.seqLogArea;
    const areaH = bottom - top;
    const overflow = Math.max(0, this.seqLog.height - areaH);
    this.seqScroll = Phaser.Math.Clamp(this.seqScroll + dy, 0, overflow);
    this.seqLog.setY(top - this.seqScroll);
    if (!this.seqScrollbar) return;
    const show = overflow > 0;
    this.seqScrollbar.track.setVisible(show);
    this.seqScrollbar.thumb.setVisible(show);
    if (show) {
      const thumbH = Math.max(16, (areaH * areaH) / this.seqLog.height);
      this.seqScrollbar.thumb.setSize(6, thumbH).setY(top + (areaH - thumbH) * (this.seqScroll / overflow));
    }
  }

  private rememberSentPlan(plan: string) {
    this.sentPlan = { turn: this.view?.turn ?? 0, plan };
  }

  /** The plan sent for the current turn, or null while it is not known yet. */
  private sentPlanString(): string | null {
    const sent = this.sentPlan;
    return sent && sent.turn === this.view?.turn ? sent.plan : null;
  }

  /** Reads my plan for the turn in progress back from the chain, when the chain says I sent one this session does not know. */
  private async loadSentPlan() {
    const view = this.view;
    if (!view || this.myIndex < 0 || !view.players[this.myIndex]?.submitted || this.sentPlan?.turn === view.turn) return;
    const turn = view.turn;
    try {
      const p = await this.chain.realm.getPlan(this.gameID, this.chain.wallet.address);
      if (!this.scene.isActive() || !p.submitted || p.turn !== turn || this.view?.turn !== turn) return;
      this.sentPlan = { turn, plan: p.plan };
      if (this.mode === "waiting") this.refreshInfoPanel();
    } catch {
      // the status stays plain text
    }
  }

  /** The lines of the resolution log for the segment shown: the plans and turn-start events at segment 0, else the segment's events. */
  private logLines(): string[] {
    const pb = this.playback;
    if (!pb) return [];
    const t = pb.turns[pb.index];
    const names = this.view?.players.map((p) => charName(p.char)) ?? [];
    if (pb.seg === 0) {
      // Each plan in words, as the "Plan sent" popup words it: the player,
      // then one indented line per action.
      const lines = t.plans.flatMap((p, i) => {
        const who = names[i] ?? `seat ${i}`;
        if (!p) return [`${who} passes.`];
        try {
          return [`${who}:`, ...decodePlan(p).map((e, k) => `    ${k + 1}. ${describePlanEntry(e, names)}`)];
        } catch {
          return [`${who}: ${p}`];
        }
      });
      lines.push(...eventsForSegment(t.events, 0).map((e) => describeEvent(e, names)));
      return lines;
    }
    let lines = eventsForSegment(t.events, pb.seg).map((e) => describeEvent(e, names));
    if (pb.seg === SEGMENTS) lines.push(...endOfTurnEvents(t.events).map((e) => describeEvent(e, names)));
    if (lines.length === 0) lines = ["Nothing happens."];
    if (pb.seg === SEGMENTS && t.cards?.length) lines.push(`Result cards drawn: ${t.cards.join(", ")}`);
    return lines;
  }

  /**
   * The resolution log in a wide popup over the board, scrollable with the
   * wheel; closed by its × button, a click outside or Escape.
   */
  private openLogPopup() {
    this.openPopup(this.seqTitle.text, this.logLines(), "log");
  }

  /** The plan sent this turn, entry by entry, in a popup. */
  private openPlanPopup() {
    const sent = this.sentPlanString();
    if (sent === null) return;
    const names = this.view?.players.map((p) => charName(p.char)) ?? [];
    let entries: PlanEntry[];
    try {
      entries = decodePlan(sent);
    } catch {
      entries = [];
    }
    const lines = entries.length === 0 ? ["You passed: no action this turn."] : entries.map((e, i) => `${i + 1}. ${describePlanEntry(e, names)}`);
    this.openPopup(`Your plan for turn ${this.view?.turn ?? ""}`, lines, "plan");
  }

  private openPopup(title: string, lines: string[], kind: "log" | "plan") {
    this.closeLogPopup();
    const pw = Math.min(this.cw - 80, 900);
    const ph = Math.min(this.ch - 120, 560);
    const px = (this.cw - pw) / 2;
    const py = (this.ch - ph) / 2;
    const backdrop = this.add.rectangle(0, 0, this.cw, this.ch, 0x000000, 0.6).setOrigin(0).setDepth(900).setInteractive();
    backdrop.on("pointerup", () => this.closeLogPopup());
    const panel = this.add.rectangle(px, py, pw, ph, 0x1a0f07, 1).setOrigin(0).setStrokeStyle(3, GOLD, 1).setDepth(901).setInteractive();
    const titleText = this.add.text(px + pw / 2, py + 26, title, { fontSize: "22px", color: GOLD_STR, fontStyle: "bold" }).setOrigin(0.5).setDepth(902);
    const close = this.add.text(px + pw - 22, py + 22, "✕", { fontSize: "22px", color: GOLD_STR }).setOrigin(0.5).setDepth(902).setInteractive({ useHandCursor: true });
    close.on("pointerup", () => this.closeLogPopup());
    const area = { top: py + 56, bottom: py + ph - 24 };
    const text = this.add
      .text(px + 28, area.top, lines.join("\n"), { fontSize: "17px", color: "#e8d5b0", lineSpacing: 6, wordWrap: { width: pw - 80 } })
      .setOrigin(0, 0)
      .setDepth(902)
      .setMask(this.make.graphics({ x: 0, y: 0 }, false).fillRect(px, area.top, pw, area.bottom - area.top).createGeometryMask());
    const track = this.add.rectangle(px + pw - 20, area.top, 6, area.bottom - area.top, 0x3a2510, 1).setOrigin(0.5, 0).setDepth(902);
    const thumb = this.add.rectangle(px + pw - 20, area.top, 6, 20, GOLD, 0.8).setOrigin(0.5, 0).setDepth(903);
    this.logPopup = { kind, objects: [backdrop, panel, titleText, close, text, track, thumb], text, area, scroll: 0, track, thumb };
    this.scrollPopup(0);
  }

  private closeLogPopup() {
    if (!this.logPopup) return;
    for (const o of this.logPopup.objects) o.destroy();
    this.logPopup = null;
  }

  private scrollPopup(dy: number) {
    const pop = this.logPopup;
    if (!pop) return;
    const areaH = pop.area.bottom - pop.area.top;
    const overflow = Math.max(0, pop.text.height - areaH);
    pop.scroll = Phaser.Math.Clamp(pop.scroll + dy, 0, overflow);
    pop.text.setY(pop.area.top - pop.scroll);
    const show = overflow > 0;
    pop.track.setVisible(show);
    pop.thumb.setVisible(show);
    if (show) {
      const thumbH = Math.max(16, (areaH * areaH) / pop.text.height);
      pop.thumb.setSize(6, thumbH).setY(pop.area.top + (areaH - thumbH) * (pop.scroll / overflow));
    }
  }

  private refreshSequencePanel() {
    const pb = this.playback;
    if (!pb || !this.seqTitle) return;
    const t = pb.turns[pb.index];
    const which = pb.turns.length > 1 ? `Turn ${t.turn} of ${pb.turns[pb.turns.length - 1].turn}` : `Turn ${t.turn}`;
    this.seqTitle.setText(pb.seg === 0 ? `${which}: start` : `${which}: segment ${pb.seg} of ${SEGMENTS}`);
    this.seqDots.forEach((dot, i) => dot.setText(i < pb.seg ? "●" : "○").setAlpha(i + 1 === pb.seg ? 1 : 0.7));
    this.seqLog.setText(this.logLines().join("\n"));
    this.seqScroll = 0;
    this.scrollLog(0);
    if (this.logPopup?.kind === "log") this.openLogPopup(); // keep an open log popup on the segment shown
    const pos = { index: pb.index, seg: pb.seg };
    this.prevSeqBtn.setAlpha(stepBack(pos) ? 1 : 0.3);
    this.nextSeqBtn.setAlpha(stepForward(pos, pb.turns.length) ? 1 : 0.3);
    this.prevTurnBtn.setAlpha(pb.index > 0 ? 1 : 0.3);
    this.nextTurnBtn.setAlpha(pb.index < pb.turns.length - 1 ? 1 : 0.3);
    this.playBtn.setText(pb.auto ? "Pause" : "Play");
    this.closeReplayBtn.setText(pb.live ? "End turn" : "Close");
  }

  /** Leaves the replay: a live turn is marked as shown, then the board re-syncs. */
  private finishPlayback() {
    const pb = this.playback;
    if (!pb) return;
    this.stopAuto();
    this.closeLogPopup();
    if (pb.live) this.shownResultTurn = pb.turns[pb.turns.length - 1].turn;
    this.playback = null;
    const view = this.view;
    // A turn resolved while the history was open: show it live now.
    if (!pb.live && view?.lastTurn && view.lastTurn.turn !== this.shownResultTurn) {
      this.stashedPlan = null;
      this.startPlayback([view.lastTurn], true);
      return;
    }
    this.applyState(false);
    const stash = this.stashedPlan;
    this.stashedPlan = null;
    if (stash && this.mode === "select" && view && stash.turn === view.turn) {
      this.selectionOrder = stash.order;
      this.pendingChoices = stash.choices;
      this.pendingGuns = stash.guns;
      this.pendingOpts = stash.opts;
      this.pendingAims = stash.aims;
      this.updatePreview();
      this.refreshSelectionDisplay();
      this.refreshCardHighlights();
    }
  }

  // ── Input (zoom, pan) ─────────────────────────────────────────────────────

  private setupInput() {
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.logPopup) {
        this.scrollPopup(dy > 0 ? 48 : -48);
        return;
      }
      if (this.mode === "playback" && pointer.y >= this.seqLogArea.top && pointer.y <= this.seqLogArea.bottom) {
        this.scrollLog(dy > 0 ? 40 : -40);
        return;
      }
      if (pointer.y <= HUD_H || pointer.y >= this.panelY) return;
      const dir = dy > 0 ? -1 : 1;
      const oldZoom = this.zoom;
      this.zoom = Phaser.Math.Clamp(this.zoom * (1 + dir * ZOOM_FACTOR), MIN_ZOOM, MAX_ZOOM);
      const factor = this.zoom / oldZoom;
      const cx = this.cw / 2;
      const cy = HUD_H + this.arrH / 2;
      if (this.zoom <= MIN_ZOOM) {
        this.panX = 0;
        this.panY = 0;
      } else {
        this.panX = (pointer.x - cx - this.panX) * (1 - factor) + this.panX;
        this.panY = (pointer.y - cy - this.panY) * (1 - factor) + this.panY;
      }
      this.refreshView();
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      // Leaving the card panel re-arms the hover preview after a click.
      if (pointer.y < this.panelY) this.previewSuppressed = false;
      this.updateStackHover(pointer);
      if (this.zoom > MIN_ZOOM && pointer.isDown && pointer.y > HUD_H && pointer.y < this.panelY) {
        const dx = pointer.x - this.dragStartX;
        const dy = pointer.y - this.dragStartY;
        if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) this.isDragging = true;
        if (this.isDragging) {
          this.panX = this.panStartX + dx;
          this.panY = this.panStartY + dy;
          this.refreshView();
        }
      }
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > HUD_H && pointer.y < this.panelY) {
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.panStartX = this.panX;
        this.panStartY = this.panY;
        this.isDragging = false;
      }
    });
    this.input.on("pointerup", () => {
      this.isDragging = false;
    });
    this.input.on("gameout", () => this.setSpreadHex(null));
    this.input.keyboard?.on("keydown-ESC", () => this.closeLogPopup());
  }
}

/** One plan entry in words, for the plan popup. */
function describePlanEntry(e: PlanEntry, names: string[]): string {
  const def = getActionDef(e);
  const target = e.target !== undefined ? (names[e.target] ?? `seat ${e.target}`) : e.hex ?? "";
  switch (def.name) {
    case "Draw & Cock":
      return e.groundGun !== undefined ? `Draw & Cock: pick up the gun from the ground into the ${HAND_NAMES[e.hand ?? 0]}` : `Draw & Cock: gun ${e.gun ?? "?"} to the ${HAND_NAMES[e.hand ?? 0]}`;
    case "Cock/Aim/Shoot":
      if (e.opt === "aim") return `Cock/Aim/Shoot: aim at ${target}`;
      if (e.opt === "shoot") return `Cock/Aim/Shoot: shoot at ${target}`;
      return `Cock/Aim/Shoot: ${e.opt ?? "?"} the gun`;
    case "Shoot":
      return e.opt === "shoot" ? `Shoot at ${target}` : "Shoot: do nothing";
    default:
      return e.dir ? `${def.name} ${e.dir.replace(/_/g, " ")}` : def.name;
  }
}

const HAND_NAMES = ["gun hand", "other hand", "both hands"];

function choicePrompt(ct: ChoiceType): string {
  switch (ct) {
    case "move_ahead":
      return "click a highlighted hex to move to";
    case "move_back":
      return "click a highlighted hex to back up to";
    case "turn_ahead":
    case "turn_back":
      return "click a highlighted hex to face toward";
    default:
      return "choose a target";
  }
}
