import { client } from '../config/redis.js';
import { db, pgPool } from '../config/database.js';
import { waitlist as Waitlist } from '../models/waitlist.model.js';
import { eq, and, asc } from 'drizzle-orm';

// Redis keys helpers
const wlKey = (eventId) => `waitlist:${eventId}`; // list storing JSON strings
const wlClosedKey = (eventId) => `waitlist:${eventId}:closed`; // string '1' if closed

export async function isWaitlistClosed(eventId) {
    const v = await client.get(wlClosedKey(eventId));
    return v === '1';
}

export async function setWaitlistClosed(eventId, closed = true) {
    if (closed) await client.set(wlClosedKey(eventId), '1');
    else await client.del(wlClosedKey(eventId));
}

// Enqueue: value shape { userId, email, eventId, numberOfSeats, requestedAt }
export async function enqueueWaitlist(entry) {
    if (!entry?.eventId) throw new Error('waitlist entry missing eventId');
    await client.rPush(
        wlKey(entry.eventId),
        JSON.stringify({
            ...entry,
            requestedAt: entry.requestedAt || Date.now(),
        })
    );
    // Persist in DB
    try {
        await db.insert(Waitlist).values({
            userId: entry.userId,
            eventId: entry.eventId,
            numberOfSeats: entry.numberOfSeats,
        });
    } catch (e) {
        // Keep Redis entry even if DB write fails; log for reconciliation.
        console.error('Failed to persist waitlist entry to DB:', e);
    }
    console.log(
        `Enqueued user ${entry.userId} to waitlist for event ${entry.eventId}`
    );
}

export async function peekWaitlist(eventId) {
    const v = await client.lIndex(wlKey(eventId), 0);
    return v ? JSON.parse(v) : null;
}

export async function dequeueWaitlist(eventId) {
    const v = await client.lPop(wlKey(eventId));
    if (!v) return null;
    const parsed = JSON.parse(v);
    // Remove corresponding row from DB (oldest matching record)
    try {
        const rows = await db
            .select({ id: Waitlist.id })
            .from(Waitlist)
            .where(
                and(
                    eq(Waitlist.userId, parsed.userId),
                    eq(Waitlist.eventId, parsed.eventId),
                    eq(Waitlist.numberOfSeats, parsed.numberOfSeats)
                )
            )
            .orderBy(asc(Waitlist.createdAt))
            .limit(1);
        if (rows.length) {
            await db.delete(Waitlist).where(eq(Waitlist.id, rows[0].id));
        }
    } catch (e) {
        console.error('Failed to delete waitlist entry from DB:', e);
    }
    console.log(`Dequeued user from waitlist for event ${eventId}`);
    return parsed;
}

export async function waitlistLength(eventId) {
    return client.lLen(wlKey(eventId));
}

// Attempt to allocate seats to waitlisted users in FIFO until capacity filled or list exhausted.
// Uses serializable transaction to ensure correctness.
export async function allocateFromWaitlist({ eventId }) {
    const allocations = []; // { userId, email, numberOfSeats, totalCost }

    const clientConn = await pgPool.connect();
    try {
        await clientConn.query('BEGIN');
        // Lock the event row to read current capacity and reservedSeats
        const eRes = await clientConn.query(
            `SELECT id, capacity, "reservedSeats", price FROM events WHERE id = $1 FOR UPDATE`,
            [eventId]
        );
        if (eRes.rowCount === 0) {
            await clientConn.query('ROLLBACK');
            return { allocations, reason: 'event_not_found' };
        }
        let { capacity, reservedSeats, price } = eRes.rows[0];
        capacity = Number(capacity) || 0;
        reservedSeats = Number(reservedSeats) || 0;
        const unitPrice = Number(price) || 0;

        // Try to fill in FIFO
        while (true) {
            const head = await client.lIndex(wlKey(eventId), 0);
            if (!head) break; // empty
            const entry = JSON.parse(head);
            const available = capacity - reservedSeats;
            if (available <= 0) break;

            // Determine how many seats to allocate for this head
            const isFullAllocation = entry.numberOfSeats <= available;
            const seatsToAllocate = isFullAllocation
                ? entry.numberOfSeats
                : available; // partial: allocate what's available

            if (isFullAllocation) {
                // Pop head and allocate fully
                await client.lPop(wlKey(eventId));
                // Delete corresponding row from DB waitlist
                try {
                    const rows = await db
                        .select({ id: Waitlist.id })
                        .from(Waitlist)
                        .where(
                            and(
                                eq(Waitlist.userId, entry.userId),
                                eq(Waitlist.eventId, eventId),
                                eq(Waitlist.numberOfSeats, entry.numberOfSeats)
                            )
                        )
                        .orderBy(asc(Waitlist.createdAt))
                        .limit(1);
                    if (rows.length) {
                        await clientConn.query('SAVEPOINT wl_del');
                        // use SQL via clientConn to stay in same tx
                        await clientConn.query(
                            'DELETE FROM waitlist WHERE id = $1',
                            [rows[0].id]
                        );
                    }
                } catch (e) {
                    console.error(
                        'Failed to remove waitlist row during allocation:',
                        e
                    );
                }
            } else {
                // Partial allocation: update Redis head and reduce DB waitlist row
                const remaining = entry.numberOfSeats - seatsToAllocate;
                const updatedEntry = { ...entry, numberOfSeats: remaining };
                try {
                    // Update head in Redis to reflect remaining seats
                    if (typeof client.lSet === 'function') {
                        await client.lSet(
                            wlKey(eventId),
                            0,
                            JSON.stringify(updatedEntry)
                        );
                    } else {
                        // Fallback: pop, then push updated entry back to the front
                        await client.lPop(wlKey(eventId));
                        await client.lPush(
                            wlKey(eventId),
                            JSON.stringify(updatedEntry)
                        );
                    }

                    // Update the oldest matching waitlist row within the same SQL tx
                    const rowRes = await clientConn.query(
                        'SELECT id FROM waitlist WHERE "userId" = $1 AND "eventId" = $2 AND "numberOfSeats" = $3 ORDER BY "createdAt" ASC LIMIT 1',
                        [entry.userId, eventId, entry.numberOfSeats]
                    );
                    if (rowRes.rowCount > 0) {
                        await clientConn.query(
                            'UPDATE waitlist SET "numberOfSeats" = $1 WHERE id = $2',
                            [remaining, rowRes.rows[0].id]
                        );
                    }
                } catch (e) {
                    console.error(
                        'Failed to perform partial waitlist update (Redis/DB):',
                        e
                    );
                }
            }

            reservedSeats += seatsToAllocate;
            const totalCost = unitPrice * seatsToAllocate;

            // Ensure we have recipient email; lookup if missing
            let email = entry.email;
            if (!email) {
                try {
                    const emailRes = await clientConn.query(
                        'SELECT email FROM users WHERE id = $1',
                        [entry.userId]
                    );
                    email = emailRes.rows?.[0]?.email || null;
                } catch (e) {
                    console.error(
                        'Failed to fetch user email for waitlist allocation:',
                        e
                    );
                }
            }

            // Create booking record for allocated seats
            await clientConn.query(
                `INSERT INTO booking ("userId", "eventId", "numberOfSeats", cost) VALUES ($1, $2, $3, $4)`,
                [entry.userId, eventId, seatsToAllocate, totalCost]
            );

            allocations.push({
                userId: entry.userId,
                email,
                numberOfSeats: seatsToAllocate,
                totalCost,
            });

            // If we just did a partial allocation, we've exhausted availability; exit loop
            if (!isFullAllocation) break;
        }

        // Persist new reservedSeats
        if (allocations.length > 0) {
            await clientConn.query(
                `UPDATE events SET "reservedSeats" = $1 WHERE id = $2`,
                [reservedSeats, eventId]
            );
        }

        await clientConn.query('COMMIT');
        return { allocations };
    } catch (e) {
        try {
            await clientConn.query('ROLLBACK');
        } catch {}
        throw e;
    } finally {
        clientConn.release();
    }
}
