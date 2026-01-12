
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'database.db');

class Database {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database');
                this.initTables();
            }
        });
    }

    initTables() {
        // Users table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                avatar TEXT DEFAULT 'default.png',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                is_verified BOOLEAN DEFAULT 0
            )
        `);

        // Rooms table (for room history)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT UNIQUE NOT NULL,
                creator_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                is_public BOOLEAN DEFAULT 1,
                max_participants INTEGER DEFAULT 10,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (creator_id) REFERENCES users(id)
            )
        `);

        // Room participants history
        this.db.run(`
            CREATE TABLE IF NOT EXISTS room_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                left_at DATETIME,
                duration INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Contacts/Friends table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, contact_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (contact_id) REFERENCES users(id)
            )
        `);
    }

    // User methods
    async createUser(userData) {
        const { email, username, password } = userData;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO users (email, username, password) VALUES (?, ?, ?)`,
                [email, username, hashedPassword],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                }
            );
        });
    }

    async getUserByEmail(email) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM users WHERE email = ?`,
                [email],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });
    }

    async getUserById(id) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT id, email, username, avatar, created_at FROM users WHERE id = ?`,
                [id],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });
    }

    async getUserByUsername(username) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM users WHERE username = ?`,
                [username],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });
    }

    async verifyPassword(email, password) {
        const user = await this.getUserByEmail(email);
        if (!user) return false;
        
        return await bcrypt.compare(password, user.password);
    }

    async updateLastLogin(userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`,
                [userId],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });
    }

    // Room methods
    async createRoom(roomData) {
        const { roomId, creatorId, name, description, isPublic, maxParticipants } = roomData;
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO rooms (room_id, creator_id, name, description, is_public, max_participants) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [roomId, creatorId, name, description, isPublic || 1, maxParticipants || 10],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                }
            );
        });
    }

    async getRoom(roomId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT r.*, u.username as creator_name 
                 FROM rooms r 
                 JOIN users u ON r.creator_id = u.id 
                 WHERE r.room_id = ?`,
                [roomId],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });
    }

    async getUserRooms(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT DISTINCT r.*, u.username as creator_name 
                 FROM rooms r 
                 JOIN users u ON r.creator_id = u.id 
                 WHERE r.creator_id = ? OR r.id IN (
                     SELECT room_id FROM room_participants WHERE user_id = ?
                 )
                 ORDER BY r.created_at DESC`,
                [userId, userId],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });
    }

    async addRoomParticipant(roomId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO room_participants (room_id, user_id) VALUES (?, ?)`,
                [roomId, userId],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                }
            );
        });
    }

    async updateParticipantLeft(roomId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE room_participants 
                 SET left_at = CURRENT_TIMESTAMP,
                     duration = CAST((strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', joined_at)) AS INTEGER)
                 WHERE room_id = ? AND user_id = ? AND left_at IS NULL`,
                [roomId, userId],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });
    }

    // Contact methods
    async addContact(userId, contactUsername) {
        const contact = await this.getUserByUsername(contactUsername);
        if (!contact) throw new Error('User not found');
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)`,
                [userId, contact.id],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                }
            );
        });
    }

    async getContacts(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT u.id, u.username, u.avatar, c.status, c.created_at
                 FROM contacts c
                 JOIN users u ON c.contact_id = u.id
                 WHERE c.user_id = ? AND c.status = 'accepted'
                 ORDER BY u.username`,
                [userId],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });
    }
}

module.exports = new Database();
