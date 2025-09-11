import ApiError from '../utils/ApiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { event, event as Event } from '../models/events.model.js';

const getAllEvents = asyncHandler(async (req, res) => {
    const events = await db.select().from(Event);
    console.log(events);
    if (events.length === 0) {
        throw res.status(404).json(new ApiError(404, 'No events found'));
    }

    return res.status(200).json(new ApiResponse(200, 'Events found', events));
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

    const { name, description, startsAt, endsAt, venue, capacity } = req.body;

    if (!name || !description || !startsAt || !endsAt || !venue || !capacity) {
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
        })
        .returning({ event_id: Event.id, event_name: Event.name });

    if (newEvent.length == 0) {
        return res.status(401).json(new ApiError(401, 'Event Creation failed'));
    }

    return res
        .status(201)
        .json(new ApiResponse(201, 'Event created successfully', newEvent[0]));
});

const updateEvent = asyncHandler(async (req, res) => {
    const user = req.user;
    const { id, name, description, startAt, endAt, venue, capacity } = req.body;

    if (!id) {
        return res.status(400).json(new ApiError(400, 'Event ID is required.'));
    }

    const event = await db.select().from(Event).where(eq(Event.id, id));

    if (!event.length) {
        return res.status(404).json(new ApiError(404, 'Event not found.'));
    }

    if (event[0].hostId !== user.id) {
        return res
            .status(401)
            .json(new ApiError(401, 'Unauthorized to modify this event.'));
    }

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (startAt !== undefined) updateData.startsAt = new Date(startAt);
    if (endAt !== undefined) updateData.endsAt = new Date(endAt);
    if (venue !== undefined) updateData.venue = venue;
    if (capacity !== undefined) updateData.capacity = capacity;

    if (Object.keys(updateData).length === 0) {
        return res
            .status(400)
            .json(new ApiError(400, 'No fields provided to update.'));
    }

    await db.update(Event).set(updateData).where(eq(Event.id, id));

    return res
        .status(200)
        .json(new ApiResponse(200, 'Event updated successfully', updateData));
});

const deleteEvent = asyncHandler(async (req, res) => {
    const { id } = req.body;

    const event = await db.select().from(Event).where(eq(Event.id, id));

    const hostId = event[0].hostId;

    if (hostId != req.user.id) {
        throw res
            .status(400)
            .json(new ApiError(400, 'User not allowed to delete this event.'));
    }

    const deleted_event = await db.delete(Event).where(eq(Event.id, id)).returning({
        event_name: Event.name,
        event_id: Event.id,
        event_description: Event.description,
    });

    if (deleted_event[0].length === 0)
        throw res
            .status(401)
            .json(new ApiError(401, `Error, deleting event: ${id}`));

    return res
        .status(201)
        .json(
            new ApiResponse(201, 'Successfully deleted event.', deleted_event)
        );
});

export { getAllEvents, createEvent, updateEvent, deleteEvent };
