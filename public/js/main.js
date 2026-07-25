// main.js
import { SocketManager } from './socket.js';
import { RoomManager } from './room.js';
import { VideoPlayer } from './player.js';
import { SyncEngine } from './sync.js';
import { ChatManager } from './chat.js';
import { SubtitleManager } from './subtitles.js';
import { UIManager } from './ui.js';
import { calculateFileHash } from './utils.js';
import { notifications } from './notifications.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Core Systems
    const socket = new SocketManager();
    const roomManager = new RoomManager(socket);
    const player = new VideoPlayer();
    const syncEngine = new SyncEngine(player, socket, roomManager);
    const chatManager = new ChatManager(socket);
    const subtitleManager = new SubtitleManager(player);
    const uiManager = new UIManager(roomManager, socket);

    // Wire up events that cross boundaries

    // When a video file is loaded, calculate hash and notify room
    player.events.addEventListener('fileLoaded', async (e) => {
        const file = e.detail.file;
        
        try {
            notifications.show('Verifying video file...', 'info');
            const hash = await calculateFileHash(file);
            
            roomManager.updateLocalState({
                videoHash: hash,
                videoSize: file.size,
                readyState: 'ready'
            });
            
            notifications.show('Video file verified locally', 'success');
            
            // Check hash against host if we aren't host
            if (roomManager.roomId) {
                roomManager.checkHashes();
            }
        } catch (err) {
            console.error('Hashing error', err);
            notifications.show('Error verifying video file', 'error');
        }
    });

    // When subtitles are loaded, update local state
    document.addEventListener('subtitleLoaded', () => {
        roomManager.updateLocalState({ subtitleLoaded: true });
    });

    // When settings change (e.g. subtitle delay)
    document.addEventListener('settingsChanged', (e) => {
        const { key, value } = e.detail;
        if (key === 'subtitleDelay') {
            subtitleManager.setOffset(value);
        } else if (key === 'subtitleSize') {
            subtitleManager.applySettings();
        }
    });
});
