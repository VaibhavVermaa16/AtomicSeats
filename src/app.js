import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import session from 'express-session';
import cookieParser from 'cookie-parser';

import userRoutes from './routes/user.routes.js';
import eventsRoutes from './routes/events.routes.js';
import adminRoutes from './routes/admin.routes.js';

dotenv.config();

const app = express();

// Basic middleware
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
    session({
        secret: process.env.SESSION_SECRET, // Change this for security
        resave: false,
        saveUninitialized: true,
        cookie: { maxAge: 30 * 60 * 1000 }, // Session lasts 30 mins
    })
);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'AtomicSeats API is running',
        timestamp: new Date().toISOString(),
    });
});

// API routes
app.use('/api/user', userRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found',
        path: req.originalUrl,
    });
});

export default app;
