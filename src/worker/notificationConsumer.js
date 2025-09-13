import { notificationConsumer } from '../utils/kafka.js';
import {
    sendNotification,
    NotificationChannel,
    NotificationType,
    buildEmailForBooking,
    buildEmailForWaitlisted,
    buildEmailForWaitlistClosed,
    buildEmailForWaitlistConfirmed,
} from '../services/notification.service.js';

const consumer = notificationConsumer;

export const startNotificationConsumer = async () => {
    await consumer.connect();
    await consumer.subscribe({ topic: 'notify-user', fromBeginning: false });
    // Also support generic notifications topic (future-proof)
    try {
        await consumer.subscribe({
            topic: 'notifications',
            fromBeginning: false,
        });
    } catch {}

    await consumer.run({
        eachMessage: async ({ topic, message }) => {
            const parsed = JSON.parse(message.value.toString());
            // If it's legacy booking shape
            if (
                parsed &&
                'userId' in parsed &&
                'eventId' in parsed &&
                'numberOfSeats' in parsed &&
                'email' in parsed &&
                'success' in parsed
            ) {
                const {
                    userId,
                    eventId,
                    numberOfSeats,
                    totalCost,
                    email,
                    success,
                    bookingId,
                    bookingIds,
                } = parsed;
                console.log(
                    `📩 [legacy] Notifying user ${userId} for event ${eventId} success=${success}`
                );
                try {
                    const payload = buildEmailForBooking({
                        userEmail: email,
                        userId,
                        eventId,
                        numberOfSeats,
                        totalCost: totalCost || 0,
                        success,
                        bookingId,
                        bookingIds,
                    });
                    await sendNotification({
                        channel: NotificationChannel.EMAIL,
                        type: success
                            ? NotificationType.BOOKING_CONFIRMED
                            : NotificationType.BOOKING_FAILED,
                        payload,
                    });
                    console.log(
                        `✅ Notification sent successfully to user ${userId}`
                    );
                } catch (error) {
                    console.error(
                        `❌ Failed to send notification to user ${userId}:`,
                        error
                    );
                }
                return;
            }

            // Generic shape: { channel, type, payload }
            const { channel, type, payload } = parsed || {};
            console.log(`📩 [generic] Sending notification`, {
                topic,
                channel,
                type,
            });
            try {
                console.log('Payload:', payload);
                await sendNotification({ channel, type, payload });
                console.log(`✅ Notification sent`);
            } catch (error) {
                console.error(`❌ Generic notification failed:`, error);
            }
        },
    });
};

startNotificationConsumer().catch(console.error);
// export default startNotificationConsumer;
