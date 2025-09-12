import { client } from '../config/redis.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';

const RateLimiter = (limit, windowInSeconds) => {
    return asyncHandler(async (req, res, next) => {
        // If user is logged in, use their ID; otherwise fall back to IP
        const identifier = req.user?.id || req.ip;
        console.log('Rate Limiter Identifier:', identifier);
        const key = `rate_limit:${identifier}`;
        const now = Date.now();

        const windowStart = now - windowInSeconds * 1000;

        // 1. Record this request timestamp
        await client.zAdd(key, [{ score: now, value: `${now}` }]);

        // 2. Remove old requests outside the time window
        await client.zRemRangeByScore(key, 0, windowStart);

        // 3. Count how many requests remain in the window
        const count = await client.zCard(key);

        // 4. Expire key automatically (to save Redis memory)
        await client.expire(key, windowInSeconds);

        // 5. Block if request count exceeds the limit
        if (count > limit) {
            throw new ApiError(
                429,
                'Too many requests, please try again later.'
            );
        }
        console.log(`Rate limit count for ${identifier}:`, count);
        // If within limit → allow
        next();
    });
};

export default RateLimiter;
