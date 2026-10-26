import { describe, expect, it } from "vitest";

import { MAX_BIO_LENGTH, parseBio } from "../../../src/lib/bio.js";

describe("parseBio", () => {
  it("[BIO-01] should trim and fold line breaks into single spaces", () => {
    expect(parseBio("  Recording\n\nrain   in Kathmandu  ")).toBe("Recording rain in Kathmandu");
  });

  it("[BIO-02] should allow an empty bio so a user can clear it", () => {
    expect(parseBio("   ")).toBe("");
  });

  it("[BIO-03] should accept exactly the limit and reject one character more", () => {
    expect(parseBio("a".repeat(MAX_BIO_LENGTH))).toHaveLength(MAX_BIO_LENGTH);
    expect(parseBio("a".repeat(MAX_BIO_LENGTH + 1))).toBeNull();
  });

  it("[BIO-04] should reject anything that isn't a string", () => {
    for (const value of [undefined, null, 42, {}, ["hi"]]) {
      expect(parseBio(value)).toBeNull();
    }
  });
});
