// Keep in sync with toones-frontend/toones-app/src/lib/xp.ts.
export const XP_PER_DROP = 40;
export const XP_PER_LISTEN = 12;
export const XP_PER_LEVEL = 100;

export function levelFromXp(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}
