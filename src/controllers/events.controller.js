import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db, pgPool } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { event as Event } from '../models/events.model.js';
import { client } from '../config/redis.js';
import { producer } from '../utils/kafka.js';
import {
    isWaitlistClosed,
    allocateFromWaitlist,
    setWaitlistClosed,
} from '../utils/waitlist.js';
import {
    NotificationChannel,
    NotificationType,
    buildEmailForWaitlistConfirmed,
} from '../services/notification.service.js';
import { randomUUID } from 'crypto';

// Cancel a user's booking for an event and free seats, then trigger waitlist allocation
const cancelBooking = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new ApiError(
            401,
            'Unauthorized, please login to cancel a booking'
        );
    }

    // Accept from body or query for flexibility with DELETE
    const eventId = Number(req.body?.eventId ?? req.query?.eventId);
    const bookingId = req.body?.bookingId ?? req.query?.bookingId;
    const cancelAll =
        (req.body?.cancelAll ?? req.query?.cancelAll) === 'true' ||
        req.body?.cancelAll === true;

    if (!eventId) {
        throw new ApiError(400, 'Event ID is required.');
    }

    const userId = req.user.id;

    const clientConn = await pgPool.connect();
    let seatsFreed = 0;
    try {
        await clientConn.query('BEGIN');

        // Lock the event row to ensure consistent reservedSeats update
        const eRes = await clientConn.query(
            `SELECT id, capacity, "reservedSeats" FROM events WHERE id = $1 FOR UPDATE`,
            [eventId]
        );
        if (eRes.rowCount === 0) {
            await clientConn.query('ROLLBACK');
            throw new ApiError(404, 'Event not found.');
        }

        // Determine which bookings to cancel
        let bookingsRes;
        if (bookingId) {
            bookingsRes = await clientConn.query(
                `SELECT id, "numberOfSeats" FROM booking WHERE id = $1 AND "userId" = $2 AND "eventId" = $3 FOR UPDATE`,
                [bookingId, userId, eventId]
            );
        } else {
            bookingsRes = await clientConn.query(
                `SELECT id, "numberOfSeats" FROM booking WHERE "userId" = $1 AND "eventId" = $2 FOR UPDATE`,
                [userId, eventId]
            );
        }

        if (bookingsRes.rowCount === 0) {
            await clientConn.query('ROLLBACK');
            throw new ApiError(
                404,
                'No booking found to cancel for this event.'
            );
        }

        // If a specific bookingId is not provided and cancelAll is false, cancel only the most recent row
        let rowsToCancel = bookingsRes.rows;
        if (!bookingId && !cancelAll) {
            // Pick the last inserted booking by highest id
            const maxIdRow = rowsToCancel.reduce((a, b) =>
                a.id > b.id ? a : b
            );
            rowsToCancel = [maxIdRow];
        }

        const idList = rowsToCancel.map((r) => r.id);
        seatsFreed = rowsToCancel.reduce(
            (acc, r) => acc + Number(r.numberOfSeats || 0),
            0
        );
        if (seatsFreed <= 0) {
            await clientConn.query('ROLLBACK');
            throw new ApiError(
                400,
                'Invalid booking state; seats to free is zero.'
            );
        }

        // Soft-delete the booking rows (preserve history)
        await clientConn.query(
            `UPDATE booking SET status = 'cancelled', "cancelledAt" = NOW() WHERE id = ANY($1::int[])`,
            [idList]
        );

        // Decrease reserved seats, clamp to 0
        const updRes = await clientConn.query(
            `UPDATE events SET "reservedSeats" = GREATEST("reservedSeats" - $1, 0)
             WHERE id = $2 RETURNING "reservedSeats"`,
            [seatsFreed, eventId]
        );
        const newReserved = Number(updRes.rows?.[0]?.reservedSeats || 0);

        await clientConn.query('COMMIT');

        // Update Redis cache for event reserved seats
        try {
            await client.hSet(`event_${eventId}`, {
                reserved_seats: String(newReserved),
            });
        } catch (e) {
            console.error(
                'Failed updating Redis reserved seats after cancel:',
                e
            );
        }

        // Trigger async waitlist allocation via Kafka
        try {
            await producer.connect();
            await producer.send({
                topic: 'waitlist-allocation',
                messages: [
                    {
                        key: String(eventId),
                        value: JSON.stringify({ eventId }),
                    },
                ],
            });
            await producer.disconnect();
        } catch (e) {
            console.error('Failed to publish waitlist allocation trigger:', e);
        }

        return res.status(200).json(
            new ApiResponse(200, 'Booking cancelled successfully', {
                eventId,
                seatsFreed,
                bookingsCancelled: idList.length,
            })
        );
    } catch (err) {
        try {
            await clientConn.query('ROLLBACK');
        } catch {}
        throw err;
    } finally {
        clientConn.release();
    }
});

const getAllEvents = asyncHandler(async (req, res) => {
    // Try to get all events from Redis
    try {
        const keys = await client.keys('event*');
        if (keys.length > 0) {
            const events = [];
            for (const key of keys) {
                const event = await client.hGetAll(key);
                events.push({
                    id: Number(event.event_id),
                    name: event.event_name,
                    description: event.description,
                    hostId: Number(event.host_id),
                    venue: event.venue,
                    startsAt: new Date(event.starts_at),
                    endsAt: new Date(event.ends_at),
                    capacity: Number(event.capacity),
                    reservedSeats: Number(event.reserved_seats),
                    price: Number(event.price || 0),
                });
            }
            return res
                .status(200)
                .json(
                    new ApiResponse(200, 'Events found (from Redis)', events)
                );
        }
        // If no keys found, fall through to DB fetch
    } catch (error) {
        // If any error, fall through to DB fetch
    }

    // Fallback: Get all events from Postgres
    const events = await db.select().from(Event);
    if (events.length === 0) {
        throw new ApiError(404, 'No events found');
    }
    return res
        .status(200)
        .json(new ApiResponse(200, 'Events found (from DB)', events));
});

const createEvent = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new ApiError(
            401,
            'Unauthorized, please login to create an event'
        );
    }

    const { name, description, startsAt, endsAt, venue, capacity, price } =
        req.body;

    if (
        !name ||
        !description ||
        !startsAt ||
        !endsAt ||
        !venue ||
        capacity == null ||
        price == null
    ) {
        throw new ApiError(400, 'All fields are required');
    }

    const hostId = req.user.id;
    const reservedSeats = 0;

    // Convert types
    const startsAtDate = new Date(startsAt);
    const endsAtDate = new Date(endsAt);
    const numericCapacity = Number(capacity);

    if (isNaN(startsAtDate.getTime()) || isNaN(endsAtDate.getTime())) {
        throw new ApiError(400, 'Invalid date format');
    }
    if (endsAtDate <= startsAtDate) {
        throw new ApiError(400, 'Event end time must be after start time');
    }
    if (numericCapacity <= 0) {
        throw new ApiError(400, 'Capacity must be a positive number');
    }

    const newEvent = await db
        .insert(Event)
        .values({
            name,
            description,
            hostId,
            venue,
            startsAt: startsAtDate,
            endsAt: endsAtDate,
            capacity: numericCapacity,
            reservedSeats,
            price: Number(price),
        })
        .returning({
            event_id: Event.id,
            event_name: Event.name,
            description: Event.description,
            host_id: Event.hostId,
            venue: Event.venue,
            starts_at: Event.startsAt,
            ends_at: Event.endsAt,
            capacity: Event.capacity,
            reserved_seats: Event.reservedSeats,
            price: Event.price,
        });

    const event = newEvent[0];

    // Save as Redis hash
    await client.hSet(`event_${event.event_id}`, {
        event_id: event.event_id.toString(),
        event_name: event.event_name,
        description: event.description,
        host_id: event.host_id.toString(),
        venue: event.venue,
        starts_at: event.starts_at.toISOString(),
        ends_at: event.ends_at.toISOString(),
        capacity: event.capacity.toString(),
        reserved_seats: event.reserved_seats.toString(),
        price: event.price.toString(),
    });

    if (newEvent.length === 0) {
        throw new ApiError(500, 'Event creation failed');
    }

    return res
        .status(201)
        .json(new ApiResponse(201, 'Event created successfully', newEvent[0]));
});

const updateEvent = asyncHandler(async (req, res) => {
    const user = req.user;
    const {
        id,
        name,
        description,
        startsAt,
        endsAt,
        venue,
        capacity,
        price,
        waitlistClosed,
        reservedSeats,
    } = req.body;

    if (!id) {
        throw new ApiError(400, 'Event ID is required.');
    }

    const event = await db.select().from(Event).where(eq(Event.id, id));

    if (!event.length) {
        throw new ApiError(404, 'Event not found.');
    }

    if (event[0].hostId !== user.id) {
        throw new ApiError(
            403,
            'Forbidden: Unauthorized to modify this event.'
        );
    }

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (startsAt !== undefined) updateData.startsAt = new Date(startsAt);
    if (endsAt !== undefined) updateData.endsAt = new Date(endsAt);
    if (venue !== undefined) updateData.venue = venue;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (price !== undefined) updateData.price = price;
    // Allow host to mark waitlist closed via Redis flag (not stored in DB)
    if (waitlistClosed !== undefined) {
        await setWaitlistClosed(id, Boolean(waitlistClosed));
    }
    if (reservedSeats !== undefined) updateData.reservedSeats = reservedSeats;

    if (Object.keys(updateData).length === 0) {
        throw new ApiError(400, 'No fields provided to update.');
    }

    await db.update(Event).set(updateData).where(eq(Event.id, id));

    await client.hSet(`event_${id}`, {
        ...(updateData.name !== undefined && { event_name: updateData.name }),
        ...(updateData.description !== undefined && {
            description: updateData.description,
        }),
        ...(updateData.startsAt !== undefined && {
            starts_at: updateData.startsAt.toISOString(),
        }),
        ...(updateData.endsAt !== undefined && {
            ends_at: updateData.endsAt.toISOString(),
        }),
        ...(updateData.venue !== undefined && { venue: updateData.venue }),
        ...(updateData.capacity !== undefined && {
            capacity: updateData.capacity.toString(),
        }),
        ...(updateData.price !== undefined && {
            price: updateData.price.toString(),
        }),
        ...(updateData.reservedSeats !== undefined && {
            reserved_seats: updateData.reservedSeats.toString(),
        }),
    });

    // If capacity increased or reservedSeats changed, trigger async waitlist allocation via Kafka
    if (
        updateData.capacity !== undefined ||
        updateData.reservedSeats !== undefined
    ) {
        try {
            console.log('Publishing waitlist allocation trigger for event', id);
            await producer.connect();
            await producer.send({
                topic: 'waitlist-allocation',
                messages: [
                    {
                        key: String(id),
                        value: JSON.stringify({ eventId: id }),
                    },
                ],
            });
            await producer.disconnect();
        } catch (e) {
            console.error('Failed to publish waitlist allocation trigger:', e);
        }
    }

    return res.status(200).json(
        new ApiResponse(200, 'Event updated successfully', {
            ...updateData,
            ...(waitlistClosed !== undefined
                ? { waitlistClosed: Boolean(waitlistClosed) }
                : {}),
        })
    );
});

const deleteEvent = asyncHandler(async (req, res) => {
    const { id } = req.body;
    const event = await db.select().from(Event).where(eq(Event.id, id));
    if (!event.length) {
        throw new ApiError(404, 'Event not found.');
    }
    const hostId = event[0].hostId;
    if (hostId !== req.user.id) {
        throw new ApiError(403, 'Forbidden: not allowed to delete this event.');
    }

    const deleted_event = await db
        .delete(Event)
        .where(eq(Event.id, id))
        .returning({
            event_name: Event.name,
            event_id: Event.id,
            event_description: Event.description,
        });

    if (deleted_event.length === 0)
        throw new ApiError(500, `Error deleting event: ${id}`);

    return res
        .status(200)
        .json(
            new ApiResponse(200, 'Successfully deleted event.', deleted_event)
        );
});

const bookEvent = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new ApiError(401, 'Unauthorized, please login to book an event');
    }
    const { eventId, numberOfSeats } = req.body;
    const userId = req.user.id;

    if (!eventId || numberOfSeats == null) {
        throw new ApiError(400, 'Event ID and number of seats are required.');
    }

    if (numberOfSeats <= 0 || numberOfSeats > 10) {
        throw new ApiError(400, 'Number of seats must be between 1 and 10.');
    }

    const event = await client.hGetAll(`event_${eventId}`);
    if (!event || Object.keys(event).length === 0) {
        throw new ApiError(404, 'Event not found.');
    }

    // We no longer block at the API when seats appear insufficient; the worker will
    // either confirm or place the user on the waitlist (or inform if waitlist closed).
    const waitlistClosed = await isWaitlistClosed(eventId);

    // Produce a booking request message to Kafka
    await producer.connect();
    const messageId = randomUUID();
    await producer.send({
        topic: 'booking-requests',
        messages: [
            {
                key: String(eventId), // partition by event for ordered handling per event
                value: JSON.stringify({
                    messageId,
                    userId,
                    eventId,
                    numberOfSeats,
                    email: req.user.email,
                    waitlistClosed,
                }),
            },
        ],
    });
    await producer.disconnect();

    const result = {
        message: 'Booking request received and is being processed.',
        messageId,
    };

    return res
        .status(200)
        .json(new ApiResponse(200, result, 'Event Booking in process'));
});

export {
    getAllEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    bookEvent,
    cancelBooking,
};
