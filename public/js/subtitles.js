// subtitles.js
import { settings } from './settings.js';

export class SubtitleManager {
    constructor(player) {
        this.player = player;
        this.input = document.getElementById('subtitle-input');
        this.track = null;
        this.cues = [];
        this.offsetMs = settings.get('subtitleDelay') || 0;
        
        this.setupListeners();
        this.applySettings();
    }

    setupListeners() {
        this.input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadSubtitle(file);
            }
        });

        // Listen for settings changes if we had a settings event bus
        // For now, we manually apply styles based on settings
    }

    applySettings() {
        // Use CSS variables or inject style for subtitle size
        const style = document.createElement('style');
        style.innerHTML = `
            ::cue {
                font-size: ${settings.get('subtitleSize') || 24}px;
            }
        `;
        document.head.appendChild(style);
    }

    setOffset(ms) {
        this.offsetMs = ms;
        settings.set('subtitleDelay', ms);
        this.updateTrack();
    }

    async loadSubtitle(file) {
        const text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (ext === 'srt') {
            this.cues = this.parseSRT(text);
        } else if (ext === 'vtt') {
            this.cues = this.parseVTT(text);
        } else {
            console.warn('Unsupported subtitle format');
            return;
        }

        this.updateTrack();
        
        // Notify room that we loaded subtitles
        const evt = new CustomEvent('subtitleLoaded', { detail: { loaded: true } });
        document.dispatchEvent(evt); // UI.js can listen to this to update roomManager
    }

    updateTrack() {
        if (!this.player.video) return;
        
        // Remove existing tracks
        const tracks = this.player.video.getElementsByTagName('track');
        for (let i = tracks.length - 1; i >= 0; i--) {
            this.player.video.removeChild(tracks[i]);
        }

        // Rebuild VTT with offset applied
        let vttText = 'WEBVTT\n\n';
        
        this.cues.forEach(cue => {
            const start = this.formatVttTime(cue.start + (this.offsetMs / 1000));
            const end = this.formatVttTime(cue.end + (this.offsetMs / 1000));
            if (start && end) {
                vttText += `${start} --> ${end}\n${cue.text}\n\n`;
            }
        });

        const blob = new Blob([vttText], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);

        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = 'Custom';
        trackEl.srclang = 'en';
        trackEl.src = url;
        trackEl.default = true;
        
        this.player.video.appendChild(trackEl);
    }

    parseSRT(data) {
        const pattern = /(\d+)\r?\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\r?\n\r?\n\d+|\r?\n?$)/g;
        let match;
        const parsed = [];
        while ((match = pattern.exec(data)) !== null) {
            parsed.push({
                start: this.srtTimeToSeconds(match[2]),
                end: this.srtTimeToSeconds(match[3]),
                text: match[4]
            });
        }
        return parsed;
    }

    parseVTT(data) {
        // Very simplified VTT parser
        const pattern = /(\d{2}:)?(\d{2}:\d{2}\.\d{3}) --> (\d{2}:)?(\d{2}:\d{2}\.\d{3})(?:.*)\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n?$)/g;
        let match;
        const parsed = [];
        while ((match = pattern.exec(data)) !== null) {
            parsed.push({
                start: this.vttTimeToSeconds((match[1] || '') + match[2]),
                end: this.vttTimeToSeconds((match[3] || '') + match[4]),
                text: match[5]
            });
        }
        return parsed;
    }

    srtTimeToSeconds(timeStr) {
        const p = timeStr.split(':');
        const s = p[2].split(',');
        return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseInt(s[0]) + parseInt(s[1]) / 1000;
    }

    vttTimeToSeconds(timeStr) {
        const p = timeStr.split(':');
        let sec = 0;
        if (p.length === 3) {
            sec = parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseFloat(p[2]);
        } else {
            sec = parseInt(p[0]) * 60 + parseFloat(p[1]);
        }
        return sec;
    }

    formatVttTime(seconds) {
        if (seconds < 0) return null; // Avoid negative times breaking VTT
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
}
