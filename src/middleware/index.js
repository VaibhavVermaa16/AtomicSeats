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

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err);

  // Default error response
  let statusCode = 500;
  let message = 'Internal Server Error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (err.code === 23505) {
    // PostgreSQL unique violation
    statusCode = 409;
    message = 'Resource already exists';
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// Authentication middleware placeholder
const authenticate = (req, res, next) => {
  // TODO: Implement authentication logic
  // For now, just pass through
  next();
};

// Rate limiting middleware placeholder
const rateLimit = (req, res, next) => {
  // TODO: Implement rate limiting logic
  // For now, just pass through
  next();
};

module.exports = {
  requestLogger,
  errorHandler,
  authenticate,
  rateLimit,
};
