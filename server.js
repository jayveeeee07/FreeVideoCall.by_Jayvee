require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Vercel provides PORT environment variable
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// WebSocket Server
const wss = new WebSocket.Server({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  
  ws.on('message', (message) => {
    // Your WebSocket logic here
    const data = JSON.parse(message);
    // Handle different message types
  });
  
  ws.on('close', () => {
    // Cleanup logic
  });
});

// For Vercel, we need to export the server
if (process.env.VERCEL) {
  // Export for Vercel serverless
  module.exports = app;
} else {
  // Local development
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
