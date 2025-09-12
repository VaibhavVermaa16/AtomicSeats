# AtomicSeats

A fault-tolerant, high-concurrency ticket booking system built with Node.Js, Redis, Kafka, and PostgreSQL. Ensures atomic seat reservations, prevents overselling with distributed locks, supports event-driven workflows, and keeps Redis + DB in sync through idempotent operations and reconciliation.

## 🚀 Quick Start

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd AtomicSeats

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Update .env with your database credentials
```

### Running the Application

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000`

## 📁 Project Structure

```
src/
├── app.js              # Express application setup
├── config/
│   └── database.js     # PostgreSQL connection configuration
├── controllers/
│   └── index.js        # API controllers with CRUD operations
├── models/
│   └── index.js        # Database models and query methods
├── routes/
│   └── index.js        # API route definitions
└── middleware/
    └── index.js        # Custom middleware functions
```

## 🛠️ API Endpoints

### Health Check

- `GET /health` - Server health status

### API Info

- `GET /api` - API information and available endpoints

### Users

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `GET /api/users/email/:email` - Get user by email
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Events

- `GET /api/events` - Get all events
- `GET /api/events/active` - Get active events
- `GET /api/events/:id` - Get event by ID
- `POST /api/events` - Create new event
- `PUT /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event

### Seats

- `GET /api/seats` - Get all seats
- `GET /api/seats/:id` - Get seat by ID
- `GET /api/seats/event/:eventId/available` - Get available seats for event
- `POST /api/seats` - Create new seat
- `PUT /api/seats/:id` - Update seat
- `DELETE /api/seats/:id` - Delete seat

## 🗄️ Database Setup

### Generate migrations

- npx drizzle-kit generate

### Apply the migrations

- npx drizzle-kit migrate

Create a PostgreSQL database and update the `.env` file with your database credentials.

Example table schemas (create these in your database):

```sql
-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events table
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    event_date TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seats table
CREATE TABLE seats (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id),
    row_number INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 💻 Development

### Code Formatting

```bash
# Format code with Prettier
npm run format

# Check formatting
npm run format:check
```

### Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with auto-reload
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## 🏗️ Architecture

- **Modular Design**: Clear separation of concerns with dedicated folders for routes, controllers, models, and middleware
- **PostgreSQL Integration**: Robust database operations with connection pooling
- **Error Handling**: Comprehensive error handling with custom middleware
- **Code Quality**: Prettier configuration for consistent code formatting
- **Environment Configuration**: Flexible environment-based configuration
