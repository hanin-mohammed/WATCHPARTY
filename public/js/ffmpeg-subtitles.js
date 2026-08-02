// ffmpeg-subtitles.js
// Client-side FFmpeg.wasm subtitle extraction fallback engine.
// Uses single-threaded @ffmpeg/ffmpeg from CDN so it works in any browser without COOP/COEP header requirements.

let ffmpegInstance = null;
let ffmpegLoadingPromise = null;

const FFMPEG_CDN = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
const FFMPEG_CORE_CDN = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

/**
 * Check if FFmpeg.wasm is supported in this browser environment.
 */
export function isFFmpegSupported() {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

/**
 * Load and get a singleton instance of FFmpeg.wasm.
 */
export async function getFFmpeg() {
    if (ffmpegInstance && ffmpegInstance.loaded) {
        return ffmpegInstance;
    }
    if (ffmpegLoadingPromise) {
        return ffmpegLoadingPromise;
    }

    ffmpegLoadingPromise = (async () => {
        try {
            console.log('[FFmpegSubtitles] Dynamically loading FFmpeg.wasm from CDN...');
            const { FFmpeg } = await import(FFMPEG_CDN);
            const ffmpeg = new FFmpeg();

            ffmpeg.on('log', ({ message }) => {
                // Log only important messages
                if (message.includes('Stream #') || message.includes('Subtitle') || message.includes('Error')) {
                    console.log('[FFmpegSubtitles Log]', message);
                }
            });

            await ffmpeg.load({
                coreURL: `${FFMPEG_CORE_CDN}/ffmpeg-core.js`,
                wasmURL: `${FFMPEG_CORE_CDN}/ffmpeg-core.wasm`
            });

            ffmpegInstance = ffmpeg;
            console.log('[FFmpegSubtitles] FFmpeg.wasm loaded successfully.');
            return ffmpegInstance;
        } catch (err) {
            console.error('[FFmpegSubtitles] Failed to load FFmpeg.wasm:', err);
            ffmpegLoadingPromise = null;
            return null;
        }
    })();

    return ffmpegLoadingPromise;
}

/**
 * Probe a video file using FFmpeg.wasm and extract available subtitle track metadata.
 * Note: To avoid WebAssembly memory limits (OOM) on large files (>1.5 GB),
 * this function checks file size first.
 */
export async function inspectSubtitleTracksFFmpeg(file) {
    if (!isFFmpegSupported()) return [];
    if (file.size > 1500 * 1024 * 1024) {
        console.warn('[FFmpegSubtitles] File size exceeds safe WASM memory limit (1.5 GB). Relying on streaming client-side parser.');
        return [];
    }

    const ffmpeg = await getFFmpeg();
    if (!ffmpeg) return [];

    const inputName = `input_${Date.now()}.${file.name.split('.').pop() || 'mkv'}`;
    const subtitleTracks = [];

    try {
        const arrayBuffer = await file.arrayBuffer();
        await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));

        // Use ffmpeg -i to probe streams (it will error out with no output file, which is normal for probing)
        let probeLog = '';
        const logHandler = ({ message }) => {
            probeLog += message + '\n';
        };
        ffmpeg.on('log', logHandler);

        await ffmpeg.exec(['-i', inputName]);

        ffmpeg.off('log', logHandler);

        // Parse Stream lines from probeLog
        // Example line: Stream #0:2(eng): Subtitle: subrip (default)
        // or Stream #0:3(jpn): Subtitle: ass (default)
        const streamRegex = /Stream #0:(\d+)(?:\[0x[0-9a-f]+\])?(?:\(([a-zA-Z]{2,3})\))?:\s*Subtitle:\s*([a-zA-Z0-9_/-]+)(?:.*)/gi;
        let match;
        let subIndex = 0;
        while ((match = streamRegex.exec(probeLog)) !== null) {
            const streamId = parseInt(match[1], 10);
            const langCode = match[2] || 'und';
            const codec = match[3] || 'subtitle';

            subtitleTracks.push({
                streamIndex: streamId,
                subIndex: subIndex,
                langCode: langCode,
                codec: codec,
                id: `ffmpeg-${subIndex}`,
                name: `#${subIndex + 1} [${langCode.toUpperCase()}] ${codec}_subtitle`
            });
            subIndex++;
        }

        await ffmpeg.deleteFile(inputName);
    } catch (err) {
        console.warn('[FFmpegSubtitles] Error probing subtitle tracks:', err);
        try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    }

    return subtitleTracks;
}

/**
 * Extract a specific subtitle track from a local video file into WebVTT format using FFmpeg.wasm.
 * @param {File} file 
 * @param {number} subIndex 0-indexed subtitle track relative to subtitle streams (e.g. -map 0:s:subIndex)
 * @returns {Promise<string|null>} WebVTT subtitle string or null on failure
 */
export async function extractSubtitleWebVTTFFmpeg(file, subIndex = 0) {
    if (!isFFmpegSupported() || file.size > 1500 * 1024 * 1024) return null;

    const ffmpeg = await getFFmpeg();
    if (!ffmpeg) return null;

    const inputName = `input_${Date.now()}.${file.name.split('.').pop() || 'mkv'}`;
    const outputName = `output_${Date.now()}.vtt`;

    try {
        console.log(`[FFmpegSubtitles] Extracting subtitle stream 0:s:${subIndex} to WebVTT...`);
        const arrayBuffer = await file.arrayBuffer();
        await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));

        const code = await ffmpeg.exec([
            '-i', inputName,
            '-map', `0:s:${subIndex}`,
            '-f', 'webvtt',
            outputName
        ]);

        if (code !== 0) {
            console.warn(`[FFmpegSubtitles] FFmpeg exec returned error code ${code}`);
            await ffmpeg.deleteFile(inputName);
            return null;
        }

        const data = await ffmpeg.readFile(outputName);
        const vttText = new TextDecoder('utf-8').decode(data);

        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);

        console.log(`[FFmpegSubtitles] Extracted ${vttText.length} bytes of WebVTT data.`);
        return vttText;
    } catch (err) {
        console.warn('[FFmpegSubtitles] Failed to extract WebVTT with FFmpeg:', err);
        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (e) {}
        return null;
    }
}
