# Toones

Toones is a location-based social audio app: open a map, discover nearby sound pins, play short audio, filter by context, and share sounds from real places.

## Team Ownership

- Backend: APIs, auth, business logic, audio upload orchestration
- Frontend: React client, map, player, upload UI, social UI
- Design: UI/UX, flows, visual system
- Database: MongoDB schema, indexes, seed data

## Run Locally

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{ "ok": true, "service": "toones-api" }
```

## Backend Environment

Create a local `.env` file when running the API.

- `PORT`: local API port
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: secret for future JWT signing
- `GOOGLE_CLIENT_ID`: Google OAuth client ID used to verify Google sign-in tokens (optional)
- `CORS_ORIGIN`: allowed React origin, usually `http://localhost:5173`. Accepts a comma-separated list to allow the deployed client alongside local dev.

## Auth API

- `POST /auth/register`: create an account and return a JWT
- `POST /auth/login`: sign in with email or username and return a JWT
- `POST /auth/google`: sign in or sign up with a Google ID token (`{ credential }`) and return a JWT. Requires `GOOGLE_CLIENT_ID`; returns `503` when it is unset. Existing accounts are linked by verified email.
- `GET /auth/me`: return the current user from a bearer token

Auth endpoints require MongoDB. If Mongo is offline, they return `503` while `/health` still works.

## Sounds API (feed)

Audio files are stored in MongoDB GridFS (bucket `audio`), so there is no separate storage service to configure.

- `POST /sounds` (bearer token): multipart form with an `audio` file (webm, ogg, mp4, mpeg, wav; max 5 MB) plus `title`, `category`, `lon`, `lat`, `durationSec` (1-60) and optional `description`, `placeName`, `tags` (comma list). Returns `{ sound, xp, level }` and awards drop XP.
- `GET /sounds`: the feed, newest first. Optional query: `category` (comma list), `limit` (max 200), `before` (ISO date cursor, use `nextBefore`), `near=lon,lat` with `radiusKm`. Send a bearer token to get per-user `listened`/`mine` flags.
- `GET /sounds/:id/audio`: streams the audio. Public, so a plain `<audio>` element works.
- `POST /sounds/:id/listen` (bearer token): the first listen per user earns XP; replays only bump `playCount`. Returns `{ firstListen, playCount, xp, level }`.
- `POST /sounds/:id/photos` (bearer token, uploader only): multipart form with one `photo` file (JPEG, PNG or WebP, detected from the file's bytes; max 4 MB). Up to 3 photos per sound. Returns `{ photos }`, the sound's photo URLs.
- `GET /sounds/:id/photos/:photoId`: streams a photo. Public, so a plain `<img>` works. Sound objects in the feed include a `photos` array of these URLs.

Photos are stored in GridFS too (bucket `photos`).

Categories: `nature`, `language`, `culture`, `music`, `city`. The free Atlas tier holds 512 MB, roughly 500 short clips.

## MongoDB Notes

Sound posts should store location as GeoJSON for radius queries:

```js
location: {
  type: "Point",
  coordinates: [lng, lat]
}
```

`src/models/Sound.ts` defines a `2dsphere` index on `location` plus indexes for `category`, `tags`, `userId`, and `createdAt`.

### Seed data

Copy `.env.example` to `.env`, set `MONGODB_URI`, then run:

```bash
npm run seed
```

This creates demo users (`maya`, `leo`, `sana` at `@seed.toones.dev`, password `password123`) and sample sounds, plus listens, follows, and XP for those users. Re-running replaces only the seed data.

## First Backend Roadmap

1. Sounds CRUD
2. Geo query
3. Upload signed URL
