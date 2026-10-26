# Toones Backend Test Plan

CS450 Capstone, Fall 2026. Testing demo: Oct 27, 2026.

## Purpose

Four people commit to the same backend. These unit tests protect the rules the demo depends on (login protection, map pins, and audio uploads), so a change in one place cannot silently break another.

## Scope

| In scope (Phase 1) | Out of scope for now |
|---|---|
| Login token check on protected routes | Likes, comments, saves (not built yet) |
| Map pin coordinate limits | Transcription and audio classification (not built yet) |
| Clip length and category rules | Frontend UI, map rendering, microphone (need a browser) |
| Accepted audio upload types | Full API requests against a real database (Phase 2) |

## Approach

- **Type:** unit tests. Each test checks one rule in isolation.
- **Tool:** [Vitest](https://vitest.dev). It runs our TypeScript directly with no build step and has mocking built in.
- **No real services:** tests never connect to MongoDB, Google, or Render, and never read `.env`. The JWT secret is replaced with a fake test value, and model rules are checked with Mongoose validation without a database connection.
- **CI:** GitHub Actions (`.github/workflows/tests.yml`) runs the install, the build, and all tests on every pull request to `main`. The `tests` check must be green before merging.
- **Naming:** every test starts with its ID, e.g. `[GEO-01] should reject a pin outside ...`.

## How to Run

```bash
npm install
npm test
```

## Test Cases

| ID | What it checks | Expected result | Status |
|---|---|---|---|
| AUTH-01 | Request to a protected route with no login token | 401, request is blocked | Pass |
| AUTH-02 | Request with a fake token, or one signed with the wrong secret | 401, request is blocked | Pass |
| AUTH-03 | Request with a valid token | Request continues, user ID is attached | Pass |
| GEO-01 | Pin with longitude beyond ±180 or latitude beyond ±90; pin exactly on ±180 / ±90 | Out-of-range rejected, exact edges accepted | Pass |
| UPL-01 | Clip of 0 s or 61 s, or category `sports`; clip of 1 s and 60 s | Invalid clips rejected, 1 s and 60 s accepted | Pass |
| UPL-02 | Upload type `audio/webm;codecs=opus` (browser recording), `text/html`, SVG, empty | WebM accepted as `audio/webm`, others rejected | Pass |

Last run: Oct 26, 2026. 6 of 6 passing.

## Next (Phase 2, by Dec 14)

Sign-up and login routes with a mocked database, photo file-type detection, friends and follow rules, then integration tests against a test database.
