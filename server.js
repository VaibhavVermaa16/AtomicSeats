import app from './src/app.js';
import dotenv from 'dotenv';

dotenv.config({ path: './env' });
const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, () => {
    console.log(`🚀 AtomicSeats server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    process.exit(0);
});
