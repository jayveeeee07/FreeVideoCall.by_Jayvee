require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const { body, validationResult } = require('express-validator');
const db = require('./database/db');
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Store active rooms and users (in-memory for WebSocket)
const rooms = new Map();
const onlineUsers = new Map(); // userId -> {ws, username}

// ========== API ROUTES ==========

// Home route (serves login/signup page)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Dashboard route (protected)
app.get('/dashboard', authMiddleware.verifyToken, (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// Room route (protected)
app.get('/room/:roomId', authMiddleware.verifyToken, (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

// ========== AUTH API ==========

// Register new user
app.post('/api/register', [
    body('email').isEmail().normalizeEmail(),
    body('username').isLength({ min: 3, max: 30 }).trim(),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, username, password } = req.body;

    try {
        // Check if user exists
        const existingEmail = await db.getUserByEmail(email);
        if (existingEmail) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const existingUsername = await db.getUserByUsername(username);
        if (existingUsername) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        // Create user
        const userId = await db.createUser({ email, username, password });
        
        // Get user data
        const user = await db.getUserById(userId);
        
        // Generate token
        const token = authMiddleware.generateToken(user);
        
        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            message: 'Registration successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login user
app.post('/api/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        // Verify password
        const isValid = await db.verifyPassword(email, password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Get user
        const user = await db.getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await db.updateLastLogin(user.id);

        // Generate token
        const token = authMiddleware.generateToken(user);
        
        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
});

// Get current user
app.get('/api/me', authMiddleware.verifyToken, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// ========== ROOM API ==========

// Create a new room
app.post('/api/rooms', authMiddleware.verifyToken, [
    body('name').isLength({ min: 1, max: 100 }),
    body('description').optional(),
    body('isPublic').isBoolean().optional(),
    body('maxParticipants').isInt({ min: 2, max: 50 }).optional()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, isPublic, maxParticipants } = req.body;
    const roomId = uuidv4().slice(0, 8).toUpperCase();

    try {
        await db.createRoom({
            roomId,
            creatorId: req.user.id,
            name,
            description,
            isPublic,
            maxParticipants
        });

        res.json({
            message: 'Room created successfully',
            room: {
                id: roomId,
                name,
                description,
                isPublic,
                maxParticipants,
                creatorId: req.user.id
            }
        });
    } catch (error) {
        console.error('Room creation error:', error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Get user's rooms
app.get('/api/rooms', authMiddleware.verifyToken, async (req, res) => {
    try {
        const rooms = await db.getUserRooms(req.user.id);
        res.json({ rooms });
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// Get room info
app.get('/api/rooms/:roomId', authMiddleware.optionalAuth, async (req, res) => {
    try {
        const room = await db.getRoom(req.params.roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }
        
        // Check if room is private and user is not creator
        if (!room.is_public && (!req.user || req.user.id !== room.creator_id)) {
            return res.status(403).json({ error: 'Private room. Access denied.' });
        }

        res.json({ room });
    } catch (error) {
        console.error('Error fetching room:', error);
        res.status(500).json({ error: 'Failed to fetch room' });
    }
});

// ========== USER API ==========

// Search users
app.get('/api/users/search', authMiddleware.verifyToken, async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        return res.status(400).json({ error: 'Search query too short' });
    }

    try {
        // Search in database (simplified)
        const users = await new Promise((resolve, reject) => {
            db.db.all(
                `SELECT id, username, email, avatar FROM users 
                 WHERE username LIKE ? OR email LIKE ?
                 LIMIT 10`,
                [`%${q}%`, `%${q}%`],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });
        
        res.json({ users });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Add contact
app.post('/api/contacts', authMiddleware.verifyToken, [
    body('username').isLength({ min: 3 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username } = req.body;

    try {
        // Can't add yourself
        if (username === req.user.username) {
            return res.status(400).json({ error: 'Cannot add yourself as contact' });
        }

        await db.addContact(req.user.id, username);
        res.json({ message: 'Contact request sent' });
    } catch (error) {
        console.error('Add contact error:', error);
        res.status(500).json({ error: error.message || 'Failed to add contact' });
    }
});

// Get contacts
app.get('/api/contacts', authMiddleware.verifyToken, async (req, res) => {
    try {
        const contacts = await db.getContacts(req.user.id);
        res.json({ contacts });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});

// ========== WEBSOCKET HANDLING (UPDATED) ==========

wss.on('connection', (ws) => {
    ws.id = uuidv4();
    ws.userId = null;
    ws.roomId = null;
    ws.userName = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            await handleWebSocketMessage(ws, data);
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        if (ws.userId) {
            onlineUsers.delete(ws.userId);
            
            if (ws.roomId && rooms.has(ws.roomId)) {
                const room = rooms.get(ws.roomId);
                room.users = room.users.filter(user => user.id !== ws.userId);
                
                // Notify others
                broadcastToRoom(ws.roomId, {
                    type: 'user-left',
                    userId: ws.userId,
                    userName: ws.userName
                }, ws);

                // Update database
                if (ws.userId) {
                    db.updateParticipantLeft(ws.roomId, ws.userId);
                }

                // Remove room if empty
                if (room.users.length === 0) {
                    rooms.delete(ws.roomId);
                }
            }
        }
    });
});

async function handleWebSocketMessage(ws, data) {
    switch (data.type) {
        case 'authenticate':
            await handleAuthentication(ws, data.token);
            break;
            
        case 'join-room':
            await joinRoom(ws, data.roomId, data.userName);
            break;
            
        case 'offer':
        case 'answer':
        case 'ice-candidate':
            forwardMessage(ws, data);
            break;
            
        case 'chat-message':
            broadcastToRoom(ws.roomId, {
                type: 'chat-message',
                userId: ws.userId,
                userName: ws.userName,
                message: data.message,
                timestamp: new Date().toISOString()
            });
            break;
            
        case 'mute-audio':
        case 'mute-video':
        case 'screen-share':
            broadcastToRoom(ws.roomId, data, ws);
            break;
            
        case 'typing':
            broadcastToRoom(ws.roomId, {
                type: 'typing',
                userId: ws.userId,
                userName: ws.userName,
                isTyping: data.isTyping
            }, ws);
            break;
    }
}

async function handleAuthentication(ws, token) {
    try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        const decoded = jwt.verify(token, JWT_SECRET);
        
        ws.userId = decoded.id;
        ws.userName = decoded.username;
        
        onlineUsers.set(ws.userId, {
            ws,
            username: decoded.username,
            lastSeen: new Date()
        });
        
        ws.send(JSON.stringify({
            type: 'authenticated',
            user: decoded
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'auth-error',
            error: 'Invalid token'
        }));
        ws.close();
    }
}

async function joinRoom(ws, roomId, userName) {
    // Verify user has access to room (check in database)
    try {
        const room = await db.getRoom(roomId);
        if (!room) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room not found'
            }));
            return;
        }
        
        // Check if room is full
        const currentRoom = rooms.get(roomId);
        if (currentRoom && currentRoom.users.length >= room.max_participants) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room is full'
            }));
            return;
        }
        
        // Add to in-memory room
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                users: [],
                createdAt: new Date(),
                roomInfo: room
            });
        }
        
        const roomData = rooms.get(roomId);
        const user = { 
            id: ws.userId || ws.id, 
            userName: userName || ws.userName || 'Anonymous',
            ws 
        };
        roomData.users.push(user);
        
        ws.roomId = roomId;
        ws.userName = user.userName;
        
        // Add to database if authenticated user
        if (ws.userId) {
            await db.addRoomParticipant(roomId, ws.userId);
        }
        
        // Send existing users to the new user
        const existingUsers = roomData.users
            .filter(user => user.id !== (ws.userId || ws.id))
            .map(user => ({ 
                id: user.id, 
                userName: user.userName 
            }));
        
        ws.send(JSON.stringify({
            type: 'room-joined',
            roomId,
            userId: ws.userId || ws.id,
            existingUsers,
            roomInfo: room
        }));
        
        // Notify others about new user
        broadcastToRoom(roomId, {
            type: 'user-joined',
            userId: ws.userId || ws.id,
            userName: user.userName
        }, ws);
        
    } catch (error) {
        console.error('Join room error:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to join room'
        }));
    }
}

function forwardMessage(sender, data) {
    const room = rooms.get(sender.roomId);
    if (!room) return;
    
    const targetUser = room.users.find(user => user.id === data.targetUserId);
    if (targetUser) {
        targetUser.ws.send(JSON.stringify({
            ...data,
            senderId: sender.userId || sender.id
        }));
    }
}

function broadcastToRoom(roomId, message, excludeWs = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.users.forEach(user => {
        if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(message));
        }
    });
}

// ========== START SERVER ==========

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
