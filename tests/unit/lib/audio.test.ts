import { describe, expect, it } from "vitest";

import { normalizeAudioMime } from "../../../src/lib/audio.js";

describe("normalizeAudioMime", () => {
  it("[UPL-02] should accept the browser's recording format and reject non-audio types", () => {
    expect(normalizeAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeAudioMime("AUDIO/MPEG")).toBe("audio/mpeg");

    expect(normalizeAudioMime("text/html")).toBeNull();
    expect(normalizeAudioMime("image/svg+xml")).toBeNull();
    expect(normalizeAudioMime("")).toBeNull();
  });
});
