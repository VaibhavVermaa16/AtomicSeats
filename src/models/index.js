import {
    pgEnum,
    pgTable as table,
    varchar,
    integer,
    timestamp,
} from 'drizzle-orm/pg-core';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Enums
const rolesEnum = pgEnum('roles', ['guest', 'host', 'admin']);

// Users table
const user = table('users', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: varchar({ length: 128 }).notNull().unique(),
    name: varchar({ length: 256 }).notNull(),
    email: varchar({ length: 256 }).notNull().unique(),
    password: varchar({ length: 256 }).notNull(),
    role: rolesEnum().default('guest'),
    refreshToken: varchar({ length: 512 }), // for auth refresh tokens
});

// Events table
const event = table('event', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    hostId: integer()
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }), // who is hosting

    venue: varchar({ length: 512 }).notNull(),
    startsAt: timestamp().notNull(),
    endsAt: timestamp().notNull(),

    capacity: integer().notNull(),
    reservedSeats: integer().default(0),
});

// Bookings table
const booking = table('booking', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    eventId: integer()
        .notNull()
        .references(() => event.id, { onDelete: 'cascade' }),

    cost: integer().notNull(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow(),
});

// User → Events
// A host user can have many events (events.hostId links to users.id).
// → for eventsHostedByUser, just query events where hostId = user.id.

// User → Bookings → Events
// A guest books an event via the bookings table.
// → for events_booked_by_user, you join bookings on userId.

// Event → Guests
// Guests list = all users who booked that event (bookings where eventId = event.id).

// Hash password before saving to DB
async function hashPassword(password) {
    const saltRounds = 12;
    return (await bcrypt.hash(password, saltRounds)).toString();
}

// Compare password with hashed one
async function isPasswordCorrect(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
}

// Generate Access Token
function generateAccessToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            email: user.email,
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
        }
    );
}

// Generate Refresh Token
function generateRefreshToken(userId) {
    return jwt.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    });
}

export {
    user,
    event,
    booking,
    hashPassword,
    isPasswordCorrect,
    generateAccessToken,
    generateRefreshToken,
    rolesEnum,
};