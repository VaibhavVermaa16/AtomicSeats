# AtomicSeats 🎟️

**Deployed URL:** [http://atomicseats.devdevops.co.in](http://atomicseats.devdevops.co.in)

AtomicSeats is a high-concurrency, production-grade ticket booking platform. It ensures atomic seat reservations, fairness under load, and robust waitlist handling.

---

## 🚀 Features

* **Atomic Bookings** — no overselling even under massive concurrency.
* **Waitlist Support** — partial and full waitlisting with automatic allocation.
* **Event-driven** — Kafka-based workflows for bookings and notifications.
* **Redis Cache** — ultra-fast lookups, waitlist queues, idempotency.
* **Role-based Access** — guest, host, admin.
* **Observability** — structured logging, reconciliation jobs.

---

## 📦 Setup Instructions

### With Docker (Recommended)

```bash
git clone https://github.com/your-repo/atomicseats.git
cd atomicseats
docker-compose up -d
```

Environment variables required in `.env`:

```env
DATABASE_URL=postgres://user:pass@postgres:5432/atomicseats
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=yourpassword
KAFKA_BROKER=kafka:9092
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_app_password
ACCESS_TOKEN_SECRET=your_access_secret
REFRESH_TOKEN_SECRET=your_refresh_secret
SESSION_SECRET=session_secret
```

### Manual Setup

```bash
git clone https://github.com/your-repo/atomicseats.git
cd atomicseats
npm install
npm run db:migrate
npm start
```

Ensure Postgres, Redis, and Kafka are running locally.

---

## 📖 API Endpoints

<details>
  <summary>👤 User Endpoints</summary>

  <details>
    <summary>Register — `POST /api/user/register`</summary>

**Payload:**
```json
{ 
    "username": "vaibhav", 
    "name": "vaibhav", 
    "password": "1234", 
    "email": "vaibhav@gmail.com", 
    "role": "admin" 
}
```

  </details>

  <details>
    <summary>Login — `POST /api/user/login`</summary>


**Payload:**
```json
{ 
    "username": "vaibhav", 
    "password": "1234", 
    "email": "vaibhav@gmail.com", //(optional)
}
```


  </details>

  <details>
    <summary>Get Bookings History — `GET /api/user/bookings`</summary>


```text
User must be logged in
```


  </details>
  <details>
    <summary>Logout — `POST /api/user/logout`</summary>

```text
User must be logged in
```

  </details>
</details>

<details>
  <summary>🎫 Event Endpoints</summary>

  <details>
    <summary>All Events — `GET /api/events/all`</summary>


```text
User must be logged in
```


  </details>

  <details>
    <summary>Create Event — `POST /api/events/create`</summary>


**Payload:**
```json
{
  "name": "Festival",
  "description": "A high-energy ceremony",
  "startsAt": "2025-09-20T18:00:00.000Z",
  "endsAt": "2025-09-20T22:00:00.000Z",
  "venue": "Bilara",
  "capacity": 8,
  "price": 50000
}

```


  </details>

  <details>
    <summary>Update Event — `POST /api/events/update`</summary>


**Payload:**
```json
{
    "id": 12,
    "capacity": 13,
    "name": "New event"
}
```


  </details>

  <details>
    <summary>Delete Event — `POST /api/events/delete`</summary>


**Payload:**
```json
{
    "id": 12 // User must be logged and authorized to delete this event
}
```


  </details>

  

  <details>
    <summary>Book Event — `POST /api/events/book`</summary>


**Payload:**
```json
{
    "eventId": 16, 
    "numberOfSeats": 9
}

```


  </details>

  <details>
    <summary>Cancel Booking — `DELETE /api/events/book`</summary>


**Payload:**
```json
{
    "eventId": 16, 
    "bookingId": 50 // Get through notification on mail
}
```


  </details>
</details>

<details>
  <summary>🛠️ Admin Endpoints</summary>

  <details>
    <summary>Analytics — `GET /api/admin/analytics`</summary>


  </details>
</details>

---

## 🔄 Workflow Diagram

```mermaid
flowchart TD
    Client -->|/api/events/book| API -->|produce booking-requests| Kafka
    Kafka --> BookingConsumer

    BookingConsumer -->|Lock event row| Postgres
    BookingConsumer -->|Check Redis event_id| Redis

    BookingConsumer -->|Seats Available| Confirmed[Insert bookings + update reservedSeats]
    BookingConsumer -->|Partial Seats| Partial[Confirm some + enqueue remainder to waitlist]
    BookingConsumer -->|No Seats| WL[Enqueue to waitlist or notify closed]

    Confirmed --> Redis
    Partial --> Redis
    WL --> Redis

    Confirmed -->|publish| Notifications
    Partial -->|publish| Notifications
    WL -->|publish| Notifications

    Notifications --> NotificationConsumer --> Email

    CancelFlow[User Cancel] --> API --> Kafka --> BookingConsumer --> Postgres
    CancelFlow -->|publish waitlist-allocation| Kafka --> BookingConsumer
```

---

## 📊 ER Diagram

```mermaid
erDiagram
  USERS {
    INTEGER id PK "identity"
    VARCHAR username UNIQUE
    VARCHAR name
    VARCHAR email UNIQUE
    VARCHAR password_hashed
    ENUM role "guest|host|admin"
    VARCHAR refreshToken
  }

  EVENTS {
    INTEGER id PK "identity"
    VARCHAR name
    TEXT description
    INTEGER hostId FK "-> users.id (onDelete cascade)"
    VARCHAR venue
    TIMESTAMP startsAt
    TIMESTAMP endsAt
    INTEGER capacity
    INTEGER reservedSeats
    INTEGER price
  }

  BOOKING {
    INTEGER id PK "identity (1 row per seat when created by consumer)"
    INTEGER userId FK "-> users.id"
    INTEGER eventId FK "-> events.id"
    INTEGER numberOfSeats
    INTEGER cost
    TIMESTAMP createdAt DEFAULT now()
    TIMESTAMP updatedAt DEFAULT now()
    ENUM status "confirmed|cancelled"
    TIMESTAMP cancelledAt
  }

  WAITLIST {
    INTEGER id PK "identity"
    INTEGER userId FK "-> users.id"
    INTEGER eventId FK "-> events.id"
    INTEGER numberOfSeats
    TIMESTAMP createdAt
  }

  REDIS_KEYS {
    STRING event_id "event summary hash"
    STRING booking_id "booking summary hash"
    STRING booking_detail "booking detail hash"
    STRING user_id "user cache"
    LIST waitlist "FIFO queue"
    FLAG waitlist_closed "flag '1' closed"
    STRING booking_idempotency "idempotency key (NX TTL)"
  }

  KAFKA_TOPICS {
    STRING booking_requests "keyed by eventId"
    STRING waitlist_allocation
    STRING notify_user
    STRING notifications
  }

  %% Relationships
  USERS ||--o{ EVENTS : hosts
  USERS ||--o{ BOOKING : "user bookings"
  USERS ||--o{ WAITLIST : "user waitlist entries"
  EVENTS ||--o{ BOOKING : "event bookings"
  EVENTS ||--o{ WAITLIST : "event waitlist entries"
  EVENTS ||--|| REDIS_KEYS : cached_as
  BOOKING ||--|| REDIS_KEYS : "summaries & details"
  WAITLIST ||--|| REDIS_KEYS : "backed-up"
  KAFKA_TOPICS ||--|| BOOKING : "drives bookingConsumer"
  KAFKA_TOPICS ||--|| WAITLIST : "drives waitlist allocation"

```
