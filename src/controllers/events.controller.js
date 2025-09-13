import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { event as Event } from '../models/events.model.js';
import { client } from '../config/redis.js';
import { producer } from '../utils/kafka.js';

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
                    price: Number(event.price || 0)
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
        return res
            .status(401)
            .json(
                new ApiError(
                    401,
                    'Unauthorized, please login to create an event'
                )
            );
    }

    const { name, description, startsAt, endsAt, venue, capacity, price } = req.body;

    if (!name || !description || !startsAt || !endsAt || !venue || !capacity || !price) {
        return res
            .status(401)
            .json(new ApiError(400, 'All fields are required'));
    }

    const hostId = req.user.id;
    const reservedSeats = 0;

    // Convert types
    const startsAtDate = new Date(startsAt);
    const endsAtDate = new Date(endsAt);
    const numericCapacity = Number(capacity);

    if (isNaN(startsAtDate.getTime()) || isNaN(endsAtDate.getTime())) {
        return res.status(401).json(new ApiError(400, 'Invalid date format'));
    }
    if (endsAtDate <= startsAtDate) {
        return res
            .status(401)
            .json(new ApiError(400, 'Event end time must be after start time'));
    }
    if (numericCapacity <= 0) {
        return res
            .status(401)
            .json(new ApiError(400, 'Capacity must be a positive number'));
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
            price: Number(price)
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
            price: Event.price
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

    if (newEvent.length == 0) {
        throw new ApiError(401, 'Event Creation failed');
    }

    return res
        .status(201)
        .json(new ApiResponse(201, 'Event created successfully', newEvent[0]));
});

const updateEvent = asyncHandler(async (req, res) => {
    const user = req.user;
    const { id, name, description, startAt, endAt, venue, capacity, price, reservedSeats } = req.body;

    if (!id) {
        return new ApiError(400, 'Event ID is required.');
    }

    const event = await db.select().from(Event).where(eq(Event.id, id));

    if (!event.length) {
        return new ApiError(404, 'Event not found.');
    }

    if (event[0].hostId !== user.id) {
        return new ApiError(401, 'Unauthorized to modify this event.');
    }

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (startAt !== undefined) updateData.startsAt = new Date(startAt);
    if (endAt !== undefined) updateData.endsAt = new Date(endAt);
    if (venue !== undefined) updateData.venue = venue;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (price !== undefined) updateData.price = price;
    if (reservedSeats !== undefined) updateData.reservedSeats = reservedSeats;

    if (Object.keys(updateData).length === 0) {
        return new ApiError(400, 'No fields provided to update.');
    }

    await db.update(Event).set(updateData).where(eq(Event.id, id));

    await client.hSet(`event_${id}`, {
        ...(updateData.name && { event_name: updateData.name }),
        ...(updateData.description && {
            description: updateData.description,
        }),
        ...(updateData.startsAt && {
            starts_at: updateData.startsAt.toISOString(),
        }),
        ...(updateData.endsAt && {
            ends_at: updateData.endsAt.toISOString(),
        }),
        ...(updateData.venue && { venue: updateData.venue }),
        ...(updateData.capacity && {
            capacity: updateData.capacity.toString(),
        }),
        ...(updateData.price && { price: updateData.price.toString() }),
        ...(updateData.reservedSeats && { reserved_seats: updateData.reservedSeats.toString() }),
    });

    return res
        .status(200)
        .json(new ApiResponse(200, 'Event updated successfully', updateData));
});

const deleteEvent = asyncHandler(async (req, res) => {
    const { id } = req.body;

    const event = await db.select().from(Event).where(eq(Event.id, id));

    const hostId = event[0].hostId;

    if (hostId != req.user.id) {
        throw new ApiError(400, 'User not allowed to delete this event.');
    }

    const deleted_event = await db
        .delete(Event)
        .where(eq(Event.id, id))
        .returning({
            event_name: Event.name,
            event_id: Event.id,
            event_description: Event.description,
        });

    if (deleted_event[0].length === 0)
        throw new ApiError(401, `Error, deleting event: ${id}`);

    return res
        .status(201)
        .json(
            new ApiResponse(201, 'Successfully deleted event.', deleted_event)
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

    const availableSeats = Number(event.capacity) - Number(event.reserved_seats);
    if (availableSeats < numberOfSeats) {
        throw new ApiError(400, 'Not enough seats available.');
    }

    // Produce a booking request message to Kafka
    await producer.connect();
    await producer.send({
        topic: 'booking-requests',
        messages: [
            {
                value: JSON.stringify({
                    userId,
                    eventId,
                    numberOfSeats,
                    email: req.user.email
                }),
            },
        ],
    });
    await producer.disconnect();

    const result = {
        message: 'Booking request received and is being processed.',
    };

    return res
        .status(200)
        .json(new ApiResponse(200, result, 'Event Booking in process'));
});

export { getAllEvents, createEvent, updateEvent, deleteEvent, bookEvent };
