import { user as User } from './user.model.js';
import { event as Event } from './events.model.js';
import {
    pgTable as table,
    integer,
    timestamp,
    pgEnum,
} from 'drizzle-orm/pg-core';

// Bookings table
const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled']);

const booking = table('booking', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
        .notNull()
        .references(() => User.id, { onDelete: 'cascade' }),
    eventId: integer()
        .notNull()
        .references(() => Event.id, { onDelete: 'cascade' }),
    numberOfSeats: integer().notNull(),
    cost: integer().notNull(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow(),
    status: bookingStatus().notNull().default('confirmed'),
    cancelledAt: timestamp(),
});

export { booking };
