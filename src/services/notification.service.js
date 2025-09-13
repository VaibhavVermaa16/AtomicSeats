import nodemailer from 'nodemailer';

// Channel enum
export const NotificationChannel = {
    EMAIL: 'email',
};

// Types enum
export const NotificationType = {
    BOOKING_CONFIRMED: 'booking_confirmed',
    BOOKING_FAILED: 'booking_failed',
    WAITLISTED: 'waitlisted',
    WAITLIST_CONFIRMED: 'waitlist_confirmed',
    WAITLIST_CLOSED: 'waitlist_closed',
};

// Create a single mail transporter (gmail creds via env)
const mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    },
});

async function sendEmail({ to, subject, text, html }) {
    const info = await mailTransporter.sendMail({
        from: process.env.MAIL_USER,
        to,
        subject,
        text,
        html,
    });
    return { messageId: info.messageId };
}

/**
 * sendNotification: generalized multi-channel dispatcher.
 * input:
 *   - channel: 'email'
 *   - type: NotificationType
 *   - payload: channel-specific props and contextual data
 */
export async function sendNotification({ channel, type, payload }) {
    try {
        switch (channel) {
            case NotificationChannel.EMAIL:
                return await sendEmail(payload);
        }
    } catch (err) {
        console.error('Notification send failed:', { channel, type, err });
        throw err;
    }
}

// Convenience builders for common types
export function buildEmailForBooking({
    userEmail,
    userId,
    eventId,
    numberOfSeats,
    totalCost,
    success,
}) {
    const subject = `Booking ${success ? 'Confirmed' : 'Failed'}: ${eventId}`;
    const text = `Your(${userId}) booking for ${numberOfSeats} seats at event ${eventId} has been ${success ? 'confirmed' : 'failed'}. Total cost: ${totalCost}`;
    const html = `<p>Your booking for <strong>${numberOfSeats}</strong> seats at event <strong>${eventId}</strong> has been <strong>${success ? 'confirmed' : 'failed'}</strong>. Total cost: <strong>${totalCost}</strong></p>`;
    return { to: userEmail, subject, text, html };
}

export function buildEmailForWaitlisted({
    userEmail,
    userId,
    eventId,
    numberOfSeats,
}) {
    const subject = `You're on the waitlist for event ${eventId}`;
    const text = `Hi ${userId}, you're placed on the waitlist for ${numberOfSeats} seat(s) at event ${eventId}. We'll notify you if seats free up.`;
    const html = `<p>Hi <strong>${userId}</strong>, you're placed on the <strong>waitlist</strong> for <strong>${numberOfSeats}</strong> seat(s) at event <strong>${eventId}</strong>. We'll notify you if seats free up.</p>`;
    return { to: userEmail, subject, text, html };
}

export function buildEmailForWaitlistConfirmed({
    userEmail,
    userId,
    eventId,
    numberOfSeats,
    totalCost,
}) {
    const subject = `Good news! Seats confirmed for event ${eventId}`;
    const text = `Hi ${userId}, your waitlisted request for ${numberOfSeats} seat(s) at event ${eventId} is now confirmed. Total cost: ${totalCost}.`;
    const html = `<p>Hi <strong>${userId}</strong>, your <em>waitlisted</em> request for <strong>${numberOfSeats}</strong> seat(s) at event <strong>${eventId}</strong> is now <strong>confirmed</strong>. Total cost: <strong>${totalCost}</strong>.</p>`;
    return { to: userEmail, subject, text, html };
}

export function buildEmailForWaitlistClosed({ userEmail, userId, eventId }) {
    const subject = `Event ${eventId} is sold out; waitlist closed`;
    const text = `Hi ${userId}, the event ${eventId} has sold out and the waitlist is now closed.`;
    const html = `<p>Hi <strong>${userId}</strong>, the event <strong>${eventId}</strong> has sold out and the waitlist is now <strong>closed</strong>.</p>`;
    return { to: userEmail, subject, text, html };
}

// Backward compatible wrapper for old util signature (optional import path migration)
export async function notifyUserLegacy(
    userId,
    eventId,
    numberOfSeats,
    totalCost,
    success,
    receiver
) {
    const emailPayload = buildEmailForBooking({
        userEmail: receiver,
        userId,
        eventId,
        numberOfSeats,
        totalCost,
        success,
    });
    return sendNotification({
        channel: NotificationChannel.EMAIL,
        type: success
            ? NotificationType.BOOKING_CONFIRMED
            : NotificationType.BOOKING_FAILED,
        payload: emailPayload,
    });
}
