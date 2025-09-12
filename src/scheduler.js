import cron from 'node-cron';
import { reconcileRedisWithPostgres } from './utils/redisReconciler.js';

// Schedule the reconciliation to run every hour
cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Starting scheduled Redis reconciliation...`);
    try {
        await reconcileRedisWithPostgres();
    } catch (error) {
        console.error('Error during Redis reconciliation:', error);
    }
});
