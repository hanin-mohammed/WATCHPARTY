// chat.js
export class ChatManager {
    constructor(socket) {
        this.socket = socket;
        this.container = document.getElementById('chat-messages');
        this.form = document.getElementById('chat-form');
        this.input = document.getElementById('chat-input');
        
        this.setupListeners();
    }

    setupListeners() {
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = this.input.value.trim();
            if (text) {
                this.socket.send('chat_message', { message: text });
                this.input.value = '';
            }
        });

        this.socket.on('chat_message', (data) => {
            this.appendMessage(data);
        });
    }

    appendMessage(data) {
        const el = document.createElement('div');
        el.className = 'chat-message';
        
        const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        el.innerHTML = `
            <span class="author" style="color: ${data.color}">${this.escapeHtml(data.username)}:</span>
            <span class="text">${this.escapeHtml(data.message)}</span>
            <span class="time">${time}</span>
        `;
        
        this.container.appendChild(el);
        
        // Auto-scroll to bottom
        this.container.scrollTop = this.container.scrollHeight;
        
        // Optional: fade out old messages if not interacted with?
        // Let's keep them visible but capped at 100 messages to save DOM memory.
        while (this.container.children.length > 100) {
            this.container.removeChild(this.container.firstChild);
        }
    }

    escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
}
