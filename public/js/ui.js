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
        this.stepStickers = document.getElementById('step-stickers');
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
        this.setupWindowResizeListener();
        this.setupVisibilityListener();
    }

    getOrCreateUserId() {
        let uid = sessionStorage.getItem('syncparty_userId');
        if (!uid) {
            uid = 'user-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
            sessionStorage.setItem('syncparty_userId', uid);
        }
        return uid;
    }

    rejoinRoom() {
        if (!this.lastJoinPayload || !this.roomManager.roomId) return;
        this.lastJoinPayload.videoHash = this.roomManager.localState.videoHash || null;
        this.lastJoinPayload.videoSize = this.roomManager.localState.videoSize || null;
        this.lastJoinPayload.readyState = this.roomManager.localState.readyState || 'not_ready';
        this.lastJoinPayload.isReady = this.roomManager.localState.isReady || false;
        this.lastJoinPayload.subtitleLoaded = this.roomManager.localState.subtitleLoaded || false;
        this.socket.send('join_room', this.lastJoinPayload);
    }

    setupVisibilityListener() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (this.socket && (!this.socket.ws || this.socket.ws.readyState !== 1)) {
                    this.socket.connect();
                } else if (this.socket && this.socket.ws && this.socket.ws.readyState === 1 && this.lastJoinPayload && this.roomManager.roomId) {
                    this.rejoinRoom();
                }
            }
        });
    }

    setupWindowResizeListener() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const chatContainer = document.getElementById('sidebar-chat-messages');
                const tabChat = document.getElementById('tab-chat');
                if (chatContainer && tabChat && tabChat.classList.contains('active')) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }, 100);
        });
    }

    setupSidebarTabs() {
        const tabParticipants = document.getElementById('tab-participants');
        const tabChat = document.getElementById('tab-chat');
        const sidebarTabs = document.querySelector('.sidebar-tabs');
        const panesContainer = document.getElementById('sidebar-panes-container');
        const paneParticipants = document.getElementById('pane-participants');
        const paneChat = document.getElementById('pane-chat');

        if (tabParticipants && tabChat && panesContainer) {
            tabParticipants.addEventListener('click', () => {
                tabParticipants.classList.add('active');
                tabChat.classList.remove('active');
                if (sidebarTabs) sidebarTabs.classList.remove('chat-active');
                panesContainer.classList.remove('show-chat');
                if (paneParticipants) paneParticipants.classList.add('active');
                if (paneChat) paneChat.classList.remove('active');
            });

            tabChat.addEventListener('click', () => {
                tabChat.classList.add('active');
                tabParticipants.classList.remove('active');
                if (sidebarTabs) sidebarTabs.classList.add('chat-active');
                panesContainer.classList.add('show-chat');
                if (paneChat) paneChat.classList.add('active');
                if (paneParticipants) paneParticipants.classList.remove('active');
                // Scroll chat to bottom when switching
                setTimeout(() => {
                    const chatContainer = document.getElementById('sidebar-chat-messages');
                    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
                }, 50);
            });
        }
    }

    setupTheme() {
        if (settings.get('darkMode')) {
            document.documentElement.classList.add('dark-mode');
        }
        const toggleHandler = () => {
            const isDark = document.documentElement.classList.toggle('dark-mode');
            settings.set('darkMode', isDark);
        };
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', toggleHandler);
        }
        const welcomeToggle = document.getElementById('welcome-theme-toggle');
        if (welcomeToggle) {
            welcomeToggle.addEventListener('click', toggleHandler);
        }
    }

    showStep(stepEl) {
        [this.stepUser, this.stepStickers, this.stepPassword].forEach(el => {
            if (el) {
                el.classList.add('hidden');
                el.classList.remove('active');
            }
        });
        const flowPanel = document.getElementById('flow-panel');
        const windowTitle = document.querySelector('#flow-panel .window-title');
        if (stepEl === this.stepStickers) {
            if (flowPanel) flowPanel.classList.add('scrapbook-mode');
            if (windowTitle && this.selectedUser) {
                windowTitle.textContent = `${this.selectedUser}'s Scrapbook`;
            }
        } else {
            if (flowPanel) flowPanel.classList.remove('scrapbook-mode');
            if (windowTitle) {
                windowTitle.textContent = 'Welcome';
            }
        }
        if (stepEl) {
            stepEl.classList.remove('hidden');
            stepEl.classList.add('active');
        }
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
                this.showStep(this.stepStickers);
            });
        });

        // Back from Stickers (Switch User)
        const backBtn = document.getElementById('btn-back-from-stickers');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.showStep(this.stepUser);
            });
        }

        // Step 2: Scrapbook Sticker Selection -> Room Password
        document.querySelectorAll('.room-sticker').forEach(sticker => {
            sticker.addEventListener('click', () => {
                if (this.isJoining) return;

                document.querySelectorAll('.room-sticker').forEach(s => s.classList.remove('selected'));
                sticker.classList.add('selected');

                this.roomId = sticker.dataset.room;
                const roomDisplayEl = document.getElementById('host-room-code-display');
                const roomValueEl = document.getElementById('host-code-value');
                if (roomDisplayEl) roomDisplayEl.classList.remove('hidden');
                if (roomValueEl) roomValueEl.textContent = this.roomId;

                this.showStep(this.stepPassword);
                this.resetPasswordInputs();
                const firstDigit = document.querySelector('.pwd-digit[data-index="0"]');
                if (firstDigit) firstDigit.focus();
            });
        });

        // Step 3: Room Password
        const backPwdBtn = document.getElementById('btn-back-from-password');
        if (backPwdBtn) {
            backPwdBtn.addEventListener('click', () => {
                this.isJoining = false;
                this.resetPasswordInputs();
                document.querySelectorAll('.room-sticker').forEach(s => s.classList.remove('selected'));
                this.showStep(this.stepStickers);
            });
        }

        const digits = Array.from(document.querySelectorAll('.pwd-digit'));
        const checkAutoSubmit = () => {
            if (this.isJoining) return;
            const pwd = digits.map(i => i.value.trim()).join('');
            if (pwd.length === 6 && /^\d{6}$/.test(pwd)) {
                digits[digits.length - 1].blur();
                this.validatePassword();
            }
        };

        digits.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                if (this.isJoining) return;
                let val = input.value.trim().replace(/\D/g, '');
                if (val.length > 1) {
                    const chars = val.split('');
                    chars.forEach((c, i) => {
                        const targetIdx = idx + i;
                        if (targetIdx < digits.length) {
                            digits[targetIdx].value = c;
                            digits[targetIdx].classList.add('filled');
                        }
                    });
                    const lastFilled = Math.min(idx + chars.length - 1, digits.length - 1);
                    if (lastFilled < digits.length - 1) {
                        digits[lastFilled + 1].focus();
                    } else {
                        digits[digits.length - 1].blur();
                    }
                    checkAutoSubmit();
                    return;
                }
                if (val.length === 1) {
                    input.value = val;
                    input.classList.add('filled');
                    if (idx < digits.length - 1) {
                        digits[idx + 1].focus();
                    } else {
                        input.blur();
                    }
                    checkAutoSubmit();
                } else {
                    input.value = '';
                    input.classList.remove('filled');
                }
            });

            input.addEventListener('keydown', (e) => {
                if (this.isJoining) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    checkAutoSubmit();
                } else if (e.key === 'Backspace' && input.value === '') {
                    if (idx > 0) {
                        digits[idx - 1].focus();
                        digits[idx - 1].value = '';
                        digits[idx - 1].classList.remove('filled');
                    }
                }
            });

            input.addEventListener('paste', (e) => {
                if (this.isJoining) return;
                e.preventDefault();
                const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/\D/g, '');
                if (pasteData.length > 0) {
                    digits.forEach((d, i) => {
                        if (i < pasteData.length) {
                            d.value = pasteData[i];
                            d.classList.add('filled');
                        } else {
                            d.value = '';
                            d.classList.remove('filled');
                        }
                    });
                    const focusIdx = Math.min(pasteData.length, digits.length - 1);
                    if (pasteData.length >= digits.length) {
                        digits[digits.length - 1].blur();
                    } else {
                        digits[focusIdx].focus();
                    }
                    checkAutoSubmit();
                }
            });
        });
    }

    validatePassword() {
        if (this.isJoining) return;

        const pwd = Array.from(document.querySelectorAll('.pwd-digit')).map(i => i.value.trim()).join('');
        if (pwd.length !== 6 || !/^\d{6}$/.test(pwd)) {
            return;
        }

        this.isJoining = true;

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
                color: this.selectedUser === 'Hanin' ? '#6699ff' : '#9966ff',
                userId: this.getOrCreateUserId(),
                videoHash: this.roomManager.localState.videoHash || null,
                videoSize: this.roomManager.localState.videoSize || null,
                readyState: this.roomManager.localState.readyState || 'not_ready',
                isReady: this.roomManager.localState.isReady || false,
                subtitleLoaded: this.roomManager.localState.subtitleLoaded || false
            };

            this.lastJoinPayload = joinPayload;

            if (this.socket.ws && this.socket.ws.readyState === 1) {
                this.socket.send('join_room', joinPayload);
            } else {
                this.socket.connect();
                const tempHandler = () => {
                    this.socket.send('join_room', joinPayload);
                    const handlers = this.socket.handlers.get('connected');
                    if (handlers) {
                        this.socket.handlers.set('connected', handlers.filter(h => h !== tempHandler));
                    }
                };
                this.socket.on('connected', tempHandler);
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

        const dismissMismatch = () => {
            this.hashWarningModal.classList.add('hidden');
            const host = this.roomManager.getHostUser();
            const me = this.roomManager.users.get(this.roomManager.myId);
            if (host && host.videoHash && me && me.videoHash) {
                this.roomManager.ignoredMismatch = `${host.videoHash}_${me.videoHash}`;
            }
        };
        this.acceptMismatchBtn.addEventListener('click', dismissMismatch);
        const modalCloseBtn = this.hashWarningModal.querySelector('.win-btn.close');
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', dismissMismatch);
        }

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
                if (!this.roomManager.localState.videoHash) {
                    notifications.show('Please load a video first', 'warning');
                    return;
                }
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
        this.socket.on('error', (data) => {
            if (data.message === 'Incorrect room password.') {
                this.isJoining = false;
                const container = document.querySelector('.password-digits');
                if (container) {
                    container.style.transform = 'translateX(-10px)';
                    setTimeout(() => container.style.transform = 'translateX(10px)', 100);
                    setTimeout(() => container.style.transform = 'translateX(-10px)', 200);
                    setTimeout(() => container.style.transform = 'translateX(0)', 300);
                }
                this.resetPasswordInputs();
                const firstDigit = document.querySelector('.pwd-digit[data-index="0"]');
                if (firstDigit) firstDigit.focus();
            }
        });

        this.socket.on('connected', () => {
            if (this.lastJoinPayload && this.roomManager.roomId) {
                this.rejoinRoom();
            }
        });

        this.socket.on('room_joined', () => {
            this.isJoining = false;
            this.flowContainer.classList.remove('active');
            this.appScreen.classList.add('active');
            const roomIdEl = document.getElementById('current-room-id');
            const roomIconEl = document.getElementById('room-header-icon');
            if (roomIdEl) {
                roomIdEl.textContent = this.roomId;
                roomIdEl.style.display = 'none';
            }
            if (roomIconEl) {
                roomIconEl.src = `img/stickers/${this.roomId}.png`;
                roomIconEl.title = `Room: ${this.roomId}`;
                roomIconEl.style.display = 'block';
            }
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
        const users = Array.from(this.roomManager.users.values());
        if (this.userCountEl) this.userCountEl.textContent = users.length;

        users.sort((a, b) => {
            if (a.id === this.roomManager.hostId) return -1;
            if (b.id === this.roomManager.hostId) return 1;
            if (a.id === this.roomManager.myId) return -1;
            if (b.id === this.roomManager.myId) return 1;
            return (a.username || '').localeCompare(b.username || '');
        });

        const currentIds = new Set(users.map(u => u.id));
        Array.from(this.userListEl.children).forEach(child => {
            const uid = child.getAttribute('data-user-id');
            if (uid && !currentIds.has(uid)) {
                this.userListEl.removeChild(child);
            }
        });

        users.forEach(user => {
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
            const statusStr = statusText.join(' • ');
            const userNameHtml = `${this.escapeHtml(user.username)} ${isMe ? '(You)' : ''} ${isHost ? '<span class="host-badge">HOST</span>' : ''}`;

            let li = this.userListEl.querySelector(`li[data-user-id="${user.id}"]`);
            if (!li) {
                li = document.createElement('li');
                li.className = 'user-item';
                li.setAttribute('data-user-id', user.id);

                const avatarSrc = `/assets/avatars/${user.username}.png`;
                const avatarDiv = document.createElement('div');
                avatarDiv.className = 'user-avatar';
                const img = document.createElement('img');
                img.src = avatarSrc;
                img.onerror = function() { this.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E'; };
                avatarDiv.appendChild(img);
                li.appendChild(avatarDiv);

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'user-details';
                detailsDiv.innerHTML = `<div class="user-name"></div><div class="user-status"></div>`;
                li.appendChild(detailsDiv);
            }

            const nameEl = li.querySelector('.user-name');
            const statusEl = li.querySelector('.user-status');
            if (nameEl && nameEl.innerHTML !== userNameHtml) nameEl.innerHTML = userNameHtml;
            if (statusEl && statusEl.textContent !== statusStr) statusEl.textContent = statusStr;

            let actionsDiv = li.querySelector('.user-actions');
            if (this.roomManager.isHost() && !isMe) {
                if (!actionsDiv) {
                    actionsDiv = document.createElement('div');
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
            } else if (actionsDiv) {
                actionsDiv.remove();
            }

            this.userListEl.appendChild(li);
        });

        if (this.readyToggleBtn) {
            const hasVideo = Boolean(this.roomManager.localState.videoHash);
            const isReady = Boolean(hasVideo && this.roomManager.localState.isReady);
            this.readyToggleBtn.style.display = hasVideo ? 'inline-block' : 'none';
            this.readyToggleBtn.textContent = isReady ? 'Ready' : 'Not Ready';
            this.readyToggleBtn.style.background = isReady ? 'var(--success)' : 'var(--warning)';
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
