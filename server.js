const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active rooms and users
const rooms = new Map();

app.use(express.static('public'));

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  ws.roomId = null;

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    handleMessage(ws, data);
  });

  ws.on('close', () => {
    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      room.users = room.users.filter(user => user.id !== ws.id);
      
      // Notify other users
      broadcastToRoom(ws.roomId, {
        type: 'user-left',
        userId: ws.id
      }, ws);

      // Remove room if empty
      if (room.users.length === 0) {
        rooms.delete(ws.roomId);
      }
    }
  });
});

function handleMessage(ws, data) {
  switch (data.type) {
    case 'join-room':
      joinRoom(ws, data.roomId, data.userName);
      break;
    case 'offer':
    case 'answer':
    case 'ice-candidate':
      forwardMessage(ws, data);
      break;
    case 'chat-message':
      broadcastToRoom(ws.roomId, {
        type: 'chat-message',
        userId: ws.id,
        userName: data.userName,
        message: data.message,
        timestamp: new Date().toISOString()
      });
      break;
    case 'mute-audio':
    case 'mute-video':
    case 'screen-share':
      broadcastToRoom(ws.roomId, data, ws);
      break;
  }
}

function joinRoom(ws, roomId, userName) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: [],
      createdAt: new Date()
    });
  }

  const room = rooms.get(roomId);
  const user = { id: ws.id, userName, ws };
  room.users.push(user);
  
  ws.roomId = roomId;
  ws.userName = userName;

  // Send existing users to the new user
  const existingUsers = room.users
    .filter(user => user.id !== ws.id)
    .map(user => ({ id: user.id, userName: user.userName }));

  ws.send(JSON.stringify({
    type: 'room-joined',
    roomId,
    userId: ws.id,
    existingUsers
  }));

  // Notify others about new user
  broadcastToRoom(roomId, {
    type: 'user-joined',
    userId: ws.id,
    userName
  }, ws);
}

function forwardMessage(sender, data) {
  const room = rooms.get(sender.roomId);
  if (!room) return;

  const targetUser = room.users.find(user => user.id === data.targetUserId);
  if (targetUser) {
    targetUser.ws.send(JSON.stringify({
      ...data,
      senderId: sender.id
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
