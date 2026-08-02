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
        this.isCorrectingDrift = false;
        this.isApplyingRemoteState = false;
        this.lastLocalActionTime = 0;
        this._remoteStateTimeout = null;
        
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
            if (this.roomManager.isHost() && this.player.video && this.player.video.readyState >= 2 && !this.isApplyingRemoteState) {
                if (Date.now() - (this.lastLocalActionTime || 0) > 1500 && Date.now() - (this.remoteState.updatedAt || 0) > 1500) {
                    this.throttledHostBroadcast();
                }
            }
        }, 1000);
    }

    setupPlayerListeners() {
        // User intends to change state (only allow if host or collab)
        this.player.events.addEventListener('userPlay', () => {
            if (this.roomManager.canControl() && !this.isApplyingRemoteState) {
                if (!this.isEveryoneReady()) {
                    notifications.show('Cannot play until everyone is ready', 'warning');
                    this.player.forcePause();
                    return;
                }
                this.lastLocalActionTime = Date.now();
                this.player.forcePlay();
                this.broadcastHostState('play');
                this.showLocalActionPopup('played');
            }
        });

        this.player.events.addEventListener('userPause', () => {
            if (this.roomManager.canControl() && !this.isApplyingRemoteState) {
                this.lastLocalActionTime = Date.now();
                this.player.forcePause();
                this.broadcastHostState('pause');
                this.showLocalActionPopup(`paused at ${this.formatTime(this.player.video.currentTime)}`);
            }
        });

        this.player.events.addEventListener('userSeek', (e) => {
            if (this.roomManager.canControl() && !this.isApplyingRemoteState) {
                this.lastLocalActionTime = Date.now();
                this.player.forceSeek(e.detail.time);
                this.broadcastHostState('seek', e.detail.time);
                this.showLocalActionPopup(`skipped to ${this.formatTime(e.detail.time)}`);
            }
        });

        this.player.events.addEventListener('userSpeedChange', (e) => {
            if (this.roomManager.canControl() && !this.isApplyingRemoteState) {
                this.lastLocalActionTime = Date.now();
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
        
        this.player.events.addEventListener('stateChange', (e) => {
            if (this.roomManager.canControl() && !this.isApplyingRemoteState) {
                // Prevent duplicate broadcast if this stateChange was just triggered by userPlay/userPause
                if (Date.now() - (this.lastLocalActionTime || 0) > 500) {
                    const action = (e.detail && e.detail.playing) ? 'play' : 'pause';
                    this.broadcastHostState(action);
                }
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('sync_playback', (data) => {
            if (data.userId === this.roomManager.myId) return; // Ignore our own sync messages
            
            // Ignore stale incoming sync messages for 1500ms after a local control action (seek/play/pause)
            if (Date.now() - (this.lastLocalActionTime || 0) < 1500) {
                return;
            }

            this.isApplyingRemoteState = true;
            this.lastLocalActionTime = 0;
            clearTimeout(this._remoteStateTimeout);
            this._remoteStateTimeout = setTimeout(() => {
                this.isApplyingRemoteState = false;
            }, 1000);
            
            this.remoteState = {
                playing: data.playing,
                time: data.time,
                speed: data.speed,
                updatedAt: Date.now()
            };
            this.baseSpeed = data.speed;
            const speedEl = document.getElementById('playback-speed');
            if (speedEl) speedEl.value = this.baseSpeed;
            if (Math.abs(this.player.video.playbackRate - this.baseSpeed) > 0.001) {
                this.player.setPlaybackRate(this.baseSpeed);
            }
            
            if (data.action && data.username && this.chatManager) {
                if (data.action === 'play') this.chatManager.showActionPopup(`${data.username} played`);
                else if (data.action === 'pause') this.chatManager.showActionPopup(`${data.username} paused at ${this.formatTime(data.time)}`);
                else if (data.action === 'seek') this.chatManager.showActionPopup(`${data.username} skipped to ${this.formatTime(data.time)}`);
                else if (data.action === 'speed') this.chatManager.showActionPopup(`${data.username} changed speed to ${data.speed}x`);
            }

            if (data.action === 'seek' || Math.abs(this.player.video.currentTime - data.time) > 2.0) {
                this.player.forceSeek(data.time);
            }

            // Immediate reaction to major state changes
            if (data.playing !== !this.player.video.paused) {
                if (data.playing) {
                    this.player.forcePlay();
                } else {
                    this.player.forcePause();
                }
            }
            
            if (!this.player.isSeeking && !this.player.video.seeking) {
                this.driftCorrectionLoop();
            }
        });

        this.socket.on('room_state_change', () => {
            if (this.roomManager.isHost() && !this.player.video.paused && !this.isApplyingRemoteState) {
                if (!this.isEveryoneReady()) {
                    this.lastLocalActionTime = Date.now();
                    this.player.forcePause();
                    this.broadcastHostState('pause');
                    notifications.show('Paused because a user is not ready', 'warning');
                }
            }
        });
    }

    broadcastHostState(action = null, overrideTime = null) {
        if (!this.player.video || !this.roomManager.canControl() || this.isApplyingRemoteState) return;
        
        if (!action && overrideTime === null && (this.player.isSeeking || this.player.video.seeking)) {
            return;
        }

        const currentTime = overrideTime !== null ? overrideTime :
            ((this.player.isSeeking || this.player.video.seeking) && this.player.targetSeekTime !== undefined
                ? this.player.targetSeekTime
                : this.player.video.currentTime);

        const state = {
            playing: !this.player.video.paused,
            time: currentTime,
            speed: this.baseSpeed,
            action: action
        };
        this.remoteState = {
            playing: state.playing,
            time: state.time,
            speed: state.speed,
            updatedAt: Date.now()
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
            this.isCorrectingDrift = false;
            return;
        }

        if (this.isApplyingRemoteState) {
            if (!this.remoteState.playing) {
                this.syncStatusEl.textContent = 'Sync: Paused';
                this.syncStatusEl.style.color = 'var(--text-secondary)';
            } else if (this.syncStatusEl.textContent === 'Sync: Paused') {
                this.syncStatusEl.textContent = 'Sync: Perfect';
                this.syncStatusEl.style.color = 'var(--success)';
            }
            return;
        }

        if (this.player.video.readyState < 2 || this.player.isSeeking || this.player.video.seeking) return; // Not ready or currently seeking
        if (Date.now() - (this.lastLocalActionTime || 0) < 2000) return; // Allow recent local actions to settle

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

        const setRateSmoothly = (rate) => {
            if (Math.abs(this.player.video.playbackRate - rate) > 0.001) {
                this.player.setPlaybackRate(rate);
            }
        };

        // If host is paused, only seek if we are also paused and out of sync
        if (!this.remoteState.playing) {
            if (this.player.video.paused && Math.abs(drift) > 0.5) {
                this.player.forceSeek(this.remoteState.time);
            }
            setRateSmoothly(this.baseSpeed);
            this.isCorrectingDrift = false;
            this.syncStatusEl.textContent = 'Sync: Paused';
            this.syncStatusEl.style.color = 'var(--text-secondary)';
            return;
        }

        // We are playing. Apply Syncplay-inspired architecture:
        // - Dead band (0 - 1.2s): do not adjust speed to avoid audio skips
        // - Hysteresis exit (< 0.5s): stop speed correction once back within 0.5s
        // - Fast-forward/Slow-down (1.2s - 2.5s): steady +/- 5% rate change
        // - Major drift (> 2.5s): hard seek
        const absDrift = Math.abs(drift);
        const MAX_DRIFT_TOLERANCE = 1.2; // 1.2 seconds deadband
        const SEEK_THRESHOLD = 2.5;      // 2.5 seconds hard seek threshold
        const HYSTERESIS_EXIT = 0.5;     // 0.5 seconds exit threshold

        if (absDrift > SEEK_THRESHOLD) {
            // Major desync: Hard seek
            this.isApplyingRemoteState = true;
            this.player.forceSeek(expectedTime);
            clearTimeout(this._remoteStateTimeout);
            this._remoteStateTimeout = setTimeout(() => {
                this.isApplyingRemoteState = false;
            }, 1000);
            setRateSmoothly(this.baseSpeed);
            this.isCorrectingDrift = false;
            this.syncStatusEl.textContent = 'Sync: Seeking...';
            this.syncStatusEl.style.color = 'var(--warning)';
        } else if (absDrift > MAX_DRIFT_TOLERANCE || (this.isCorrectingDrift && absDrift > HYSTERESIS_EXIT)) {
            // Minor desync: Gentle speed adjustment (Syncplay fast-forward / slow-down)
            this.isCorrectingDrift = true;
            const targetSpeed = drift > 0 ? this.baseSpeed * 1.05 : this.baseSpeed * 0.95;
            setRateSmoothly(targetSpeed);
            this.syncStatusEl.textContent = `Sync: Drift ${(drift*1000).toFixed(0)}ms`;
            this.syncStatusEl.style.color = 'var(--accent)';
        } else {
            // Within tolerance: Normal playback speed without stutters
            this.isCorrectingDrift = false;
            setRateSmoothly(this.baseSpeed);
            this.syncStatusEl.textContent = 'Sync: Perfect';
            this.syncStatusEl.style.color = 'var(--success)';
        }
    }

    isEveryoneReady() {
        if (!this.roomManager.users || this.roomManager.users.size === 0) return false;
        for (const user of this.roomManager.users.values()) {
            if (!user.videoHash || !user.isReady) return false;
        }
        return true;
    }
}
