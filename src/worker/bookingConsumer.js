import { producer, bookingConsumer } from '../utils/kafka.js';
import { pgPool } from '../config/database.js';
import { client } from '../config/redis.js';
import { reconcileRedisWithPostgres } from '../utils/redisReconciler.js';
import {
    enqueueWaitlist,
    isWaitlistClosed,
    allocateFromWaitlist,
} from '../utils/waitlist.js';
import {
    NotificationChannel,
    NotificationType,
    buildEmailForWaitlisted,
    buildEmailForWaitlistConfirmed,
} from '../services/notification.service.js';

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
    await producer.disconnect();
    console.log(
        `📩 Notification sent to user ${userId} for event ${eventId} | Success: ${success}`
    );
}

async function handleAllocationTrigger(eventId) {
    console.log(`⚙️  Allocation trigger received for event ${eventId}`);
    const { allocations } = await allocateFromWaitlist({ eventId });
    console.log(`Waitlist allocation completed for event ${eventId}`, {
        allocations,
    });
    if (!allocations || allocations.length === 0) {
        console.log(
            `ℹ️  No waitlist allocations possible for event ${eventId}`
        );
        return;
    }

    // Update Redis reserved seats counter
    const addSeats = allocations.reduce(
        (acc, a) => acc + Number(a.numberOfSeats),
        0
    );
    const current = Number(
        (await client.hGet(`event_${eventId}`, 'reserved_seats')) || '0'
    );
    await client.hSet(`event_${eventId}`, {
        reserved_seats: String(current + addSeats),
    });

    // Notify each allocated user via notifications topic using builders
    await producer.connect();
    const messages = allocations
        .filter((a) => !!a.email)
        .map((a) => ({
            value: JSON.stringify({
                channel: NotificationChannel.EMAIL,
                type: NotificationType.WAITLIST_CONFIRMED,
                payload: buildEmailForWaitlistConfirmed({
                    userEmail: a.email,
                    userId: a.userId,
                    eventId,
                    numberOfSeats: a.numberOfSeats,
                    totalCost: a.totalCost,
                }),
            }),
        }));
    if (messages.length > 0) {
        await producer.send({ topic: 'notifications', messages });
    }
    await producer.disconnect();
    const skipped = allocations.filter((a) => !a.email).length;
    if (skipped > 0) {
        console.warn(
            `Skipped ${skipped} waitlist confirmation notifications due to missing email for event ${eventId}`
        );
    }
    console.log(
        `✅ Allocated ${allocations.length} waitlisted booking(s) for event ${eventId}`
    );
}

async function startBookingConsumer() {
    await consumer.connect();
    await consumer.subscribe({
        topic: 'booking-requests',
        fromBeginning: false,
    });
    try {
        await consumer.subscribe({
            topic: 'waitlist-allocation',
            fromBeginning: false,
        });
    } catch {}

    await consumer.run({
        eachMessage: async ({ topic, message }) => {
            const parsed = JSON.parse(message.value.toString());

            if (topic === 'waitlist-allocation') {
                const { eventId } = parsed || {};
                if (eventId) {
                    try {
                        await handleAllocationTrigger(eventId);
                    } catch (e) {
                        console.error('Waitlist allocation error:', e);
                    }
                }
                return;
            }

            // booking-requests flow
            const {
                messageId,
                userId,
                eventId,
                numberOfSeats,
                email,
                waitlistClosed,
            } = parsed;
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
            let bookedSeats = 0;
            try {
                const clientConn = await pgPool.connect();
                try {
                    await clientConn.query('BEGIN');

                    // Lock event row, compute availability for potential partial booking
                    const eRes = await clientConn.query(
                        `SELECT id, capacity, "reservedSeats", price FROM events WHERE id = $1 FOR UPDATE`,
                        [eventId]
                    );
                    if (eRes.rowCount === 0) {
                        await clientConn.query('ROLLBACK');
                        throw new Error(`Event ${eventId} not found`);
                    }
                    const capacity = Number(eRes.rows[0].capacity || 0);
                    const currentReserved = Number(
                        eRes.rows[0].reservedSeats || 0
                    );
                    const price = Number(eRes.rows[0].price || 0);
                    const available = Math.max(0, capacity - currentReserved);

                    if (available <= 0) {
                        // No seats available at all; full waitlist flow after rollback
                        await clientConn.query('ROLLBACK');
                        const closed =
                            waitlistClosed ?? (await isWaitlistClosed(eventId));
                        if (closed) {
                            await producer.connect();
                            await producer.send({
                                topic: 'notifications',
                                messages: [
                                    {
                                        value: JSON.stringify({
                                            channel: NotificationChannel.EMAIL,
                                            type: NotificationType.WAITLIST_CLOSED,
                                            payload: buildEmailForWaitlisted({
                                                userEmail: email,
                                                userId,
                                                eventId,
                                            }),
                                        }),
                                    },
                                ],
                            });
                            await producer.disconnect();
                            console.error(
                                `Waitlist closed for event ${eventId}. Notifying user.`
                            );
                            return;
                        }

                        // Enqueue full request to waitlist
                        await enqueueWaitlist({
                            userId,
                            email,
                            eventId,
                            numberOfSeats,
                        });

                        await producer.connect();
                        await producer.send({
                            topic: 'notifications',
                            messages: [
                                {
                                    value: JSON.stringify({
                                        channel: NotificationChannel.EMAIL,
                                        type: NotificationType.WAITLISTED,
                                        payload: buildEmailForWaitlisted({
                                            userEmail: email,
                                            userId,
                                            eventId,
                                            numberOfSeats,
                                        }),
                                    }),
                                },
                            ],
                        });
                        await producer.disconnect();

                        reconcileRedisWithPostgres();
                        return;
                    }

                    // Determine seats to book now (may be partial)
                    bookedSeats = Math.min(available, Number(numberOfSeats));
                    const remainingSeats = Number(numberOfSeats) - bookedSeats;

                    // Update event reserved seats
                    await clientConn.query(
                        `UPDATE events SET "reservedSeats" = "reservedSeats" + $1 WHERE id = $2`,
                        [bookedSeats, eventId]
                    );

                    totalCost = bookedSeats * price;
                    await clientConn.query(
                        `INSERT INTO booking ("userId", "eventId", "numberOfSeats", cost)
             VALUES ($1, $2, $3, $4)`,
                        [userId, eventId, bookedSeats, totalCost]
                    );

                    await clientConn.query('COMMIT');

                    // If partial, enqueue remaining to waitlist and notify
                    if (remainingSeats > 0) {
                        const closed =
                            waitlistClosed ?? (await isWaitlistClosed(eventId));
                        if (closed) {
                            await producer.connect();
                            await producer.send({
                                topic: 'notifications',
                                messages: [
                                    {
                                        value: JSON.stringify({
                                            channel: NotificationChannel.EMAIL,
                                            type: NotificationType.WAITLIST_CLOSED,
                                            payload: buildEmailForWaitlisted({
                                                userEmail: email,
                                                userId,
                                                eventId,
                                            }),
                                        }),
                                    },
                                ],
                            });
                            await producer.disconnect();
                        } else {
                            await enqueueWaitlist({
                                userId,
                                email,
                                eventId,
                                numberOfSeats: remainingSeats,
                            });

                            await producer.connect();
                            await producer.send({
                                topic: 'notifications',
                                messages: [
                                    {
                                        value: JSON.stringify({
                                            channel: NotificationChannel.EMAIL,
                                            type: NotificationType.WAITLISTED,
                                            payload: buildEmailForWaitlisted({
                                                userEmail: email,
                                                userId,
                                                eventId,
                                                numberOfSeats: remainingSeats,
                                            }),
                                        }),
                                    },
                                ],
                            });
                            await producer.disconnect();
                            reconcileRedisWithPostgres();
                        }
                    }
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
                    bookedSeats || numberOfSeats,
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
                    number_of_seats: bookedSeats.toString(),
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
                        ) + bookedSeats
                    ).toString(),
                });
            } catch (error) {
                console.error('Error caching booking details:', error);
                reconcileRedisWithPostgres();
            }

            console.log(
                `Booking successful for user ${userId} on event ${eventId} for price ${totalCost} for ${bookedSeats} seats`
            );

            await sendBookingNotification(
                userId,
                eventId,
                bookedSeats,
                totalCost,
                email,
                true
            );
        },
    });
}

startBookingConsumer().catch(console.error);

// export { startBookingConsumer };
