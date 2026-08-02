// player.js
import { formatTime, formatBytes } from './utils.js';
import { notifications } from './notifications.js';

class RecentFilesDB {
    constructor() {
        this.dbName = 'syncparty_recent_files_db';
        this.storeName = 'recent_files';
        this.dbPromise = null;
    }

    getDB() {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
        return this.dbPromise;
    }

    async saveFile(file) {
        try {
            const db = await this.getDB();
            const id = `${file.name}_${file.size}`;
            const record = {
                id,
                name: file.name,
                size: file.size,
                type: file.type,
                lastUsed: Date.now(),
                file: file
            };
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const putReq = store.put(record);
                putReq.onsuccess = () => resolve();
                putReq.onerror = (e) => reject(e.target.error);
            });

            const all = await this.getAll();
            if (all.length > 3) {
                const toRemove = all.slice(3);
                const tx = await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    toRemove.forEach(r => store.delete(r.id));
                    tx.oncomplete = () => resolve();
                    tx.onerror = (e) => reject(e.target.error);
                });
            }
        } catch (err) {
            console.warn('Could not save recent file to IndexedDB:', err);
        }
    }

    async deleteFile(id) {
        try {
            const db = await this.getDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn('Could not delete recent file:', err);
        }
    }

    async getAll() {
        try {
            const db = await this.getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.getAll();
                req.onsuccess = () => {
                    const list = req.result || [];
                    list.sort((a, b) => b.lastUsed - a.lastUsed);
                    resolve(list.slice(0, 3));
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn('Could not fetch recent files:', err);
            return [];
        }
    }
}

export class VideoPlayer {
    constructor() {
        this.recentFilesDB = new RecentFilesDB();
        this.video = document.getElementById('video-element');
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');
        
        // Controls
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.fullscreenBtn = document.getElementById('fullscreen-btn');
        this.videoCallModeBtn = document.getElementById('video-call-mode-btn');
        this.isVideoCallMode = false;
        this.speedSelect = document.getElementById('playback-speed');
        
        this.muteBtn = document.getElementById('mute-btn');
        this.volumeSlider = document.getElementById('volume-slider');
        this.volumeIcon = document.getElementById('volume-icon');
        this._previousVolume = 1;
        this.isSeeking = false;
        
        // Load saved volume
        try {
            const savedVol = localStorage.getItem('syncparty_volume');
            if (savedVol !== null) {
                const vol = parseFloat(savedVol);
                this.video.volume = vol;
                if (this.volumeSlider) this.volumeSlider.value = savedVol;
                if (vol > 0) this._previousVolume = vol;
                setTimeout(() => this.updateVolumeIcon(), 0);
            } else if (this.video.volume > 0) {
                this._previousVolume = this.video.volume;
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
        this.setupWallpaperAnimation();
    }

    setupFileHandling() {
        const handleFile = async (file, isFromRecent = false) => {
            if (!file) {
                if (isFromRecent) {
                    notifications.show('File no longer exists', 'error');
                }
                return;
            }
            this.handleFileCallback = handleFile;
            const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mkv|mov|avi|m4v)$/i);
            if (!isVideo) return;
            
            try {
                await file.slice(0, 1).arrayBuffer();
            } catch (err) {
                console.warn('File no longer exists or cannot be read:', err);
                notifications.show('File no longer exists', 'error');
                return;
            }

            if (this.objectUrl) {
                URL.revokeObjectURL(this.objectUrl);
            }
            
            this.currentFile = file;
            let fileToPlay = file;
            // Safari AVFoundation rejects MKV files masquerading as video/mp4 because EBML headers
            // do not match MP4 ftyp boxes. However, Safari 14.1+ natively supports video/webm,
            // which uses the Matroska EBML container format. Serving as video/webm allows WebKit's
            // EBML parser to process Matroska containers.
            if (file.name.toLowerCase().endsWith('.mkv')) {
                fileToPlay = new Blob([file], { type: 'video/webm' });
            }
            this.objectUrl = URL.createObjectURL(fileToPlay);
            this.video.src = this.objectUrl;
            if (this.previewVideo) {
                this.previewVideo.src = this.objectUrl;
                this.previewVideo.load();
            }
            if (this.progressContainer) {
                this.progressContainer.classList.add('has-video');
            }
            
            this.dropZone.classList.add('hidden');
            if (this.stopWallpaperAnimation) this.stopWallpaperAnimation();
            this.video.classList.remove('hidden');
            this.videoInfo.classList.remove('hidden');
            
            this.fileNameEl.textContent = file.name;
            this.fileNameEl.title = file.name;
            this.fileSizeEl.textContent = formatBytes(file.size);
            
            if (this.recentFilesDB) {
                this.recentFilesDB.saveFile(file).then(() => this.refreshRecentFilesUI());
            }
            
            this.events.dispatchEvent(new CustomEvent('fileLoaded', { detail: { file } }));
        };
        this.handleFileCallback = handleFile;

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

        this.recentBtn = document.getElementById('recent-videos-btn');
        this.recentDropdown = document.getElementById('recent-videos-dropdown');
        this.recentListEl = document.getElementById('recent-videos-list');

        if (this.recentBtn && this.recentDropdown) {
            this.recentBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = this.recentDropdown.classList.contains('hidden');
                if (isHidden) {
                    this.refreshRecentFilesUI();
                    this.recentDropdown.classList.remove('hidden');
                } else {
                    this.recentDropdown.classList.add('hidden');
                }
            });

            document.addEventListener('click', (e) => {
                if (!this.recentDropdown.contains(e.target) && !this.recentBtn.contains(e.target)) {
                    this.recentDropdown.classList.add('hidden');
                }
            });
        }
        this.refreshRecentFilesUI();
    }

    async refreshRecentFilesUI() {
        if (!this.recentListEl || !this.recentFilesDB) return;
        const records = await this.recentFilesDB.getAll();
        this.recentListEl.innerHTML = '';
        if (!records || records.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'recent-video-empty';
            emptyLi.textContent = 'No recent files';
            this.recentListEl.appendChild(emptyLi);
            return;
        }

        records.forEach(record => {
            const li = document.createElement('li');
            li.className = 'recent-video-item';
            li.innerHTML = `
                <div class="recent-video-name">${record.name}</div>
                <div class="recent-video-size">${formatBytes(record.size)}</div>
            `;
            li.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (this.recentDropdown) {
                    this.recentDropdown.classList.add('hidden');
                }

                if (!record.file || typeof record.file.slice !== 'function') {
                    notifications.show('File no longer exists', 'error');
                    if (this.recentFilesDB && record.id) {
                        await this.recentFilesDB.deleteFile(record.id);
                        this.refreshRecentFilesUI();
                    }
                    return;
                }

                try {
                    await record.file.slice(0, 1).arrayBuffer();
                } catch (err) {
                    console.warn('Could not read recent file:', err);
                    notifications.show('File no longer exists', 'error');
                    if (this.recentFilesDB && record.id) {
                        await this.recentFilesDB.deleteFile(record.id);
                        this.refreshRecentFilesUI();
                    }
                    return;
                }

                if (this.handleFileCallback) {
                    this.handleFileCallback(record.file, true);
                }
            });
            this.recentListEl.appendChild(li);
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
                if (this.progressContainer) {
                    this.progressContainer.classList.remove('has-video');
                }
                this.dropZone.classList.remove('hidden');
                if (this.startWallpaperAnimation) this.startWallpaperAnimation();
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

        if (this.videoCallModeBtn) {
            this.videoCallModeBtn.addEventListener('click', () => {
                this.toggleVideoCallMode();
            });
        }

        const updateFullscreenClass = () => {
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl) {
                this.playerWrapper.classList.add('is-fullscreen');
            } else {
                this.playerWrapper.classList.remove('is-fullscreen');
                if (this.isVideoCallMode) {
                    this.isVideoCallMode = false;
                    this.playerWrapper.classList.remove('video-call-mode');
                    if (this.videoCallModeBtn) {
                        this.videoCallModeBtn.classList.remove('active');
                        this.videoCallModeBtn.title = "Video Call Mode - Resize for PiP video call";
                    }
                }
            }
        };
        document.addEventListener('fullscreenchange', updateFullscreenClass);
        document.addEventListener('webkitfullscreenchange', updateFullscreenClass);
        this.video.addEventListener('webkitbeginfullscreen', () => {
            this.playerWrapper.classList.add('is-fullscreen');
        });
        this.video.addEventListener('webkitendfullscreen', () => {
            this.playerWrapper.classList.remove('is-fullscreen');
            if (this.isVideoCallMode) {
                this.isVideoCallMode = false;
                this.playerWrapper.classList.remove('video-call-mode');
                if (this.videoCallModeBtn) {
                    this.videoCallModeBtn.classList.remove('active');
                    this.videoCallModeBtn.title = "Video Call Mode - Resize for PiP video call";
                }
            }
        });

        if (this.muteBtn && this.volumeSlider) {
            this.muteBtn.addEventListener('click', () => {
                const isCurrentlyMuted = this.video.muted || parseFloat(this.volumeSlider.value) === 0 || this.video.volume === 0;
                if (isCurrentlyMuted) {
                    const restoreVol = (this._previousVolume && this._previousVolume > 0) ? this._previousVolume : 1;
                    this.video.muted = false;
                    this.video.volume = restoreVol;
                    this.volumeSlider.value = restoreVol;
                    try {
                        localStorage.setItem('syncparty_volume', restoreVol);
                    } catch(err) {}
                } else {
                    const currentSliderVal = parseFloat(this.volumeSlider.value);
                    if (currentSliderVal > 0) {
                        this._previousVolume = currentSliderVal;
                    }
                    this.video.muted = true;
                    this.video.volume = 0;
                    this.volumeSlider.value = 0;
                    try {
                        localStorage.setItem('syncparty_volume', 0);
                    } catch(err) {}
                }
                this.updateVolumeIcon();
            });

            this.volumeSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.video.volume = val;
                this.video.muted = (val === 0);
                if (val > 0) {
                    this._previousVolume = val;
                }
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
        
        const getClientX = (evt) => {
            if (evt.touches && evt.touches.length > 0) return evt.touches[0].clientX;
            if (evt.changedTouches && evt.changedTouches.length > 0) return evt.changedTouches[0].clientX;
            return evt.clientX;
        };

        const updateScrub = (e, triggerSeek = false) => {
            if (!this.video.duration || isNaN(this.video.duration) || !this.progressContainer.classList.contains('has-video')) return;
            const rect = this.progressContainer.getBoundingClientRect();
            const clientX = getClientX(e);
            let pos = (clientX - rect.left) / rect.width;
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
                this.isSeeking = true;
                this.targetSeekTime = targetTime;
                clearTimeout(this._seekTimeout);
                this._seekTimeout = setTimeout(() => { this.isSeeking = false; }, 3000);
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

        this.progressContainer.addEventListener('touchstart', (e) => {
            this.isDragging = true;
            this.progressContainer.classList.add('is-dragging');
            updateScrub(e, false);
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                if (e.cancelable) e.preventDefault();
                updateScrub(e, false);
            }
        }, { passive: false });

        const endTouchScrub = (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                this.progressContainer.classList.remove('is-dragging');
                updateScrub(e, true);
            }
        };
        document.addEventListener('touchend', endTouchScrub);
        document.addEventListener('touchcancel', endTouchScrub);

        this.progressContainer.addEventListener('mousemove', (e) => {
            if (!this.video.duration || isNaN(this.video.duration) || !this.scrubPreview || !this.progressContainer.classList.contains('has-video')) {
                if (this.scrubPreview) {
                    this.scrubPreview.style.opacity = '0';
                    this.scrubPreview.style.visibility = 'hidden';
                }
                return;
            }
            const rect = this.progressContainer.getBoundingClientRect();
            const clientX = getClientX(e);
            let pos = (clientX - rect.left) / rect.width;
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
            } else if (e.code === 'KeyV' || e.code === 'KeyP') {
                this.toggleVideoCallMode();
            }
        });
        
        // Mouse movement for controls overlay hide/show timeout
        this.chatOverlay = document.getElementById('chat-overlay');
        this.messageBar = document.querySelector('.message-bar');
        let hideTimeout;
        const showControls = () => {
            this.controlsOverlay.classList.add('active');
            const subtitleOverlay = document.getElementById('subtitle-text-overlay');
            if (subtitleOverlay) subtitleOverlay.classList.add('toolbar-visible');
            if (this.chatOverlay) this.chatOverlay.classList.add('active');
            if (this.messageBar) this.messageBar.classList.add('active');
            this.playerWrapper.style.cursor = 'default';
            clearTimeout(hideTimeout);
            
            const isChatFocused = document.activeElement === document.getElementById('chat-input');
            if (!this.video.paused && !isChatFocused) {
                hideTimeout = setTimeout(() => {
                    if (document.activeElement === document.getElementById('chat-input')) return;
                    this.controlsOverlay.classList.remove('active');
                    if (subtitleOverlay) subtitleOverlay.classList.remove('toolbar-visible');
                    if (this.reactionsBar) this.reactionsBar.classList.remove('active');
                    const reactionBtn = document.getElementById('reaction-mode-btn');
                    if (reactionBtn) reactionBtn.classList.remove('active');
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
            if (this.progressContainer) {
                this.progressContainer.classList.add('has-video');
            }
            this.totalTimeEl.textContent = formatTime(this.video.duration);
            this.fileDurationEl.textContent = formatTime(this.video.duration);
            this.events.dispatchEvent(new CustomEvent('durationChange', { detail: { duration: this.video.duration } }));
        });

        this.video.addEventListener('timeupdate', () => {
            if (this.isDragging || this.isSeeking || this.video.seeking) return;
            this.currentTimeEl.textContent = formatTime(this.video.currentTime);
            if (this.video.duration) {
                const percent = (this.video.currentTime / this.video.duration) * 100;
                this.progressFilled.style.width = `${percent}%`;
                if (this.playhead) this.playhead.style.left = `${percent}%`;
            }
        });

        this.video.addEventListener('seeking', () => {
            this.isSeeking = true;
            clearTimeout(this._seekTimeout);
            this._seekTimeout = setTimeout(() => {
                this.isSeeking = false;
            }, 3000);
        });

        this.video.addEventListener('seeked', () => {
            this.isSeeking = false;
            clearTimeout(this._seekTimeout);
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
            this.isSeeking = true;
            this.targetSeekTime = time;
            clearTimeout(this._seekTimeout);
            this._seekTimeout = setTimeout(() => {
                this.isSeeking = false;
            }, 3000);
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
                    if (this.video.webkitEnterFullscreen) {
                        this.video.webkitEnterFullscreen();
                    } else if (this.video.webkitRequestFullscreen) {
                        this.video.webkitRequestFullscreen();
                    }
                });
            } else if (this.playerWrapper.webkitRequestFullscreen) {
                this.playerWrapper.webkitRequestFullscreen();
            } else if (this.video.webkitEnterFullscreen) {
                this.video.webkitEnterFullscreen();
            } else if (this.video.webkitRequestFullscreen) {
                this.video.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    toggleVideoCallMode() {
        const isFS = document.fullscreenElement || document.webkitFullscreenElement || (this.playerWrapper && this.playerWrapper.classList.contains('is-fullscreen'));
        if (!isFS) {
            if (typeof notifications !== 'undefined' && notifications.show) {
                notifications.show('Video Call Mode only works in fullscreen mode', 'warning');
            }
            return;
        }
        this.isVideoCallMode = !this.isVideoCallMode;
        if (this.playerWrapper) {
            this.playerWrapper.classList.toggle('video-call-mode', this.isVideoCallMode);
        }
        if (this.videoCallModeBtn) {
            this.videoCallModeBtn.classList.toggle('active', this.isVideoCallMode);
            this.videoCallModeBtn.title = this.isVideoCallMode 
                ? "Exit Video Call Mode" 
                : "Video Call Mode - Resize for PiP video call";
        }
        if (this.isVideoCallMode) {
            if (typeof notifications !== 'undefined' && notifications.show) {
                notifications.show('Video Call Mode ON: Top-Right space reserved for PiP call', 'success');
            }
        } else {
            if (typeof notifications !== 'undefined' && notifications.show) {
                notifications.show('Video Call Mode OFF: Full video size restored', 'info');
            }
        }
    }

    updateVolumeIcon() {
        if (!this.volumeIcon) return;
        if (this.video.muted || this.video.volume === 0 || (this.volumeSlider && parseFloat(this.volumeSlider.value) === 0)) {
            this.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
        } else if (this.video.volume < 0.5) {
            this.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        } else {
            this.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        }
    }

    setupWallpaperAnimation() {
        const getBlobs = () => {
            if (!this.dropZone) return [];
            return this.dropZone.querySelectorAll('.wallpaper-blob');
        };

        const blobConfigs = [
            {
                baseX: 0, baseY: 0,
                ampX1: 28, freqX1: (2 * Math.PI) / 65, phaseX1: 0.2,
                ampX2: 14, freqX2: (2 * Math.PI) / 41, phaseX2: 1.5,
                ampY1: 25, freqY1: (2 * Math.PI) / 72, phaseY1: 0.8,
                ampY2: 12, freqY2: (2 * Math.PI) / 49, phaseY2: 2.1,
                ampS: 0.18, freqS: (2 * Math.PI) / 55, phaseS: 0.5,
                baseO: 0.85, ampO: 0.10, freqO: (2 * Math.PI) / 47, phaseO: 1.2
            },
            {
                baseX: 15, baseY: -15,
                ampX1: 32, freqX1: (2 * Math.PI) / 78, phaseX1: 2.3,
                ampX2: 15, freqX2: (2 * Math.PI) / 46, phaseX2: 0.7,
                ampY1: 28, freqY1: (2 * Math.PI) / 68, phaseY1: 3.1,
                ampY2: 10, freqY2: (2 * Math.PI) / 53, phaseY2: 1.1,
                ampS: 0.20, freqS: (2 * Math.PI) / 62, phaseS: 2.0,
                baseO: 0.80, ampO: 0.12, freqO: (2 * Math.PI) / 51, phaseO: 0.3
            },
            {
                baseX: -15, baseY: 15,
                ampX1: 30, freqX1: (2 * Math.PI) / 70, phaseX1: 4.1,
                ampX2: 16, freqX2: (2 * Math.PI) / 44, phaseX2: 2.8,
                ampY1: 30, freqY1: (2 * Math.PI) / 75, phaseY1: 1.4,
                ampY2: 14, freqY2: (2 * Math.PI) / 57, phaseY2: 3.7,
                ampS: 0.22, freqS: (2 * Math.PI) / 68, phaseS: 4.5,
                baseO: 0.82, ampO: 0.12, freqO: (2 * Math.PI) / 59, phaseO: 2.6
            },
            {
                baseX: 20, baseY: 20,
                ampX1: 26, freqX1: (2 * Math.PI) / 60, phaseX1: 1.1,
                ampX2: 12, freqX2: (2 * Math.PI) / 38, phaseX2: 3.4,
                ampY1: 24, freqY1: (2 * Math.PI) / 64, phaseY1: 2.7,
                ampY2: 13, freqY2: (2 * Math.PI) / 43, phaseY2: 0.9,
                ampS: 0.16, freqS: (2 * Math.PI) / 49, phaseS: 1.7,
                baseO: 0.75, ampO: 0.12, freqO: (2 * Math.PI) / 42, phaseO: 3.8
            },
            {
                baseX: -20, baseY: -15,
                ampX1: 29, freqX1: (2 * Math.PI) / 85, phaseX1: 3.2,
                ampX2: 14, freqX2: (2 * Math.PI) / 52, phaseX2: 1.9,
                ampY1: 27, freqY1: (2 * Math.PI) / 80, phaseY1: 4.6,
                ampY2: 11, freqY2: (2 * Math.PI) / 58, phaseY2: 2.4,
                ampS: 0.19, freqS: (2 * Math.PI) / 73, phaseS: 3.3,
                baseO: 0.80, ampO: 0.10, freqO: (2 * Math.PI) / 63, phaseO: 0.7
            }
        ];

        let isRunning = false;
        let animationFrameId = null;
        const startTime = performance.now();

        const animate = (timestamp) => {
            if (document.hidden || (this.dropZone && this.dropZone.classList.contains('hidden'))) {
                isRunning = false;
                animationFrameId = null;
                return;
            }

            const blobs = getBlobs();
            if (blobs.length > 0) {
                const t = (timestamp - startTime) * 0.001; // seconds
                blobs.forEach((blob, i) => {
                    const config = blobConfigs[i % blobConfigs.length];
                    const x = config.baseX +
                        config.ampX1 * Math.sin(t * config.freqX1 + config.phaseX1) +
                        config.ampX2 * Math.sin(t * config.freqX2 + config.phaseX2);
                    const y = config.baseY +
                        config.ampY1 * Math.cos(t * config.freqY1 + config.phaseY1) +
                        config.ampY2 * Math.sin(t * config.freqY2 + config.phaseY2);
                    const scale = 1.05 + config.ampS * Math.sin(t * config.freqS + config.phaseS);
                    const opacity = config.baseO + config.ampO * Math.cos(t * config.freqO + config.phaseO);

                    blob.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(2)}%, 0) scale(${scale.toFixed(3)})`;
                    blob.style.opacity = opacity.toFixed(3);
                });
            }

            animationFrameId = requestAnimationFrame(animate);
        };

        this.startWallpaperAnimation = () => {
            if (!isRunning && !document.hidden && this.dropZone && !this.dropZone.classList.contains('hidden')) {
                isRunning = true;
                animationFrameId = requestAnimationFrame(animate);
            }
        };

        this.stopWallpaperAnimation = () => {
            isRunning = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        };

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopWallpaperAnimation();
            } else {
                this.startWallpaperAnimation();
            }
        });

        this.startWallpaperAnimation();
    }
}
