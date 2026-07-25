// socket.js
import { notifications } from './notifications.js';

export class SocketManager {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.handlers = new Map();
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.latency = 0;
        this.shouldReconnect = true;
        
        // Status indicator UI
        this.dotEl = document.getElementById('status-dot');
        this.pingEl = document.getElementById('ping-value');
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.updateStatus('connecting');
        
        // Use wss:// if hosted on https
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        this.ws = new WebSocket(`${protocol}//${host}`);

        this.ws.onopen = () => {
            this.updateStatus('connected');
            this.startPing();
            this.trigger('connected');
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'pong') {
                    const rtt = Date.now() - data.payload.clientTime;
                    this.latency = Math.round(rtt / 2);
                    if (this.pingEl) {
                        this.pingEl.textContent = `${this.latency}ms`;
                        // Trigger local update state to send latency
                        this.trigger('_internal_latency_update', this.latency);
                    }
                    return;
                }
                
                if (this.handlers.has(data.type)) {
                    this.handlers.get(data.type).forEach(cb => cb(data.payload));
                }
            } catch (e) {
                console.error('Message parse error', e);
            }
        };

        this.ws.onclose = () => {
            this.updateStatus('error');
            this.stopPing();
            this.trigger('disconnected');
            if (this.shouldReconnect) {
                this.reconnectTimer = setTimeout(() => this.connect(), 3000);
            }
        };

        this.ws.onerror = () => {
            this.updateStatus('error');
        };
    }

    disconnect() {
        this.shouldReconnect = false;
        if (this.ws) {
            this.ws.close();
        }
    }

    send(type, payload = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, payload }));
        }
    }

    on(type, callback) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, []);
        }
        this.handlers.get(type).push(callback);
    }

    trigger(type, payload = null) {
        if (this.handlers.has(type)) {
            this.handlers.get(type).forEach(cb => cb(payload));
        }
    }

    startPing() {
        this.pingInterval = setInterval(() => {
            this.send('ping', { clientTime: Date.now() });
        }, 5000);
    }

    stopPing() {
        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    updateStatus(status) {
        if (!this.dotEl) return;
        this.dotEl.className = 'status-indicator ' + status;
    }
}
