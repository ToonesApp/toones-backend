import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { SoundModel } from "../../../src/models/Sound.js";

function soundErrors(overrides: Record<string, unknown> = {}) {
  const sound = new SoundModel({
    userId: new mongoose.Types.ObjectId(),
    title: "Morning birds",
    audioUrl: "https://example.com/clip.webm",
    durationSec: 10,
    category: "nature",
    location: { type: "Point", coordinates: [-74.006, 40.713] },
    ...overrides
  });
  return Object.keys(sound.validateSync()?.errors ?? {});
}

const at = (lng: number, lat: number) => ({ location: { type: "Point", coordinates: [lng, lat] } });

describe("Sound model", () => {
  it("[GEO-01] should reject a pin outside real latitude/longitude limits and accept the exact edges", () => {
    for (const [lng, lat] of [[181, 0], [-181, 0], [0, 91], [0, -91]]) {
      expect(soundErrors(at(lng, lat))).toContain("location.coordinates");
    }

    for (const [lng, lat] of [[180, 90], [-180, -90]]) {
      expect(soundErrors(at(lng, lat))).toEqual([]);
    }
  });

  it("[UPL-01] should reject a clip shorter than 1 s, longer than 60 s, or with an unknown category", () => {
    expect(soundErrors({ durationSec: 0 })).toContain("durationSec");
    expect(soundErrors({ durationSec: 61 })).toContain("durationSec");
    expect(soundErrors({ category: "sports" })).toContain("category");

    expect(soundErrors({ durationSec: 1 })).toEqual([]);
    expect(soundErrors({ durationSec: 60 })).toEqual([]);
  });
});
