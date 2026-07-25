// settings.js

export const defaultSettings = {
    username: '',
    color: '#4a8cff',
    subtitleDelay: 0,
    subtitleSize: 24,
    lastRoomId: ''
};

export class Settings {
    constructor() {
        this.data = { ...defaultSettings };
        this.load();
    }

    load() {
        try {
            const saved = localStorage.getItem('syncparty_settings');
            if (saved) {
                this.data = { ...this.data, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Failed to load settings', e);
        }
    }

    save() {
        try {
            localStorage.setItem('syncparty_settings', JSON.stringify(this.data));
        } catch (e) {
            console.warn('Failed to save settings', e);
        }
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
    }
}

export const settings = new Settings();
