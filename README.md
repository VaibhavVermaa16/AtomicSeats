<div align="center">

# AtomicSeats

High-concurrency, event-driven ticket booking that stays consistent under load — built with Node.js, Express, PostgreSQL (Drizzle ORM), Redis, and Kafka.

</div>

## 🔗 Deployed Base URL

https://atomicseats.devdevops.co.in

## Why AtomicSeats?

- Atomic booking pipeline via Kafka workers — decouples API from booking execution
- Redis-backed caching + custom rate limiter for resilience and fairness
- Periodic reconciliation to keep Redis and Postgres in sync (idempotent rebuild)
- Clean modular architecture with Drizzle models and migrations

## ✨ Features

- Event-driven bookings with Kafka (at-least-once processing)
- Redis cache for events and bookings + hourly reconciliation job
- JWT auth with httpOnly cookies or Bearer tokens
- Per-user/IP rate limiting (Redis sorted sets)
- Structured error and response wrappers
- Dockerized app + workers + Kafka (external Postgres/Redis supported)

## 🧭 Architecture (high level)

```mermaid
flowchart LR
    Client((Client))
    API[Express API\n/app.js]
    K(Kafka Broker)
    BW[Booking Worker\nbookingConsumer.js]
    NW[Notification Worker\nnotificationConsumer.js]
    PG[(PostgreSQL)]
    R[(Redis)]

    Client <--> API
    API -- book --> K
    K --> BW
    BW --> PG
    BW --> R
    BW -- notify --> K
    K --> NW
    NW -- email --> Client
    API <-- cache --> R
    Scheduler[[Cron: Reconcile]] --> R
    Scheduler --> PG
```

## �️ Project Structure

```
src/
├── app.js                  # Express setup, middleware, routes, healthcheck
├── scheduler.js            # Hourly Redis ↔ Postgres reconciliation
├── config/
│   ├── database.js         # Drizzle + node-postgres (DATABASE_URL)
│   └── redis.js            # Redis client (host/port/password)
├── controllers/
│   ├── admin.controller.js     # Admin: manage events + analytics
│   ├── events.controller.js    # Events CRUD + booking producer
│   └── user.controller.js      # Auth: register/login/logout
├── middleware/
│   ├── auth.middleware.js      # JWT parser (cookie/Bearer)
│   └── ratelimiter.middleware.js # Redis-backed rate limiter
├── models/
│   ├── user.model.js           # Users table + auth helpers
│   ├── events.model.js         # Events table
│   └── booking.models.js       # Bookings table
├── routes/
│   ├── admin.routes.js         # /api/admin endpoints (admin only)
│   ├── user.routes.js          # /api/user endpoints
│   └── events.routes.js        # /api/events endpoints
├── utils/
│   ├── kafka.js                # Kafka producer/consumers
│   ├── redisReconciler.js      # Rebuild Redis from Postgres
│   └── sendNotification.js     # Nodemailer transport
└── worker/
        ├── bookingConsumer.js      # Consumes bookings, updates DB+Redis, notifies
        └── notificationConsumer.js # Sends email notifications
```

## 🧰 Tech Stack

- Node.js, Express 5
- PostgreSQL + Drizzle ORM (drizzle-kit migrations)
- Redis 5 (cache, rate limiting)
- Kafka (kafkajs)
- Nodemailer (Gmail)
- Docker + docker-compose

## 🛠️ DevOps & Deployment Features

- Dockerized services (API, workers, Kafka/Zookeeper) with compose for local orchestration
- Healthcheck endpoint: `GET /health` for liveness/readiness probes
- Environment-driven configuration (DATABASE_URL, KAFKA_BROKER, Redis, JWT secrets)
- Graceful shutdown handling (SIGINT/SIGTERM) in `server.js`
- Scheduled cron job for Redis ↔ Postgres reconciliation to maintain cache correctness
- Reverse proxy ready (NGINX) with HTTPS (Let’s Encrypt) for TLS termination
- Horizontal scaling friendly (stateless API + Kafka consumers)
- Structured logging via morgan and clear error/response format

## ⚙️ Environment Variables

Create an env file with these keys. Note: `server.js` loads from a file named `env` by default. You can either create a file named `env` at repo root or export variables in your shell. If you prefer `.env`, either change the path in `server.js` or symlink it: `ln -s .env env`.

Required

- DATABASE_URL=postgresql://USER:PASS@HOST:5432/DBNAME
- ACCESS_TOKEN_SECRET=your-long-random-secret
- REFRESH_TOKEN_SECRET=your-long-random-secret
- ACCESS_TOKEN_EXPIRY=15m
- REFRESH_TOKEN_EXPIRY=7d
- SESSION_SECRET=another-secret
- KAFKA_BROKER=localhost:29092          # local outside Docker; kafka:9092 inside compose

Redis

- REDIS_HOST=localhost                  # or host.docker.internal from containers
- REDIS_PORT=6379
- REDIS_PASSWORD=                       # optional

Mail (Gmail)

- MAIL_USER=you@gmail.com
- MAIL_PASS=app-password                # Use Gmail App Passwords

General

- PORT=3000
- NODE_ENV=development

## 🚀 Quick Start (Local)

1) Install dependencies

```bash
npm install
```

2) Start Kafka (and Zookeeper) via Docker

```bash
docker compose up -d zookeeper kafka
```

3) Ensure Postgres and Redis are running

- Postgres: provide a reachable `DATABASE_URL` (local or hosted)
- Redis: run locally or in Docker:

```bash
docker run -d --name redis -p 6379:6379 redis:7.2
```

4) Generate and run migrations (Drizzle)

```bash
npm run db:generate
npm run db:migrate
```

5) Start services

Development API

```bash
npm run dev
```

Background workers (optional if not using docker-compose for them):

```bash
node src/worker/bookingConsumer.js
node src/worker/notificationConsumer.js
```

API will be available at http://localhost:${PORT:-3000}

## 🐳 Run Everything with Docker

This repo provides containers for API + workers + Kafka/Zookeeper. You still supply your own Postgres/Redis (via env). Example using macOS host services:

```bash
# Ensure your env has DATABASE_URL, REDIS_HOST=host.docker.internal, REDIS_PORT=6379, KAFKA_BROKER=kafka:9092, MAIL_USER, MAIL_PASS
docker compose up -d --build
```

Note: If you want Redis in compose too, you can add a service:

```yaml
redis:
    image: redis:7.2
    ports:
        - "6379:6379"
```

Then set `REDIS_HOST=redis` for containers.

## 🗄️ Database & Migrations (Drizzle)

- Config: `drizzle.config.js` (uses `DATABASE_URL`)
- Migrations out dir: `./drizzle`
- Scripts
    - Generate: `npm run db:generate`
    - Migrate: `npm run db:migrate`

Tables (Drizzle models)

- users: id, username, name, email, password, role (guest|host|admin), refreshToken
- events: id, name, description, hostId, venue, startsAt, endsAt, capacity, reservedSeats, price
- booking: id, userId, eventId, numberOfSeats, cost, createdAt, updatedAt

## 🔐 Auth & Rate Limiting

- Login returns `{ accessToken, refreshToken }` and also sets httpOnly, secure cookies. For local HTTP testing, you may prefer passing `Authorization: Bearer <accessToken>`.
- Protected endpoints use `Authorization: Bearer ...` or `accessToken` cookie.
- Rate limits (examples):
    - Register/Login: 5 requests/60s


## 📡 API Reference (v1)

Health

- GET /health → { status, message, timestamp }

User (prefix: /api/user)

- GET /api/user/ → API info
- POST /api/user/register { username, name, email, password, role } → 201
- POST /api/user/login { email, password } → 200 { user, accessToken, refreshToken }
- POST /api/user/logout (requires auth)
- GET /api/user/bookings (requires auth) → Booking history with cursor pagination
    - Query params:
        - limit: number (default 20, max 100)
        - cursor: base64 token for keyset pagination (opaque)
        - eventId: filter to a specific event
        - status: confirmed | cancelled
        - from, to: ISO date range over booking createdAt
        - view: tickets | summary (summary groups by event)
    - Response:
        - data.items: array of tickets or grouped summaries
        - data.pageInfo: { hasMore, nextCursor }
    - Example:
        ```bash
        curl -H "Authorization: Bearer $ACCESS_TOKEN" \
            'http://localhost:3000/api/user/bookings?limit=20&view=summary'
        ```

Events (prefix: /api/events, requires auth)

- GET /api/events/all → 200 [events]
- POST /api/events/create { name, description, startsAt, endsAt, venue, capacity, price }
- POST /api/events/update { id, ...fields }
- POST /api/events/delete { id }
- POST /api/events/book { eventId, numberOfSeats } → 200 (enqueued)

Example: create event

```bash
curl -X POST http://localhost:3000/api/events/create \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name":"Rock Night",
        "description":"Live music",
        "startsAt":"2025-12-20T19:00:00.000Z",
        "endsAt":"2025-12-20T22:00:00.000Z",
        "venue":"Arena",
        "capacity": 500,
        "price": 1200
    }'
```

Admin (prefix: /api/admin, requires role=admin)

- GET /api/admin/events → 200 [events] (list all events)
- POST /api/admin/events { name, description, startsAt, endsAt, venue, capacity, price, hostId? } → 201
- PATCH /api/admin/events { id, ...fields } → 200 (update any event)
- DELETE /api/admin/events { id } → 200
- GET /api/admin/analytics → 200 { totalBookings, mostPopularEvents, overallCapacity, perEventUtilization }

Example: analytics

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
    http://localhost:3000/api/admin/analytics
```

Notes

- Admin routes enforce JWT auth and role-based middleware. Set your user role to `admin` to access these.
- POST/PUT/PATCH body fields should be valid ISO8601 dates for startsAt/endsAt and numbers for capacity/price.

## 🎟️ Booking Flow

1) API enqueues a message to Kafka topic `booking-requests`
2) Booking worker consumes, verifies capacity, updates Postgres (events.reservedSeats and inserts booking)
3) Worker updates Redis caches (event and booking keys)
4) Worker emits `notify-user` message → Notification worker emails the user
5) A scheduled job reconciles Redis from Postgres hourly for consistency

## 🧹 Reconciliation (Redis ↔ Postgres)

- On server start and hourly via cron, Redis is flushed and repopulated from Postgres (`src/utils/redisReconciler.js`)
- Events, users, and bookings are written as hashes compatible with consumers/controllers

## 🧪 Scripts

- Start (prod): `npm start`
- Start (dev): `npm run dev`
- Format: `npm run format`
- Format check: `npm run format:check`

## 🧯 Troubleshooting

- Cookies not appearing locally? Cookies are set with `secure: true`. Use Bearer tokens or enable HTTPS locally.
- Kafka connection: outside Docker use `KAFKA_BROKER=localhost:29092`; inside compose services use `kafka:9092`.
- Redis connection from containers to host: use `REDIS_HOST=host.docker.internal` on macOS.
- Postgres SSL: the pool uses SSL; ensure your `DATABASE_URL` supports it (for Neon/Render use `sslmode=require`).
- Rate limit 429 errors: slow down or raise limits in route definitions.

## 🤝 Contributing

Issues and PRs welcome. Please include context, reproduction steps, and proposed changes.

## 📜 License

ISC


## 🧪 Concurrency & Race Condition Test

An interactive test harness is included to simulate concurrent bookings end-to-end via Docker Compose:

What it does
- Prompts for your registered email and password
- Logs in and captures the access token and cookies
- Creates a fresh event
- Fires multiple parallel booking requests for that event

One-line command

```
npm run test:concurrency
```

Configurable via env (defaults shown):

```
BASE_URL=http://app:3000
CONCURRENCY=5
SEATS_PER_BOOKING=2
EVENT_CAPACITY=10
EVENT_PRICE=100
WAIT_TIMEOUT_MS=120000
WAIT_INTERVAL_MS=1500
```

Notes
- Bookings are processed asynchronously by the booking worker; check its logs to confirm final allocations and ensure no overselling.
- Rate limits apply; keep CONCURRENCY modest or adjust limiter for testing.

