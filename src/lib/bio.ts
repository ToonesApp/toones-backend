export const MAX_BIO_LENGTH = 160;

/** Cleans a client-sent bio: trims it and folds line breaks into spaces. Returns null if it isn't a string or is too long. */
export function parseBio(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const bio = raw.replace(/\s+/g, " ").trim();

  return bio.length <= MAX_BIO_LENGTH ? bio : null;
}
