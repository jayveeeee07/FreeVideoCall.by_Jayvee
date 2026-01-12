const jwt = require('jsonwebtoken');
const db = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const authMiddleware = {
    // Generate JWT token
    generateToken: (user) => {
        return jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
    },

    // Verify JWT token middleware
    verifyToken: (req, res, next) => {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        try {
            const verified = jwt.verify(token, JWT_SECRET);
            req.user = verified;
            next();
        } catch (err) {
            res.status(400).json({ error: 'Invalid token.' });
        }
    },

    // Optional auth (for routes that work with or without auth)
    optionalAuth: (req, res, next) => {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (token) {
            try {
                const verified = jwt.verify(token, JWT_SECRET);
                req.user = verified;
            } catch (err) {
                // Token is invalid, continue without auth
                req.user = null;
            }
        }
        next();
    }
};

module.exports = authMiddleware;
