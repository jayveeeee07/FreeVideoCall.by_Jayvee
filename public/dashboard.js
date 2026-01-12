class Dashboard {
    constructor() {
        this.auth = window.auth;
        this.init();
    }

    async init() {
        // Wait for auth to be ready
        if (!this.auth.currentUser) {
            await this.auth.checkAuth();
        }
        
        // Update user info
        this.updateUserInfo();
        
        // Load data
        await this.loadRooms();
        await this.loadContacts();
        
        // Setup event listeners
        this.setupEventListeners();
    }

    updateUserInfo() {
        if (this.auth.currentUser) {
            const userName = document.getElementById('userName');
            const userEmail = document.getElementById('userEmail');
            const userAvatar = document.getElementById('userAvatar');
            const joinUserName = document.getElementById('joinUserName');
            
            if (userName) userName.textContent = this.auth.currentUser.username;
            if (userEmail) userEmail.textContent = this.auth.currentUser.email;
            if (userAvatar) userAvatar.textContent = this.auth.getUserInitials(this.auth.currentUser.username);
            if (joinUserName) joinUserName.value = this.auth.currentUser.username;
        }
    }

    async loadRooms() {
        try {
            const response = await fetch('/api/rooms', {
                headers: this.auth.getAuthHeaders()
            });
            
            if (response.ok) {
                const data = await response.json();
                this.displayRooms(data.rooms);
            }
        } catch (error) {
            console.error('Error loading rooms:', error);
        }
    }

    async loadContacts() {
        try {
            const response = await fetch('/api/contacts', {
                headers: this.auth.getAuthHeaders()
            });
            
            if (response.ok) {
                const data = await response.json();
                this.displayContacts(data.contacts);
            }
        } catch (error) {
            console.error('Error loading contacts:', error);
        }
    }

    displayRooms(rooms) {
        const recentRooms = document.getElementById('recentRooms');
        const allRooms = document.getElementById('allRooms');
        
        if (!rooms || rooms.length === 0) {
            const noRooms = '<div class="no-rooms">No rooms yet. Create your first room!</div>';
            if (recentRooms) recentRooms.innerHTML = noRooms;
            if (allRooms) allRooms.innerHTML = noRooms;
            return;
        }
        
        const roomsHTML = rooms.map(room => this.createRoomCard(room)).join('');
        
        // Show only recent 4 rooms in dashboard
        const recentRoomsHTML = rooms.slice(0, 4).map(room => this.createRoomCard(room)).join('');
        
        if (recentRooms) recentRooms.innerHTML = recentRoomsHTML;
        if (allRooms) allRooms.innerHTML = roomsHTML;
    }

    createRoomCard(room) {
        const isPublic = room.is_public === 1;
        const badgeClass = isPublic ? 'public' : 'private';
        const badgeText = isPublic ? 'Public' : 'Private';
        
        return `
            <div class="room-card">
                <div class="room-header">
                    <h3 class="room-name">${room.name}</h3>
                    <span class="room-badge ${badgeClass}">${badgeText}</span>
                </div>
                ${room.description ? `<p class="room-description">${room.description}</p>` : ''}
                <div class="room-meta">
                    <span>👤 ${room.creator_name}</span>
                    <span>👥 ${room.max_participants} max</span>
                    <span>📅 ${new Date(room.created_at).toLocaleDateString()}</span>
                </div>
                <div class="room-actions">
                    <button class="room-btn join" onclick="dashboard.joinRoom('${room.room_id}')">
                        Join
                    </button>
                    <button class="room-btn copy" onclick="dashboard.copyRoomLink('${room.room_id}')">
                        Copy Link
                    </button>
                </div>
            </div>
        `;
    }

    displayContacts(contacts) {
        const contactsList = document.getElementById('contactsList');
        
        if (!contacts || contacts.length === 0) {
            contactsList.innerHTML = '<div class="no-contacts">No contacts yet. Add some friends!</div>';
            return;
        }
        
        const contactsHTML = contacts.map(contact => `
            <div class="contact-item">
                <div class="contact-avatar">${this.auth.getUserInitials(contact.username)}</div>
                <div class="contact-info">
                    <h4 class="contact-name">${contact.username}</h4>
                    <p class="contact-email">${contact.email || 'No email'}</p>
                </div>
                <div class="contact-status ${contact.is_online ? 'online' : 'offline'}"></div>
            </div>
        `).join('');
        
        contactsList.innerHTML = contactsHTML;
    }

    setupEventListeners() {
        // Navigation
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                this.showSection(section);
                
                // Update active nav link
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            });
        });

        // Create room button
        const createRoomBtn = document.getElementById('createRoomBtn');
        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                this.showCreateRoomModal();
            });
        }

        // Quick action buttons
        document.getElementById('quickJoinBtn')?.addEventListener('click', () => {
            this.showJoinRoomModal();
        });
        
        document.getElementById('quickCreateBtn')?.addEventListener('click', () => {
            this.showCreateRoomModal();
        });
        
        document.getElementById('quickContactsBtn')?.addEventListener('click', () => {
            this.showAddContactModal();
        });

        // Modal close buttons
        document.getElementById('closeCreateRoomModal')?.addEventListener('click', () => {
            this.hideCreateRoomModal();
        });
        
        document.getElementById('closeJoinRoomModal')?.addEventListener('click', () => {
            this.hideJoinRoomModal();
        });
        
        document.getElementById('closeAddContactModal')?.addEventListener('click', () => {
            this.hideAddContactModal();
        });

        // Create room form
        const createRoomForm = document.getElementById('createRoomForm');
        if (createRoomForm) {
            createRoomForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createRoom();
            });
        }

        // Join room button
        document.getElementById('joinRoomConfirmBtn')?.addEventListener('click', () => {
            this.joinRoom();
        });

        // Add contact button
        document.getElementById('addContactConfirmBtn')?.addEventListener('click', () => {
            this.addContact();
        });

        // Click outside modal to close
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
    }

    showSection(sectionId) {
        const sections = document.querySelectorAll('.content-section');
        sections.forEach(section => {
            section.classList.remove('active');
        });
        
        const targetSection = document.getElementById(`${sectionId}Section`);
        if (targetSection) {
            targetSection.classList.add('active');
            document.getElementById('pageTitle').textContent = 
                sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
        }
    }

    showCreateRoomModal() {
        document.getElementById('createRoomModal').classList.add('active');
    }

    hideCreateRoomModal() {
        document.getElementById('createRoomModal').classList.remove('active');
        document.getElementById('createRoomForm').reset();
    }

    showJoinRoomModal() {
        document.getElementById('joinRoomModal').classList.add('active');
    }

    hideJoinRoomModal() {
        document.getElementById('joinRoomModal').classList.remove('active');
        document.getElementById('joinRoomId').value = '';
    }

    showAddContactModal() {
        document.getElementById('addContactModal').classList.add('active');
    }

    hideAddContactModal() {
        document.getElementById('addContactModal').classList.remove('active');
        document.getElementById('contactUsername').value = '';
    }

    async createRoom() {
        const name = document.getElementById('roomName').value;
        const description = document.getElementById('roomDescription').value;
        const maxParticipants = document.getElementById('maxParticipants').value;
        const isPublic = document.getElementById('isPublic').checked;
        
        try {
            const response = await fetch('/api/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.auth.getAuthHeaders()
                },
                body: JSON.stringify({ 
                    name, 
                    description, 
                    isPublic, 
                    maxParticipants 
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.hideCreateRoomModal();
                alert(`Room created! Room ID: ${data.room.id}`);
                
                // Reload rooms
                await this.loadRooms();
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to create room');
            }
        } catch (error) {
            alert('Network error. Please try again.');
        }
    }

    joinRoom(roomId = null) {
        const roomIdInput = roomId || document.getElementById('joinRoomId').value;
        const userName = document.getElementById('joinUserName').value || this.auth.currentUser?.username;
        
        if (!roomIdInput) {
            alert('Please enter a room ID');
            return;
        }
        
        if (!userName) {
            alert('Please enter your name');
            return;
        }
        
        // Redirect to room
        window.location.href = `/room.html?room=${roomIdInput}&name=${encodeURIComponent(userName)}`;
    }

    async addContact() {
        const username = document.getElementById('contactUsername').value;
        
        if (!username) {
            alert('Please enter a username or email');
            return;
        }
        
        try {
            const response = await fetch('/api/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.auth.getAuthHeaders()
                },
                body: JSON.stringify({ username })
            });
            
            if (response.ok) {
                this.hideAddContactModal();
                alert('Contact request sent!');
                await this.loadContacts();
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to add contact');
            }
        } catch (error) {
            alert('Network error. Please try again.');
        }
    }

    copyRoomLink(roomId) {
        const roomLink = `${window.location.origin}/room.html?room=${roomId}`;
        navigator.clipboard.writeText(roomLink)
            .then(() => alert('Room link copied to clipboard!'))
            .catch(() => alert('Failed to copy link'));
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});
