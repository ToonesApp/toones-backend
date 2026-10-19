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
- `CORS_ORIGIN`: local React origin, usually `http://localhost:5173`. Separate several with commas, e.g. `http://localhost:5173,http://localhost:5174`

## Auth API

- `POST /auth/register`: create an account and return a JWT. Body: `{ name, email, password }`; `username` is optional and generated from the email when omitted
- `POST /auth/login`: sign in with email or username and return a JWT
- `GET /auth/me`: return the current user (including `xp` and `level`) from a bearer token

Send the JWT as `Authorization: Bearer <token>` on routes marked 🔒.

## Sounds API

Sounds are returned in the frontend's `Drop` shape: `id`, `title`, `cat` (`Nature`, `Language`, `Culture`, `Music`, `City`), `dur` (seconds), `when` (ms timestamp), `lon`, `lat`, `place`, `listened`, `playCount`, `audioUrl`, and `author`.

- `GET /sounds`: newest first. Optional query: `category=Nature,City`, `user=<userId>`, `limit` (default 200, max 500), and `lon`, `lat`, `radiusKm` (default 50) for nearest-first results. `listened` is set when a token is sent
- `GET /sounds/:id`: one sound
- 🔒 `POST /sounds`: drop a sound and earn 40 XP. Body: `{ title, cat, dur, lon, lat, place?, audioUrl?, tags?, description? }`
- 🔒 `POST /sounds/:id/listen`: count a play. The first listen per user earns 12 XP; replays only bump `playCount`

## Users API

- `GET /users/:id`: profile with `xp`, `level`, `soundCount`, `followerCount`, `followingCount`, and `isFollowing` when a token is sent
- `GET /users/:id/followers` and `GET /users/:id/following`
- 🔒 `POST /users/:id/follow` and 🔒 `DELETE /users/:id/follow`

All endpoints except `/health` require MongoDB. If Mongo is offline, they return `503` while `/health` still works.

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

## Backend Roadmap

1. Upload signed URL, so recordings get a real `audioUrl`
2. Edit and delete your own sounds
