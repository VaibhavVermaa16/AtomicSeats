import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db, pgPool } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { event as Event } from '../models/events.model.js';
import { client } from '../config/redis.js';

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
    adminCreateEvent,
    adminDeleteEvent,
    adminAnalytics,
};
