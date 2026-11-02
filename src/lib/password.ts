export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt ignores everything past 72 bytes, so longer passwords would silently match shorter ones. */
export const MAX_PASSWORD_BYTES = 72;

/** The first problem with a new password, or null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} characters.`;
  }

  return null;
}
