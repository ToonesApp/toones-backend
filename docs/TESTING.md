# Toones Backend Test Plan

[![Tests](https://github.com/ToonesApp/toones-backend/actions/workflows/tests.yml/badge.svg)](https://github.com/ToonesApp/toones-backend/actions/workflows/tests.yml)

CS450 Capstone, Fall 2026. Testing demo: Oct 27, 2026.

## Why We Test

Four people commit to the same backend. Without automated tests, one person's change can silently break login, map pins, or uploads, and nobody notices until the demo. Our tests check those rules on every pull request, before anything reaches `main`.

## What We Test

| In scope (Phase 1) | Out of scope for now |
|---|---|
| Login protection on private routes | Likes, comments, saves (not built yet) |
| Map pin coordinate limits | Transcription and audio classification (not built yet) |
| Clip length and category rules | Frontend UI, map rendering, microphone (need a real browser) |
| Accepted audio upload types | Full API requests against a real database (Phase 2) |

## How We Test

- **Unit tests:** each test checks one rule of our code in isolation, in milliseconds.
- **Tool:** [Vitest](https://vitest.dev). It runs our TypeScript directly and has mocking built in.
- **No real services:** tests never connect to MongoDB, Google, or Render, and never read `.env`. The login secret is replaced with a fake test value, and database rules are checked without a database connection.
- **Automatic on every pull request:** GitHub Actions ([`tests.yml`](../.github/workflows/tests.yml)) runs:

  `Pull request` → `install` → `build` → `6 unit tests` → **green: OK to merge** / **red: fix first**

## Test Cases

IDs: **AUTH** = login, **GEO** = map pins, **UPL** = audio uploads.

| ID | What it checks | Expected result | Status |
|---|---|---|---|
| AUTH-01 | Request to a private route with no login token | Blocked with 401 | Pass |
| AUTH-02 | Request with a fake token, or one signed with the wrong secret | Blocked with 401 | Pass |
| AUTH-03 | Request with a valid login token | Allowed, and the user is identified | Pass |
| GEO-01 | Pin beyond ±180 longitude or ±90 latitude; pin exactly on the edges | Out of range rejected, exact edges accepted | Pass |
| UPL-01 | Clip of 0 s or 61 s, or an unknown category; clip of exactly 1 s and 60 s | Invalid clips rejected, 1 s and 60 s accepted | Pass |
| UPL-02 | Upload type from browser recording (`audio/webm;codecs=opus`), HTML, SVG, empty | Recording accepted, the rest rejected | Pass |

## Results

- **6 of 6 passing**, locally and in CI (Oct 26, 2026).
- **Passed before merge:** [PR #7](https://github.com/ToonesApp/toones-backend/pull/7) showed "1 check passed" before it was merged into `main`.
- **Test log:** [CI run on `main`](https://github.com/ToonesApp/toones-backend/actions/runs/40350296263). Open the `tests` job, then "Unit tests", to see each test by ID.
- **Proof the tests catch bugs:** we changed the clip limit from 60 s to 61 s. UPL-01 failed right away, so that change could not have merged unnoticed.

## Run It Yourself

```bash
npm install
npm test
```

## Next (Phase 2, by Dec 14)

Sign-up and login routes with a mocked database, photo file-type checks, friends and follow rules, then integration tests against a test database.
