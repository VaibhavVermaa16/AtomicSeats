import { consumer } from '../utils/kafka.js';
import { db } from '../config/database.js';
import { event as Event } from '../models/events.model.js';
import { booking } from '../models/booking.models.js';
import { eq } from 'drizzle-orm';
import { client } from '../config/redis.js';
import apiError from '../utils/apiError.js';
import { reconcileRedisWithPostgres } from '../utils/redisReconciler.js';

async function startBookingConsumer() {
    await consumer.connect();
    await consumer.subscribe({
        topic: 'booking-requests',
        fromBeginning: false,
    });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const { userId, eventId, numberOfSeats } = JSON.parse(
                message.value.toString()
            );

            console.log(
                `Processing booking for user ${userId} on event ${eventId} for ${numberOfSeats} seats`
            );
            // Booking logic (check seats, update DB, etc.)
            const currentEvent = await db
                .select()
                .from(Event)
                .where(eq(Event.id, eventId));
            const availableSeats =
                currentEvent[0].capacity - currentEvent[0].reservedSeats;
        
            try {
                await db
                    .update(Event)
                    .set({
                        reservedSeats:
                            currentEvent[0].reservedSeats + numberOfSeats,
                    })
                    .where(eq(Event.id, eventId));
                await db
                    .insert(booking)
                    .values({
                        userId,
                        eventId,
                        cost: numberOfSeats * currentEvent[0].price,
                        numberOfSeats,
                    })
                    .returning();
            } catch (error) {
                console.error('Error processing booking:', error);
                throw new apiError(500, 'Error processing booking');
            }

            // Cache booking details in Redis

            // Cache booking details in Redis (snake_case, string values)
            try {
                await client.hSet(`booking_${userId}_${eventId}`, {
                    user_id: userId.toString(),
                    event_id: eventId.toString(),
                    cost: (numberOfSeats * currentEvent[0].price).toString(),
                    number_of_seats: numberOfSeats.toString(),
                });

                // Update event cache in Redis

                // Update event cache in Redis (consistent with updateEvent)
                await client.hSet(`event_${eventId}`, {
                    event_id: currentEvent[0].id.toString(),
                    event_name: currentEvent[0].name,
                    description: currentEvent[0].description,
                    host_id: currentEvent[0].hostId.toString(),
                    venue: currentEvent[0].venue,
                    starts_at: currentEvent[0].startsAt.toISOString(),
                    ends_at: currentEvent[0].endsAt.toISOString(),
                    capacity: currentEvent[0].capacity.toString(),
                    reserved_seats: (
                        currentEvent[0].reservedSeats + numberOfSeats
                    ).toString(),
                    price: currentEvent[0].price.toString(),
                });
            } catch (error) {
                console.error('Error caching booking details:', error);
                reconcileRedisWithPostgres()
            }

            console.log(
                `Booking successful for user ${userId} on event ${eventId} for price ${numberOfSeats * currentEvent[0].price} for ${numberOfSeats} seats`
            );
        },
    });
}

startBookingConsumer().catch(console.error);
