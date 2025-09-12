import { client as redisClient } from '../config/redis.js';
import { db } from '../config/database.js';
import { event } from '../models/events.model.js';
import { user } from '../models/user.model.js';
import { booking } from '../models/booking.models.js';

/**
 * Reconciles Redis cache with PostgreSQL DB.
 * Flushes all Redis data and repopulates it from Postgres.
 */
export async function reconcileRedisWithPostgres() {
    // Flush all Redis data
    await redisClient.flushAll();

    // Repopulate Redis from Postgres
    const events = await db.select().from(event);
    const users = await db.select().from(user);
    const bookings = await db.select().from(booking);
    console.log(
        `Repopulating Redis: ${events.length} events, ${users.length} users, ${bookings.length} bookings`
    );

    // Store events as hashes (compatible with events.controller.js)
    for (const e of events) {
        await redisClient.hSet(`event_${e.id}`, {
            event_id: e.id.toString(),
            event_name: e.name,
            description: e.description,
            host_id: e.hostId.toString(),
            venue: e.venue,
            starts_at: e.startsAt.toISOString(),
            ends_at: e.endsAt.toISOString(),
            capacity: e.capacity.toString(),
            reserved_seats: e.reservedSeats.toString(),
        });
    }

    // Store users as hashes
    for (const u of users) {
        await redisClient.hSet(`user_${u.id}`, {
            user_id: u.id.toString(),
            name: u.name,
            email: u.email,
            // ...add other user fields as needed...
        });
    }

    // Store bookings as hashes
    for (const b of bookings) {
        await redisClient.hSet(`booking_${b.id}`, {
            booking_id: b.id.toString(),
            user_id: b.userId.toString(),
            event_id: b.eventId.toString(),
            number_of_seats: b.numberOfSeats.toString(),
            cost: b.cost.toString(),
            // ...add other booking fields as needed...
        });
    }

    console.log('Redis cache reconciled with PostgreSQL.');
}
