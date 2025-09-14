import {
    user as User,
    generateAccessToken,
    generateRefreshToken,
    hashPassword,
    isPasswordCorrect,
} from '../models/user.model.js';
import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db, pgPool } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { client } from '../config/redis.js';
import { booking as Booking } from '../models/booking.models.js';
import { event as Event } from '../models/events.model.js';

const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await db.select().from(User).where(eq(User.id, userId));

        if (!user.length) {
            throw new ApiError(404, 'User not found');
        }
        const accessToken = generateAccessToken(user[0]);
        const refreshToken = generateRefreshToken(user[0].id);
        // console.log({ accessToken, refreshToken });
        user[0].refreshToken = refreshToken;
        // await user.save({ validateBeforeSave: false });
        await db
            .update(User)
            .set({ refreshToken: refreshToken })
            .where(eq(User.id, userId));
        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, error.message);
    }
};

const getUsers = asyncHandler(async (req, res) => {
    const users = await db
        .select({
            username: User.username,
            role: User.role,
        })
        .from(User);
    if (!users || users.length === 0) {
        throw new ApiError(404, 'No users found');
    }
    return res.status(200).json(new ApiResponse(200, 'Users found', users));
});

const registerUser = asyncHandler(async (req, res) => {
    const { username, name, password, email, role } = req.body;
    if (!username || !password || !role || !name || !email) {
        throw new ApiError(400, 'Please fill in all fields');
    }

    console.log(role);

    if (!['guest', 'host', 'admin'].includes(role)) {
        throw new ApiError(400, 'Role must be guest, host, or admin');
    }

    const existed_user = await db
        .select()
        .from(User)
        .where(eq(User.email, email));

    if (existed_user && existed_user.length > 0) {
        throw new ApiError(
            409,
            'User with this email or username already exists'
        );
    }

    const hashedPassword = await hashPassword(password);

    const user = await db
        .insert(User)
        .values({
            username: username,
            name: name,
            email: email,
            password: hashedPassword,
            role: role,
        })
        .returning({ insertedId: User.id });
    console.log(user);
    const newUser = await db
        .select()
        .from(User)
        .where(eq(User.id, user[0].insertedId));

    console.log(newUser);

    if (!newUser || newUser.length === 0) {
        throw new ApiError(500, 'Error creating user');
    }

    return res
        .status(201)
        .json(new ApiResponse(201, 'User created successfully', newUser));
});

const loginUser = asyncHandler(async (req, res) => {
    const { username, password, email } = req.body;
    if (!username && !email) {
        throw new ApiError(400, 'Please provide a username or email');
    }
    if (!password) {
        throw new ApiError(400, 'Please provide a password');
    }

    const existed_user = await db
        .select()
        .from(User)
        .where(eq(User.email, email));

    if (!existed_user || existed_user.length === 0) {
        throw new ApiError(404, 'User not found');
    }

    const isMatch = await isPasswordCorrect(password, existed_user[0].password);
    if (!isMatch) {
        throw new ApiError(401, 'Invalid credentials');
    }
    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
        existed_user[0].id
    );
    // console.log(accessToken, refreshToken);

    existed_user[0].refreshToken = refreshToken;

    // Update user in database
    await db
        .update(User)
        .set({ refreshToken: refreshToken })
        .where(eq(User.id, existed_user[0].id));

    // Fetch only necessary user details to return
    const newUser = await db
        .select({
            username: User.username,
            role: User.role,
        })
        .from(User)
        .where(eq(User.id, existed_user[0].id));
    if (!newUser || newUser.length === 0) {
        throw new ApiError(500, 'Error logging in user');
    }
    const options = {
        httpOnly: true,
        secure: true,
    };

    // Cache user in Redis for quick lookup
    await client.set(
        `user:${existed_user[0].id}`,
        JSON.stringify(existed_user[0]),
        'EX',
        60 * 60 // 1 hour cache
    );

    return res
        .status(200)
        .cookie('refreshToken', refreshToken, options)
        .cookie('accessToken', accessToken, options)
        .json(
            new ApiResponse(200, 'User logged in successfully', {
                user: newUser[0],
                accessToken,
                refreshToken,
            })
        );
});

const logOutUser = asyncHandler(async (req, res) => {
    // console.log(req.user);
    if (!req.user) {
        throw new ApiError(401, 'Unauthorized');
    }

    await db
        .update(User)
        .set({ refreshToken: '' })
        .where(eq(User.id, req.user.id));

    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'None', // Use the same setting as when setting the cookies
        path: '/', // Default is '/' if not explicitly set
    };

    return res
        .status(200)
        .clearCookie('accessToken', options)
        .clearCookie('refreshToken', options)
        .json(new ApiResponse(200, {}, 'User logged out successfully'));
});

export { getUsers, registerUser, loginUser, logOutUser };

// GET /api/user/bookings
// Query params: limit, cursor, eventId, status, from, to, view
// - cursor encodes createdAt and id for keyset: base64(JSON.stringify({ t, id }))
const getBookingHistory = asyncHandler(async (req, res) => {
    if (!req.user) throw new ApiError(401, 'Unauthorized');
    const userId = req.user.id;

    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const view = (req.query.view || 'tickets').toLowerCase(); // 'tickets' | 'summary'
    const eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    const status = req.query.status?.toLowerCase(); // 'confirmed' | 'cancelled'
    const from = req.query.from ? new Date(req.query.from) : undefined;
    const to = req.query.to ? new Date(req.query.to) : undefined;
    const cursor = req.query.cursor;

    // Build SQL with keyset pagination (createdAt DESC, id DESC)
    // Use pgPool for flexibility with raw SQL + joins
    const params = [userId];
    let where = 'b."userId" = $1';
    let idx = params.length + 1;
    if (eventId) {
        params.push(eventId);
        where += ` AND b."eventId" = $${idx++}`;
    }
    if (status === 'confirmed' || status === 'cancelled') {
        params.push(status);
        where += ` AND b.status = $${idx++}`;
    }
    if (from && !isNaN(from.getTime())) {
        params.push(from);
        where += ` AND b."createdAt" >= $${idx++}`;
    }
    if (to && !isNaN(to.getTime())) {
        params.push(to);
        where += ` AND b."createdAt" <= $${idx++}`;
    }

    // Decode cursor: { t: ISO string, id: number }
    let tCursor, idCursor;
    if (cursor) {
        try {
            const decoded = JSON.parse(
                Buffer.from(cursor, 'base64').toString('utf8')
            );
            tCursor = decoded.t ? new Date(decoded.t) : undefined;
            idCursor = decoded.id ? Number(decoded.id) : undefined;
        } catch {}
    }
    if (tCursor && idCursor) {
        params.push(tCursor);
        params.push(idCursor);
        where += ` AND (b."createdAt" < $${idx++} OR (b."createdAt" = $${idx - 1} AND b.id < $${idx++}))`;
    }

    const sql = `
        SELECT b.id, b."eventId", b."numberOfSeats", b.cost, b."createdAt", b."cancelledAt", b.status,
               e.name AS event_name, e.venue, e."startsAt", e."endsAt", e.price
        FROM booking b
        JOIN events e ON e.id = b."eventId"
        WHERE ${where}
        ORDER BY b."createdAt" DESC, b.id DESC
        LIMIT ${limit + 1}
    `;

    const result = await pgPool.query(sql, params);
    const rows = result.rows || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Compute next cursor
    let nextCursor = undefined;
    if (hasMore) {
        const last = pageRows[pageRows.length - 1];
        nextCursor = Buffer.from(
            JSON.stringify({ t: last.createdAt, id: last.id })
        ).toString('base64');
    }

    if (view === 'summary') {
        // Group by eventId
        const map = new Map();
        for (const r of pageRows) {
            const key = r.eventId;
            if (!map.has(key)) {
                map.set(key, {
                    eventId: r.eventId,
                    event: {
                        name: r.event_name,
                        venue: r.venue,
                        startsAt: r.startsAt,
                        endsAt: r.endsAt,
                        price: Number(r.price || 0),
                    },
                    totalTickets: 0,
                    totalCost: 0,
                    activeTickets: 0,
                    cancelledTickets: 0,
                    firstBookedAt: r.createdAt,
                    lastBookedAt: r.createdAt,
                });
            }
            const s = map.get(key);
            s.totalTickets += Number(r.numberOfSeats || 0);
            s.totalCost += Number(r.cost || 0);
            if (r.status === 'cancelled') s.cancelledTickets += 1;
            else s.activeTickets += 1;
            if (r.createdAt < s.firstBookedAt) s.firstBookedAt = r.createdAt;
            if (r.createdAt > s.lastBookedAt) s.lastBookedAt = r.createdAt;
        }
        const items = Array.from(map.values());
        return res
            .status(200)
            .json(
                new ApiResponse(
                    200,
                    { items, pageInfo: { hasMore, nextCursor } },
                    'Booking history (summary)'
                )
            );
    }

    // Default: tickets view (one per booking row)
    const items = pageRows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        event: {
            name: r.event_name,
            venue: r.venue,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            price: Number(r.price || 0),
        },
        numberOfSeats: Number(r.numberOfSeats || 0),
        cost: Number(r.cost || 0),
        status: r.status,
        createdAt: r.createdAt,
        cancelledAt: r.cancelledAt,
    }));

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                { items, pageInfo: { hasMore, nextCursor } },
                'Booking history'
            )
        );
});

export { getBookingHistory };
