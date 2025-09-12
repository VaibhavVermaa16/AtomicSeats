import express from 'express';
import {
    getAllEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    bookEvent,
} from '../controllers/events.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import RateLimiter from '../middleware/ratelimiter.middleware.js';

const router = express.Router();

// Event routes go here
router.route('/all').get(verifyToken, RateLimiter(50, 60), getAllEvents);

router.route('/create').post(verifyToken, RateLimiter(5, 60), createEvent);

router.route('/update').post(verifyToken, RateLimiter(5, 60), updateEvent);

router.route('/delete').post(verifyToken, RateLimiter(5, 60), deleteEvent);

router.route('/book').post(verifyToken, RateLimiter(5, 60), bookEvent);

export default router;
