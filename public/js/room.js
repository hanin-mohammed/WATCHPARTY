// room.js
import { notifications } from './notifications.js';

export class RoomManager {
    constructor(socket) {
        this.socket = socket;
        this.roomId = null;
        this.myId = null;
        this.hostId = null;
        this.users = new Map(); // id -> userData
        this.collaborative = true;
        this.ignoredMismatch = null;
        
        this.localState = {
            videoHash: null,
            videoSize: null,
            readyState: 'not_ready',
            isReady: false,
            subtitleLoaded: false,
            buffering: false,
            latency: 0,
            syncOffset: 0
        };

        this.setupListeners();
    }

    setupListeners() {
        this.socket.on('room_joined', (data) => {
            this.roomId = data.roomId;
            this.myId = data.userId;
            this.hostId = data.hostId;
            this.collaborative = data.collaborative;
            
            this.users.clear();
            data.users.forEach(u => this.users.set(u.id, u));
            
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
            notifications.show(`Joined room ${this.roomId}`, 'success');
            if (this.localState.videoHash) {
                this.socket.send('update_state', {
                    videoHash: this.localState.videoHash,
                    videoSize: this.localState.videoSize,
                    readyState: this.localState.readyState,
                    isReady: this.localState.isReady,
                    subtitleLoaded: this.localState.subtitleLoaded
                });
            }
            this.emitChange();
        });

        this.socket.on('user_joined', (data) => {
            this.users.set(data.user.id, data.user);
            notifications.show(`${data.user.username} joined`, 'info');
            this.emitChange();
        });

        this.socket.on('user_left', (data) => {
            const u = this.users.get(data.userId);
            if (u) {
                notifications.show(`${u.username} left`, 'info');
                this.users.delete(data.userId);
                this.emitChange();
            }
        });

        this.socket.on('user_state_updated', (data) => {
            const u = this.users.get(data.userId);
            if (u) {
                Object.assign(u, data.state);
                this.emitChange();
                
                // If they updated hash and we are host, we might want to check it, 
                // but usually clients check against host.
                this.checkHashes();
            }
        });

        this.socket.on('host_transferred', (data) => {
            const oldHost = this.users.get(this.hostId);
            this.hostId = data.newHostId;
            const newHost = this.users.get(this.hostId);
            
            if (this.myId === this.hostId) {
                notifications.show('You are now the host', 'success');
            } else if (newHost) {
                notifications.show(`${newHost.username} is now the host`, 'info');
            }
            this.emitChange();
        });

        this.socket.on('room_settings_updated', (data) => {
            this.collaborative = data.collaborative;
            notifications.show(`Collaborative mode ${this.collaborative ? 'enabled' : 'disabled'}`, 'info');
            this.emitChange();
        });

        this.socket.on('removed_from_room', (data) => {
            alert(data.message || 'You have been removed from the room by the host.');
            window.location.reload();
        });

        this.socket.on('user_removed', (data) => {
            const u = this.users.get(data.userId);
            const username = u ? u.username : (data.username || 'A user');
            if (u) {
                this.users.delete(data.userId);
            }
            notifications.show(`${username} was removed by the host`, 'info');
            this.emitChange();
        });

        this.socket.on('error', (data) => {
            notifications.show(data.message, 'error');
        });

        this.socket.on('_internal_latency_update', (latency) => {
            if (this.localState.latency !== latency && this.roomId) {
                this.updateLocalState({ latency });
            }
        });
    }

    updateLocalState(partialState) {
        if (partialState.videoHash === null || partialState.videoHash === '') {
            partialState.isReady = false;
        }
        if (partialState.isReady !== undefined && !this.localState.videoHash && !partialState.videoHash) {
            partialState.isReady = false;
        }
        Object.assign(this.localState, partialState);
        if (this.roomId) {
            this.socket.send('update_state', partialState);
        }
        
        const me = this.users.get(this.myId);
        if (me) {
            Object.assign(me, partialState);
            this.emitChange();
        }
    }

    isHost() {
        return this.myId === this.hostId;
    }

    canControl() {
        return this.isHost() || this.collaborative;
    }

    getHostUser() {
        return this.users.get(this.hostId);
    }

    checkHashes() {
        if (this.isHost()) return;
        const host = this.getHostUser();
        const me = this.users.get(this.myId);
        
        if (host && host.videoHash && me && me.videoHash) {
            if (host.videoHash !== me.videoHash) {
                const currentPair = `${host.videoHash}_${me.videoHash}`;
                if (this.ignoredMismatch !== currentPair) {
                    this.socket.trigger('hash_mismatch', { hostHash: host.videoHash, localHash: me.videoHash });
                }
            }
        }
    }

    emitChange() {
        this.socket.trigger('room_state_change', {
            users: Array.from(this.users.values()),
            hostId: this.hostId,
            myId: this.myId,
            collaborative: this.collaborative
        });
    }
}
