// notifications.js

export class Notifications {
    constructor() {
        this.container = document.getElementById('notifications-container');
    }

    show(message, type = 'info', duration = 3000) {
        const el = document.createElement('div');
        el.className = `notification ${type}`;
        
        let icon = '';
        if (type === 'success') icon = '✓';
        else if (type === 'error') icon = '✕';
        else if (type === 'warning') icon = '⚠';
        else icon = 'ℹ';

        el.innerHTML = `
            <div class="icon">${icon}</div>
            <div class="message">${message}</div>
        `;
        
        this.container.appendChild(el);

        setTimeout(() => {
            el.classList.add('fade-out');
            setTimeout(() => {
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }, 300);
        }, duration);
    }
}

export const notifications = new Notifications();
