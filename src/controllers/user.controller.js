import {
    user as User,
    generateAccessToken,
    generateRefreshToken,
    hashPassword,
    isPasswordCorrect,
} from '../models/user.model.js';
import ApiError from '../utils/ApiError.js';
import ApiResponse from '../utils/apiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { db } from '../config/database.js';
import { eq } from 'drizzle-orm';
import { client } from '../config/redis.js';

const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await db.select().from(User).where(eq(User.id, userId));

        if (user.length === 0) {
            throw new ApiError(404, 'User not found');
        }
        const accessToken = generateAccessToken(user[0]);
        const refreshToken = generateRefreshToken(user[0].id);
        // console.log({ accessToken, refreshToken });
        user[0].refreshToken = refreshToken;
        // await user.save({ validateBeforeSave: false });
        await db
            .update(User)
            .set({ refreshToken: refreshToken })
            .where(eq(User.id, userId));
        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, error.message);
    }
};

const getUsers = asyncHandler(async (req, res) => {
    const users = await db
        .select({
            username: User.username,
            role: User.role,
        })
        .from(User);
    if (!users) {
        throw new ApiError(404, 'No users found');
    }
    return res.status(200).json(new ApiResponse(200, 'Users found', users));
});

const registerUser = asyncHandler(async (req, res) => {
    const { username, name, password, email, role } = req.body;
    if (!username || !password || !role || !name) {
        throw new ApiError(400, 'Please fill in all fields');
    }

    console.log(role);

    if (!['guest', 'host', 'admin'].includes(role)) {
        throw new ApiError(400, 'Role must be either guest or host');
    }

    const existed_user = await db
        .select()
        .from(User)
        .where(eq(User.email, email));

    if (existed_user.length > 0) {
        throw new ApiError(
            409,
            'User with this email or username already exists'
        );
    }

    const hashedPassword = await hashPassword(password);

    const user = await db
        .insert(User)
        .values({
            username: username,
            name: name,
            email: email,
            password: hashedPassword,
            role: role,
        })
        .returning({ insertedId: User.id });
    console.log(user);
    const newUser = await db
        .select()
        .from(User)
        .where(eq(User.id, user[0].insertedId));

    console.log(newUser);

    if (!newUser) {
        throw new ApiError(500, 'Error creating user');
    }

    return res
        .status(201)
        .json(new ApiResponse(201, 'User created successfully', newUser));
});

const loginUser = asyncHandler(async (req, res) => {
    const { username, password, email } = req.body;
    if (!username && !email) {
        throw new ApiError(400, 'Please provide a username or email');
    }
    if (!password) {
        throw new ApiError(400, 'Please provide a password');
    }

    const existed_user = await db
        .select()
        .from(User)
        .where(eq(User.email, email));

    if (!existed_user) {
        throw new ApiError(404, 'User not found');
    }

    const isMatch = await isPasswordCorrect(password, existed_user[0].password);
    if (!isMatch) {
        throw new ApiError(401, 'Invalid credentials');
    }
    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
        existed_user[0].id
    );
    // console.log(accessToken, refreshToken);

    existed_user[0].refreshToken = refreshToken;

    // Update user in database
    await db
        .update(User)
        .set({ refreshToken: refreshToken })
        .where(eq(User.id, existed_user[0].id));

    // Fetch only necessary user details to return
    const newUser = await db
        .select({
            username: User.username,
            role: User.role,
        })
        .from(User)
        .where(eq(User.id, existed_user[0].id));
    if (newUser.length === 0) {
        throw new ApiError(500, 'Error logging in user');
    }
    const options = {
        httpOnly: true,
        secure: true,
    };

    // Cache user in Redis for quick lookup
    await client.set(
        `user:${existed_user[0].id}`,
        JSON.stringify(existed_user[0]),
        'EX',
        60 * 60 // 1 hour cache
    );

    return res
        .status(200)
        .cookie('refreshToken', refreshToken, options)
        .cookie('accessToken', accessToken, options)
        .json(
            new ApiResponse(200, 'User logged in successfully', {
                user: newUser[0],
                accessToken,
                refreshToken,
            })
        );
});

const logOutUser = asyncHandler(async (req, res) => {
    // console.log(req.user);
    if (!req.user) {
        throw new ApiError(401, 'Unauthorized');
    }

    await db
        .update(User)
        .set({ refreshToken: '' })
        .where(eq(User.id, req.user.id));

    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'None', // Use the same setting as when setting the cookies
        path: '/', // Default is '/' if not explicitly set
    };

    return res
        .status(200)
        .clearCookie('accessToken', options)
        .clearCookie('refreshToken', options)
        .json(new ApiResponse(200, {}, 'User logged out successfully'));
});

export { getUsers, registerUser, loginUser, logOutUser };
