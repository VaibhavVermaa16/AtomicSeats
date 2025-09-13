import { producer, bookingConsumer } from '../utils/kafka.js';
import { db, pgPool } from '../config/database.js';
import { event as Event } from '../models/events.model.js';
import { booking } from '../models/booking.models.js';
import { eq } from 'drizzle-orm';
import { client } from '../config/redis.js';
import { reconcileRedisWithPostgres } from '../utils/redisReconciler.js';

const consumer = bookingConsumer;

async function sendBookingNotification(
    userId,
    eventId,
    numberOfSeats,
    totalCost,
    email,
    success
) {
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
            const { messageId, userId, eventId, numberOfSeats, email } =
                JSON.parse(message.value.toString());

            console.log(
                `Processing booking for user ${userId} on event ${eventId} for ${numberOfSeats} seats`
            );
            // Idempotency: skip if messageId already processed
            if (messageId) {
                const idemKey = `booking_idem:${messageId}`;
                const already = await client.set(idemKey, '1', {
                    NX: true,
                    EX: 60 * 60 * 6, // 6 hours
                });
                if (!already) {
                    console.log(`Duplicate message ${messageId}, skipping.`);
                    return;
                }
            }

            let totalCost = 0;
            try {
                // Start a transaction using a client connection from pgPool
                const clientConn = await pgPool.connect();
                try {
                    await clientConn.query('BEGIN');

                    // Atomic capacity check and increment
                    const updateRes = await clientConn.query(
                        `UPDATE events
                         SET "reservedSeats" = "reservedSeats" + $1
                         WHERE id = $2 AND ("reservedSeats" + $1) <= capacity
                         RETURNING "reservedSeats", price`,
                        [numberOfSeats, eventId]
                    );

                    if (updateRes.rowCount === 0) {
                        await clientConn.query('ROLLBACK');
                        console.error(
                            `Not enough capacity for event ${eventId}`
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
                        return;
                    }

                    const price = Number(updateRes.rows[0].price || 0);
                    totalCost = numberOfSeats * price;

                    await clientConn.query(
                        `INSERT INTO booking ("userId", "eventId", "numberOfSeats", cost)
                         VALUES ($1, $2, $3, $4)`,
                        [userId, eventId, numberOfSeats, totalCost]
                    );

                    await clientConn.query('COMMIT');
                } catch (txErr) {
                    try {
                        await clientConn.query('ROLLBACK');
                    } catch {}
                    throw txErr;
                } finally {
                    clientConn.release();
                }
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
                    cost: totalCost.toString(),
                    number_of_seats: numberOfSeats.toString(),
                });

                // Update event cache in Redis
                await client.hSet(`event_${eventId}`, {
                    // reservedSeats unknown post-commit; it's fine to reconcile lazily
                    // we can increment locally instead of reading
                    reserved_seats: (
                        Number(
                            (await client.hGet(
                                `event_${eventId}`,
                                'reserved_seats'
                            )) || '0'
                        ) + numberOfSeats
                    ).toString(),
                });
            } catch (error) {
                console.error('Error caching booking details:', error);
                reconcileRedisWithPostgres();
            }

            console.log(
                `Booking successful for user ${userId} on event ${eventId} for price ${totalCost} for ${numberOfSeats} seats`
            );

            await sendBookingNotification(
                userId,
                eventId,
                numberOfSeats,
                totalCost,
                email,
                true
            );
        },
    });
}

startBookingConsumer().catch(console.error);

// export { startBookingConsumer };
