import { producer, bookingConsumer } from '../utils/kafka.js';
import { db } from '../config/database.js';
import { event as Event } from '../models/events.model.js';
import { booking } from '../models/booking.models.js';
import { eq } from 'drizzle-orm';
import { client } from '../config/redis.js';
import { reconcileRedisWithPostgres } from '../utils/redisReconciler.js';

const consumer = bookingConsumer;

async function sendBookingNotification(userId, eventId, numberOfSeats, totalCost, email, success) {
    await producer.connect();
    await producer.send({
        topic: 'notify-user',
        messages: [
            {
                value: JSON.stringify({
                    userId,
                    eventId,
                    numberOfSeats,
                    totalCost,
                    email,
                    success,
                }),
            },
        ],
    });
    console.log(
        `📩 Notification sent to user ${userId} for event ${eventId} | Success: ${success}`
    );
}

async function startBookingConsumer() {
    await consumer.connect();
    await consumer.subscribe({
        topic: 'booking-requests',
        fromBeginning: false,
    });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const { userId, eventId, numberOfSeats, email } = JSON.parse(
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
            if (availableSeats < numberOfSeats) {
                console.error(
                    `Not enough seats available for event ${eventId}`
                );
                await sendBookingNotification(
                    userId,
                    eventId,
                    numberOfSeats,
                    0,
                    email,
                    false
                );
                reconcileRedisWithPostgres();
                return; // Skip this booking
            }

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
                await sendBookingNotification(
                    userId,
                    eventId,
                    numberOfSeats,
                    0,
                    email,
                    false
                );
                return; // Skip this booking
            }

            try {
                await client.hSet(`booking_${userId}_${eventId}`, {
                    user_id: userId.toString(),
                    event_id: eventId.toString(),
                    cost: (numberOfSeats * currentEvent[0].price).toString(),
                    number_of_seats: numberOfSeats.toString(),
                });

                // Update event cache in Redis
                await client.hSet(`event_${eventId}`, {
                    reserved_seats: (
                        currentEvent[0].reservedSeats + numberOfSeats
                    ).toString(),
                });
            } catch (error) {
                console.error('Error caching booking details:', error);
                reconcileRedisWithPostgres();
            }

            console.log(
                `Booking successful for user ${userId} on event ${eventId} for price ${numberOfSeats * currentEvent[0].price} for ${numberOfSeats} seats`
            );

            await sendBookingNotification(
                userId,
                eventId,
                numberOfSeats,
                numberOfSeats * currentEvent[0].price,
                email,
                true
            );
        },
    });
}

startBookingConsumer().catch(console.error);

// export { startBookingConsumer };
