// subtitles.js
// Production-grade client-side subtitle engine for local video files.
// Supports Matroska (.mkv/.webm), MP4 (.mp4/.m4v/.mov), and external subtitle files (.srt/.vtt/.ass).
// Converts extracted cues to WebVTT and dynamically attaches native HTML5 <track> elements to <video>.

import { settings } from './settings.js';
import { isFFmpegSupported, inspectSubtitleTracksFFmpeg, extractSubtitleWebVTTFFmpeg } from './ffmpeg-subtitles.js';

export class SubtitleManager {
    constructor(player) {
        this.player = player;
        this.input = document.getElementById('subtitle-input');
        
        // Subtitle menu UI elements
        this.menuBtn = document.getElementById('subtitles-menu-btn');
        this.dropdown = document.getElementById('subtitles-dropdown');
        this.trackListEl = document.getElementById('subtitles-track-list');
        this.trackCountEl = document.getElementById('subtitles-track-count');
        this.countBadgeEl = document.getElementById('subtitles-count-badge');
        this.pgsCanvas = document.getElementById('pgs-subtitle-canvas');
        this.textOverlay = document.getElementById('subtitle-text-overlay');
        
        this.track = null;
        this.cues = [];
        this.offsetMs = settings.get('subtitleDelay') || 0;
        
        this.availableTracks = [];
        this.activeTrackId = 'off';
        this.lastRenderedCue = null;
        
        this.setupListeners();
        this.applySettings();
        this.startActiveCuesRenderer();
    }

    setupListeners() {
        if (this.input) {
            this.input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.loadSubtitle(file);
                }
            });
        }

        if (this.menuBtn) {
            this.menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDropdown();
            });
        }

        document.addEventListener('click', (e) => {
            if (this.dropdown && !this.dropdown.contains(e.target) && (!this.menuBtn || !this.menuBtn.contains(e.target))) {
                this.closeDropdown();
            }
        });

        if (this.player && this.player.events) {
            this.player.events.addEventListener('fileLoaded', async (e) => {
                if (e.detail && e.detail.file) {
                    await this.handleFileLoaded(e.detail.file);
                }
            });
        }

        if (this.player && this.player.video) {
            this.player.video.addEventListener('loadedmetadata', () => {
                this.inspectNativeTracks();
            });

            this.player.video.addEventListener('timeupdate', () => {
                this.renderPGSOverlay();
            });
        }

        if (this.trackListEl) {
            this.trackListEl.addEventListener('click', (e) => {
                const item = e.target.closest('.subtitles-item[data-track-id]');
                if (item) {
                    const trackId = item.getAttribute('data-track-id');
                    this.selectTrack(trackId);
                    this.closeDropdown();
                }
            });
        }
    }

    toggleDropdown() {
        if (!this.dropdown) return;
        const isActive = this.dropdown.classList.contains('active');
        if (isActive) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        if (!this.dropdown) return;
        this.refreshSubtitleMenu();
        this.dropdown.classList.add('active');
    }

    closeDropdown() {
        if (!this.dropdown) return;
        this.dropdown.classList.remove('active');
    }

    refreshSubtitleMenu() {
        if (this.trackCountEl) {
            this.trackCountEl.textContent = `${this.availableTracks.length} tracks`;
        }
        if (this.countBadgeEl) {
            if (this.availableTracks.length > 0) {
                this.countBadgeEl.textContent = this.availableTracks.length;
                this.countBadgeEl.classList.remove('hidden');
            } else {
                this.countBadgeEl.classList.add('hidden');
            }
        }
        if (this.trackListEl) {
            let html = `<li class="subtitles-item ${this.activeTrackId === 'off' ? 'selected' : ''}" data-track-id="off">Off</li>`;
            this.availableTracks.forEach(track => {
                const isSelected = this.activeTrackId === track.id;
                html += `
                    <li class="subtitles-item ${isSelected ? 'selected' : ''}" data-track-id="${track.id}">
                        <span>${track.name}</span>
                        ${track.badge ? `<span class="subtitles-badge">${track.badge}</span>` : ''}
                    </li>
                `;
            });
            this.trackListEl.innerHTML = html;
        }
    }

    async selectTrack(trackId) {
        if (!this.player || !this.player.video) return;

        // Clear all subtitle rendering & disable active tracks
        this.lastRenderedCue = null;
        this.hideTextOverlay();
        if (this.pgsCanvas) {
            const ctx = this.pgsCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.pgsCanvas.width, this.pgsCanvas.height);
            this.pgsCanvas.classList.add('hidden');
        }

        // Disable all tracks
        this.availableTracks.forEach(t => {
            if (t.trackElement) {
                t.trackElement.mode = 'disabled';
                t.trackElement.default = false;
                if (t.trackElement.track) {
                    t.trackElement.track.mode = 'disabled';
                }
            }
            if (t.nativeTrack) {
                t.nativeTrack.mode = 'disabled';
            }
        });
        this._disableAllNativeTracks();

        if (trackId === 'off') {
            this.activeTrackId = 'off';
            this.cues = [];
            this.refreshSubtitleMenu();
            return;
         }

        const track = this.availableTracks.find(t => t.id === trackId);
        if (!track) return;

        this.activeTrackId = trackId;

        // If this track is from FFmpeg fallback and cues aren't extracted yet, extract now
        if (track.isFFmpeg && (!track.cues || track.cues.length === 0) && !track.isPGS && this._currentFile) {
            const vttText = await extractSubtitleWebVTTFFmpeg(this._currentFile, track.streamIndex);
            if (vttText) {
                track.cues = this.parseVTT(vttText);
            }
        }

        if (track.nativeTrack) {
            // Native track found by browser — set mode to 'hidden' to prevent duplicate native browser rendering (::cue) while keeping activeCues functional
            this.cues = this._extractNativeTrackCues(track.nativeTrack);
            track.cues = this.cues;
            track.nativeTrack.mode = 'hidden';
        } else if (track.isPGS) {
            this.cues = track.cues || [];
            if (this.pgsCanvas) {
                this.pgsCanvas.classList.remove('hidden');
            }
            this.renderPGSOverlay();
            this.provePGSDecoding(track);
        } else {
            // Text subtitle track — attach native HTML5 <track> element to video
            this.cues = track.cues || [];
            if (!track.trackElement) {
                this.attachNativeTrack(track);
            }
            if (track.trackElement) {
                track.trackElement.mode = 'hidden';
                track.trackElement.default = true;
                if (track.trackElement.track) {
                    track.trackElement.track.mode = 'hidden';
                } else {
                    track.trackElement.addEventListener('load', () => {
                        if (track.trackElement.track) {
                            track.trackElement.track.mode = 'hidden';
                        }
                    });
                }
            }
        }

        this.refreshSubtitleMenu();

        setTimeout(() => {
            console.log(`[Subtitles Debug] After selecting track "${trackId}" (${track.name}):`);
            this.logTextTracksDebug();
            let activeCount = 0;
            if (this.player.video && this.player.video.textTracks) {
                for (let i = 0; i < this.player.video.textTracks.length; i++) {
                    if (this.player.video.textTracks[i].mode === 'hidden' || this.player.video.textTracks[i].mode === 'showing') activeCount++;
                }
            }
            console.log(`[Subtitles Debug] Exactly one TextTrack has active mode ("hidden" to suppress duplicate native rendering):`, activeCount === 1, `(count=${activeCount})`);
        }, 50);

        const evt = new CustomEvent('subtitleLoaded', { detail: { loaded: true, track: track.name } });
        document.dispatchEvent(evt);
    }

    _disableAllNativeTracks() {
        if (!this.player || !this.player.video || !this.player.video.textTracks) return;
        for (let i = 0; i < this.player.video.textTracks.length; i++) {
            this.player.video.textTracks[i].mode = 'disabled';
        }
    }

    _extractNativeTrackCues(nativeTrack) {
        const cues = [];
        try {
            const prevMode = nativeTrack.mode;
            if (nativeTrack.mode === 'disabled') {
                nativeTrack.mode = 'hidden';
            }
            if (nativeTrack.cues) {
                const seen = new Set();
                for (let i = 0; i < nativeTrack.cues.length; i++) {
                    const c = nativeTrack.cues[i];
                    const text = (c.text || '').trim();
                    const key = `${c.startTime.toFixed(2)}_${text}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    cues.push({
                        start: c.startTime,
                        end: c.endTime,
                        text: text
                    });
                }
            }
            nativeTrack.mode = 'disabled';
        } catch (err) {
            console.warn('[Subtitles] Error extracting native track cues:', err);
        }
        cues.sort((a, b) => a.start - b.start);
        return cues;
    }

    hideTextOverlay() {
        if (this.textOverlay) {
            this.textOverlay.innerHTML = '';
            this.textOverlay.classList.add('hidden');
        }
    }

    _cleanAndDeduplicateSubtitleText(textInput) {
        if (!textInput) return '';
        const lines = [];
        const seen = new Set();
        const inputLines = typeof textInput === 'string'
            ? textInput.split(/\r?\n/)
            : Array.isArray(textInput)
                ? textInput.flatMap(t => String(t || '').split(/\r?\n/))
                : [String(textInput)];
        for (let line of inputLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push(trimmed);
        }
        return lines.join('\n');
    }

    renderTextOverlay(text) {
        if (!this.textOverlay) return;
        this.textOverlay.innerHTML = `<span>${text}</span>`;
        this.textOverlay.classList.remove('hidden');
    }

    startActiveCuesRenderer() {
        const renderLoop = () => {
            if (this.player && this.player.video) {
                if (this.activeTrackId === 'off') {
                    this.hideTextOverlay();
                } else {
                    const track = this.availableTracks.find(t => t.id === this.activeTrackId);
                    if (track && !track.isPGS) {
                        let activeText = null;
                        // 1. Try reading from TextTrack.activeCues (native browser parsing)
                        if (track.trackElement && track.trackElement.track && track.trackElement.track.activeCues && track.trackElement.track.activeCues.length > 0) {
                            const cues = track.trackElement.track.activeCues;
                            const texts = [];
                            for (let i = 0; i < cues.length; i++) {
                                if (cues[i].text) texts.push(cues[i].text);
                            }
                            if (texts.length > 0) {
                                activeText = this._cleanAndDeduplicateSubtitleText(texts);
                            }
                        } else if (track.nativeTrack && track.nativeTrack.activeCues && track.nativeTrack.activeCues.length > 0) {
                            const cues = track.nativeTrack.activeCues;
                            const texts = [];
                            for (let i = 0; i < cues.length; i++) {
                                if (cues[i].text) texts.push(cues[i].text);
                            }
                            if (texts.length > 0) {
                                activeText = this._cleanAndDeduplicateSubtitleText(texts);
                            }
                        }
                        // 2. Fallback to extracted cues matching currentTime if TextTrack.activeCues is empty
                        if (!activeText && track.cues && track.cues.length > 0) {
                            const now = this.player.video.currentTime - (this.offsetMs / 1000);
                            const matching = track.cues.filter(c => now >= c.start && now <= c.end);
                            if (matching.length > 0) {
                                activeText = this._cleanAndDeduplicateSubtitleText(matching.map(c => c.text));
                            }
                        }

                        if (activeText) {
                            this.renderTextOverlay(activeText);
                        } else {
                            this.hideTextOverlay();
                        }
                    }
                }
            }
            requestAnimationFrame(renderLoop);
        };
        requestAnimationFrame(renderLoop);
    }

    logTextTracksDebug() {
        if (!this.player || !this.player.video || !this.player.video.textTracks) return;
        const tts = this.player.video.textTracks;
        console.log(`[Subtitles Debug] video.textTracks.length =`, tts.length);
        for (let i = 0; i < tts.length; i++) {
            const tt = tts[i];
            console.log(`[Subtitles Debug] TextTrack[${i}]: kind="${tt.kind}", label="${tt.label}", mode="${tt.mode}", cues.length=${tt.cues ? tt.cues.length : 'null'}`);
        }
    }

    applySettings() {
        const size = settings.get('subtitleSize') || 24;
        let styleEl = document.getElementById('subtitle-custom-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'subtitle-custom-styles';
            document.head.appendChild(styleEl);
        }
        styleEl.innerHTML = `
            ::cue {
                background: transparent !important;
                color: transparent !important;
                text-shadow: none !important;
                opacity: 0 !important;
            }
            .subtitle-text-overlay span {
                font-size: ${size}px !important;
            }
        `;
    }

    setOffset(ms) {
        this.offsetMs = ms;
        settings.set('subtitleDelay', ms);
        if (this.activeTrackId !== 'off') {
            const track = this.availableTracks.find(t => t.id === this.activeTrackId);
            if (track) {
                if (track.isPGS) {
                    this.lastRenderedCue = null;
                    this.renderPGSOverlay();
                } else if (!track.nativeTrack) {
                    // Refresh native <track> element WebVTT Blob URL with offset applied
                    this.attachNativeTrack(track);
                    if (track.trackElement) {
                        track.trackElement.mode = 'hidden';
                        if (track.trackElement.track) track.trackElement.track.mode = 'hidden';
                    }
                }
            }
        }
    }

    async handleFileLoaded(file) {
        this._currentFile = file;
        this.availableTracks = [];
        this.activeTrackId = 'off';
        this.cues = [];
        this.lastRenderedCue = null;
        this.hideTextOverlay();
        if (this.pgsCanvas) {
            const ctx = this.pgsCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.pgsCanvas.width, this.pgsCanvas.height);
            this.pgsCanvas.classList.add('hidden');
        }
        this.refreshSubtitleMenu();

        try {
            await this.extractBuiltInSubtitles(file);
        } catch (err) {
            console.warn('Error extracting built-in subtitles:', err);
        }
        this.refreshSubtitleMenu();
    }

    async extractBuiltInSubtitles(file) {
        const nameLower = file.name.toLowerCase();
        let extractedCount = 0;

        if (nameLower.endsWith('.mkv') || nameLower.endsWith('.webm')) {
            extractedCount = await this.parseMatroskaSubtitles(file);
        } else if (nameLower.endsWith('.mp4') || nameLower.endsWith('.m4v') || nameLower.endsWith('.mov')) {
            extractedCount = await this.parseMP4Subtitles(file);
        }

        // If client-side demuxing did not find subtitle tracks (or for fallback), probe with FFmpeg.wasm
        if (extractedCount === 0 && isFFmpegSupported() && file.size <= 1500 * 1024 * 1024) {
            try {
                const ffmpegTracks = await inspectSubtitleTracksFFmpeg(file);
                if (ffmpegTracks && ffmpegTracks.length > 0) {
                    ffmpegTracks.forEach(ft => {
                        if (!this.availableTracks.some(tr => tr.id === ft.id)) {
                            this.availableTracks.push({
                                id: ft.id,
                                name: ft.name,
                                badge: ft.langCode ? ft.langCode.toUpperCase() : 'FFMPEG',
                                streamIndex: ft.streamIndex,
                                isFFmpeg: true,
                                cues: [],
                                isPGS: ft.codec === 'hdmv_pgs_subtitle' || (ft.codec && ft.codec.toLowerCase().includes('pgs'))
                            });
                        }
                    });
                }
            } catch (err) {
                console.warn('[Subtitles] FFmpeg probe error:', err);
            }
        }

        setTimeout(() => {
            this.inspectNativeTracks();
        }, 500);
    }

    inspectNativeTracks() {
        if (!this.player || !this.player.video || !this.player.video.textTracks) return;
        const tracks = this.player.video.textTracks;
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            if (t.kind === 'subtitles' || t.kind === 'captions') {
                if (t.label === 'Custom') continue;
                const id = 'native-' + i;
                if (!this.availableTracks.some(tr => tr.id === id)) {
                    this.availableTracks.push({
                        id: id,
                        name: `#${i + 1} [${this.mapLanguageName(t.language)}] ${t.label || 'subtitle'}`.trim(),
                        badge: t.language ? t.language.toUpperCase() : 'BUILT-IN',
                        nativeTrack: t
                    });
                }
            }
        }
        this.refreshSubtitleMenu();
    }

    mapLanguageName(code) {
        if (!code) return 'English';
        const c = code.toLowerCase().trim();
        const map = {
            'eng': 'English', 'en': 'English',
            'ara': 'Arabic', 'ar': 'Arabic',
            'hin': 'Hindi', 'hi': 'Hindi',
            'ind': 'Indonesian', 'id': 'Indonesian',
            'spa': 'Spanish', 'es': 'Spanish',
            'fre': 'French', 'fra': 'French', 'fr': 'French',
            'deu': 'German', 'ger': 'German', 'de': 'German',
            'ita': 'Italian', 'it': 'Italian',
            'jpn': 'Japanese', 'ja': 'Japanese',
            'kor': 'Korean', 'ko': 'Korean',
            'rus': 'Russian', 'ru': 'Russian',
            'zho': 'Chinese', 'chi': 'Chinese', 'zh': 'Chinese',
            'por': 'Portuguese', 'pt': 'Portuguese',
            'nld': 'Dutch', 'dut': 'Dutch', 'nl': 'Dutch',
            'swe': 'Swedish', 'sv': 'Swedish',
            'pol': 'Polish', 'pl': 'Polish',
            'tur': 'Turkish', 'tr': 'Turkish',
            'tha': 'Thai', 'th': 'Thai',
            'vie': 'Vietnamese', 'vi': 'Vietnamese',
            'heb': 'Hebrew', 'he': 'Hebrew',
            'ell': 'Greek', 'gre': 'Greek', 'el': 'Greek',
            'dan': 'Danish', 'da': 'Danish',
            'fin': 'Finnish', 'fi': 'Finnish',
            'nor': 'Norwegian', 'no': 'Norwegian',
            'ces': 'Czech', 'cze': 'Czech', 'cs': 'Czech',
            'hun': 'Hungarian', 'hu': 'Hungarian',
            'ron': 'Romanian', 'rum': 'Romanian', 'ro': 'Romanian',
            'tam': 'Tamil', 'ta': 'Tamil',
            'tel': 'Telugu', 'te': 'Telugu',
            'mal': 'Malayalam', 'ml': 'Malayalam',
            'may': 'Malay', 'msa': 'Malay', 'ms': 'Malay',
            'ukr': 'Ukrainian', 'uk': 'Ukrainian',
            'ben': 'Bengali', 'bn': 'Bengali',
            'fas': 'Persian', 'per': 'Persian', 'fa': 'Persian'
        };
        return map[c] || (code.charAt(0).toUpperCase() + code.slice(1));
    }

    // =========================================================================
    // EBML / Matroska Parser with EBML Lacing & ASS Comma-Field Support
    // =========================================================================

    readVINT(data, pos) {
        if (pos >= data.length) return null;
        const first = data[pos];
        if (first === 0) return null;

        let len = 1;
        let mask = 0x80;
        while (len <= 8 && !(first & mask)) {
            len++;
            mask >>= 1;
        }
        if (len > 8 || pos + len > data.length) return null;

        let value = first & (mask - 1);
        for (let i = 1; i < len; i++) {
            value = value * 256 + data[pos + i];
        }
        return { value, length: len };
    }

    readElementID(data, pos) {
        if (pos >= data.length) return null;
        const first = data[pos];
        if (first === 0) return null;

        let len = 1;
        let mask = 0x80;
        while (len <= 4 && !(first & mask)) {
            len++;
            mask >>= 1;
        }
        if (len > 4 || pos + len > data.length) return null;

        let id = 0;
        for (let i = 0; i < len; i++) {
            id = (id << 8) | data[pos + i];
        }
        return { id, length: len };
    }

    readEBMLElement(data, pos) {
        const idResult = this.readElementID(data, pos);
        if (!idResult) return null;

        const sizeResult = this.readVINT(data, pos + idResult.length);
        if (!sizeResult) return null;

        const dataStart = pos + idResult.length + sizeResult.length;
        const allOnes = (1 << (7 * sizeResult.length)) - 1;
        const isUnknownSize = sizeResult.value === allOnes;

        return {
            id: idResult.id,
            idLen: idResult.length,
            dataStart: dataStart,
            dataSize: isUnknownSize ? -1 : sizeResult.value,
            size: isUnknownSize ? -1 : sizeResult.value,
            next: isUnknownSize ? data.length : dataStart + sizeResult.value
        };
    }

    readEBMLUInt(data, start, len) {
        let val = 0;
        for (let i = 0; i < len; i++) {
            val = (val * 256) + data[start + i];
        }
        return val;
    }

    readEBMLString(data, start, len) {
        return new TextDecoder('utf-8').decode(data.subarray(start, start + len)).replace(/\0/g, '').trim();
    }

    async parseMatroskaSubtitles(file) {
        try {
            console.log('[Subtitles] Starting Matroska subtitle extraction...');
            const headerSize = Math.min(file.size, 64 * 1024 * 1024);
            const headerBuf = await file.slice(0, headerSize).arrayBuffer();
            const data = new Uint8Array(headerBuf);

            let timecodeScale = 1000000;
            const infoResult = this._findTopLevelElement(data, 0x1549A966);
            if (infoResult) {
                timecodeScale = this._parseInfoTimecodeScale(data, infoResult.dataStart, infoResult.next) || 1000000;
            }

            const tracks = this.findMatroskaSubtitleTracks(data);
            if (!tracks || tracks.length === 0) {
                console.log('[Subtitles] No subtitle tracks found in MKV header');
                return 0;
            }

            console.log('[Subtitles] Found', tracks.length, 'subtitle track(s):', tracks.map(t => `${t.trackNumber}: ${t.codecID} (${t.language})`));

            tracks.forEach((t, idx) => {
                const langName = this.mapLanguageName(t.language);
                let codecLabel = 'subtitle';
                if (t.codecID === 'S_HDMV/PGS') {
                    codecLabel = 'hdmv_pgs_subtitle';
                } else if (t.codecID) {
                    const short = t.codecID.replace('S_TEXT/', '').replace('S_', '').toLowerCase();
                    codecLabel = short.endsWith('subtitle') ? short : `${short}_subtitle`;
                }
                const titlePart = t.name ? ` ${t.name} ` : ' ';
                const displayName = `#${idx + 1} [${langName}]${titlePart}${codecLabel}`.trim();

                const trackId = 'mkv-' + t.trackNumber;
                if (!this.availableTracks.some(tr => tr.id === trackId)) {
                    this.availableTracks.push({
                        id: trackId,
                        name: displayName,
                        badge: t.language ? t.language.toUpperCase() : 'MKV',
                        codecID: t.codecID,
                        trackNumber: t.trackNumber,
                        cues: [],
                        isPGS: t.codecID === 'S_HDMV/PGS' || (t.codecID && t.codecID.toLowerCase().includes('pgs')) || t.codec_name === 'hdmv_pgs_subtitle'
                    });
                }
            });
            this.refreshSubtitleMenu();

            // Scan entire file in memory-efficient 16MB chunks
            const trackNumSet = new Set(tracks.map(t => t.trackNumber));
            const chunkSize = 16 * 1024 * 1024;
            const maxScan = file.size;

            for (let offset = 0; offset < maxScan; offset += chunkSize) {
                const readEnd = Math.min(file.size, offset + chunkSize + 4096);
                const chunkBuf = await file.slice(offset, readEnd).arrayBuffer();
                const chunkData = new Uint8Array(chunkBuf);
                this._extractClustersFromChunk(chunkData, tracks, trackNumSet, timecodeScale);
            }

            // Post-process cues: sort, deduplicate, and adjust end times
            this.availableTracks.forEach(tr => {
                if (!tr.cues || tr.cues.length === 0) return;

                const seen = new Set();
                tr.cues = tr.cues.filter(c => {
                    const key = `${c.start.toFixed(3)}_${c.text || 'pgs'}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                tr.cues.sort((a, b) => a.start - b.start);

                for (let i = 0; i < tr.cues.length - 1; i++) {
                    if (tr.cues[i].end > tr.cues[i + 1].start) {
                        tr.cues[i].end = tr.cues[i + 1].start;
                    }
                }

                console.log(`[Subtitles] Track ${tr.id}: ${tr.cues.length} cues extracted`);
                if (!tr.isPGS) {
                    this.attachNativeTrack(tr);
                } else if (tr.id === this.activeTrackId) {
                    this.provePGSDecoding(tr);
                }
            });

            return tracks.length;
        } catch (err) {
            console.warn('Matroska subtitle parsing error:', err);
            return 0;
        }
    }

    _findTopLevelElement(data, targetId) {
        let pos = 0;
        while (pos < data.length - 4) {
            const el = this.readEBMLElement(data, pos);
            if (!el) { pos++; continue; }

            if (el.id === 0x18538067) {
                let childPos = el.dataStart;
                const segEnd = el.dataSize === -1 ? data.length : Math.min(data.length, el.next);
                while (childPos < segEnd - 4) {
                    const child = this.readEBMLElement(data, childPos);
                    if (!child) break;
                    if (child.id === targetId) return child;
                    if (child.next <= childPos) break;
                    childPos = child.next;
                }
                return null;
            }
            if (el.next <= pos) break;
            pos = el.next;
        }
        return null;
    }

    _parseInfoTimecodeScale(data, start, end) {
        let pos = start;
        while (pos < end - 2) {
            const el = this.readEBMLElement(data, pos);
            if (!el || el.next > end || el.next <= pos) break;
            if (el.id === 0x2AD7B1) {
                return this.readEBMLUInt(data, el.dataStart, el.size);
            }
            pos = el.next;
        }
        return null;
    }

    findMatroskaSubtitleTracks(data) {
        const tracks = [];
        const tracksEl = this._findTopLevelElement(data, 0x1654AE6B);
        if (!tracksEl) return tracks;

        const tracksEnd = Math.min(data.length, tracksEl.next);
        let pos = tracksEl.dataStart;

        while (pos < tracksEnd - 2) {
            const el = this.readEBMLElement(data, pos);
            if (!el || el.next > tracksEnd || el.next <= pos) break;

            if (el.id === 0xAE) {
                const teEnd = Math.min(data.length, el.next);
                let subPos = el.dataStart;

                let trackNum = null;
                let trackType = null;
                let codecID = null;
                let name = null;
                let language = 'eng';

                while (subPos < teEnd - 2) {
                    const subEl = this.readEBMLElement(data, subPos);
                    if (!subEl || subEl.next > teEnd || subEl.next <= subPos) break;

                    if (subEl.id === 0xD7) {
                        trackNum = this.readEBMLUInt(data, subEl.dataStart, subEl.size);
                    } else if (subEl.id === 0x83) {
                        trackType = this.readEBMLUInt(data, subEl.dataStart, subEl.size);
                    } else if (subEl.id === 0x86) {
                        codecID = this.readEBMLString(data, subEl.dataStart, subEl.size);
                    } else if (subEl.id === 0x536E) {
                        name = this.readEBMLString(data, subEl.dataStart, subEl.size);
                    } else if (subEl.id === 0x22B59C) {
                        language = this.readEBMLString(data, subEl.dataStart, subEl.size);
                    }

                    subPos = subEl.next;
                }

                if (trackType === 17 && trackNum !== null) {
                    tracks.push({
                        trackNumber: trackNum,
                        codecID: codecID || 'S_TEXT/UTF8',
                        name: name || '',
                        language: language || 'eng'
                    });
                }
            }
            pos = el.next;
        }
        return tracks;
    }

    _extractClustersFromChunk(data, tracks, trackNumSet, timecodeScale) {
        const trackNumMap = {};
        tracks.forEach(t => { trackNumMap[t.trackNumber] = t; });

        let pos = 0;
        while (pos < data.length - 4) {
            if (data[pos] === 0x1F && data[pos + 1] === 0x43 && data[pos + 2] === 0xB6 && data[pos + 3] === 0x75) {
                const clEl = this.readEBMLElement(data, pos);
                if (!clEl) { pos++; continue; }

                const clusterEnd = clEl.dataSize === -1
                    ? data.length
                    : Math.min(data.length, clEl.next);
                let cPos = clEl.dataStart;
                let clusterTimecode = 0;

                while (cPos < clusterEnd - 2) {
                    const el = this.readEBMLElement(data, cPos);
                    if (!el || el.next > clusterEnd || el.next <= cPos) break;

                    if (el.id === 0xE7) {
                        clusterTimecode = this.readEBMLUInt(data, el.dataStart, el.size);
                    } else if (el.id === 0xA3) {
                        this._parseBlock(data, el.dataStart, el.dataStart + el.size, clusterTimecode, trackNumMap, trackNumSet, timecodeScale, null);
                    } else if (el.id === 0xA0) {
                        let bgPos = el.dataStart;
                        const bgEnd = Math.min(data.length, el.next);
                        let blockStart = -1, blockEnd = -1;
                        let blockDuration = null;

                        while (bgPos < bgEnd - 2) {
                            const bgEl = this.readEBMLElement(data, bgPos);
                            if (!bgEl || bgEl.next > bgEnd || bgEl.next <= bgPos) break;

                            if (bgEl.id === 0xA1) {
                                blockStart = bgEl.dataStart;
                                blockEnd = bgEl.dataStart + bgEl.size;
                            } else if (bgEl.id === 0x9B) {
                                blockDuration = this.readEBMLUInt(data, bgEl.dataStart, bgEl.size);
                            }
                            bgPos = bgEl.next;
                        }

                        if (blockStart >= 0) {
                            this._parseBlock(data, blockStart, blockEnd, clusterTimecode, trackNumMap, trackNumSet, timecodeScale, blockDuration);
                        }
                    }
                    cPos = el.next;
                }

                pos = clEl.dataSize === -1 ? clEl.dataStart + 1 : clEl.next;
            } else {
                pos++;
            }
        }
    }

    /**
     * Decode Matroska EBML / Xiph / Fixed lacing for a block.
     */
    _decodeLacingFrames(data, start, end, lacingType) {
        const frames = [];
        if (start >= end) return frames;

        if (lacingType === 0) {
            frames.push(data.subarray(start, end));
            return frames;
        }

        let pos = start;
        const numFramesMinusOne = data[pos++];
        const totalFrames = numFramesMinusOne + 1;

        if (lacingType === 2) { // Fixed-size lacing
            const frameSize = Math.floor((end - pos) / totalFrames);
            for (let i = 0; i < totalFrames; i++) {
                frames.push(data.subarray(pos, pos + frameSize));
                pos += frameSize;
            }
            return frames;
        }

        const sizes = [];
        let sizesSum = 0;

        if (lacingType === 1) { // Xiph lacing
            for (let i = 0; i < totalFrames - 1; i++) {
                let s = 0;
                while (pos < end && data[pos] === 255) {
                    s += 255;
                    pos++;
                }
                if (pos < end) {
                    s += data[pos++];
                }
                sizes.push(s);
                sizesSum += s;
            }
        } else if (lacingType === 3) { // EBML lacing
            let prevSize = 0;
            for (let i = 0; i < totalFrames - 1; i++) {
                const vint = this.readVINT(data, pos);
                if (!vint) break;
                pos += vint.length;
                let s = vint.value;
                if (i > 0) {
                    const half = 1 << ((7 * vint.length) - 1);
                    s = prevSize + (s - half + 1);
                }
                sizes.push(s);
                sizesSum += s;
                prevSize = s;
            }
        }

        const lastSize = Math.max(0, (end - pos) - sizesSum);
        sizes.push(lastSize);

        for (let i = 0; i < totalFrames && pos < end; i++) {
            const fSize = sizes[i] || 0;
            frames.push(data.subarray(pos, pos + fSize));
            pos += fSize;
        }

        return frames;
    }

    _parseBlock(data, start, end, clusterTimecode, trackNumMap, trackNumSet, timecodeScale, blockDurationUnits) {
        if (start >= end) return;

        const vint = this.readVINT(data, start);
        if (!vint) return;
        const trackNum = vint.value;
        if (!trackNumSet.has(trackNum)) return;

        let bPos = start + vint.length;
        if (bPos + 3 > end) return;

        const timeOffset = (data[bPos] << 8) | data[bPos + 1];
        const signedOffset = timeOffset >= 32768 ? timeOffset - 65536 : timeOffset;
        bPos += 2;

        const flags = data[bPos];
        bPos += 1;

        if (bPos >= end) return;

        const lacingType = (flags & 0x06) >> 1;
        const frames = this._decodeLacingFrames(data, bPos, end, lacingType);
        if (frames.length === 0) return;

        const startSec = Math.max(0, (clusterTimecode + signedOffset) * timecodeScale / 1e9);
        let endSec;
        if (blockDurationUnits != null) {
            endSec = startSec + (blockDurationUnits * timecodeScale / 1e9);
        } else {
            endSec = startSec + 5.0;
        }

        const targetTrack = this.availableTracks.find(tr => tr.id === 'mkv-' + trackNum);
        if (!targetTrack) return;

        const trackMeta = trackNumMap[trackNum];

        for (const frame of frames) {
            if (targetTrack.isPGS || (trackMeta && (trackMeta.codecID === 'S_HDMV/PGS' || (trackMeta.codecID && trackMeta.codecID.toLowerCase().includes('pgs')) || trackMeta.codec_name === 'hdmv_pgs_subtitle'))) {
                if (frame.length > 0) {
                    targetTrack.cues.push({
                        start: startSec,
                        end: endSec,
                        isPGS: true,
                        pgsData: frame
                    });
                }
            } else {
                const rawText = new TextDecoder('utf-8').decode(frame);
                let dialogueText = rawText;

                // In Matroska S_TEXT/ASS and S_TEXT/SSA, the payload is comma-separated fields:
                // ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                if (trackMeta && (trackMeta.codecID === 'S_TEXT/ASS' || trackMeta.codecID === 'S_TEXT/SSA')) {
                    const parts = rawText.split(',');
                    if (parts.length >= 9) {
                        dialogueText = parts.slice(8).join(',').trim();
                    }
                }

                const cleanText = this.cleanASSTags(dialogueText);
                if (!cleanText) continue;

                targetTrack.cues.push({
                    start: startSec,
                    end: endSec,
                    text: cleanText
                });
            }
        }
    }

    // =========================================================================
    // PGS Rendering
    // =========================================================================

    renderPGSOverlay() {
        if (!this.pgsCanvas || !this.player || !this.player.video) return;
        if (this.activeTrackId === 'off') {
            this.pgsCanvas.classList.add('hidden');
            return;
        }

        const track = this.availableTracks.find(t => t.id === this.activeTrackId);
        if (!track || !track.isPGS) {
            this.pgsCanvas.classList.add('hidden');
            return;
        }

        const now = this.player.video.currentTime - (this.offsetMs / 1000);
        const cue = (track.cues || []).find(c => now >= c.start && now <= c.end);

        if (!cue) {
            const ctx = this.pgsCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.pgsCanvas.width, this.pgsCanvas.height);
            this.lastRenderedCue = null;
            return;
        }

        if (this.lastRenderedCue === cue) return;
        this.lastRenderedCue = cue;

        this.pgsCanvas.classList.remove('hidden');
        this.drawPGSCue(cue);
    }

    decodePGSDialogue(pgsData) {
        if (!pgsData) return null;
        let pos = 0;
        const palette = new Array(256).fill([0, 0, 0, 0]);
        let imgWidth = 0, imgHeight = 0;
        let rleDataChunks = [];
        let screenWidth = 1920, screenHeight = 1080;
        let compositionObjects = [];
        let paletteEntryCount = 0;
        let activeObjId = 0;

        while (pos + 3 <= pgsData.length) {
            const type = pgsData[pos];
            const len = (pgsData[pos + 1] << 8) | pgsData[pos + 2];
            if (pos + 3 + len > pgsData.length) break;
            const segData = pgsData.subarray(pos + 3, pos + 3 + len);
            pos += 3 + len;

            if (type === 0x14) {
                // Presentation Composition Segment (PCS)
                if (segData.length >= 11) {
                    screenWidth = (segData[0] << 8) | segData[1];
                    screenHeight = (segData[2] << 8) | segData[3];
                    const numObjs = segData[10];
                    let p = 11;
                    for (let o = 0; o < numObjs && p + 8 <= segData.length; o++) {
                        const objId = (segData[p] << 8) | segData[p + 1];
                        const winId = segData[p + 2];
                        const cropped = segData[p + 3];
                        const objX = (segData[p + 4] << 8) | segData[p + 5];
                        const objY = (segData[p + 6] << 8) | segData[p + 7];
                        compositionObjects.push({ objId, objX, objY });
                        p += 8;
                        if (cropped && p + 8 <= segData.length) {
                            p += 8;
                        }
                    }
                }
            } else if (type === 0x16) {
                // Palette Definition Segment (PDS)
                let p = 2; // Skip palette_id (1 byte) and palette_version (1 byte)
                while (p + 5 <= segData.length) {
                    const colorId = segData[p];
                    const y = segData[p + 1];
                    const cr = segData[p + 2];
                    const cb = segData[p + 3];
                    const alpha = segData[p + 4];
                    const r = Math.max(0, Math.min(255, Math.round(y + 1.402 * (cr - 128))));
                    const g = Math.max(0, Math.min(255, Math.round(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128))));
                    const b = Math.max(0, Math.min(255, Math.round(y + 1.772 * (cb - 128))));
                    if (alpha > 0) paletteEntryCount++;
                    palette[colorId] = [r, g, b, alpha];
                    p += 5;
                }
            } else if (type === 0x17) {
                // Object Definition Segment (ODS)
                if (segData.length >= 11) {
                    const objId = (segData[0] << 8) | segData[1];
                    activeObjId = objId;
                    const version = segData[2];
                    const seqFlag = segData[3];
                    let rleOffset = 4;
                    if (seqFlag === 0x80 || seqFlag === 0xC0) {
                        if (segData.length >= 11) {
                            imgWidth = (segData[7] << 8) | segData[8];
                            imgHeight = (segData[9] << 8) | segData[10];
                            rleOffset = 11;
                        }
                    }
                    if (segData.length > rleOffset) {
                        rleDataChunks.push(segData.subarray(rleOffset));
                    }
                }
            }
        }

        if (imgWidth <= 0 || imgHeight <= 0 || rleDataChunks.length === 0) {
            return null;
        }

        let totalRLELen = 0;
        for (const chunk of rleDataChunks) totalRLELen += chunk.length;
        const rleData = new Uint8Array(totalRLELen);
        let offset = 0;
        for (const chunk of rleDataChunks) {
            rleData.set(chunk, offset);
            offset += chunk.length;
        }

        const totalPixels = imgWidth * imgHeight;
        const rgba = new Uint8ClampedArray(totalPixels * 4);
        let pixelIndex = 0;
        let i = 0;
        let transparentCount = 0;
        let opaqueCount = 0;

        while (i < rleData.length && pixelIndex < totalPixels) {
            const b1 = rleData[i++];
            if (b1 !== 0) {
                const col = palette[b1] || [0, 0, 0, 0];
                const idx = pixelIndex * 4;
                rgba[idx] = col[0];
                rgba[idx + 1] = col[1];
                rgba[idx + 2] = col[2];
                rgba[idx + 3] = col[3];
                if (col[3] === 0) transparentCount++; else opaqueCount++;
                pixelIndex++;
            } else {
                if (i >= rleData.length) break;
                const b2 = rleData[i++];
                if (b2 !== 0) {
                    let count = 0;
                    let colorIdx = 0;
                    if ((b2 & 0xC0) === 0x00) {
                        count = b2 & 0x3F;
                        colorIdx = 0;
                    } else if ((b2 & 0xC0) === 0x40) {
                        if (i >= rleData.length) break;
                        count = ((b2 & 0x3F) << 8) | rleData[i++];
                        colorIdx = 0;
                    } else if ((b2 & 0xC0) === 0x80) {
                        if (i >= rleData.length) break;
                        count = b2 & 0x3F;
                        colorIdx = rleData[i++];
                    } else if ((b2 & 0xC0) === 0xC0) {
                        if (i + 1 >= rleData.length) break;
                        count = ((b2 & 0x3F) << 8) | rleData[i++];
                        colorIdx = rleData[i++];
                    }
                    const col = palette[colorIdx] || [0, 0, 0, 0];
                    for (let c = 0; c < count && pixelIndex < totalPixels; c++) {
                        const idx = pixelIndex * 4;
                        rgba[idx] = col[0];
                        rgba[idx + 1] = col[1];
                        rgba[idx + 2] = col[2];
                        rgba[idx + 3] = col[3];
                        if (col[3] === 0) transparentCount++; else opaqueCount++;
                        pixelIndex++;
                    }
                }
            }
        }

        const compX = compositionObjects.length > 0 ? compositionObjects[0].objX : 0;
        const compY = compositionObjects.length > 0 ? compositionObjects[0].objY : 0;
        const objId = compositionObjects.length > 0 ? compositionObjects[0].objId : activeObjId;

        return {
            imgWidth,
            imgHeight,
            screenWidth,
            screenHeight,
            compositionObjects,
            compX,
            compY,
            objId,
            paletteEntryCount,
            totalPixels: pixelIndex,
            transparentCount,
            opaqueCount,
            rgba
        };
    }

    drawPGSCue(cue) {
        if (!cue || !cue.pgsData || !this.pgsCanvas) return;
        const decoded = this.decodePGSDialogue(cue.pgsData);
        if (!decoded) return;

        const ctx = this.pgsCanvas.getContext('2d');
        if (decoded.screenWidth > 0 && decoded.screenHeight > 0) {
            if (this.pgsCanvas.width !== decoded.screenWidth || this.pgsCanvas.height !== decoded.screenHeight) {
                this.pgsCanvas.width = decoded.screenWidth;
                this.pgsCanvas.height = decoded.screenHeight;
            }
        } else if (this.pgsCanvas.width === 0) {
            this.pgsCanvas.width = 1920;
            this.pgsCanvas.height = 1080;
        }

        ctx.clearRect(0, 0, this.pgsCanvas.width, this.pgsCanvas.height);
        if (decoded.compositionObjects.length === 0) return;

        try {
            const imgData = new ImageData(decoded.rgba, decoded.imgWidth, decoded.imgHeight);
            for (const obj of decoded.compositionObjects) {
                ctx.putImageData(imgData, obj.objX, obj.objY);
            }
        } catch (e) {
            console.warn('[Subtitles] PGS bitmap render error:', e);
        }
    }

    provePGSDecoding(track) {
        if (!track || !track.isPGS || !track.cues || track.cues.length === 0) return;

        let firstValidDecoded = null;
        let cueIdx = 0;
        for (let i = 0; i < track.cues.length; i++) {
            const cue = track.cues[i];
            if (cue.pgsData) {
                const dec = this.decodePGSDialogue(cue.pgsData);
                if (dec && dec.opaqueCount > 0 && dec.compositionObjects.length > 0) {
                    firstValidDecoded = dec;
                    cueIdx = i;
                    break;
                }
            }
        }

        if (!firstValidDecoded) {
            console.warn('[PGS Proof WARNING] No subtitle cue found with opaque pixels! Checking first decoded cue...');
            if (track.cues[0] && track.cues[0].pgsData) {
                const rawDec = this.decodePGSDialogue(track.cues[0].pgsData);
                if (rawDec) {
                    console.warn('[PGS Proof WARNING] First cue stats -> palette entries:', rawDec.paletteEntryCount, 'opaque pixels:', rawDec.opaqueCount, 'transparent:', rawDec.transparentCount);
                }
            }
            return;
        }

        const d = firstValidDecoded;
        console.log('====================================================');
        console.log('[PGS Proof] Successfully decoded first subtitle object:');
        console.log(' - Bitmap Width:', d.imgWidth);
        console.log(' - Bitmap Height:', d.imgHeight);
        console.log(' - Object ID:', d.objId);
        console.log(' - Composition X:', d.compX);
        console.log(' - Composition Y:', d.compY);
        console.log(' - Palette Entry Count:', d.paletteEntryCount);
        console.log(' - Number of Decoded Pixels:', d.totalPixels);
        console.log(' - Number of Transparent Pixels:', d.transparentCount);
        console.log(' - Number of Opaque Pixels:', d.opaqueCount);
        console.log('====================================================');

        // Render onto off-screen canvas and export as PNG
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = d.imgWidth;
        offscreenCanvas.height = d.imgHeight;
        const offCtx = offscreenCanvas.getContext('2d');
        const imgData = new ImageData(d.rgba, d.imgWidth, d.imgHeight);
        offCtx.putImageData(imgData, 0, 0);
        const pngDataUrl = offscreenCanvas.toDataURL('image/png');

        // Display PNG in page next to the video
        let container = document.getElementById('pgs-debug-proof');
        if (!container) {
            container = document.createElement('div');
            container.id = 'pgs-debug-proof';
            container.style.cssText = 'position: fixed; top: 70px; right: 20px; z-index: 999999; background: rgba(10, 10, 15, 0.95); border: 2px solid #00e5ff; padding: 12px; border-radius: 8px; color: #fff; max-width: 380px; font-family: monospace; font-size: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.8);';
            document.body.appendChild(container);
        }
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #333; padding-bottom:4px;">
                <b style="color:#00e5ff;">PGS DECODER PROOF (PNG)</b>
                <button onclick="document.getElementById('pgs-debug-proof').remove()" style="background:none; border:none; color:#fff; cursor:pointer;">✕</button>
            </div>
            <div style="margin-bottom:8px; line-height:1.5;">
                <div><b>Width:</b> ${d.imgWidth}px | <b>Height:</b> ${d.imgHeight}px</div>
                <div><b>Object ID:</b> ${d.objId} | <b>X:</b> ${d.compX}, <b>Y:</b> ${d.compY}</div>
                <div><b>Palette Entries:</b> ${d.paletteEntryCount}</div>
                <div><b>Decoded Pixels:</b> ${d.totalPixels}</div>
                <div><b>Transparent Pixels:</b> ${d.transparentCount}</div>
                <div><b>Opaque Pixels:</b> <span style="color:#00e5ff;">${d.opaqueCount}</span></div>
            </div>
            <div style="background:#000; border:1px solid #444; padding:6px; text-align:center; border-radius:4px;">
                <img src="${pngDataUrl}" alt="Decoded PGS PNG" style="max-width:100%; height:auto; display:block; margin:0 auto;" />
            </div>
        `;
    }

    // =========================================================================
    // MP4 / MOV Parser
    // =========================================================================

    async parseMP4Subtitles(file) {
        try {
            console.log('[Subtitles] Starting MP4 subtitle extraction...');

            let moovData = null;
            const firstChunkSize = Math.min(file.size, 64 * 1024 * 1024);
            const firstBuf = await file.slice(0, firstChunkSize).arrayBuffer();
            const firstData = new Uint8Array(firstBuf);

            const moovInFirst = this._findMP4Box(firstData, 0, 'moov');
            if (moovInFirst) {
                moovData = firstData;
            } else if (file.size > firstChunkSize) {
                const tailSize = Math.min(file.size, 64 * 1024 * 1024);
                const tailStart = file.size - tailSize;
                const tailBuf = await file.slice(tailStart, file.size).arrayBuffer();
                const tailData = new Uint8Array(tailBuf);
                const moovInTail = this._findMP4Box(tailData, 0, 'moov');
                if (moovInTail) {
                    moovData = tailData;
                }
            }

            if (!moovData) {
                console.log('[Subtitles] No moov box found in MP4 — relying on native tracks');
                return 0;
            }

            const moovBox = this._findMP4Box(moovData, 0, 'moov');
            if (!moovBox) return 0;

            const traks = this._findAllMP4Boxes(moovData, moovBox.dataOffset, moovBox.dataOffset + moovBox.dataSize, 'trak');
            console.log('[Subtitles] Found', traks.length, 'trak boxes');

            let subtitleTrackIndex = 0;
            for (const trak of traks) {
                const result = await this._parseMP4SubtitleTrack(moovData, trak, file, subtitleTrackIndex);
                if (result) {
                    subtitleTrackIndex++;
                    this.availableTracks.push(result);
                    this.refreshSubtitleMenu();
                }
            }

            for (const track of this.availableTracks) {
                if (track._mp4SampleInfo) {
                    await this._readMP4SubtitleSamples(file, track);
                    delete track._mp4SampleInfo;
                    if (track.cues && track.cues.length > 0) {
                        this.attachNativeTrack(track);
                    }
                }
            }

            console.log('[Subtitles] MP4 subtitle extraction complete');
            return subtitleTrackIndex;
        } catch (err) {
            console.warn('[Subtitles] MP4 subtitle parsing error:', err);
            return 0;
        }
    }

    _readU32(data, offset) {
        return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
    }

    _readU64(data, offset) {
        const hi = this._readU32(data, offset);
        const lo = this._readU32(data, offset + 4);
        return hi * 0x100000000 + lo;
    }

    _readBoxType(data, offset) {
        return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    }

    _findMP4Box(data, startOffset, type) {
        let pos = startOffset;
        while (pos + 8 <= data.length) {
            let size = this._readU32(data, pos);
            const boxType = this._readBoxType(data, pos + 4);

            let headerSize = 8;
            if (size === 1) {
                if (pos + 16 > data.length) break;
                size = this._readU64(data, pos + 8);
                headerSize = 16;
            } else if (size === 0) {
                size = data.length - pos;
            }

            if (size < headerSize) break;

            if (boxType === type) {
                return {
                    offset: pos,
                    size: size,
                    dataOffset: pos + headerSize,
                    dataSize: size - headerSize
                };
            }

            pos += size;
        }
        return null;
    }

    _findAllMP4Boxes(data, start, end, type) {
        const results = [];
        let pos = start;
        while (pos + 8 <= end) {
            let size = this._readU32(data, pos);
            const boxType = this._readBoxType(data, pos + 4);

            let headerSize = 8;
            if (size === 1) {
                if (pos + 16 > end) break;
                size = this._readU64(data, pos + 8);
                headerSize = 16;
            } else if (size === 0) {
                size = end - pos;
            }

            if (size < headerSize) break;

            if (boxType === type) {
                results.push({
                    offset: pos,
                    size: size,
                    dataOffset: pos + headerSize,
                    dataSize: size - headerSize
                });
            }

            pos += size;
        }
        return results;
    }

    async _parseMP4SubtitleTrack(data, trak, file, index) {
        const mdia = this._findMP4Box(data, trak.dataOffset, 'mdia');
        if (!mdia) return null;

        const hdlr = this._findMP4Box(data, mdia.dataOffset, 'hdlr');
        if (!hdlr) return null;

        const hdlrDataStart = hdlr.dataOffset;
        if (hdlrDataStart + 12 > data.length) return null;
        const handlerType = this._readBoxType(data, hdlrDataStart + 8);

        const subtitleHandlers = ['sbtl', 'subt', 'text', 'tx3g', 'c608', 'clcp'];
        if (!subtitleHandlers.includes(handlerType)) return null;

        let language = 'und';
        const mdhd = this._findMP4Box(data, mdia.dataOffset, 'mdhd');
        if (mdhd) {
            const mdhdData = mdhd.dataOffset;
            const version = data[mdhdData];
            let langOffset;
            if (version === 0) {
                langOffset = mdhdData + 20;
            } else {
                langOffset = mdhdData + 32;
            }

            if (langOffset + 2 <= data.length) {
                const langCode = (data[langOffset] << 8) | data[langOffset + 1];
                const c1 = ((langCode >> 10) & 0x1F) + 0x60;
                const c2 = ((langCode >> 5) & 0x1F) + 0x60;
                const c3 = (langCode & 0x1F) + 0x60;
                if (c1 >= 0x61 && c1 <= 0x7A) {
                    language = String.fromCharCode(c1, c2, c3);
                }
            }
        }

        let timescale = 1000;
        if (mdhd) {
            const version = data[mdhd.dataOffset];
            if (version === 0) {
                timescale = this._readU32(data, mdhd.dataOffset + 12);
            } else {
                timescale = this._readU32(data, mdhd.dataOffset + 20);
            }
        }

        const minf = this._findMP4Box(data, mdia.dataOffset, 'minf');
        if (!minf) return null;
        const stbl = this._findMP4Box(data, minf.dataOffset, 'stbl');
        if (!stbl) return null;

        const sampleInfo = this._parseMP4SampleTable(data, stbl, timescale);
        if (!sampleInfo || sampleInfo.samples.length === 0) {
            return null;
        }

        const langName = this.mapLanguageName(language);
        const trackId = 'mp4-' + index;
        const displayName = `#${index + 1} [${langName}] ${handlerType}_subtitle`;

        return {
            id: trackId,
            name: displayName,
            badge: language !== 'und' ? language.toUpperCase() : 'MP4',
            cues: [],
            isPGS: false,
            _mp4SampleInfo: sampleInfo
        };
    }

    _parseMP4SampleTable(data, stbl, timescale) {
        const stblStart = stbl.dataOffset;

        const stts = this._findMP4Box(data, stblStart, 'stts');
        if (!stts) return null;

        const sttsEntryCount = this._readU32(data, stts.dataOffset + 4);
        const sttsEntries = [];
        let sttsPos = stts.dataOffset + 8;
        for (let i = 0; i < sttsEntryCount && sttsPos + 8 <= data.length; i++) {
            const count = this._readU32(data, sttsPos);
            const delta = this._readU32(data, sttsPos + 4);
            sttsEntries.push({ count, delta });
            sttsPos += 8;
        }

        const stsz = this._findMP4Box(data, stblStart, 'stsz');
        if (!stsz) return null;

        const defaultSampleSize = this._readU32(data, stsz.dataOffset + 4);
        const sampleCount = this._readU32(data, stsz.dataOffset + 8);
        const sampleSizes = [];
        if (defaultSampleSize > 0) {
            for (let i = 0; i < sampleCount; i++) sampleSizes.push(defaultSampleSize);
        } else {
            let szPos = stsz.dataOffset + 12;
            for (let i = 0; i < sampleCount && szPos + 4 <= data.length; i++) {
                sampleSizes.push(this._readU32(data, szPos));
                szPos += 4;
            }
        }

        let chunkOffsets = [];
        const stco = this._findMP4Box(data, stblStart, 'stco');
        const co64 = this._findMP4Box(data, stblStart, 'co64');
        if (stco) {
            const count = this._readU32(data, stco.dataOffset + 4);
            let coPos = stco.dataOffset + 8;
            for (let i = 0; i < count && coPos + 4 <= data.length; i++) {
                chunkOffsets.push(this._readU32(data, coPos));
                coPos += 4;
            }
        } else if (co64) {
            const count = this._readU32(data, co64.dataOffset + 4);
            let coPos = co64.dataOffset + 8;
            for (let i = 0; i < count && coPos + 8 <= data.length; i++) {
                chunkOffsets.push(this._readU64(data, coPos));
                coPos += 8;
            }
        }

        const stsc = this._findMP4Box(data, stblStart, 'stsc');
        if (!stsc) return null;

        const stscEntryCount = this._readU32(data, stsc.dataOffset + 4);
        const stscEntries = [];
        let stscPos = stsc.dataOffset + 8;
        for (let i = 0; i < stscEntryCount && stscPos + 12 <= data.length; i++) {
            stscEntries.push({
                firstChunk: this._readU32(data, stscPos),
                samplesPerChunk: this._readU32(data, stscPos + 4),
                sampleDescIndex: this._readU32(data, stscPos + 8)
            });
            stscPos += 12;
        }

        const samples = [];
        let sampleIndex = 0;

        const sampleTimestamps = [];
        let currentTimestamp = 0;
        for (const entry of sttsEntries) {
            for (let i = 0; i < entry.count; i++) {
                sampleTimestamps.push(currentTimestamp);
                currentTimestamp += entry.delta;
            }
        }

        for (let chunkIdx = 0; chunkIdx < chunkOffsets.length; chunkIdx++) {
            const chunkNum = chunkIdx + 1;
            let samplesInChunk = 1;
            for (let e = stscEntries.length - 1; e >= 0; e--) {
                if (chunkNum >= stscEntries[e].firstChunk) {
                    samplesInChunk = stscEntries[e].samplesPerChunk;
                    break;
                }
            }

            let offsetInChunk = chunkOffsets[chunkIdx];
            for (let s = 0; s < samplesInChunk && sampleIndex < sampleSizes.length; s++) {
                const size = sampleSizes[sampleIndex];
                const startTime = sampleIndex < sampleTimestamps.length
                    ? sampleTimestamps[sampleIndex] / timescale
                    : 0;
                const endTime = (sampleIndex + 1 < sampleTimestamps.length)
                    ? sampleTimestamps[sampleIndex + 1] / timescale
                    : startTime + 5.0;

                samples.push({
                    fileOffset: offsetInChunk,
                    size: size,
                    startTime: startTime,
                    endTime: endTime
                });

                offsetInChunk += size;
                sampleIndex++;
            }
        }

        return { samples, timescale };
    }

    async _readMP4SubtitleSamples(file, track) {
        const { samples } = track._mp4SampleInfo;
        if (!samples || samples.length === 0) return;

        const batchSize = 1024 * 1024;
        let i = 0;
        while (i < samples.length) {
            const batchStart = samples[i].fileOffset;
            let batchEnd = batchStart;
            let j = i;
            while (j < samples.length && samples[j].fileOffset - batchStart < batchSize) {
                batchEnd = samples[j].fileOffset + samples[j].size;
                j++;
            }
            if (j === i) {
                batchEnd = samples[i].fileOffset + samples[i].size;
                j = i + 1;
            }

            const safeBatchEnd = Math.min(file.size, batchEnd);
            if (batchStart >= file.size) break;

            try {
                const batchBuf = await file.slice(batchStart, safeBatchEnd).arrayBuffer();
                const batchData = new Uint8Array(batchBuf);

                for (let k = i; k < j; k++) {
                    const sample = samples[k];
                    const localOffset = sample.fileOffset - batchStart;
                    if (localOffset < 0 || localOffset + sample.size > batchData.length) continue;
                    if (sample.size < 3) continue;

                    const sampleData = batchData.subarray(localOffset, localOffset + sample.size);

                    const textLen = (sampleData[0] << 8) | sampleData[1];
                    if (textLen === 0) continue;

                    const textStart = 2;
                    const textEnd = Math.min(textStart + textLen, sampleData.length);
                    const rawText = new TextDecoder('utf-8').decode(sampleData.subarray(textStart, textEnd)).trim();
                    const cleanText = this.cleanASSTags(rawText);

                    if (cleanText.length > 0) {
                        track.cues.push({
                            start: sample.startTime,
                            end: sample.endTime,
                            text: cleanText
                        });
                    }
                }
            } catch (err) {
                console.warn(`[Subtitles] Error reading MP4 samples batch at offset ${batchStart}:`, err);
            }

            i = j;
        }

        console.log(`[Subtitles] Track ${track.id}: ${track.cues.length} MP4 subtitle cues extracted`);
    }

    // =========================================================================
    // ASS/SSA Tag Cleaning
    // =========================================================================

    cleanASSTags(text) {
        if (!text) return '';
        return text
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\h/g, ' ')
            .replace(/\r/g, '')
            .trim();
    }

    // =========================================================================
    // External Subtitle File Loading
    // =========================================================================

    async loadSubtitle(file) {
        const text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (ext === 'srt') {
            this.cues = this.parseSRT(text);
        } else if (ext === 'vtt') {
            this.cues = this.parseVTT(text);
        } else if (ext === 'ass' || ext === 'ssa') {
            this.cues = this.parseASS(text);
        } else {
            console.warn('Unsupported subtitle format');
            return;
        }

        const trackId = 'ext-' + Date.now();
        const trackObj = {
            id: trackId,
            name: file.name,
            badge: ext.toUpperCase(),
            cues: this.cues
        };
        this.availableTracks.push(trackObj);
        this.attachNativeTrack(trackObj);
        this.selectTrack(trackId);
        this.refreshSubtitleMenu();
        
        const evt = new CustomEvent('subtitleLoaded', { detail: { loaded: true, track: file.name } });
        document.dispatchEvent(evt);
    }

    // =========================================================================
    // Native HTML5 <track> Attachment & WebVTT Generation
    // =========================================================================

    attachNativeTrack(track) {
        if (!this.player || !this.player.video || track.isPGS || !track.cues || track.cues.length === 0) return null;

        if (track.blobUrl) {
            try { URL.revokeObjectURL(track.blobUrl); } catch (e) {}
        }
        if (track.trackElement && track.trackElement.parentNode) {
            try { track.trackElement.parentNode.removeChild(track.trackElement); } catch (e) {}
        }

        const vttString = this.cuesToWebVTT(track.cues, this.offsetMs);
        const isValidWebVTT = vttString.startsWith('WEBVTT');
        console.log(`[Subtitles Debug] Track "${track.name}" valid WebVTT:`, isValidWebVTT);
        console.log(`[Subtitles Debug] First 20 cues for "${track.name}":`, track.cues.slice(0, 20));

        let timestampsValid = true;
        for (let i = 0; i < track.cues.length; i++) {
            const c = track.cues[i];
            if (c.start >= c.end || (i > 0 && c.start < track.cues[i - 1].start)) {
                timestampsValid = false;
            }
        }
        console.log(`[Subtitles Debug] Cue start/end timestamps valid and increasing for "${track.name}":`, timestampsValid, `Total cues: ${track.cues.length}`);

        const blob = new Blob([vttString], { type: 'text/vtt' });
        console.log(`[Subtitles Debug] Generated WebVTT Blob size:`, blob.size, `bytes, type:`, blob.type);
        track.blobUrl = URL.createObjectURL(blob);

        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = track.name || 'Subtitle';
        trackEl.srclang = track.langCode || 'en';
        trackEl.src = track.blobUrl;
        trackEl.id = `track-${track.id}`;

        trackEl.addEventListener('load', () => {
            console.log(`[Subtitles Debug] Track load event for "${track.name}": readyState=`, trackEl.readyState);
            if (trackEl.track) {
                console.log(`[Subtitles Debug] track.track.cues length=`, trackEl.track.cues ? trackEl.track.cues.length : 0);
                console.log(`[Subtitles Debug] track.track.activeCues length=`, trackEl.track.activeCues ? trackEl.track.activeCues.length : 0);
            }
        });

        this.player.video.appendChild(trackEl);
        track.trackElement = trackEl;

        setTimeout(() => {
            this.logTextTracksDebug();
        }, 100);

        return trackEl;
    }

    cuesToWebVTT(cues, offsetMs = 0) {
        let vtt = 'WEBVTT\n\n';
        const offsetSec = (offsetMs || 0) / 1000;
        cues.forEach((c, idx) => {
            const start = Math.max(0, c.start + offsetSec);
            const end = Math.max(start + 0.05, c.end + offsetSec);
            const startStr = this.formatVttTime(start);
            const endStr = this.formatVttTime(end);
            if (startStr && endStr && c.text) {
                vtt += `${idx + 1}\n${startStr} --> ${endStr}\n${c.text}\n\n`;
            }
        });
        return vtt;
    }

    // =========================================================================
    // Subtitle Format Parsers
    // =========================================================================

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
        const pattern = /(\d{2}:)?(\d{2}:\d{2}\.\d{3}) --> (\d{2}:)?(\d{2}:\d{2}\.\d{3})(.*)\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n?$)/g;
        let match;
        const parsed = [];
        while ((match = pattern.exec(data)) !== null) {
            parsed.push({
                start: this.vttTimeToSeconds((match[1] || '') + match[2]),
                end: this.vttTimeToSeconds((match[3] || '') + match[4]),
                text: match[6]
            });
        }
        return parsed;
    }

    parseASS(data) {
        const lines = data.split(/\r?\n/);
        const parsed = [];
        let inEvents = false;
        let formatIdx = {};

        lines.forEach(line => {
            if (line.trim().toLowerCase() === '[events]') {
                inEvents = true;
                return;
            }
            if (!inEvents) return;
            if (line.startsWith('Format:')) {
                const parts = line.substring(7).split(',').map(s => s.trim().toLowerCase());
                parts.forEach((p, idx) => { formatIdx[p] = idx; });
            } else if (line.startsWith('Dialogue:')) {
                const parts = line.substring(9).split(',');
                const startIdx = formatIdx['start'];
                const endIdx = formatIdx['end'];
                const textIdx = formatIdx['text'];
                if (startIdx !== undefined && endIdx !== undefined && textIdx !== undefined) {
                    const startStr = parts[startIdx]?.trim();
                    const endStr = parts[endIdx]?.trim();
                    const textStr = parts.slice(textIdx).join(',').trim();
                    parsed.push({
                        start: this.assTimeToSeconds(startStr),
                        end: this.assTimeToSeconds(endStr),
                        text: this.cleanASSTags(textStr)
                    });
                }
            }
        });
        return parsed;
    }

    // =========================================================================
    // Time Conversion Utilities
    // =========================================================================

    assTimeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const p = timeStr.split(':');
        if (p.length !== 3) return 0;
        const h = parseInt(p[0], 10) || 0;
        const m = parseInt(p[1], 10) || 0;
        const s = parseFloat(p[2]) || 0;
        return (h * 3600) + (m * 60) + s;
    }

    srtTimeToSeconds(timeStr) {
        const p = timeStr.split(':');
        const s = p[2].split(',');
        return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(s[0], 10) + parseInt(s[1], 10) / 1000;
    }

    vttTimeToSeconds(timeStr) {
        const p = timeStr.split(':');
        let sec = 0;
        if (p.length === 3) {
            sec = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
        } else {
            sec = parseInt(p[0], 10) * 60 + parseFloat(p[1]);
        }
        return sec;
    }

    formatVttTime(seconds) {
        if (seconds < 0 || Number.isNaN(seconds)) return null;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
}
