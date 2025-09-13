import app from './src/app.js';
import dotenv from 'dotenv';
import './src/scheduler.js'; // Import the scheduler to start scheduled tasks
import { reconcileRedisWithPostgres } from './src/utils/redisReconciler.js';
// import { startBookingConsumer } from './src/worker/bookingConsumer.js';
// import { startNotificationConsumer } from './src/worker/notificationConsumer.js';

dotenv.config({ path: './env' });
const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, () => {
    console.log(`AtomicSeats server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    reconcileRedisWithPostgres().catch((err) => {
        console.error('Error during initial Redis reconciliation:', err);
    });
    // startBookingConsumer().catch(console.error);
    // startNotificationConsumer().catch(console.error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});
