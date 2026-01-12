// Configuration
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // For production, add TURN servers here
    ],
    sdpSemantics: 'unified-plan'
};

// Global variables
let localStream;
let peerConnections = {};
let ws;
let userName = '';
let roomId = '';
let userId = '';

// DOM Elements
const joinBtn = document.getElementById('joinBtn');
const userNameInput = document.getElementById('userName');
const roomIdInput = document.getElementById('roomId');

// Initialize
if (joinBtn) {
    joinBtn.addEventListener('click', joinRoom);
}

// Join room from home page
async function joinRoom() {
    userName = userNameInput.value.trim();
    roomId = roomIdInput.value.trim() || generateRoomId();
    
    if (!userName) {
        alert('Please enter your name');
        return;
    }
    
    // Store in localStorage
    localStorage.setItem('userName', userName);
    localStorage.setItem('roomId', roomId);
    
    // Redirect to room page
    window.location.href = `/room.html?room=${roomId}&name=${encodeURIComponent(userName)}`;
}

// Generate random room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Room page initialization
if (window.location.pathname.includes('room.html')) {
    initializeRoomPage();
}

async function initializeRoomPage() {
    // Get parameters
    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('room');
    userName = urlParams.get('name') || localStorage.getItem('userName') || 'User';
    
    // Update UI
    document.getElementById('roomName').textContent = `Room: ${roomId}`;
    document.getElementById('userNameDisplay').textContent = userName;
    
    // Initialize WebSocket
    initializeWebSocket();
    
    // Get local media
    await getLocalMedia();
    
    // Setup controls
    setupControls();
}

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({
            type: 'join-room',
            roomId,
            userName
        }));
    };
    
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await handleSignalingMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        alert('Connection lost. Please refresh the page.');
    };
}

async function getLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Display local video
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please check permissions.');
    }
}

async function handleSignalingMessage(data) {
    switch (data.type) {
        case 'room-joined':
            userId = data.userId;
            console.log('Joined room:', data.roomId, 'User ID:', userId);
            // Create peer connections for existing users
            data.existingUsers.forEach(user => createPeerConnection(user.id, user.userName));
            break;
            
        case 'user-joined':
            // New user joined, create peer connection
            createPeerConnection(data.userId, data.userName);
            break;
            
        case 'user-left':
            // User left, close connection
            removePeerConnection(data.userId);
            break;
            
        case 'offer':
            await handleOffer(data);
            break;
            
        case 'answer':
            await handleAnswer(data);
            break;
            
        case 'ice-candidate':
            await handleIceCandidate(data);
            break;
            
        case 'chat-message':
            displayChatMessage(data);
            break;
            
        case 'mute-audio':
        case 'mute-video':
        case 'screen-share':
            updateRemoteUserStatus(data);
            break;
    }
}

function createPeerConnection(targetUserId, targetUserName) {
    if (peerConnections[targetUserId]) {
        return;
    }
    
    console.log('Creating peer connection with:', targetUserId);
    
    const peerConnection = new RTCPeerConnection(config);
    peerConnections[targetUserId] = { pc: peerConnection, userName: targetUserName };
    
    // Add local stream tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                targetUserId,
                candidate: event.candidate
            }));
        }
    };
    
    // Handle remote stream
    peerConnection.ontrack = (event) => {
        const stream = event.streams[0];
        displayRemoteVideo(targetUserId, targetUserName, stream);
    };
    
    // Handle connection state
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${targetUserId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' || 
            peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'closed') {
            removePeerConnection(targetUserId);
        }
    };
    
    // Create and send offer if we're the initiator
    // (For simplicity, newest user creates offer to all existing users)
    if (userId && userId !== targetUserId) {
        createOffer(targetUserId);
    }
}

async function createOffer(targetUserId) {
    const peerConnection = peerConnections[targetUserId]?.pc;
    if (!peerConnection) return;
    
    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        
        ws.send(JSON.stringify({
            type: 'offer',
            targetUserId,
            offer
        }));
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

async function handleOffer(data) {
    const peerConnection = peerConnections[data.senderId]?.pc;
    if (!peerConnection) return;
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
            type: 'answer',
            targetUserId: data.senderId,
            answer
        }));
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(data) {
    const peerConnection = peerConnections[data.senderId]?.pc;
    if (!peerConnection) return;
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function handleIceCandidate(data) {
    const peerConnection = peerConnections[data.senderId]?.pc;
    if (!peerConnection) return;
    
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function displayRemoteVideo(userId, userName, stream) {
    // Remove existing video element for this user
    const existingVideo = document.getElementById(`remote-video-${userId}`);
    if (existingVideo) {
        existingVideo.remove();
    }
    
    // Create new video element
    const videoGrid = document.getElementById('videoGrid');
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    videoWrapper.id = `remote-video-wrapper-${userId}`;
    
    const video = document.createElement('video');
    video.id = `remote-video-${userId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const nameLabel = document.createElement('div');
    nameLabel.className = 'user-name';
    nameLabel.textContent = userName;
    
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(nameLabel);
    videoGrid.appendChild(videoWrapper);
}

function removePeerConnection(userId) {
    const peerConnection = peerConnections[userId]?.pc;
    if (peerConnection) {
        peerConnection.close();
    }
    delete peerConnections[userId];
    
    // Remove video element
    const videoWrapper = document.getElementById(`remote-video-wrapper-${userId}`);
    if (videoWrapper) {
        videoWrapper.remove();
    }
}

function setupControls() {
    // Mute/unmute audio
    document.getElementById('muteAudio').addEventListener('click', () => {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('muteAudio');
            btn.classList.toggle('muted', !audioTrack.enabled);
            btn.innerHTML = audioTrack.enabled ? '🎤' : '🔇';
            
            // Notify others
            ws.send(JSON.stringify({
                type: 'mute-audio',
                muted: !audioTrack.enabled,
                userId
            }));
        }
    });
    
    // Enable/disable video
    document.getElementById('muteVideo').addEventListener('click', () => {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('muteVideo');
            btn.classList.toggle('muted', !videoTrack.enabled);
            btn.innerHTML = videoTrack.enabled ? '📹' : '🚫';
            
            // Notify others
            ws.send(JSON.stringify({
                type: 'mute-video',
                muted: !videoTrack.enabled,
                userId
            }));
        }
    });
    
    // Screen sharing
    let screenStream = null;
    document.getElementById('screenShare').addEventListener('click', async () => {
        try {
            if (!screenStream) {
                // Start screen sharing
                screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: true
                });
                
                // Replace video track in all peer connections
                const screenTrack = screenStream.getVideoTracks()[0];
                const localVideoTrack = localStream.getVideoTracks()[0];
                
                Object.values(peerConnections).forEach(({ pc }) => {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(screenTrack);
                    }
                });
                
                // Update local video display
                document.getElementById('localVideo').srcObject = screenStream;
                
                // Update button
                const btn = document.getElementById('screenShare');
                btn.classList.add('screen-sharing');
                btn.innerHTML = '🖥️';
                
                // Notify others
                ws.send(JSON.stringify({
                    type: 'screen-share',
                    sharing: true,
                    userId
                }));
                
                // Handle screen sharing stop
                screenTrack.onended = () => {
                    screenStream = null;
                    const btn = document.getElementById('screenShare');
                    btn.classList.remove('screen-sharing');
                    btn.innerHTML = '📤';
                    
                    // Revert to camera
                    Object.values(peerConnections).forEach(({ pc }) => {
                        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                        if (sender && localVideoTrack) {
                            sender.replaceTrack(localVideoTrack);
                        }
                    });
                    
                    document.getElementById('localVideo').srcObject = localStream;
                    
                    ws.send(JSON.stringify({
                        type: 'screen-share',
                        sharing: false,
                        userId
                    }));
                };
            } else {
                // Stop screen sharing
                screenStream.getTracks().forEach(track => track.stop());
                screenStream = null;
            }
        } catch (error) {
            console.error('Error sharing screen:', error);
        }
    });
    
    // Hang up
    document.getElementById('hangUp').addEventListener('click', () => {
        if (confirm('End the call for everyone?')) {
            // Close all connections
            Object.keys(peerConnections).forEach(userId => {
                removePeerConnection(userId);
            });
            
            // Stop local stream
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            
            // Close WebSocket
            if (ws) {
                ws.close();
            }
            
            // Redirect to home
            window.location.href = '/';
        }
    });
    
    // Chat functionality
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChat');
    
    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (message && ws) {
        ws.send(JSON.stringify({
            type: 'chat-message',
            message,
            userName
        }));
        chatInput.value = '';
    }
}

function displayChatMessage(data) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${data.userId === userId ? 'self' : ''}`;
    
    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageDiv.innerHTML = `
        <strong>${data.userName}</strong> <small>${time}</small>
        <p>${data.message}</p>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateRemoteUserStatus(data) {
    const videoWrapper = document.getElementById(`remote-video-wrapper-${data.userId}`);
    if (videoWrapper) {
        const nameLabel = videoWrapper.querySelector('.user-name');
        let status = '';
        
        if (data.type === 'mute-audio' && data.muted) {
            status += ' 🔇';
        }
        if (data.type === 'mute-video' && data.muted) {
            status += ' 🚫';
        }
        if (data.type === 'screen-share' && data.sharing) {
            status += ' 🖥️';
        }
        
        nameLabel.textContent = peerConnections[data.userId]?.userName + status;
    }
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});
