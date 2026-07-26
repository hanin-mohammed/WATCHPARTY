// effects.js
export class SpecialEffectsManager {
    constructor(socket, chatManager) {
        this.socket = socket;
        this.chatManager = chatManager;
        this.cooldowns = {
            golden_buzzer: false,
            rotten_tomato: false
        };

        this.setupListeners();
        this.setupUI();
    }

    setupListeners() {
        if (this.socket) {
            this.socket.on('special_effect', (data) => {
                this.handleSpecialEffect(data);
            });
        }
    }

    setupUI() {
        const goldenBtn = document.getElementById('golden-buzzer-btn');
        const tomatoBtn = document.getElementById('rotten-tomato-btn');

        if (goldenBtn) {
            goldenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.triggerLocal('golden_buzzer', goldenBtn);
            });
        }

        if (tomatoBtn) {
            tomatoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.triggerLocal('rotten_tomato', tomatoBtn);
            });
        }
    }

    triggerLocal(effectType, buttonEl) {
        if (this.cooldowns[effectType]) return;

        // Apply brief button cooldown to prevent accidental double taps
        this.cooldowns[effectType] = true;
        if (buttonEl) {
            buttonEl.classList.add('buzzer-active');
            setTimeout(() => buttonEl.classList.remove('buzzer-active'), 300);
        }
        setTimeout(() => {
            this.cooldowns[effectType] = false;
        }, 1500);

        if (this.socket) {
            this.socket.send('special_effect', { effectType });
        }
    }

    handleSpecialEffect(data) {
        const { effectType, username } = data;
        const senderName = username || 'Someone';

        if (this.chatManager) {
            if (effectType === 'golden_buzzer') {
                this.chatManager.appendMessage({
                    username: senderName,
                    message: '🌟 hit the GOLDEN BUZZER! ✨👑',
                    timestamp: data.timestamp || Date.now()
                });
            } else if (effectType === 'rotten_tomato') {
                this.chatManager.appendMessage({
                    username: senderName,
                    message: '🍅 threw a ROTTEN TOMATO! 💥🍅',
                    timestamp: data.timestamp || Date.now()
                });
            }
            this.chatManager.wakeUpOverlay();
        }

        if (effectType === 'golden_buzzer') {
            this.playGoldenBuzzerEffect(senderName);
        } else if (effectType === 'rotten_tomato') {
            this.playRottenTomatoEffect(senderName);
        }
    }

    playGoldenBuzzerEffect(senderName) {
        const overlay = document.createElement('div');
        overlay.className = 'special-effect-overlay golden-overlay';
        
        // Confetti Canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'confetti-canvas';
        overlay.appendChild(canvas);

        // Banner with letter-by-letter popup animation
        const banner = document.createElement('div');
        banner.className = 'special-effect-banner golden-banner';

        const subtitle = document.createElement('div');
        subtitle.className = 'banner-subtitle golden-subtitle';
        subtitle.textContent = `✨ ${senderName} pressed the ✨`;

        const title = document.createElement('div');
        title.className = 'banner-title';
        const text = 'Golden Buzzer';
        for (let i = 0; i < text.length; i++) {
            const span = document.createElement('span');
            span.className = 'pop-letter golden-letter';
            span.style.animationDelay = `${i * 65}ms`;
            span.innerHTML = text[i] === ' ' ? '&nbsp;' : text[i];
            title.appendChild(span);
        }

        // Decorative floating buzzer icon in banner
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'banner-icon-wrapper golden-icon-wrapper';
        const iconImg = document.createElement('img');
        iconImg.src = '/img/buzzers/golden-buzzer.png';
        iconImg.alt = 'Golden Buzzer';
        iconWrapper.appendChild(iconImg);

        banner.appendChild(iconWrapper);
        banner.appendChild(subtitle);
        banner.appendChild(title);
        overlay.appendChild(banner);

        document.body.appendChild(overlay);

        // Resize canvas
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Run Confetti Animation
        this.animateGoldenConfetti(canvas, () => {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 600);
        });
    }

    animateGoldenConfetti(canvas, onComplete) {
        const ctx = canvas.getContext('2d');
        const colors = [
            '#FFD700', '#FFA500', '#DAA520', '#F1C40F', // Golden hues
            '#00FF7F', '#2E8B57', '#32CD32', '#00E676', // Emerald & green hues
            '#FFF8DC', '#FFFFFF', '#FFE4B5'             // Shimmer highlights
        ];

        const particleCount = 180;
        const particles = [];

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 18 + 6;
            particles.push({
                x: canvas.width / 2 + (Math.random() - 0.5) * 100,
                y: canvas.height / 2 + (Math.random() - 0.5) * 50,
                vx: Math.cos(angle) * speed * (Math.random() * 1.5 + 0.5),
                vy: Math.sin(angle) * speed - (Math.random() * 12 + 6), // Initial upward burst
                size: Math.random() * 12 + 6,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 12,
                shape: Math.random() > 0.4 ? 'rect' : (Math.random() > 0.5 ? 'circle' : 'ribbon'),
                ribbonLen: Math.random() * 20 + 10,
                opacity: 1,
                gravity: 0.28 + Math.random() * 0.1,
                drag: 0.982
            });
        }

        let startTime = Date.now();
        const duration = 4500;

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

                if (progress > 0.7) {
                    p.opacity = Math.max(0, 1 - (progress - 0.7) / 0.3);
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
                    } else if (p.shape === 'ribbon') {
                        ctx.fillRect(-p.size / 2, -p.ribbonLen / 2, p.size / 2, p.ribbonLen);
                    } else {
                        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
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

    playRottenTomatoEffect(senderName) {
        const overlay = document.createElement('div');
        overlay.className = 'special-effect-overlay tomato-overlay';
        
        // Splatter Canvas for red juice marks
        const canvas = document.createElement('canvas');
        canvas.className = 'splatter-canvas';
        overlay.appendChild(canvas);

        // Add tomato splatter icons across the screen
        const splatterContainer = document.createElement('div');
        splatterContainer.className = 'splatter-container';
        const splatterCount = 9;
        for (let i = 0; i < splatterCount; i++) {
            const splatterEl = document.createElement('div');
            splatterEl.className = 'tomato-splatter-item';
            const randomX = Math.floor(Math.random() * 80) + 10;
            const randomY = Math.floor(Math.random() * 75) + 10;
            const randomRot = Math.floor(Math.random() * 60) - 30;
            const randomDelay = Math.floor(Math.random() * 350);
            const randomScale = (Math.random() * 0.5 + 0.85).toFixed(2);

            splatterEl.style.left = `${randomX}%`;
            splatterEl.style.top = `${randomY}%`;
            splatterEl.style.transform = `translate(-50%, -50%) rotate(${randomRot}deg) scale(${randomScale})`;
            splatterEl.style.animationDelay = `${randomDelay}ms`;

            const img = document.createElement('img');
            img.src = '/img/buzzers/rotten-tomato.png';
            img.alt = 'Rotten Tomato';
            splatterEl.appendChild(img);

            splatterContainer.appendChild(splatterEl);
        }
        overlay.appendChild(splatterContainer);

        // Banner with letter-by-letter popup animation
        const banner = document.createElement('div');
        banner.className = 'special-effect-banner tomato-banner';

        const subtitle = document.createElement('div');
        subtitle.className = 'banner-subtitle tomato-subtitle';
        subtitle.textContent = `🍅 ${senderName} threw a 🍅`;

        const title = document.createElement('div');
        title.className = 'banner-title';
        const text = 'Rotten Tomato!';
        for (let i = 0; i < text.length; i++) {
            const span = document.createElement('span');
            span.className = 'pop-letter tomato-letter';
            span.style.animationDelay = `${i * 60}ms`;
            span.innerHTML = text[i] === ' ' ? '&nbsp;' : text[i];
            title.appendChild(span);
        }

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'banner-icon-wrapper tomato-icon-wrapper';
        const iconImg = document.createElement('img');
        iconImg.src = '/img/buzzers/rotten-tomato.png';
        iconImg.alt = 'Rotten Tomato';
        iconWrapper.appendChild(iconImg);

        banner.appendChild(iconWrapper);
        banner.appendChild(subtitle);
        banner.appendChild(title);
        overlay.appendChild(banner);

        document.body.appendChild(overlay);

        // Resize canvas
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Run splatter juice particle animation
        this.animateTomatoSplatter(canvas, () => {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 600);
        });
    }

    animateTomatoSplatter(canvas, onComplete) {
        const ctx = canvas.getContext('2d');
        const colors = [
            '#D32F2F', '#C62828', '#B71C1C', '#E53935', // Tomato red juice
            '#FF5252', '#8B0000', '#990000', '#4CAF50'  // Bright red & tiny tomato green flecks
        ];

        const particleCount = 140;
        const particles = [];

        // Create splatter particles bursting outwards from random splash centers
        const centers = [
            { x: canvas.width * 0.3, y: canvas.height * 0.4 },
            { x: canvas.width * 0.7, y: canvas.height * 0.35 },
            { x: canvas.width * 0.5, y: canvas.height * 0.65 },
            { x: canvas.width * 0.2, y: canvas.height * 0.7 },
            { x: canvas.width * 0.8, y: canvas.height * 0.75 }
        ];

        for (let i = 0; i < particleCount; i++) {
            const center = centers[i % centers.length];
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 14 + 3;
            const isDrip = Math.random() > 0.65;
            particles.push({
                x: center.x + (Math.random() - 0.5) * 40,
                y: center.y + (Math.random() - 0.5) * 40,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 10 + 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                opacity: 1,
                drag: 0.89,
                dripSpeed: isDrip ? (Math.random() * 2 + 1) : 0
            });
        }

        let startTime = Date.now();
        const duration = 4500;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let activeCount = 0;
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.vx *= p.drag;
                p.vy *= p.drag;
                p.x += p.vx;
                p.y += p.vy + p.dripSpeed; // Slowly drip down screen

                if (progress > 0.7) {
                    p.opacity = Math.max(0, 1 - (progress - 0.7) / 0.3);
                }

                if (p.opacity > 0.01) {
                    activeCount++;
                    ctx.save();
                    ctx.globalAlpha = p.opacity * 0.9;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
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
}
