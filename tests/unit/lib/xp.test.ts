import { describe, expect, it } from "vitest";
import { XP_PER_LEVEL, levelFromXp } from "../../../src/lib/xp.js";

describe("levelFromXp", () => {
  it("[XP-01] should start a user at level 1 when they have 0 XP", () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it("[XP-02] should go up one level exactly at each XP_PER_LEVEL boundary", () => {
    expect(levelFromXp(XP_PER_LEVEL - 1)).toBe(1);
    expect(levelFromXp(XP_PER_LEVEL)).toBe(2);
    expect(levelFromXp(XP_PER_LEVEL * 3 + 50)).toBe(4);
  });
});
