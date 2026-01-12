class Auth {
    constructor() {
        this.currentUser = null;
        this.token = null;
        this.init();
    }

    async init() {
        // Check if user is logged in
        await this.checkAuth();
        
        // Setup event listeners
        this.setupEventListeners();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/me', {
                headers: this.getAuthHeaders()
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.token = this.getCookie('token');
                
                // If on login page, redirect to dashboard
                if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
                    window.location.href = '/dashboard';
                }
                return true;
            }
        } catch (error) {
            console.log('Not authenticated');
        }
        
        // If on dashboard without auth, redirect to login
        if (window.location.pathname.includes('dashboard') || 
            window.location.pathname.includes('room')) {
            window.location.href = '/';
        }
        return false;
    }

    getAuthHeaders() {
        const token = this.token || this.getCookie('token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    getCookie(name) {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [key, value] = cookie.trim().split('=');
            if (key === name) return decodeURIComponent(value);
        }
        return null;
    }

    setupEventListeners() {
        // Tab switching
        const tabs = document.querySelectorAll('.auth-tab');
        const forms = document.querySelectorAll('.auth-form');
        
        if (tabs.length > 0) {
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const tabName = tab.dataset.tab;
                    
                    // Update active tab
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    
                    // Show corresponding form
                    forms.forEach(form => {
                        form.classList.remove('active');
                        if (form.id === `${tabName}Form`) {
                            form.classList.add('active');
                        }
                    });
                });
            });
        }

        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        // Register form
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.register();
            });
        }

        // Guest button
        const guestBtn = document.getElementById('guestBtn');
        if (guestBtn) {
            guestBtn.addEventListener('click', () => {
                this.joinAsGuest();
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }
    }

    async login() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        // Clear previous errors
        this.clearErrors('login');
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showSuccess('Login successful! Redirecting...');
                this.currentUser = data.user;
                this.token = this.getCookie('token');
                
                // Redirect after delay
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 1500);
            } else {
                this.showError('login', data.error || 'Login failed');
            }
        } catch (error) {
            this.showError('login', 'Network error. Please try again.');
        }
    }

    async register() {
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('registerConfirmPassword').value;
        
        // Clear previous errors
        this.clearErrors('register');
        
        // Validation
        if (password !== confirmPassword) {
            this.showError('register', 'Passwords do not match', 'registerConfirmPassword');
            return;
        }
        
        if (password.length < 6) {
            this.showError('register', 'Password must be at least 6 characters', 'registerPassword');
            return;
        }
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showSuccess('Registration successful! Please login.');
                
                // Switch to login tab
                document.querySelector('.auth-tab[data-tab="login"]').click();
                document.getElementById('loginEmail').value = email;
                document.getElementById('loginPassword').value = '';
            } else {
                this.showError('register', data.error || 'Registration failed');
            }
        } catch (error) {
            this.showError('register', 'Network error. Please try again.');
        }
    }

    joinAsGuest() {
        const userName = `Guest_${Math.floor(Math.random() * 10000)}`;
        const roomId = this.generateRoomId();
        
        // Store guest data in localStorage
        localStorage.setItem('guestUser', JSON.stringify({
            userName,
            roomId,
            isGuest: true
        }));
        
        // Redirect to room
        window.location.href = `/room.html?room=${roomId}&name=${encodeURIComponent(userName)}&guest=true`;
    }

    async logout() {
        try {
            await fetch('/api/logout', { method: 'POST' });
            this.currentUser = null;
            this.token = null;
            window.location.href = '/';
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    showError(formType, message, field = null) {
        if (field) {
            const errorElement = document.getElementById(`${field}Error`);
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.style.display = 'block';
            }
        } else {
            // Show general error
            const errorId = `${formType}${field ? field : ''}Error`;
            let errorElement = document.getElementById(errorId);
            
            if (!errorElement) {
                // Create error element
                errorElement = document.createElement('div');
                errorElement.className = 'error-message';
                errorElement.id = errorId;
                
                const form = document.getElementById(`${formType}Form`);
                if (form) {
                    form.insertBefore(errorElement, form.firstChild);
                }
            }
            
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    clearErrors(formType) {
        const errors = document.querySelectorAll(`#${formType}Form .error-message`);
        errors.forEach(error => error.style.display = 'none');
    }

    showSuccess(message) {
        const successElement = document.getElementById('successMessage');
        if (successElement) {
            successElement.textContent = message;
            successElement.style.display = 'block';
            setTimeout(() => {
                successElement.style.display = 'none';
            }, 3000);
        }
    }

    generateRoomId() {
        return Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    getUserInitials(name) {
        return name ? name.charAt(0).toUpperCase() : 'U';
    }
}

// Initialize auth
const auth = new Auth();
