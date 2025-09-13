import { notificationConsumer } from '../utils/kafka.js';
import { notifyUser } from '../utils/sendNotification.js';

const consumer = notificationConsumer;

export const startNotificationConsumer = async () => {
    await consumer.connect();
    await consumer.subscribe({ topic: 'notify-user', fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const {
                userId,
                eventId,
                numberOfSeats,
                totalCost,
                email,
                success,
            } = JSON.parse(message.value.toString());
            console.log(
                `📩 Sending notification to user ${userId} for event ${eventId} for success: ${success}`
            );
            try {
                await notifyUser(
                    userId,
                    eventId,
                    numberOfSeats,
                    totalCost,
                    success,
                    email
                );
                console.log(
                    `✅ Notification sent successfully to user ${userId}`
                );
            } catch (error) {
                console.error(
                    `❌ Failed to send notification to user ${userId}:`,
                    error
                );
            }
        },
    });
};

startNotificationConsumer().catch(console.error);
// export default startNotificationConsumer;
