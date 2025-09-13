import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    },
});

async function notifyUser(userId, eventId, numberOfSeats, totalCost, success, reciever) {

    const subject = `Booking ${success ? 'Confirmed' : 'Failed'}: ${eventId}`;
    const text = `Your(${userId}) booking for ${numberOfSeats} seats at event ${eventId} has been ${success ? 'confirmed' : 'failed'}. Total cost: ${totalCost}`;
    const html = `<p>Your booking for <strong>${numberOfSeats}</strong> seats at event <strong>${eventId}</strong> has been <strong>${success ? 'confirmed' : 'failed'}</strong>. Total cost: <strong>${totalCost}</strong></p>`;

    try {
        const info = await transporter.sendMail({
            from: process.env.MAIL_USER,
            to: reciever,
            subject,
            text,
            html,
        })
        return {
            status: 200,
            message: 'Notification sent',
            data: {
                messageId: info.messageId,
            },
        };
    } catch (error) {
        console.error('Failed to send notification', error);
        return {
            status: 500,
            message: 'Failed to send notification',
            error,
        };
    }
};

export { notifyUser };
