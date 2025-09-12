import express from 'express';
import {
    registerUser,
    loginUser,
    logOutUser,
} from '../controllers/user.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import RateLimiter from '../middleware/ratelimiter.middleware.js';

const router = express.Router();

// API Info endpoint
router.get('/', (req, res) => {
    res.status(200).json({
        message: 'Welcome to AtomicSeats API',
        version: '1.0.0',
        endpoints: {
            users: '/api/users',
            events: '/api/events',
            seats: '/api/seats',
        },
        docs: 'API documentation coming soon',
    });
});

router.route('/register').post(RateLimiter(5, 60), registerUser);

router.route('/login').post(RateLimiter(5, 60), loginUser);

router.route('/logout').post(verifyToken, logOutUser);

export default router;
