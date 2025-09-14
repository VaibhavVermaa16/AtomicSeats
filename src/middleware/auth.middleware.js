import asyncHandler from '../utils/asyncHandler.js';
import jwt from 'jsonwebtoken';
import { user as User } from '../models/user.model.js';
import { db } from '../config/database.js';
import ApiError from '../utils/apiError.js';
import { eq } from 'drizzle-orm';
import { client } from '../config/redis.js';

const verifyToken = asyncHandler(async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            req.header('Authorization')?.replace('Bearer ', '');

        if (!token) throw new ApiError(401, 'Unauthorized access');

        const decodedToken = jwt.decode(token, process.env.ACCESS_TOKEN_SECRET);

        // Get cached user from Redis
        const cachedUser = await client.get(`user:${decodedToken.id}`);

        if (cachedUser) {
            req.user = JSON.parse(cachedUser);
        } else {
            const user = await db
                .select()
                .from(User)
                .where(eq(User.id, decodedToken?.id));

            if (!user || user.length === 0) {
                throw new ApiError(401, 'Unauthorized access');
            }

            req.user = user[0];
            // Cache user in Redis for quick lookup
            await client.set(
                `user:${user[0].id}`,
                JSON.stringify(user[0]),
                'EX',
                3600
            );
        }
        next();
    } catch (error) {
        // Handle token verification errors
        if (
            error.name === 'JsonWebTokenError' ||
            error.name === 'TokenExpiredError'
        ) {
            throw new ApiError(
                401,
                'Unauthorized access: Invalid or expired token'
            );
        }
        // Handle other errors
        console.log(error);
        throw new ApiError(500, 'Internal server error');
    }
});

export { verifyToken };
