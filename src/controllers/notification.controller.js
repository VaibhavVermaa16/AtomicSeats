import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    },
});

const notifyUser = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new ApiError(
            401,
            'Unauthorized, please login to send notifications'
        );
    }

    const { to, subject, text, html } = req.body;
    if (!to || !subject || (!text && !html)) {
        throw new ApiError(400, 'To, subject, and text or html are required');
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.MAIL_FROM,
            to,
            subject,
            text,
            html,
        });
        return res
            .status(200)
            .json(
                new ApiResponse(200, 'Notification sent', {
                    messageId: info.messageId,
                })
            );
    } catch (error) {
        throw new ApiError(500, 'Failed to send notification', error);
    }
});

export { notifyUser };
