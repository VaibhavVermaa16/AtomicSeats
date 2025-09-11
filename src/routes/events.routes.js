import express from 'express';
import { getAllEvents, createEvent, updateEvent, deleteEvent, bookEvent } from '../controllers/events.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// Event routes go here
router.route('/all').get(getAllEvents);

router.route('/create').post(verifyToken, createEvent);

router.route('/update').post(verifyToken, updateEvent);

router.route('/delete').post(verifyToken, deleteEvent)

router.route('/book').post(verifyToken, bookEvent);

export default router;
