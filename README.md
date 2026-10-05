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
- `CORS_ORIGIN`: local React origin, usually `http://localhost:5173`

## Auth API

- `POST /auth/register`: create an account and return a JWT
- `POST /auth/login`: sign in with email or username and return a JWT
- `GET /auth/me`: return the current user from a bearer token

Auth endpoints require MongoDB. If Mongo is offline, they return `503` while `/health` still works.

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
