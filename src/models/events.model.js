import { user as User } from './user.model.js';
import {
    pgTable as table,
    varchar,
    integer,
    timestamp,
} from 'drizzle-orm/pg-core';

// Events table
const event = table('events', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    description: varchar({ length: 1024 }).notNull(),
    hostId: integer()
        .notNull()
        .references(() => User.id, { onDelete: 'cascade' }), // who is hosting

    venue: varchar({ length: 512 }).notNull(),
    startsAt: timestamp().notNull(),
    endsAt: timestamp().notNull(),

    capacity: integer().notNull(),
    reservedSeats: integer().default(0),
});

export { event };