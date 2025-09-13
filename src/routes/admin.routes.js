import express from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/roles.middleware.js';
import {
    adminCreateEvent,
    adminDeleteEvent,
    adminAnalytics,
} from '../controllers/admin.controller.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(verifyToken, requireRole('admin'));

// Events management
router.post('/events', adminCreateEvent);
router.delete('/events', adminDeleteEvent);

// Analytics
router.get('/analytics', adminAnalytics);

export default router;
