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

        const reactionBtn = document.getElementById('reaction-mode-btn');
        const reactionsBar = document.getElementById('reactions-bar');
        const reactionContainer = document.getElementById('reaction-picker-container');

        if (reactionBtn && reactionsBar) {
            reactionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                reactionsBar.classList.toggle('active');
                reactionBtn.classList.toggle('active');
            });

            if (reactionContainer) {
                let hoverTimeout;
                reactionContainer.addEventListener('mouseenter', () => {
                    clearTimeout(hoverTimeout);
                    reactionsBar.classList.add('active');
                    reactionBtn.classList.add('active');
                });
                reactionContainer.addEventListener('mouseleave', () => {
                    hoverTimeout = setTimeout(() => {
                        reactionsBar.classList.remove('active');
                        reactionBtn.classList.remove('active');
                    }, 350);
                });
            }

            document.addEventListener('click', (e) => {
                if (reactionContainer && !reactionContainer.contains(e.target)) {
                    reactionsBar.classList.remove('active');
                    reactionBtn.classList.remove('active');
                }
            });
        }

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

    getOverlayTarget() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
            return (fsEl.tagName && fsEl.tagName.toLowerCase() === 'video') ? (fsEl.parentNode || document.body) : fsEl;
        }
        const fullscreenWrapper = document.querySelector('.player-wrapper.is-fullscreen');
        if (fullscreenWrapper) {
            return fullscreenWrapper;
        }
        return document.querySelector('.player-content') || document.querySelector('.player-wrapper') || document.body;
    }

    showFloatingEmoji(emoji) {
        const container = this.getOverlayTarget();
        if (!container) return;

        const popup = document.createElement('div');
        popup.className = 'center-emoji-popup';

        // Offset slightly if multiple emojis appear
        const offsetX = Math.floor(Math.random() * 40 - 20);
        const offsetY = Math.floor(Math.random() * 40 - 20);
        popup.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;

        if (container === document.body) {
            popup.style.position = 'fixed';
        } else {
            popup.style.position = 'absolute';
        }

        // Background particle canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'emoji-particle-canvas';
        popup.appendChild(canvas);

        // Emoji display element
        const el = document.createElement('div');
        el.className = 'center-emoji-el';
        if (emoji === 'three' || emoji === '/assets/emojis/three.png' || (typeof emoji === 'string' && emoji.startsWith('/assets/emojis/') && emoji.endsWith('.png'))) {
            const img = document.createElement('img');
            img.src = emoji === 'three' ? '/assets/emojis/three.png' : emoji;
            img.alt = 'Emoji';
            img.className = 'center-emoji-img';
            el.appendChild(img);
        } else {
            el.textContent = emoji;
        }
        popup.appendChild(el);

        container.appendChild(popup);

        // Size canvas to popup dimensions
        const rect = popup.getBoundingClientRect();
        canvas.width = rect.width || 360;
        canvas.height = rect.height || 360;

        // Animate bursting background particles
        this.animateEmojiParticles(canvas, () => {
            popup.classList.add('fade-out');
            setTimeout(() => {
                if (popup.parentNode) {
                    popup.parentNode.removeChild(popup);
                }
            }, 500);
        });
    }

    animateEmojiParticles(canvas, onComplete) {
        const ctx = canvas.getContext('2d');
        const colors = [
            '#FFD700', '#FF6B6B', '#4ECDC4', '#A8E6CF', 
            '#FF8C00', '#FF69B4', '#00E676', '#70A1FF', '#FFFFFF'
        ];
        const particleCount = 45;
        const particles = [];
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 7 + 2;
            particles.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.2,
                size: Math.random() * 8 + 3,
                color: colors[Math.floor(Math.random() * colors.length)],
                opacity: 1,
                drag: 0.94,
                gravity: 0.08,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10,
                shape: Math.random() > 0.5 ? 'circle' : (Math.random() > 0.5 ? 'star' : 'diamond')
            });
        }

        const startTime = Date.now();
        const duration = 2400;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let activeCount = 0;
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.vx *= p.drag;
                p.vy *= p.drag;
                p.vy += p.gravity;
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotationSpeed;

                if (progress > 0.65) {
                    p.opacity = Math.max(0, 1 - (progress - 0.65) / 0.35);
                }

                if (p.opacity > 0.01) {
                    activeCount++;
                    ctx.save();
                    ctx.globalAlpha = p.opacity;
                    ctx.translate(p.x, p.y);
                    ctx.rotate((p.rotation * Math.PI) / 180);
                    ctx.fillStyle = p.color;

                    if (p.shape === 'circle') {
                        ctx.beginPath();
                        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                        ctx.fill();
                    } else if (p.shape === 'diamond') {
                        ctx.beginPath();
                        ctx.moveTo(0, -p.size);
                        ctx.lineTo(p.size * 0.6, 0);
                        ctx.lineTo(0, p.size);
                        ctx.lineTo(-p.size * 0.6, 0);
                        ctx.closePath();
                        ctx.fill();
                    } else {
                        ctx.beginPath();
                        for (let j = 0; j < 5; j++) {
                            const a = (j * 4 * Math.PI) / 5 - Math.PI / 2;
                            const r = p.size;
                            ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
                        }
                        ctx.closePath();
                        ctx.fill();
                    }

                    ctx.restore();
                }
            }

            if (elapsed < duration && activeCount > 0) {
                requestAnimationFrame(animate);
            } else {
                if (onComplete) onComplete();
            }
        };

        requestAnimationFrame(animate);
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

    formatMessageText(msg) {
        if (!msg) return '';
        if (msg === 'three' || msg === '/assets/emojis/three.png' || (typeof msg === 'string' && msg.startsWith('/assets/emojis/') && msg.endsWith('.png'))) {
            const src = msg === 'three' ? '/assets/emojis/three.png' : msg;
            return `<img src="${src}" alt="Three" style="width: 20px; height: 20px; vertical-align: middle; object-fit: contain; display: inline-block;">`;
        }
        return this.escapeHtml(msg);
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
                        <span class="text" style="font-size: 0.85rem; line-height: 1.3;">${this.formatMessageText(data.message)}</span>
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
