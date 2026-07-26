// ui.js
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
        this.isJoining = false;
        
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

        this.themeToggleBtn = document.getElementById('theme-toggle');

        this.setupTheme();
        this.setupFlow();
        this.setupSettings();
        this.setupRoomListeners();
        this.setupSidebarTabs();
    }

    setupSidebarTabs() {
        const tabParticipants = document.getElementById('tab-participants');
        const tabChat = document.getElementById('tab-chat');
        const paneParticipants = document.getElementById('pane-participants');
        const paneChat = document.getElementById('pane-chat');

        if (tabParticipants && tabChat) {
            tabParticipants.addEventListener('click', () => {
                tabParticipants.classList.add('active');
                tabChat.classList.remove('active');
                paneParticipants.style.display = 'flex';
                paneChat.style.display = 'none';
            });
            tabChat.addEventListener('click', () => {
                tabChat.classList.add('active');
                tabParticipants.classList.remove('active');
                paneParticipants.style.display = 'none';
                paneChat.style.display = 'flex';
                // Scroll chat to bottom when switching
                const chatContainer = document.getElementById('sidebar-chat-messages');
                if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
            });
        }
    }

    setupTheme() {
        if (settings.get('darkMode')) {
            document.documentElement.classList.add('dark-mode');
        }
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => {
                const isDark = document.documentElement.classList.toggle('dark-mode');
                settings.set('darkMode', isDark);
            });
        }
    }

    showStep(stepEl) {
        [this.stepUser, this.stepRole, this.stepJoin, this.stepPassword].forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('active');
        });
        stepEl.classList.remove('hidden');
        stepEl.classList.add('active');
    }

    resetPasswordInputs() {
        this.isJoining = false;
        document.querySelectorAll('.pwd-digit').forEach(input => {
            input.disabled = false;
            input.value = '';
            input.classList.remove('filled');
        });
    }

    setupFlow() {
        // Step 1: User
        document.querySelectorAll('.user-card').forEach(card => {
            card.addEventListener('click', () => {
                this.selectedUser = card.dataset.user;
                // Remove existing theme classes safely
                document.body.classList.forEach(cls => {
                    if (cls.startsWith('theme-')) {
                        document.body.classList.remove(cls);
                    }
                });
                document.body.classList.add('theme-' + this.selectedUser.toLowerCase());
                this.showStep(this.stepRole);
            });
        });

        // Step 2: Role
        document.getElementById('btn-back-from-role').addEventListener('click', () => {
            this.showStep(this.stepUser);
        });

        document.getElementById('btn-host').addEventListener('click', () => {
            this.role = 'host';
            this.roomId = 'HNC-' + Math.random().toString(36).substr(2, 4).toUpperCase();
            document.getElementById('host-room-code-display').classList.remove('hidden');
            document.getElementById('host-code-value').textContent = this.roomId;
            this.showStep(this.stepPassword);
            this.resetPasswordInputs();
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
                this.resetPasswordInputs();
                document.querySelector('.pwd-digit[data-index="0"]').focus();
            }
        });

        // Step 4: Password
        document.getElementById('btn-back-from-password').addEventListener('click', () => {
            this.resetPasswordInputs();
            if (this.role === 'host') {
                this.showStep(this.stepRole);
            } else {
                this.showStep(this.stepJoin);
            }
        });

        const digits = Array.from(document.querySelectorAll('.pwd-digit'));
        digits.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                if (this.isJoining) return;
                if (input.value.length === 1) {
                    input.classList.add('filled');
                    if (idx < digits.length - 1) {
                        digits[idx + 1].focus();
                    } else {
                        input.blur();
                        this.validatePassword();
                    }
                } else {
                    input.classList.remove('filled');
                }
            });

            input.addEventListener('keydown', (e) => {
                if (this.isJoining) return;
                if (e.key === 'Backspace' && input.value === '') {
                    if (idx > 0) {
                        digits[idx - 1].focus();
                        digits[idx - 1].value = '';
                        digits[idx - 1].classList.remove('filled');
                    }
                }
            });

            input.addEventListener('paste', (e) => {
                if (this.isJoining) return;
                const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
                if (/^\d{6}$/.test(pasteData)) {
                    e.preventDefault();
                    digits.forEach((d, i) => {
                        d.value = pasteData[i];
                        d.classList.add('filled');
                    });
                    digits[digits.length - 1].blur();
                    this.validatePassword();
                }
            });
        });
    }

    validatePassword() {
        if (this.isJoining) return;
        this.isJoining = true;

        const pwd = Array.from(document.querySelectorAll('.pwd-digit')).map(i => i.value).join('');

        document.querySelectorAll('.pwd-digit').forEach(input => {
            input.disabled = true;
            input.blur();
        });
        
        settings.set('username', this.selectedUser);
        settings.set('lastRoomId', this.roomId);
        
        // Adding a small delay for the success animation feel
        setTimeout(() => {
            const joinPayload = {
                roomId: this.roomId,
                password: pwd,
                username: this.selectedUser,
                color: this.selectedUser === 'Hanin' ? '#6699ff' : '#9966ff'
            };
            
            // Handle incorrect password from server
            this.socket.on('error', (data) => {
                if (data.message === 'Incorrect room password.') {
                    // Shake effect or error
                    const container = document.querySelector('.password-digits');
                    container.style.transform = 'translateX(-10px)';
                    setTimeout(() => container.style.transform = 'translateX(10px)', 100);
                    setTimeout(() => container.style.transform = 'translateX(-10px)', 200);
                    setTimeout(() => container.style.transform = 'translateX(0)', 300);
                    
                    this.resetPasswordInputs();
                    document.querySelector('.pwd-digit[data-index="0"]').focus();
                }
            });

            if (this.socket.ws && this.socket.ws.readyState === 1) {
                this.socket.send('join_room', joinPayload);
            } else {
                this.socket.connect();
                // clear previous connected listeners to avoid multiple triggers
                if (this.socket.handlers && this.socket.handlers.has('connected')) {
                    this.socket.handlers.set('connected', []);
                }
                this.socket.on('connected', () => {
                    this.socket.send('join_room', joinPayload);
                });
            }
        }, 300);
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

        this.leaveRoomBtn = document.getElementById('leave-room-btn');
        if (this.leaveRoomBtn) {
            this.leaveRoomBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to leave the room?')) {
                    window.location.reload();
                }
            });
        }

        this.readyToggleBtn = document.getElementById('ready-toggle-btn');
        if (this.readyToggleBtn) {
            this.readyToggleBtn.addEventListener('click', () => {
                const current = this.roomManager.localState.isReady;
                this.roomManager.updateLocalState({ isReady: !current });
                this.readyToggleBtn.textContent = !current ? 'Ready' : 'Not Ready';
                this.readyToggleBtn.style.background = !current ? 'var(--success)' : 'var(--warning)';

                // Unlock video for Safari autoplay
                const video = document.getElementById('video-element');
                if (video && video.src && video.paused) {
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            video.pause();
                        }).catch(() => {
                            // ignore
                        });
                    }
                }
            });
        }
    }

    setupRoomListeners() {
        this.socket.on('room_joined', () => {
            this.isJoining = false;
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
            else if (user.videoHash) {
                if (user.isReady) statusText.push('Ready');
                else statusText.push('Loaded (Not Ready)');
            }
            else statusText.push('No video');

            if (user.latency > 0) statusText.push(`${user.latency}ms`);
            
            if (!isHost && user.videoHash && user.syncOffset !== undefined) {
                statusText.push(`${Math.abs(user.syncOffset)}ms offset`);
            }
            
            // Assume the username is Hanin or Manha
            const avatarSrc = `/assets/avatars/${user.username}.png`;

            li.innerHTML = `
                <div class="user-avatar">
                    <img src="${avatarSrc}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E'">
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
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'user-actions';
                actionsDiv.style.display = 'flex';
                actionsDiv.style.gap = '6px';

                const btnHost = document.createElement('button');
                btnHost.className = 'icon-btn';
                btnHost.title = 'Make Host';
                btnHost.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`;
                btnHost.addEventListener('click', () => {
                    this.socket.send('transfer_host', { newHostId: user.id });
                });
                actionsDiv.appendChild(btnHost);

                const btnRemove = document.createElement('button');
                btnRemove.className = 'icon-btn remove-user-btn';
                btnRemove.title = 'Remove User';
                btnRemove.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="18" y1="8" x2="23" y2="13"></line><line x1="23" y1="8" x2="18" y2="13"></line></svg>`;
                btnRemove.addEventListener('click', () => {
                    if (confirm(`Are you sure you want to remove ${user.username} from the room?`)) {
                        this.socket.send('remove_user', { targetUserId: user.id });
                    }
                });
                actionsDiv.appendChild(btnRemove);

                li.appendChild(actionsDiv);
            }

            this.userListEl.appendChild(li);
        });

        if (this.readyToggleBtn) {
            this.readyToggleBtn.style.display = this.roomManager.localState.videoHash ? 'inline-block' : 'none';
        }
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
