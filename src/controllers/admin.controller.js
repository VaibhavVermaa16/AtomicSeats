import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db, pgPool } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { event as Event } from '../models/events.model.js';
import { client } from '../config/redis.js';

// Admin: List all events (from Redis if available, fallback to DB)
const adminListEvents = asyncHandler(async (req, res) => {
    try {
        const keys = await client.keys('event*');
        if (keys.length > 0) {
            const events = [];
            for (const key of keys) {
                const e = await client.hGetAll(key);
                events.push({
                    id: Number(e.event_id),
                    name: e.event_name,
                    description: e.description,
                    hostId: Number(e.host_id),
                    venue: e.venue,
                    startsAt: new Date(e.starts_at),
                    endsAt: new Date(e.ends_at),
                    capacity: Number(e.capacity),
                    reservedSeats: Number(e.reserved_seats),
                    price: Number(e.price || 0),
                });
            }
            return res
                .status(200)
                .json(
                    new ApiResponse(200, 'Events found (from Redis)', events)
                );
        }
    } catch (_) {
        // ignore and fallback to DB
    }

    const events = await db.select().from(Event);
    if (events.length === 0) {
        throw new ApiError(404, 'No events found');
    }
    return res
        .status(200)
        .json(new ApiResponse(200, 'Events found (from DB)', events));
});

// Admin: Create an event (can assign hostId or default to admin self)
const adminCreateEvent = asyncHandler(async (req, res) => {
    const {
        name,
        description,
        startsAt,
        endsAt,
        venue,
        capacity,
        price,
        hostId,
    } = req.body;

    if (
        !name ||
        !description ||
        !startsAt ||
        !endsAt ||
        !venue ||
        capacity == null ||
        price == null
    ) {
        return res
            .status(400)
            .json(new ApiError(400, 'All fields are required'));
    }

    const ownerId = hostId ?? req.user.id;

    const startsAtDate = new Date(startsAt);
    const endsAtDate = new Date(endsAt);
    const numericCapacity = Number(capacity);
    const numericPrice = Number(price);

    if (isNaN(startsAtDate.getTime()) || isNaN(endsAtDate.getTime())) {
        return res.status(400).json(new ApiError(400, 'Invalid date format'));
    }
    if (endsAtDate <= startsAtDate) {
        return res
            .status(400)
            .json(new ApiError(400, 'Event end time must be after start time'));
    }
    if (numericCapacity <= 0) {
        return res
            .status(400)
            .json(new ApiError(400, 'Capacity must be a positive number'));
    }

    const created = await db
        .insert(Event)
        .values({
            name,
            description,
            hostId: ownerId,
            venue,
            startsAt: startsAtDate,
            endsAt: endsAtDate,
            capacity: numericCapacity,
            reservedSeats: 0,
            price: numericPrice,
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

    const e = created[0];

    await client.hSet(`event_${e.event_id}`, {
        event_id: String(e.event_id),
        event_name: e.event_name,
        description: e.description,
        host_id: String(e.host_id),
        venue: e.venue,
        starts_at: e.starts_at.toISOString(),
        ends_at: e.ends_at.toISOString(),
        capacity: String(e.capacity),
        reserved_seats: String(e.reserved_seats),
        price: String(e.price || 0),
    });

    return res
        .status(201)
        .json(new ApiResponse(201, 'Event created successfully', created[0]));
});

// Admin: Update any event by id
const adminUpdateEvent = asyncHandler(async (req, res) => {
    const {
        id,
        name,
        description,
        startAt,
        endAt,
        venue,
        capacity,
        price,
        reservedSeats,
        hostId,
    } = req.body;

    if (!id) {
        return res.status(400).json(new ApiError(400, 'Event ID is required.'));
    }

    const found = await db.select().from(Event).where(eq(Event.id, id));
    if (!found.length) {
        return res.status(404).json(new ApiError(404, 'Event not found.'));
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (startAt !== undefined) updateData.startsAt = new Date(startAt);
    if (endAt !== undefined) updateData.endsAt = new Date(endAt);
    if (venue !== undefined) updateData.venue = venue;
    if (capacity !== undefined) updateData.capacity = Number(capacity);
    if (price !== undefined) updateData.price = Number(price);
    if (reservedSeats !== undefined)
        updateData.reservedSeats = Number(reservedSeats);
    if (hostId !== undefined) updateData.hostId = Number(hostId);

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json(new ApiError(400, 'No fields to update.'));
    }

    await db.update(Event).set(updateData).where(eq(Event.id, id));

    await client.hSet(`event_${id}`, {
        ...(updateData.name && { event_name: updateData.name }),
        ...(updateData.description && { description: updateData.description }),
        ...(updateData.startsAt && {
            starts_at: updateData.startsAt.toISOString(),
        }),
        ...(updateData.endsAt && { ends_at: updateData.endsAt.toISOString() }),
        ...(updateData.venue && { venue: updateData.venue }),
        ...(updateData.capacity !== undefined && {
            capacity: String(updateData.capacity),
        }),
        ...(updateData.price !== undefined && {
            price: String(updateData.price),
        }),
        ...(updateData.reservedSeats !== undefined && {
            reserved_seats: String(updateData.reservedSeats),
        }),
        ...(updateData.hostId !== undefined && {
            host_id: String(updateData.hostId),
        }),
    });

    return res
        .status(200)
        .json(new ApiResponse(200, 'Event updated successfully', updateData));
});

// Admin: Delete any event by id
const adminDeleteEvent = asyncHandler(async (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json(new ApiError(400, 'Event ID is required.'));
    }

    const deleted = await db
        .delete(Event)
        .where(eq(Event.id, id))
        .returning({
            id: Event.id,
            name: Event.name,
            description: Event.description,
        });

    if (deleted.length === 0) {
        return res.status(404).json(new ApiError(404, 'Event not found.'));
    }

    try {
        await client.del(`event_${id}`);
    } catch (_) {}

    return res
        .status(200)
        .json(new ApiResponse(200, 'Successfully deleted event.', deleted[0]));
});

// Admin: Booking analytics
const adminAnalytics = asyncHandler(async (req, res) => {
    // Total bookings
    const totalBookingsRes = await pgPool.query(
        'SELECT COUNT(*)::int AS count FROM booking'
    );
    const totalBookings = totalBookingsRes.rows[0]?.count || 0;

    // Most popular events by number of bookings (top 5)
    const popularRes = await pgPool.query(
        `SELECT e.id, e.name, COALESCE(COUNT(b.id), 0)::int AS bookings
         FROM events e
         LEFT JOIN booking b ON b."eventId" = e.id
         GROUP BY e.id
         ORDER BY bookings DESC
         LIMIT 5`
    );

    // Capacity utilization overall and per event
    const sumsRes = await pgPool.query(
        'SELECT COALESCE(SUM("reservedSeats"),0)::int AS reserved, COALESCE(SUM(capacity),0)::int AS capacity FROM events'
    );
    const reservedSum = sumsRes.rows[0]?.reserved || 0;
    const capacitySum = sumsRes.rows[0]?.capacity || 0;
    const overallUtilization = capacitySum
        ? Math.round((reservedSum / capacitySum) * 10000) / 100
        : 0;

    const perEventRes = await pgPool.query(
        `SELECT id, name, "reservedSeats"::int AS "reservedSeats", capacity::int AS capacity,
                CASE WHEN capacity > 0 THEN ROUND(("reservedSeats"::numeric / capacity::numeric) * 100, 2) ELSE 0 END AS utilizationPercent
         FROM events
         ORDER BY utilizationPercent DESC NULLS LAST`
    );

    const data = {
        totalBookings,
        mostPopularEvents: popularRes.rows,
        overallCapacity: {
            totalReserved: reservedSum,
            totalCapacity: capacitySum,
            utilizationPercent: overallUtilization,
        },
        perEventUtilization: perEventRes.rows,
    };

    return res
        .status(200)
        .json(
            new ApiResponse(200, 'Admin analytics fetched successfully', data)
        );
});

export {
    adminListEvents,
    adminCreateEvent,
    adminUpdateEvent,
    adminDeleteEvent,
    adminAnalytics,
};
