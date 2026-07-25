import re

content = """// ui.js
import { settings } from './settings.js';
import { formatBytes } from './utils.js';

export class UIManager {
    constructor(roomManager, socketManager) {
        this.roomManager = roomManager;
        this.socket = socketManager;

        // Dashboard
        this.flowContainer = document.getElementById('flow-container');
        this.appScreen = document.getElementById('app');
        
        // Steps
        this.stepUser = document.getElementById('step-user');
        this.stepRole = document.getElementById('step-role');
        this.stepJoin = document.getElementById('step-join');
        this.stepPassword = document.getElementById('step-password');
        
        // Flow state
        this.selectedUser = '';
        this.role = ''; // 'host' or 'join'
        this.roomId = '';
        
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

        this.setupFlow();
        this.setupSettings();
        this.setupRoomListeners();
    }

    showStep(stepEl) {
        [this.stepUser, this.stepRole, this.stepJoin, this.stepPassword].forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('active');
        });
        stepEl.classList.remove('hidden');
        stepEl.classList.add('active');
    }

    setupFlow() {
        // Step 1: User
        document.querySelectorAll('.user-card').forEach(card => {
            card.addEventListener('click', () => {
                this.selectedUser = card.dataset.user;
                document.body.className = 'theme-' + this.selectedUser.toLowerCase();
                this.showStep(this.stepRole);
            });
        });

        // Step 2: Role
        document.getElementById('btn-host').addEventListener('click', () => {
            this.role = 'host';
            this.roomId = 'HNC-' + Math.random().toString(36).substr(2, 4).toUpperCase();
            document.getElementById('host-room-code-display').classList.remove('hidden');
            document.getElementById('host-code-value').textContent = this.roomId;
            this.showStep(this.stepPassword);
            document.querySelector('.pwd-digit[data-index="0"]').focus();
        });

        document.getElementById('btn-join').addEventListener('click', () => {
            this.role = 'join';
            this.showStep(this.stepJoin);
            document.getElementById('join-room-code').focus();
        });

        // Step 3: Join
        document.getElementById('btn-back-from-join').addEventListener('click', () => {
            this.showStep(this.stepRole);
        });

        document.getElementById('btn-submit-join').addEventListener('click', () => {
            const code = document.getElementById('join-room-code').value.trim();
            if (code.length > 0) {
                this.roomId = code;
                document.getElementById('host-room-code-display').classList.add('hidden');
                this.showStep(this.stepPassword);
                document.querySelector('.pwd-digit[data-index="0"]').focus();
            }
        });

        // Step 4: Password
        document.getElementById('btn-back-from-password').addEventListener('click', () => {
            // clear password inputs
            document.querySelectorAll('.pwd-digit').forEach(input => {
                input.value = '';
                input.classList.remove('filled');
            });
            if (this.role === 'host') {
                this.showStep(this.stepRole);
            } else {
                this.showStep(this.stepJoin);
            }
        });

        const digits = Array.from(document.querySelectorAll('.pwd-digit'));
        digits.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                if (input.value.length === 1) {
                    input.classList.add('filled');
                    if (idx < digits.length - 1) {
                        digits[idx + 1].focus();
                    } else {
                        this.validatePassword();
                    }
                } else {
                    input.classList.remove('filled');
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && input.value === '') {
                    if (idx > 0) {
                        digits[idx - 1].focus();
                        digits[idx - 1].value = '';
                        digits[idx - 1].classList.remove('filled');
                    }
                }
            });
        });
    }

    validatePassword() {
        const pwd = Array.from(document.querySelectorAll('.pwd-digit')).map(i => i.value).join('');
        if (pwd === '301025') {
            settings.set('username', this.selectedUser);
            settings.set('lastRoomId', this.roomId);
            
            // Adding a small delay for the success animation feel
            setTimeout(() => {
                this.socket.connect();
                this.socket.on('connected', () => {
                    this.socket.send('join_room', {
                        roomId: this.roomId,
                        password: pwd,
                        username: this.selectedUser,
                        color: this.selectedUser === 'Hanin' ? '#6699ff' : '#9966ff'
                    });
                });
            }, 300);
        } else {
            // Shake effect or error
            const container = document.querySelector('.password-digits');
            container.style.transform = 'translateX(-10px)';
            setTimeout(() => container.style.transform = 'translateX(10px)', 100);
            setTimeout(() => container.style.transform = 'translateX(-10px)', 200);
            setTimeout(() => container.style.transform = 'translateX(0)', 300);
            
            Array.from(document.querySelectorAll('.pwd-digit')).forEach(input => {
                input.value = '';
                input.classList.remove('filled');
            });
            document.querySelector('.pwd-digit[data-index="0"]').focus();
        }
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
            this.flowContainer.classList.remove('active');
            this.appScreen.classList.add('active');
            document.getElementById('current-room-id').textContent = this.roomId;
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
        
        document.addEventListener('fileLoaded', (e) => {});
    }

    renderUserList() {
        this.userListEl.innerHTML = '';
        const users = Array.from(this.roomManager.users.values());
        this.userCountEl.textContent = users.length;

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
            
            if (!isHost && user.videoHash && user.syncOffset !== undefined) {
                statusText.push(`${Math.abs(user.syncOffset)}ms offset`);
            }
            
            // Assume the username is Hanin or Manha
            const avatarSrc = `/assets/avatars/${user.username}.png`;

            li.innerHTML = `
                <div class="user-avatar">
                    <img src="${avatarSrc}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\'/%3E'">
                </div>
                <div class="user-details">
                    <div class="user-name">
                        ${this.escapeHtml(user.username)} ${isMe ? '(You)' : ''}
                        ${isHost ? '<span class="host-badge">HOST</span>' : ''}
                    </div>
                    <div class="user-status">${statusText.join(' • ')}</div>
                </div>
            `;
            
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
"""

with open('public/js/ui.js', 'w') as f:
    f.write(content)

