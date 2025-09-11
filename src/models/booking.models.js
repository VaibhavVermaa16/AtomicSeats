import {
    pgTable as table,
    integer,
    timestamp,
} from 'drizzle-orm/pg-core';

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

export { booking };