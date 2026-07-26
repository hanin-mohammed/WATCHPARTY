// sync.js
import { throttle } from './utils.js';
import { notifications } from './notifications.js';

export class SyncEngine {
    constructor(player, socket, roomManager, chatManager) {
        this.player = player;
        this.socket = socket;
        this.roomManager = roomManager;
        this.chatManager = chatManager;
        
        this.baseSpeed = 1.0;
        this.isSyncing = false;
        
        this.syncStatusEl = document.getElementById('sync-status');
        
        // Host state
        this.remoteState = {
            playing: false,
            time: 0,
            speed: 1.0,
            updatedAt: Date.now()
        };

        this.setupPlayerListeners();
        this.setupSocketListeners();
        
        // Periodic sync loop for non-hosts
        setInterval(() => this.driftCorrectionLoop(), 500);
        
        // Periodic broadcast for host
        this.throttledHostBroadcast = throttle(() => this.broadcastHostState(), 500);
        setInterval(() => {
            if (this.roomManager.isHost() && this.player.video.readyState >= 2) {
                this.throttledHostBroadcast();
            }
        }, 1000);
    }

    setupPlayerListeners() {
        // User intends to change state (only allow if host or collab)
        this.player.events.addEventListener('userPlay', () => {
            if (this.roomManager.canControl()) {
                if (!this.isEveryoneReady()) {
                    notifications.show('Cannot play until everyone is ready', 'warning');
                    this.player.forcePause();
                    return;
                }
                this.player.forcePlay();
                this.broadcastHostState('play');
                this.showLocalActionPopup('played');
            }
        });

        this.player.events.addEventListener('userPause', () => {
            if (this.roomManager.canControl()) {
                this.player.forcePause();
                this.broadcastHostState('pause');
                this.showLocalActionPopup(`paused at ${this.formatTime(this.player.video.currentTime)}`);
            }
        });

        this.player.events.addEventListener('userSeek', (e) => {
            if (this.roomManager.canControl()) {
                this.player.forceSeek(e.detail.time);
                this.broadcastHostState('seek');
                this.showLocalActionPopup(`skipped to ${this.formatTime(e.detail.time)}`);
            }
        });

        this.player.events.addEventListener('userSpeedChange', (e) => {
            if (this.roomManager.canControl()) {
                this.baseSpeed = e.detail.speed;
                this.player.setPlaybackRate(this.baseSpeed);
                this.broadcastHostState('speed');
            } else {
                // Revert UI to match host if not allowed
                document.getElementById('playback-speed').value = this.baseSpeed;
            }
        });
        
        // Local state changes to report to room (buffering, ready)
        this.player.events.addEventListener('buffering', (e) => {
            this.roomManager.updateLocalState({ buffering: e.detail.buffering });
        });
        
        this.player.events.addEventListener('stateChange', () => {
            if (this.roomManager.isHost()) {
                this.broadcastHostState();
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('sync_playback', (data) => {
            if (this.roomManager.isHost()) return; // Host ignores sync messages
            
            this.remoteState = data;
            this.baseSpeed = data.speed;
            document.getElementById('playback-speed').value = this.baseSpeed;
            
            if (data.action && data.username && this.chatManager) {
                if (data.action === 'play') this.chatManager.showActionPopup(`${data.username} played`);
                else if (data.action === 'pause') this.chatManager.showActionPopup(`${data.username} paused at ${this.formatTime(data.time)}`);
                else if (data.action === 'seek') this.chatManager.showActionPopup(`${data.username} skipped to ${this.formatTime(data.time)}`);
            }

            // Immediate reaction to major state changes
            if (data.playing !== !this.player.video.paused) {
                if (data.playing) this.player.forcePlay();
                else this.player.forcePause();
            }
            
            this.driftCorrectionLoop();
        });

        this.socket.on('room_state_change', () => {
            if (this.roomManager.isHost() && !this.player.video.paused) {
                if (!this.isEveryoneReady()) {
                    this.player.forcePause();
                    this.broadcastHostState();
                    notifications.show('Paused because a user is not ready', 'warning');
                }
            }
        });
    }

    broadcastHostState(action = null) {
        if (!this.player.video || !this.roomManager.canControl()) return;
        
        const state = {
            playing: !this.player.video.paused,
            time: this.player.video.currentTime,
            speed: this.baseSpeed,
            action: action
        };
        this.socket.send('sync_playback', state);
    }

    showLocalActionPopup(actionText) {
        if (this.chatManager) {
            const me = this.roomManager.users.get(this.roomManager.myId);
            const username = me ? me.username : 'You';
            this.chatManager.showActionPopup(`${username} ${actionText}`);
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    driftCorrectionLoop() {
        if (this.roomManager.isHost() || !this.player.currentFile) {
            this.syncStatusEl.textContent = '';
            this.syncStatusEl.style.color = 'var(--text-secondary)';
            return;
        }

        if (this.player.video.readyState < 2) return; // Not ready

        // Calculate expected time based on when the server received the host's update
        // We factor in our latency to the server.
        // host sent message -> server -> us
        // Time elapsed since update = Date.now() - remoteState.updatedAt + latency
        
        const timeElapsedSec = (Date.now() - this.remoteState.updatedAt + this.roomManager.localState.latency) / 1000.0;
        
        let expectedTime = this.remoteState.time;
        if (this.remoteState.playing) {
            expectedTime += timeElapsedSec * this.remoteState.speed;
        }

        const localTime = this.player.video.currentTime;
        const drift = expectedTime - localTime;
        
        this.roomManager.updateLocalState({ syncOffset: Math.round(drift * 1000) });

        // If paused, just ensure we are at the right frame
        if (!this.remoteState.playing) {
            if (Math.abs(drift) > 0.1) {
                this.player.forceSeek(this.remoteState.time);
            }
            this.player.setPlaybackRate(this.baseSpeed);
            this.syncStatusEl.textContent = 'Sync: Paused';
            this.syncStatusEl.style.color = 'var(--text-secondary)';
            return;
        }

        // We are playing. Apply drift correction.
        const absDrift = Math.abs(drift);
        
        if (absDrift > 2.0) {
            // Major drift: Hard seek
            this.player.forceSeek(expectedTime);
            this.player.setPlaybackRate(this.baseSpeed);
            this.syncStatusEl.textContent = 'Sync: Seeking...';
            this.syncStatusEl.style.color = 'var(--warning)';
        } else if (absDrift > 0.05) {
            // Minor drift: Adjust speed smoothly
            // If drift is positive, we are behind, speed up.
            // Max speed adjustment is 10% (0.1)
            let adjustment = drift * 0.5; // proportional gain
            adjustment = Math.max(-0.2, Math.min(0.2, adjustment));
            
            this.player.setPlaybackRate(this.baseSpeed + adjustment);
            this.syncStatusEl.textContent = `Sync: Drift ${(drift*1000).toFixed(0)}ms`;
            this.syncStatusEl.style.color = 'var(--accent)';
        } else {
            // Perfect sync
            this.player.setPlaybackRate(this.baseSpeed);
            this.syncStatusEl.textContent = 'Sync: Perfect';
            this.syncStatusEl.style.color = 'var(--success)';
        }
    }

    isEveryoneReady() {
        if (!this.roomManager.users || this.roomManager.users.size === 0) return false;
        for (const user of this.roomManager.users.values()) {
            if (!user.isReady) return false;
        }
        return true;
    }
}
