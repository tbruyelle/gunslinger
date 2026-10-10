import type { TurnEvent } from "../chain/types";
import type { CharView } from "./replay";

/**
 * Sound effects, by group: each group lists its variants under
 * assets/sounds/, one is picked at random every time the group plays so a
 * repeated action does not sound mechanical.
 */
export const SOUND_FILES = {
  // A card added to the plan, and reversed when it leaves; both converted
  // from pick-card.aiff (only Safari decodes AIFF), the reverse with
  // ffmpeg -af "atrim=start=0.05,areverse,atrim=start=0.205,asetpts=N/SR/TB,
  // afade=t=in:d=0.01", which shortens the quiet fade-out it starts with.
  pickCard: ["pick-card.mp3"],
  unpickCard: ["pick-card-reverse.mp3"],
  // An option button clicked (Cock, Aim, Shoot).
  select: ["select.mp3"],
  step: ["advance1.wav", "advance2.wav", "advance3.wav", "advance4.wav"],
  turn: ["turn1.wav"],
  unholster: ["unholster-gun1.wav", "unholster-gun2.wav"],
  cock: ["cock-gun1.wav", "cock-gun2.wav", "cock-gun3.wav"],
  aim: ["aim1.wav"],
  // A shot's target picked while planning (the shot itself waits for the cards).
  planShoot: ["plan-shoot.wav"],
  gunshot: ["gunshot1.wav", "gunshot2.wav", "gunshot3.wav", "gunshot4.mp3", "gunshot5.wav", "gunshot7.wav"],
  // A missed bullet ricocheting past the target.
  ricochet: ["missed1.wav", "missed2.wav", "missed3.mp3"],
  reload: ["reload.mp3"],
  delay: ["delay1.mp3"],
  // delay1.mp3 reversed (ffmpeg -af "atrim=0:0.29,areverse"): delay going down.
  undelay: ["delay1-reverse.mp3"],
  fall: ["drop1.ogg", "drop2.wav"],
  wounded: ["serious1.wav", "serious2.ogg"],
  dead: ["dead1.wav", "dead2.wav", "dead3.wav"],
} as const;

export type SoundGroup = keyof typeof SOUND_FILES;

/** Volume per group: gunshots stand out, footsteps stay in the background. */
export const SOUND_VOLUME: Record<SoundGroup, number> = {
  pickCard: 0.6, unpickCard: 0.6, select: 0.6, step: 0.5, turn: 0.5, unholster: 0.8, cock: 0.8, aim: 0.8, planShoot: 0.8, gunshot: 1, ricochet: 0.8, reload: 0.8, delay: 0.7, undelay: 0.7, fall: 0.8, wounded: 0.9, dead: 0.9,
};

/** The Phaser audio key of one variant of a group. */
export const soundKey = (group: SoundGroup, i: number) => `sfx_${group}_${i}`;

/** A sound to play, delayMs after the segment is shown. */
export interface SoundCue {
  group: SoundGroup;
  delayMs: number;
}

/** A Draw & Cock cocks the gun once it is out of the holster. */
const COCK_AFTER_DRAW_MS = 350;
/** Hits apply when the bullet lands, after the gunshot. */
const WOUND_AFTER_SHOT_MS = 350;
/** A miss ricochets once the bullet has passed the target. */
const RICOCHET_AFTER_SHOT_MS = 350;

/** The sounds of one step's events, in the order they happen. */
export function soundsForEvents(events: TurnEvent[]): SoundCue[] {
  const cues: SoundCue[] = [];
  const bled = new Set<number>();
  for (const e of events) {
    switch (e.kind) {
      case "move":
        cues.push({ group: "step", delayMs: 0 });
        break;
      case "turn":
        cues.push({ group: "turn", delayMs: 0 });
        break;
      case "flip":
        if (e.down) cues.push({ group: "fall", delayMs: 0 });
        break;
      case "draw":
        cues.push({ group: "unholster", delayMs: 0 });
        if (e.result !== "jammed") cues.push({ group: "cock", delayMs: COCK_AFTER_DRAW_MS });
        break;
      case "cock":
        cues.push({ group: "cock", delayMs: 0 });
        break;
      case "aim":
        cues.push({ group: "aim", delayMs: 0 });
        break;
      case "load":
        cues.push({ group: "reload", delayMs: 0 });
        break;
      case "shot":
        // A misfire sounds like a missed shot, as it shows, unless the second
        // MALFUNCTION jams or blows up the gun: no bullet then.
        if (e.reason === "misfire" && events.some((x) => x.kind === "malfunction" && x.p === e.p && (x.result === "jams" || x.result === "explodes"))) break;
        cues.push({ group: "gunshot", delayMs: 0 });
        if (e.hit === "-") cues.push({ group: "ricochet", delayMs: RICOCHET_AFTER_SHOT_MS });
        break;
      case "wild_shot":
        cues.push({ group: "gunshot", delayMs: 0 });
        break;
      case "wound":
        cues.push({ group: e.result === "kill" ? "dead" : "wounded", delayMs: WOUND_AFTER_SHOT_MS });
        break;
      case "delay":
        // SERIOUS fatigue cards at the turn start: a groan when they cost
        // endurance, once per character however many cards it draws.
        if (e.reason === "serious" && e.endurance > 0 && !bled.has(e.p)) {
          bled.add(e.p);
          cues.push({ group: "wounded", delayMs: 0 });
        }
        break;
      case "pass_out":
        cues.push({ group: "fall", delayMs: 0 });
        break;
    }
  }
  return cues;
}

/**
 * The sounds of a plan step while planning, from the preview before and
 * after it: only what the plan alone decides (moves, turns, going down,
 * drawing, cocking, aiming, loading); shots and penalties wait for the cards
 * drawn.
 */
export function soundsForPreview(before: CharView, after: CharView): SoundCue[] {
  const cues: SoundCue[] = [];
  if (after.hex !== before.hex) cues.push({ group: "step", delayMs: 0 });
  if (after.facing !== before.facing) cues.push({ group: "turn", delayMs: 0 });
  if (after.down && !before.down) cues.push({ group: "fall", delayMs: 0 });
  if (after.aim > before.aim) cues.push({ group: "aim", delayMs: 0 });
  for (const g of after.guns) {
    const b = before.guns.find((x) => x.id === g.id);
    if (!b || b.location !== g.location) {
      cues.push({ group: "unholster", delayMs: 0 });
      if (g.cocked) cues.push({ group: "cock", delayMs: COCK_AFTER_DRAW_MS });
    } else if (g.shells > b.shells) {
      cues.push({ group: "reload", delayMs: 0 });
    } else if (g.cocked && !b.cocked) {
      cues.push({ group: "cock", delayMs: 0 });
    }
  }
  return cues;
}

/**
 * The DEL badge sounds of a state change: delay1 when a character's delay
 * goes up, reversed when it goes down; once each whoever it is. A character
 * killed or passed out drops its delay silently.
 */
export function soundsForDelay(before: number[], after: CharView[]): SoundCue[] {
  let up = false;
  let down = false;
  after.forEach((c, i) => {
    if (!c || c.status !== "alive" || before[i] === undefined) return;
    if (c.delay > before[i]) up = true;
    else if (c.delay < before[i]) down = true;
  });
  const cues: SoundCue[] = [];
  if (up) cues.push({ group: "delay", delayMs: 0 });
  if (down) cues.push({ group: "undelay", delayMs: 0 });
  return cues;
}
