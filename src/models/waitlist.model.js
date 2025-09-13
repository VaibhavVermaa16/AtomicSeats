import { user as User } from './user.model.js';
import { event as Event } from './events.model.js';
import { pgTable as table, integer, timestamp } from 'drizzle-orm/pg-core';

// Waitlist entries (FIFO approximated by createdAt and sequence id)
const waitlist = table('waitlist', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
        .notNull()
        .references(() => User.id, { onDelete: 'cascade' }),
    eventId: integer()
        .notNull()
        .references(() => Event.id, { onDelete: 'cascade' }),
    numberOfSeats: integer().notNull(),
    createdAt: timestamp().defaultNow(),
});

export { waitlist };
