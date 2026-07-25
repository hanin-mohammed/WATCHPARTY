// ui.js
import { settings } from './settings.js';
import { formatBytes } from './utils.js';

export class UIManager {
    constructor(roomManager, socketManager) {
        this.roomManager = roomManager;
        this.socket = socketManager;

        // Dashboard
        this.dashboardScreen = document.getElementById('dashboard');
        this.appScreen = document.getElementById('app');
        this.joinForm = document.getElementById('join-form');
        this.usernameInput = document.getElementById('username');
        this.roomIdInput = document.getElementById('room-id');
        this.roomPasswordInput = document.getElementById('room-password');
        this.colorOptionsContainer = document.getElementById('color-options');
        
        // Sidebar
        this.userListEl = document.getElementById('user-list');
        this.userCountEl = document.getElementById('user-count');
        this.hostControlsEl = document.getElementById('host-controls');
        this.collabCheckbox = document.getElementById('collab-mode-checkbox');

        // Modals
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.closeSettingsBtn = document.getElementById('close-settings');
        this.subDelayInput = document.getElementById('sub-delay');
        this.subSizeInput = document.getElementById('sub-size');

        this.hashWarningModal = document.getElementById('hash-warning-modal');
        this.hostHashDisplay = document.getElementById('host-hash-display');
        this.localHashDisplay = document.getElementById('local-hash-display');
        this.acceptMismatchBtn = document.getElementById('accept-mismatch');

        this.selectedColor = settings.get('color');

        this.setupDashboard();
        this.setupSettings();
        this.setupRoomListeners();
    }

    setupDashboard() {
        this.usernameInput.value = settings.get('username') || '';
        this.roomIdInput.value = settings.get('lastRoomId') || '';

        // Generate color options
        const colors = ['#4a8cff', '#ff4a4a', '#00e676', '#ffb74d', '#9c27b0', '#00bcd4'];
        if (!colors.includes(this.selectedColor)) this.selectedColor = colors[0];

        colors.forEach(color => {
            const el = document.createElement('div');
            el.className = 'color-swatch' + (this.selectedColor === color ? ' selected' : '');
            el.style.backgroundColor = color;
            el.addEventListener('click', () => {
                document.querySelectorAll('.color-swatch').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
                this.selectedColor = color;
            });
            this.colorOptionsContainer.appendChild(el);
        });

        this.joinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = this.usernameInput.value.trim();
            const roomId = this.roomIdInput.value.trim() || Math.random().toString(36).substr(2, 8).toUpperCase();
            const password = this.roomPasswordInput.value;

            settings.set('username', username);
            settings.set('color', this.selectedColor);
            settings.set('lastRoomId', roomId);

            this.socket.connect();
            this.socket.on('connected', () => {
                this.socket.send('join_room', {
                    roomId,
                    password,
                    username,
                    color: this.selectedColor
                });
            });
        });
    }

    setupSettings() {
        this.subDelayInput.value = settings.get('subtitleDelay');
        this.subSizeInput.value = settings.get('subtitleSize');

        this.settingsBtn.addEventListener('click', () => {
            this.settingsModal.classList.remove('hidden');
        });

        this.closeSettingsBtn.addEventListener('click', () => {
            this.settingsModal.classList.add('hidden');
        });

        this.subDelayInput.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val)) {
                // Dispatch event so SubtitleManager can pick it up
                const evt = new CustomEvent('settingsChanged', { detail: { key: 'subtitleDelay', value: val } });
                document.dispatchEvent(evt);
            }
        });

        this.subSizeInput.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val)) {
                settings.set('subtitleSize', val);
                const evt = new CustomEvent('settingsChanged', { detail: { key: 'subtitleSize', value: val } });
                document.dispatchEvent(evt);
            }
        });

        this.acceptMismatchBtn.addEventListener('click', () => {
            this.hashWarningModal.classList.add('hidden');
        });
    }

    setupRoomListeners() {
        this.socket.on('room_joined', () => {
            this.dashboardScreen.classList.remove('active');
            this.appScreen.classList.add('active');
            this.renderUserList();
        });

        this.socket.on('room_state_change', (data) => {
            this.renderUserList();
            
            if (this.roomManager.isHost()) {
                this.hostControlsEl.classList.remove('hidden');
                this.collabCheckbox.checked = this.roomManager.collaborative;
            } else {
                this.hostControlsEl.classList.add('hidden');
            }
        });

        this.collabCheckbox.addEventListener('change', (e) => {
            if (this.roomManager.isHost()) {
                this.socket.send('set_collaborative', { collaborative: e.target.checked });
            }
        });

        this.socket.on('hash_mismatch', (data) => {
            this.hostHashDisplay.textContent = data.hostHash.substring(0, 16) + '...';
            this.localHashDisplay.textContent = data.localHash.substring(0, 16) + '...';
            this.hashWarningModal.classList.remove('hidden');
        });
        
        // Listen to UI-specific file loading events to trigger room state updates
        document.addEventListener('fileLoaded', (e) => {
            // Player fires this. It's a CustomEvent on its own target, 
            // so we should pass that via main.js or bind directly.
            // handled in main.js
        });
    }

    renderUserList() {
        this.userListEl.innerHTML = '';
        const users = Array.from(this.roomManager.users.values());
        this.userCountEl.textContent = users.length;

        // Sort: Host first, then me, then others by name
        users.sort((a, b) => {
            if (a.id === this.roomManager.hostId) return -1;
            if (b.id === this.roomManager.hostId) return 1;
            if (a.id === this.roomManager.myId) return -1;
            if (b.id === this.roomManager.myId) return 1;
            return a.username.localeCompare(b.username);
        });

        users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'user-item';

            const isHost = user.id === this.roomManager.hostId;
            const isMe = user.id === this.roomManager.myId;

            let statusText = [];
            if (user.buffering) statusText.push('Buffering');
            else if (user.videoHash) statusText.push('Ready');
            else statusText.push('No video');

            if (user.latency > 0) statusText.push(`${user.latency}ms`);
            
            // Sync offset if not host
            if (!isHost && user.videoHash && user.syncOffset !== undefined) {
                statusText.push(`${Math.abs(user.syncOffset)}ms offset`);
            }

            li.innerHTML = `
                <div class="user-avatar" style="background-color: ${user.color}">
                    ${user.username.charAt(0).toUpperCase()}
                </div>
                <div class="user-details">
                    <div class="user-name">
                        ${this.escapeHtml(user.username)} ${isMe ? '(You)' : ''}
                        ${isHost ? '<span class="host-badge">HOST</span>' : ''}
                    </div>
                    <div class="user-status">${statusText.join(' • ')}</div>
                </div>
            `;
            
            // Add transfer host button if we are host and it's someone else
            if (this.roomManager.isHost() && !isMe) {
                const btn = document.createElement('button');
                btn.className = 'icon-btn';
                btn.title = 'Make Host';
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`;
                btn.addEventListener('click', () => {
                    this.socket.send('transfer_host', { newHostId: user.id });
                });
                li.appendChild(btn);
            }

            this.userListEl.appendChild(li);
        });
    }

    escapeHtml(unsafe) {
        return (unsafe||'')
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
}
