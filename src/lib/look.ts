// Keep in sync with toones-frontend/toones-app/src/components/characters/avatar.ts.
import { levelFromXp } from "./xp.js";

export interface Look {
  species: string;
  bg: string;
  hair: string;
  hairColor: number;
  hat: string;
  glasses: string;
  eyes: string;
  mouth: string;
  outfit: string;
  facial: string;
  color: number;
}

/** What a user must reach to wear an item: a level, or a badge by name. */
type Lock = { level: number } | { badge: string };
type Option = { id: string; lock?: Lock };

const open = (...ids: string[]): Option[] => ids.map((id) => ({ id }));

const SPECIES: Option[] = open("pip", "moss", "ima", "sol", "tomo", "ned");
const HAIR: Option[] = [
  ...open("none", "tuft", "bun", "pigtails", "curls", "bob"),
  { id: "long", lock: { level: 2 } },
  { id: "mohawk", lock: { level: 3 } }
];
const HATS: Option[] = [
  ...open("none", "beanie", "cap", "bucket", "party"),
  { id: "catears", lock: { level: 2 } },
  { id: "headphones", lock: { badge: "Listener" } },
  { id: "crown", lock: { badge: "Explorer" } },
  { id: "halo", lock: { level: 5 } }
];
const GLASSES: Option[] = [
  ...open("none", "round", "square", "shades", "star"),
  { id: "heart", lock: { level: 2 } },
  { id: "goggles", lock: { badge: "First Drop" } },
  { id: "monocle", lock: { level: 4 } }
];
const EYES: Option[] = [...open("round", "sleepy", "lashes", "wink"), { id: "star", lock: { badge: "First Drop" } }];
const MOUTHS: Option[] = [...open("smile", "grin", "smirk", "meh"), { id: "tongue", lock: { level: 2 } }];
const OUTFITS: Option[] = [
  ...open("none", "stripes", "polka", "scarf", "bowtie", "hoodie"),
  { id: "overalls", lock: { level: 2 } },
  { id: "cape", lock: { level: 5 } }
];
const FACIAL: Option[] = [
  ...open("none", "stubble", "mustache", "goatee", "chinstrap"),
  { id: "beard", lock: { level: 2 } },
  { id: "handlebar", lock: { level: 3 } }
];
const BACKGROUNDS: Option[] = [
  ...open("none", "sky", "mint", "cream"),
  { id: "sunset", lock: { level: 3 } },
  { id: "dusk", lock: { level: 4 } }
];

const HAIR_COLOR_COUNT = 7;
const COLOR_COUNT = 6;

export const DEFAULT_LOOK: Look = {
  species: "pip",
  bg: "none",
  hair: "none",
  hairColor: 0,
  hat: "none",
  glasses: "none",
  eyes: "round",
  mouth: "smile",
  outfit: "none",
  facial: "none",
  color: 0
};

const STRING_PARTS: [keyof Look, Option[]][] = [
  ["species", SPECIES],
  ["bg", BACKGROUNDS],
  ["hair", HAIR],
  ["hat", HATS],
  ["glasses", GLASSES],
  ["eyes", EYES],
  ["mouth", MOUTHS],
  ["outfit", OUTFITS],
  ["facial", FACIAL]
];

const isIndex = (value: unknown, count: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;

/** Validates a client-sent look strictly: every part must be a known option. Returns null if anything is off. */
export function parseLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const r = raw as Record<string, unknown>;

  if (!isIndex(r.hairColor, HAIR_COLOR_COUNT) || !isIndex(r.color, COLOR_COUNT)) {
    return null;
  }

  const look: Look = { ...DEFAULT_LOOK, hairColor: r.hairColor, color: r.color };

  for (const [part, options] of STRING_PARTS) {
    const value = r[part];

    if (typeof value !== "string" || !options.some((o) => o.id === value)) {
      return null;
    }

    (look[part] as string) = value;
  }

  return look;
}

/** What the user has earned so far, which gates dress-up items. */
export type Progress = { xp: number; drops: number; places: number; listens: number };

function badgesFor(p: Progress): string[] {
  const names: string[] = [];

  if (p.drops >= 1) names.push("First Drop");
  if (p.places >= 3) names.push("Explorer");
  if (p.listens >= 5) names.push("Listener");

  return names;
}

/** The first locked part of the look the user hasn't earned, or null when they can wear all of it. */
export function firstLockedPart(look: Look, progress: Progress): string | null {
  const level = levelFromXp(progress.xp);
  const badges = badgesFor(progress);

  for (const [part, options] of STRING_PARTS) {
    const lock = options.find((o) => o.id === look[part])?.lock;

    if (!lock) continue;

    const earned = "level" in lock ? level >= lock.level : badges.includes(lock.badge);

    if (!earned) return part;
  }

  return null;
}
