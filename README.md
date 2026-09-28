# Toones

Toones is a location-based social audio app: open a map, discover nearby sound pins, play short audio, filter by context, and share sounds from real places.

## Team Ownership

- Backend: APIs, auth, business logic, audio upload orchestration
- Frontend: React client, map, player, upload UI, social UI
- Design: UI/UX, flows, visual system
- Database: MongoDB schema, indexes, seed data

## Repo Layout

```text
toones/
  backend/   Node.js, TypeScript, Express API
  frontend/  React app placeholder for the frontend lead
```

## Run Backend Locally

```bash
cd backend
npm install
cp .env.example .env
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

See `backend/.env.example`.

- `PORT`: local API port
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: secret for future JWT signing
- `CORS_ORIGIN`: local React origin, usually `http://localhost:5173`

## MongoDB Notes

Sound posts should store location as GeoJSON for radius queries:

```js
location: {
  type: "Point",
  coordinates: [lng, lat]
}
```

Add a `2dsphere` index on `location`. Also plan indexes for `category`, `tags`, `userId`, and `createdAt` as the schema stabilizes.

## First Backend Roadmap

1. Auth
2. Sounds CRUD
3. Geo query
4. Upload signed URL
