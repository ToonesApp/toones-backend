# Toones Backend Test Plan

[![Tests](https://github.com/ToonesApp/toones-backend/actions/workflows/tests.yml/badge.svg)](https://github.com/ToonesApp/toones-backend/actions/workflows/tests.yml)

CS450 Capstone, Fall 2026. Testing demo: Oct 27, 2026. Last updated: Nov 2, 2026.

## Why We Test

Four people commit to the same backend. Without automated tests, one person's change can silently break login, map pins, or uploads, and nobody notices until the demo. Our tests check those rules on every pull request, before anything reaches `main`.

## What We Test

| In scope | Out of scope for now |
|---|---|
| Login protection on private routes | Saves (not built yet) |
| Sign-up and login rules (email, username, password) | Transcription and audio classification (not built yet) |
| Rate limits on sign-up, login, and deletes | Frontend UI, map rendering, microphone (need a real browser) |
| Map pin coordinate limits | Full API requests against a real database (Phase 2) |
| Clip length, category, and audio upload types | |
| Profile bio rules | |
| Deleting a drop and deleting an account | |
| Likes: like, unlike, counts, and the "liked by" list | |

## How We Test

- **Unit tests:** each test checks one rule of our code in isolation, in milliseconds.
- **Route tests:** sign-up, login, delete, and like tests start the real routes on a temporary local port and send real HTTP requests, with the database and file storage mocked.
- **Tool:** [Vitest](https://vitest.dev). It runs our TypeScript directly and has mocking built in.
- **No real services:** tests never connect to MongoDB, Google, or Render, and never read `.env`. The login secret is replaced with a fake test value, and database rules are checked without a database connection.
- **Automatic on every pull request:** GitHub Actions ([`tests.yml`](../.github/workflows/tests.yml)) runs:

  `Pull request` → `install` → `build` → `all unit tests` → **green: OK to merge** / **red: fix first**

## Test Cases

IDs: **AUTH** = login and sign-up, **RATE** = rate limits, **VAL** = request format, **GEO** = map pins, **UPL** = audio uploads, **BIO** = profile bio, **DEL** = deleting a drop, **ACC** = deleting an account, **LIKE** = likes.

| ID | What it checks | Expected result | Status |
|---|---|---|---|
| AUTH-01 | Request to a private route with no login token | Blocked with 401 | Pass |
| AUTH-02 | Request with a fake token, or one signed with the wrong secret | Blocked with 401 | Pass |
| AUTH-03 | Request with a valid login token | Allowed, and the user is identified | Pass |
| AUTH-04 | Valid sign-up with email `"  Maya@Example.COM "` | 201 with a token; email saved as `maya@example.com`; password stored only as a bcrypt hash | Pass |
| AUTH-05 | Sign-up with bad emails (`maya`, `maya@`, `maya@example`, with a space, empty) | Rejected with 400, nothing saved | Pass |
| AUTH-06 | Sign-up with a 7-character password | Rejected with 400 ("at least 8") | Pass |
| AUTH-07 | Sign-up with a username too short, too long, or with symbols/spaces | Rejected with 400 | Pass |
| AUTH-08 | Sign-up with an email that is already registered | Rejected with 409 | Pass |
| AUTH-09 | Login with the correct email (any capitalization) and password | 200 with a token; password hash never returned | Pass |
| AUTH-10 | Login with a wrong password, and with an unknown account | Same 401 error for both, so accounts can't be guessed | Pass |
| AUTH-11 | Sign-up with a 73-character or 76-byte (emoji) password; exactly 72 | Over 72 bytes rejected with 400; exactly 72 accepted | Pass |
| AUTH-12 | Sign-up with a 255-character email | Rejected with 400 | Pass |
| AUTH-13 | Login with a 255-character email/username | Rejected with 400, database never queried | Pass |
| AUTH-14 | Login while the database fails | 500 JSON error instead of a hanging request | Pass |
| RATE-01 | 11th failed login from the same IP within 15 minutes | Blocked with 429 and a JSON error, even with the right password | Pass |
| RATE-02 | 15 successful logins in a row from the same IP | Never blocked (only failures count) | Pass |
| RATE-03 | 6th sign-up from the same IP within an hour; sign-up from another IP | 6th blocked with 429; the other IP still allowed | Pass |
| RATE-04 | 6th account-delete attempt after 5 wrong passwords within 15 minutes | Blocked with 429, even with the right password | Pass |
| RATE-05 | 61st drop delete from the same IP within 15 minutes | First 60 allowed, 61st blocked with 429 | Pass |
| VAL-01 | Request with a malformed JSON body | 400 with a JSON error, not an HTML page | Pass |
| VAL-02 | Request body over the 100 KB limit | 413 with a JSON error | Pass |
| GEO-01 | Pin beyond ±180 longitude or ±90 latitude; pin exactly on the edges | Out of range rejected, exact edges accepted | Pass |
| UPL-01 | Clip of 0 s or 61 s, or an unknown category; clip of exactly 1 s and 60 s | Invalid clips rejected, 1 s and 60 s accepted | Pass |
| UPL-02 | Upload type from browser recording (`audio/webm;codecs=opus`), HTML, SVG, empty | Recording accepted, the rest rejected | Pass |
| BIO-01 | Bio with extra spaces and line breaks | Trimmed, line breaks folded into single spaces | Pass |
| BIO-02 | Empty bio | Allowed, so a user can clear it | Pass |
| BIO-03 | Bio exactly at the length limit; one character over | Limit accepted, one over rejected | Pass |
| BIO-04 | Bio that is not text | Rejected | Pass |
| DEL-01 | Owner deletes their drop | 200; the drop, its listens, its likes, its audio, and its photos are all deleted | Pass |
| DEL-02 | Owner deletes their drop | The 40 drop XP is taken back, never going below 0 | Pass |
| DEL-03 | Someone deletes another user's drop | Blocked with 403, nothing deleted | Pass |
| DEL-04 | Delete a drop that doesn't exist, or with an invalid id | 404, nothing deleted | Pass |
| DEL-05 | Delete a drop with no login token | Blocked with 401, nothing deleted | Pass |
| ACC-01 | Delete account with the correct password | 200; the user, their drops, their listens, and their friend links are all deleted | Pass |
| ACC-02 | Delete account | The user record is deleted last, so a failure part-way can be retried | Pass |
| ACC-03 | Delete account with a wrong password | Blocked with 403, nothing deleted | Pass |
| ACC-04 | Delete a password account without sending the password | Rejected with 400, nothing deleted | Pass |
| ACC-05 | Delete a Google-only account (no password) | Allowed with just the login token | Pass |
| ACC-06 | Delete account with no login token | Blocked with 401, nothing deleted | Pass |
| ACC-07 | Delete an account that liked other drops | Each of those drops loses one like, then the user's likes are deleted | Pass |
| LIKE-01 | Like a drop | 200; like saved, count goes up by 1 | Pass |
| LIKE-02 | Like the same drop twice (double-tap) | Second like ignored, count unchanged | Pass |
| LIKE-03 | Unlike a liked drop | 200; like removed, count goes down by 1, never below 0 | Pass |
| LIKE-04 | Unlike a drop you never liked | Count unchanged | Pass |
| LIKE-05 | Like or unlike a drop that doesn't exist, or with an invalid id | 404, nothing written | Pass |
| LIKE-06 | Like or unlike with no login token | Blocked with 401, nothing written | Pass |
| LIKE-07 | Feed while signed in | Each drop shows its like count and whether you liked it; older drops show 0 | Pass |
| LIKE-08 | Feed while signed out | Counts shown, `liked` false on every drop | Pass |
| LIKE-09 | "Liked by" list | Newest first, with follow status; no email or XP | Pass |
| LIKE-10 | "Liked by" list with `limit` and `before` | Pages correctly and returns the next-page cursor | Pass |
| LIKE-11 | "Liked by" list for a missing drop, or with no login token | 404 / 401 | Pass |

## Results

- **51 of 51 passing** locally (Nov 2, 2026). CI runs them on every pull request.
- **Oct 27 demo:** [PR #7](https://github.com/ToonesApp/toones-backend/pull/7) showed "1 check passed" before merge. [CI test log](https://github.com/ToonesApp/toones-backend/actions/runs/40350296263): open the `tests` job, then "Unit tests", to see each test by ID.
- **Proof the tests catch bugs:**
  - Changing the clip limit from 60 s to 61 s made UPL-01 fail.
  - Loosening the password minimum from 8 to 7 made AUTH-06 fail.
  - Run against the code before issue #11, AUTH-11 to AUTH-14 failed. AUTH-14 hung until it timed out, which confirmed the login bug was real.
  - Removing the owner check made DEL-03 fail, skipping the password check made ACC-03 fail, and deleting the user record first made ACC-02 fail.
  - Counting a repeated like made LIKE-02 fail, returning the whole user record in the "liked by" list made LIKE-09 fail, and skipping like cleanup made DEL-01 and ACC-07 fail.

## Run It Yourself

```bash
npm install
npm test
```

## Next (Phase 2, by Dec 14)

Photo file-type checks, friends and follow rules, sound upload and feed routes, then integration tests against a test database.
