import Razorpay from 'razorpay';
import crypto from 'crypto';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/apiError.js';
import ApiResponse from '../utils/apiResponse.js';

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create a new payment order
const createOrder = asyncHandler(async (req, res) => {
    const { amount, currency = 'INR', notes } = req.body;
    const receipt = `receipt_${Date.now()}`;
    console.log(
        'Creating order with amount:',
        amount,
        'currency:',
        currency,
        'notes:',
        notes
    );
    if (!amount) {
        throw new ApiError(400, 'Amount is required');
    }

    const options = {
        amount: Math.round(Number(amount) * 100), // Razorpay expects amount in paise
        currency,
        receipt,
        notes,
    };

    try {
        const order = await razorpay.orders.create(options);
        console.log('Razorpay Order:', order);
        return res
            .status(201)
            .json(new ApiResponse(201, 'Order created', order));
    } catch (error) {
        throw new ApiError(500, 'Failed to create Razorpay order', error);
    }
});

// Verify payment signature (to be called after payment)
const verifyPayment = asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
        req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new ApiError(400, 'Missing payment verification fields');
    }

    const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (generatedSignature !== razorpay_signature) {
        throw new ApiError(400, 'Invalid payment signature');
    }

    return res
        .status(200)
        .json(new ApiResponse(200, 'Payment verified successfully'));
});

const createPaymentLink = asyncHandler(async (req, res) => {
    const { amount } = req.body;
    if (!amount) {
        throw new ApiError(400, 'Amount is required');
    }
    // Build options and remove undefined/null fields
    let options = {
        title: 'Test Order Payment',
        description: 'Pay for order',
        amount: Math.round(Number(amount)),
        customer: {
            name: 'Test User',
            email: 'vaibhavvermaa16@gmail.com',
        },
        notify: { sms: true, email: true },
        reminder_enable: true,
        callback_url: 'http://localhost:3000/payment-callback',
        expiration_time: Math.floor(Date.now() / 1000) + 15 * 60,
    };
    // Remove undefined/null fields recursively
    function clean(obj) {
        return Object.fromEntries(
            Object.entries(obj)
                .filter(([_, v]) => v !== undefined && v !== null)
                .map(([k, v]) => [
                    k,
                    typeof v === 'object' && v !== null && !Array.isArray(v)
                        ? clean(v)
                        : v,
                ])
        );
    }
    options = clean(options);
    console.log('PaymentLink options:', options);
    try {
        const link = await razorpay.paymentLink.create(options);
        return res.json({
            paymentLinkId: link.id,
            shortUrl: link.short_url,
            longUrl: link.url,
        });
    } catch (error) {
        console.error('Payment Link Error:', error?.response || error);
        throw new ApiError(
            500,
            error.message || 'Failed to create payment link'
        );
    }
});

export { createOrder, verifyPayment, createPaymentLink };
