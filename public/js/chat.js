// chat.js
export class ChatManager {
    constructor(socket) {
        this.socket = socket;
        this.overlayContainer = document.getElementById('chat-messages');
        this.sidebarContainer = document.getElementById('sidebar-chat-messages');
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
            this.wakeUpOverlay();
        });

        this.socket.on('reaction', (data) => {
            this.showFloatingEmoji(data.emoji);
            if (data.username) {
                this.appendMessage({
                    username: data.username,
                    message: data.emoji,
                    timestamp: data.timestamp || Date.now()
                });
            }
            this.wakeUpOverlay();
        });

        document.querySelectorAll('.reaction-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trigger = e.target.closest('.reaction-trigger');
                if (trigger && this.socket) {
                    const emoji = trigger.dataset.emoji;
                    if (emoji) {
                        this.socket.send('reaction', { emoji });
                    }
                }
            });
        });
    }

    wakeUpOverlay() {
        const wrapper = document.getElementById('player-wrapper');
        if (wrapper) {
            wrapper.dispatchEvent(new Event('mousemove'));
        }
    }

    showFloatingEmoji(emoji) {
        const el = document.createElement('div');
        el.className = 'floating-emoji';
        el.textContent = emoji;
        // Randomize horizontal start position slightly on the right side
        const randomX = Math.floor(Math.random() * 60) + 20; 
        el.style.right = `${randomX}px`;
        el.style.bottom = '40px';
        
        const container = document.querySelector('.player-content');
        if (container) {
            container.appendChild(el);
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 2000);
        }
    }

    showActionPopup(message) {
        if (!this.overlayContainer) return;
        const el = document.createElement('div');
        el.className = 'action-popup';
        el.textContent = message;
        
        this.overlayContainer.appendChild(el);
        this.overlayContainer.scrollTop = this.overlayContainer.scrollHeight;
        
        setTimeout(() => {
            el.classList.add('fade-out');
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 500);
        }, 3000);
        
        this.wakeUpOverlay();
    }

    appendMessage(data) {
        const createMsgEl = () => {
            const el = document.createElement('div');
            const usernameLower = data.username ? data.username.toLowerCase() : '';
            const isHanin = usernameLower === 'hanin';
            const isManha = usernameLower === 'manha';
            
            el.className = 'chat-message ' + (isHanin ? 'hanin-msg' : (isManha ? 'manha-msg' : ''));
            
            const avatarSrc = isHanin ? '/assets/avatars/Hanin.png' : 
                             (isManha ? '/assets/avatars/Manha.png' : '');
                             
            const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            el.innerHTML = `
                <div style="display: flex; gap: 8px; align-items: flex-start;">
                    ${avatarSrc ? `<img src="${avatarSrc}" style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border-color); object-fit: cover; margin-top: 2px;">` : ''}
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px;">
                            <span class="author">${this.escapeHtml(data.username)}</span>
                            <span class="time">${time}</span>
                        </div>
                        <span class="text" style="font-size: 0.85rem; line-height: 1.3;">${this.escapeHtml(data.message)}</span>
                    </div>
                </div>
            `;
            return el;
        };
        
        // Append to sidebar (permanent)
        if (this.sidebarContainer) {
            const sidebarEl = createMsgEl();
            this.sidebarContainer.appendChild(sidebarEl);
            this.sidebarContainer.scrollTop = this.sidebarContainer.scrollHeight;
            while (this.sidebarContainer.children.length > 200) {
                this.sidebarContainer.removeChild(this.sidebarContainer.firstChild);
            }
        }
        
        // Append to overlay (temporary)
        if (this.overlayContainer) {
            const overlayEl = createMsgEl();
            this.overlayContainer.appendChild(overlayEl);
            this.overlayContainer.scrollTop = this.overlayContainer.scrollHeight;
            
            setTimeout(() => {
                overlayEl.classList.add('fade-out');
                setTimeout(() => {
                    if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
                }, 500);
            }, 5000);
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
