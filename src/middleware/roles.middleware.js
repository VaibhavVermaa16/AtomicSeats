import ApiError from '../utils/apiError.js';

// Simple role-based authorization middleware
// Usage: requireRole('admin') or requireRole('host', 'admin')
const requireRole = (...roles) => {
    return (req, res, next) => {
        try {
            // Ensure user is attached by previous auth middleware
            const user = req.user;
            if (!user) {
                throw new ApiError(401, 'Unauthorized: user not found');
            }

            if (!roles.includes(user.role)) {
                throw new ApiError(403, 'Forbidden: insufficient role');
            }

            next();
        } catch (err) {
            next(err);
        }
    };
};

export { requireRole };
