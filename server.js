const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all to serve index.html for any other route
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// State management
const rooms = new Map(); // roomId -> { password, hostId, users: Map(userId -> userData), playbackState, syncSensitivity }

function broadcastToRoom(roomId, message, excludeUserId = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    for (const [userId, user] of room.users.entries()) {
        if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(message));
        }
    }
}

function sendToUser(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

wss.on('connection', (ws, req) => {
    let currentRoomId = null;
    let currentUserId = null;

    ws.on('message', (messageRaw) => {
        try {
            const data = JSON.parse(messageRaw);
            const { type, payload } = data;

            switch (type) {
                case 'ping':
                    sendToUser(ws, { type: 'pong', payload: { clientTime: payload.clientTime, serverTime: Date.now() } });
                    break;

                case 'join_room': {
                    const { roomId, password, username, color } = payload;
                    
                    // If this WebSocket connection is already in this room, ignore duplicate join_room
                    if (currentRoomId === roomId && currentUserId && rooms.has(roomId) && rooms.get(roomId).users.has(currentUserId)) {
                        break;
                    }

                    // If this WebSocket connection was previously in another room, disconnect from it first
                    if (currentRoomId && currentUserId) {
                        handleDisconnect();
                    }

                    currentUserId = uuidv4();
                    currentRoomId = roomId;

                    if (!rooms.has(roomId)) {
                        // Create room
                        rooms.set(roomId, {
                            password: password || null,
                            hostId: currentUserId,
                            users: new Map(),
                            playbackState: { playing: false, time: 0, speed: 1, updatedAt: Date.now() },
                            collaborative: false
                        });
                    }

                    const room = rooms.get(roomId);

                    // Password check bypassed as per request
                    if (false && room.password && room.password !== password && room.users.size > 0) {
                        sendToUser(ws, { type: 'error', payload: { message: 'Incorrect room password.' } });
                        ws.close();
                        return;
                    }

                    const userData = {
                        id: currentUserId,
                        username: username || 'Anonymous',
                        color: color || '#888888',
                        readyState: 'not_ready',
                        isReady: false,
                        videoHash: null,
                        videoSize: null,
                        subtitleLoaded: false,
                        buffering: false,
                        latency: 0,
                        syncOffset: 0,
                        ws: ws
                    };

                    room.users.set(currentUserId, userData);

                    // Send room state to the joining user
                    const usersList = Array.from(room.users.values()).map(u => ({
                        id: u.id, username: u.username, color: u.color, readyState: u.readyState, isReady: u.isReady,
                        videoHash: u.videoHash, subtitleLoaded: u.subtitleLoaded, buffering: u.buffering,
                        latency: u.latency, syncOffset: u.syncOffset
                    }));

                    sendToUser(ws, {
                        type: 'room_joined',
                        payload: {
                            roomId,
                            userId: currentUserId,
                            hostId: room.hostId,
                            collaborative: room.collaborative,
                            users: usersList,
                            playbackState: room.playbackState
                        }
                    });

                    // Broadcast to others
                    broadcastToRoom(roomId, {
                        type: 'user_joined',
                        payload: {
                            user: {
                                id: userData.id, username: userData.username, color: userData.color,
                                readyState: userData.readyState, isReady: userData.isReady
                            }
                        }
                    }, currentUserId);
                    break;
                }

                case 'leave_room':
                    handleDisconnect();
                    break;

                case 'chat_message': {
                    const room = rooms.get(currentRoomId);
                    if (room) {
                        broadcastToRoom(currentRoomId, {
                            type: 'chat_message',
                            payload: {
                                userId: currentUserId,
                                username: room.users.get(currentUserId).username,
                                color: room.users.get(currentUserId).color,
                                message: payload.message,
                                timestamp: Date.now()
                            }
                        });
                    }
                    break;
                }

                case 'reaction': {
                    const room = rooms.get(currentRoomId);
                    if (room) {
                        broadcastToRoom(currentRoomId, {
                            type: 'reaction',
                            payload: {
                                userId: currentUserId,
                                username: room.users.get(currentUserId).username,
                                emoji: payload.emoji,
                                timestamp: Date.now()
                            }
                        });
                    }
                    break;
                }

                case 'update_state': {
                    // Update user's local state (hash, ready, buffering, latency)
                    const room = rooms.get(currentRoomId);
                    if (room) {
                        const user = room.users.get(currentUserId);
                        if (user) {
                            if (payload.videoHash !== undefined) user.videoHash = payload.videoHash;
                            if (payload.videoSize !== undefined) user.videoSize = payload.videoSize;
                            if (payload.readyState !== undefined) user.readyState = payload.readyState;
                            if (payload.isReady !== undefined) user.isReady = payload.isReady;
                            if (payload.subtitleLoaded !== undefined) user.subtitleLoaded = payload.subtitleLoaded;
                            if (payload.buffering !== undefined) user.buffering = payload.buffering;
                            if (payload.latency !== undefined) user.latency = payload.latency;
                            if (payload.syncOffset !== undefined) user.syncOffset = payload.syncOffset;

                            broadcastToRoom(currentRoomId, {
                                type: 'user_state_updated',
                                payload: {
                                    userId: currentUserId,
                                    state: {
                                        videoHash: user.videoHash,
                                        videoSize: user.videoSize,
                                        readyState: user.readyState,
                                        isReady: user.isReady,
                                        subtitleLoaded: user.subtitleLoaded,
                                        buffering: user.buffering,
                                        latency: user.latency,
                                        syncOffset: user.syncOffset
                                    }
                                }
                            });
                        }
                    }
                    break;
                }

                case 'sync_playback': {
                    const room = rooms.get(currentRoomId);
                    if (room) {
                        if (currentUserId === room.hostId || room.collaborative) {
                            room.playbackState = {
                                playing: payload.playing,
                                time: payload.time,
                                speed: payload.speed,
                                updatedAt: Date.now()
                            };
                            broadcastToRoom(currentRoomId, {
                                type: 'sync_playback',
                                payload: {
                                    ...room.playbackState,
                                    userId: currentUserId,
                                    username: room.users.get(currentUserId).username,
                                    action: payload.action
                                }
                            }, currentUserId); // Don't echo to the sender if they are host, unless we want to for confirmation
                        }
                    }
                    break;
                }

                case 'transfer_host': {
                    const room = rooms.get(currentRoomId);
                    if (room && room.hostId === currentUserId) {
                        if (room.users.has(payload.newHostId)) {
                            room.hostId = payload.newHostId;
                            broadcastToRoom(currentRoomId, {
                                type: 'host_transferred',
                                payload: { newHostId: payload.newHostId }
                            });
                        }
                    }
                    break;
                }
                
                case 'set_collaborative': {
                    const room = rooms.get(currentRoomId);
                    if (room && room.hostId === currentUserId) {
                        room.collaborative = payload.collaborative;
                        broadcastToRoom(currentRoomId, {
                            type: 'room_settings_updated',
                            payload: { collaborative: room.collaborative }
                        });
                    }
                    break;
                }

                case 'remove_user': {
                    const room = rooms.get(currentRoomId);
                    if (room && room.hostId === currentUserId) {
                        const targetUser = room.users.get(payload.targetUserId);
                        if (targetUser && payload.targetUserId !== currentUserId) {
                            sendToUser(targetUser.ws, {
                                type: 'removed_from_room',
                                payload: { message: 'You have been removed from the room by the host.' }
                            });
                            room.users.delete(payload.targetUserId);
                            broadcastToRoom(currentRoomId, {
                                type: 'user_removed',
                                payload: { userId: payload.targetUserId, username: targetUser.username }
                            });
                            targetUser.ws.close();
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        handleDisconnect();
    });
    
    ws.on('error', () => {
        handleDisconnect();
    });

    function handleDisconnect() {
        if (currentRoomId && currentUserId) {
            const room = rooms.get(currentRoomId);
            if (room) {
                const wasInRoom = room.users.has(currentUserId);
                room.users.delete(currentUserId);
                if (room.users.size === 0) {
                    rooms.delete(currentRoomId); // Clean up empty room
                } else if (wasInRoom) {
                    if (room.hostId === currentUserId) {
                        // Reassign host to next available user
                        room.hostId = Array.from(room.users.keys())[0];
                        broadcastToRoom(currentRoomId, {
                            type: 'host_transferred',
                            payload: { newHostId: room.hostId }
                        });
                    }
                    broadcastToRoom(currentRoomId, {
                        type: 'user_left',
                        payload: { userId: currentUserId }
                    });
                }
            }
            currentRoomId = null;
            currentUserId = null;
        }
    }
});

server.listen(PORT, () => {
    console.log(`Syncplay Clone Server running on http://localhost:${PORT}`);
});
