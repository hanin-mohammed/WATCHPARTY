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
        
        this.muteBtn = document.getElementById('mute-btn');
        this.volumeSlider = document.getElementById('volume-slider');
        this.volumeIcon = document.getElementById('volume-icon');
        
        // Load saved volume
        try {
            const savedVol = localStorage.getItem('syncparty_volume');
            if (savedVol !== null) {
                this.video.volume = parseFloat(savedVol);
                if (this.volumeSlider) this.volumeSlider.value = savedVol;
                setTimeout(() => this.updateVolumeIcon(), 0);
            }
        } catch(e) {}
        
        this.progressContainer = document.getElementById('progress-container');
        this.progressBar = document.getElementById('progress-bar');
        this.progressFilled = document.getElementById('progress-filled');
        
        this.playhead = document.getElementById('playhead');
        this.scrubPreview = document.getElementById('scrub-preview');
        this.previewVideo = document.getElementById('preview-video');
        this.previewTime = document.getElementById('preview-time');
        
        this.currentTimeEl = document.getElementById('current-time');
        this.totalTimeEl = document.getElementById('total-time');
        
        // Info
        this.videoInfo = document.getElementById('video-info');
        this.fileNameEl = document.getElementById('file-name');
        this.fileSizeEl = document.getElementById('file-size');
        this.fileDurationEl = document.getElementById('file-duration');

        this.controlsOverlay = document.getElementById('video-controls');
        this.reactionsBar = document.getElementById('reactions-bar');
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
            if (!file) return;
            const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mkv|mov|avi|m4v)$/i);
            if (!isVideo) return;
            
            if (this.objectUrl) {
                URL.revokeObjectURL(this.objectUrl);
            }
            
            this.currentFile = file;
            let fileToPlay = file;
            if (file.name.toLowerCase().endsWith('.mkv')) {
                fileToPlay = new Blob([file], { type: 'video/mp4' });
            }
            this.objectUrl = URL.createObjectURL(fileToPlay);
            this.video.src = this.objectUrl;
            if (this.previewVideo) {
                this.previewVideo.src = this.objectUrl;
                this.previewVideo.load();
            }
            
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

        this.removeVideoBtn = document.getElementById('remove-video-btn');
        if (this.removeVideoBtn) {
            this.removeVideoBtn.addEventListener('click', () => {
                if (this.objectUrl) {
                    URL.revokeObjectURL(this.objectUrl);
                }
                this.currentFile = null;
                this.objectUrl = null;
                this.video.src = '';
                this.dropZone.classList.remove('hidden');
                this.video.classList.add('hidden');
                this.videoInfo.classList.add('hidden');
                this.fileInput.value = '';
                this.events.dispatchEvent(new CustomEvent('videoRemoved'));
            });
        }

        this.video.addEventListener('click', () => {
            if (this.video.paused) this.play();
            else this.pause();
        });

        this.video.addEventListener('dblclick', (e) => {
            e.preventDefault();
            this.toggleFullscreen();
        });

        this.fullscreenBtn.addEventListener('click', () => {
            this.toggleFullscreen();
        });

        if (this.muteBtn && this.volumeSlider) {
            this.muteBtn.addEventListener('click', () => {
                this.video.muted = !this.video.muted;
                this.updateVolumeIcon();
            });

            this.volumeSlider.addEventListener('input', (e) => {
                this.video.volume = e.target.value;
                this.video.muted = false;
                this.updateVolumeIcon();
                try {
                    localStorage.setItem('syncparty_volume', e.target.value);
                } catch(err) {}
            });
        }

        this.speedSelect.addEventListener('change', (e) => {
            this.events.dispatchEvent(new CustomEvent('userSpeedChange', { detail: { speed: parseFloat(e.target.value) } }));
        });

        this.isDragging = false;
        
        const updateScrub = (e, triggerSeek = false) => {
            if (!this.video.duration) return;
            const rect = this.progressContainer.getBoundingClientRect();
            let pos = (e.clientX - rect.left) / rect.width;
            pos = Math.max(0, Math.min(1, pos));
            const targetTime = pos * this.video.duration;
            
            // Instantly update UI for smooth dragging
            const percent = pos * 100;
            this.progressFilled.style.width = `${percent}%`;
            if (this.playhead) this.playhead.style.left = `${percent}%`;
            this.currentTimeEl.textContent = formatTime(targetTime);
            
            // Update preview during drag
            if (this.isDragging && this.scrubPreview) {
                if (this.previewTime) this.previewTime.textContent = formatTime(targetTime);
                if (this.previewVideo && this.previewVideo.readyState >= 1) {
                    if (!this._lastPreviewTime || performance.now() - this._lastPreviewTime > 150) {
                        this.previewVideo.currentTime = targetTime;
                        this._lastPreviewTime = performance.now();
                    }
                }
                const previewWidth = 160;
                let previewLeft = pos * rect.width;
                if (previewLeft < previewWidth / 2) previewLeft = previewWidth / 2;
                if (previewLeft > rect.width - previewWidth / 2) previewLeft = rect.width - previewWidth / 2;
                this.scrubPreview.style.left = `${previewLeft}px`;
            }
            
            if (triggerSeek) {
                this.events.dispatchEvent(new CustomEvent('userSeek', { detail: { time: targetTime } }));
            }
        };

        this.progressContainer.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.progressContainer.classList.add('is-dragging');
            updateScrub(e, false);
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                e.preventDefault(); // Prevent text selection while dragging
                updateScrub(e, false);
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                this.progressContainer.classList.remove('is-dragging');
                updateScrub(e, true);
            }
        });

        this.progressContainer.addEventListener('mousemove', (e) => {
            if (!this.video.duration || !this.scrubPreview) return;
            const rect = this.progressContainer.getBoundingClientRect();
            let pos = (e.clientX - rect.left) / rect.width;
            pos = Math.max(0, Math.min(1, pos));
            
            const targetTime = pos * this.video.duration;
            if (this.previewTime) this.previewTime.textContent = formatTime(targetTime);
            if (this.previewVideo && this.previewVideo.readyState >= 1) {
                if (!this._lastPreviewTime || performance.now() - this._lastPreviewTime > 150) {
                    this.previewVideo.currentTime = targetTime;
                    this._lastPreviewTime = performance.now();
                }
            }
            
            const previewWidth = 160;
            let previewLeft = pos * rect.width;
            
            if (previewLeft < previewWidth / 2) previewLeft = previewWidth / 2;
            if (previewLeft > rect.width - previewWidth / 2) previewLeft = rect.width - previewWidth / 2;
            
            this.scrubPreview.style.left = `${previewLeft}px`;
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
        this.chatOverlay = document.getElementById('chat-overlay');
        this.messageBar = document.querySelector('.message-bar');
        let hideTimeout;
        const showControls = () => {
            this.controlsOverlay.classList.add('active');
            if (this.reactionsBar) this.reactionsBar.classList.add('active');
            if (this.chatOverlay) this.chatOverlay.classList.add('active');
            if (this.messageBar) this.messageBar.classList.add('active');
            this.playerWrapper.style.cursor = 'default';
            clearTimeout(hideTimeout);
            
            const isChatFocused = document.activeElement === document.getElementById('chat-input');
            if (!this.video.paused && !isChatFocused) {
                hideTimeout = setTimeout(() => {
                    if (document.activeElement === document.getElementById('chat-input')) return;
                    this.controlsOverlay.classList.remove('active');
                    if (this.reactionsBar) this.reactionsBar.classList.remove('active');
                    if (this.chatOverlay) this.chatOverlay.classList.remove('active');
                    if (this.messageBar) this.messageBar.classList.remove('active');
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
            if (this.isDragging) return;
            this.currentTimeEl.textContent = formatTime(this.video.currentTime);
            if (this.video.duration) {
                const percent = (this.video.currentTime / this.video.duration) * 100;
                this.progressFilled.style.width = `${percent}%`;
                if (this.playhead) this.playhead.style.left = `${percent}%`;
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
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
        
        if (!fullscreenElement) {
            if (this.playerWrapper.requestFullscreen) {
                this.playerWrapper.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else if (this.playerWrapper.webkitRequestFullscreen) {
                this.playerWrapper.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    updateVolumeIcon() {
        if (!this.volumeIcon) return;
        if (this.video.muted || this.video.volume === 0) {
            this.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
        } else if (this.video.volume < 0.5) {
            this.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        } else {
            this.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        }
    }
}
