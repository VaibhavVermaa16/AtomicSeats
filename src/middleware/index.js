// Request logging middleware
const requestLogger = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(
            `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`
        );
    });

    next();
};

// Rate limiting middleware placeholder
const rateLimit = (req, res, next) => {
    // TODO: Implement rate limiting logic
    // For now, just pass through
    next();
};

export default {
    requestLogger,
    rateLimit,
};
