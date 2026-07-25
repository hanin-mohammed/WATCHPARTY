// player.js
import { formatTime, formatBytes } from './utils.js';

export class VideoPlayer {
    constructor() {
        this.video = document.getElementById('video-element');
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');
        
        // Controls
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.fullscreenBtn = document.getElementById('fullscreen-btn');
        this.speedSelect = document.getElementById('playback-speed');
        
        this.progressContainer = document.getElementById('progress-container');
        this.progressBar = document.getElementById('progress-bar');
        this.progressFilled = document.getElementById('progress-filled');
        
        this.currentTimeEl = document.getElementById('current-time');
        this.totalTimeEl = document.getElementById('total-time');
        
        // Info
        this.videoInfo = document.getElementById('video-info');
        this.fileNameEl = document.getElementById('file-name');
        this.fileSizeEl = document.getElementById('file-size');
        this.fileDurationEl = document.getElementById('file-duration');

        this.controlsOverlay = document.getElementById('video-controls');
        this.playerWrapper = document.getElementById('player-wrapper');

        this.currentFile = null;
        this.objectUrl = null;

        // Custom Event Target for Sync.js to listen to
        this.events = new EventTarget();

        this.setupFileHandling();
        this.setupControls();
        this.setupVideoEvents();
    }

    setupFileHandling() {
        const handleFile = (file) => {
            if (!file || !file.type.startsWith('video/')) return;
            
            if (this.objectUrl) {
                URL.revokeObjectURL(this.objectUrl);
            }
            
            this.currentFile = file;
            this.objectUrl = URL.createObjectURL(file);
            this.video.src = this.objectUrl;
            
            this.dropZone.classList.add('hidden');
            this.video.classList.remove('hidden');
            this.videoInfo.classList.remove('hidden');
            
            this.fileNameEl.textContent = file.name;
            this.fileSizeEl.textContent = formatBytes(file.size);
            
            this.events.dispatchEvent(new CustomEvent('fileLoaded', { detail: { file } }));
        };

        this.fileInput.addEventListener('change', (e) => {
            handleFile(e.target.files[0]);
        });

        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('dragover');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('dragover');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                handleFile(e.dataTransfer.files[0]);
            }
        });
        
        // Also allow dropping onto the video element itself to replace
        this.video.addEventListener('dragover', (e) => e.preventDefault());
        this.video.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) {
                handleFile(e.dataTransfer.files[0]);
            }
        });
    }

    setupControls() {
        this.playPauseBtn.addEventListener('click', () => {
            if (this.video.paused) this.play();
            else this.pause();
        });

        this.video.addEventListener('click', () => {
            if (this.video.paused) this.play();
            else this.pause();
        });

        this.video.addEventListener('dblclick', () => {
            this.toggleFullscreen();
        });

        this.fullscreenBtn.addEventListener('click', () => {
            this.toggleFullscreen();
        });

        this.speedSelect.addEventListener('change', (e) => {
            this.events.dispatchEvent(new CustomEvent('userSpeedChange', { detail: { speed: parseFloat(e.target.value) } }));
        });

        this.progressContainer.addEventListener('click', (e) => {
            if (!this.video.duration) return;
            const rect = this.progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            const targetTime = pos * this.video.duration;
            this.events.dispatchEvent(new CustomEvent('userSeek', { detail: { time: targetTime } }));
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in an input
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            if (e.code === 'Space') {
                e.preventDefault();
                if (this.video.paused) this.play();
                else this.pause();
            } else if (e.code === 'ArrowRight') {
                this.events.dispatchEvent(new CustomEvent('userSeek', { detail: { time: this.video.currentTime + 5 } }));
            } else if (e.code === 'ArrowLeft') {
                this.events.dispatchEvent(new CustomEvent('userSeek', { detail: { time: this.video.currentTime - 5 } }));
            } else if (e.code === 'KeyF') {
                this.toggleFullscreen();
            }
        });
        
        // Mouse movement for controls overlay hide/show timeout
        let hideTimeout;
        const showControls = () => {
            this.controlsOverlay.classList.add('active');
            this.playerWrapper.style.cursor = 'default';
            clearTimeout(hideTimeout);
            if (!this.video.paused) {
                hideTimeout = setTimeout(() => {
                    this.controlsOverlay.classList.remove('active');
                    this.playerWrapper.style.cursor = 'none';
                }, 2500);
            }
        };
        
        this.playerWrapper.addEventListener('mousemove', showControls);
        this.video.addEventListener('play', showControls);
        this.video.addEventListener('pause', showControls);
    }

    setupVideoEvents() {
        this.video.addEventListener('loadedmetadata', () => {
            this.totalTimeEl.textContent = formatTime(this.video.duration);
            this.fileDurationEl.textContent = formatTime(this.video.duration);
            this.events.dispatchEvent(new CustomEvent('durationChange', { detail: { duration: this.video.duration } }));
        });

        this.video.addEventListener('timeupdate', () => {
            this.currentTimeEl.textContent = formatTime(this.video.currentTime);
            if (this.video.duration) {
                const percent = (this.video.currentTime / this.video.duration) * 100;
                this.progressFilled.style.width = `${percent}%`;
            }
        });

        this.video.addEventListener('play', () => {
            this.playPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
            this.events.dispatchEvent(new CustomEvent('stateChange', { detail: { playing: true } }));
        });

        this.video.addEventListener('pause', () => {
            this.playPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            this.events.dispatchEvent(new CustomEvent('stateChange', { detail: { playing: false } }));
        });

        this.video.addEventListener('waiting', () => {
            this.events.dispatchEvent(new CustomEvent('buffering', { detail: { buffering: true } }));
        });

        this.video.addEventListener('playing', () => {
            this.events.dispatchEvent(new CustomEvent('buffering', { detail: { buffering: false } }));
        });
        
        this.video.addEventListener('ratechange', () => {
            // Update UI selector to match current real rate (which might be tweaked by sync engine)
            // But we don't want to overwrite the user's selected base speed in the dropdown necessarily
            // Actually, we'll let sync engine handle setting the base rate.
        });
    }

    play() {
        this.events.dispatchEvent(new CustomEvent('userPlay'));
    }

    pause() {
        this.events.dispatchEvent(new CustomEvent('userPause'));
    }

    // Direct methods for Sync engine to call
    forcePlay() {
        this.video.play().catch(e => console.warn('Play prevented', e));
    }

    forcePause() {
        this.video.pause();
    }

    forceSeek(time) {
        if (Math.abs(this.video.currentTime - time) > 0.1) {
            this.video.currentTime = time;
        }
    }

    setPlaybackRate(rate) {
        this.video.playbackRate = rate;
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.playerWrapper.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }
}
