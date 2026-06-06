const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('TicTacToe Server Running!');
});

const wss = new WebSocket.Server({ server });

let rooms = {};

wss.on('connection', function(ws) {
    console.log('Client connected');

    ws.on('message', function(message) {
        const data = JSON.parse(message.toString());

        if (data.type === 'join') {
            const roomId = data.room;
            if (!rooms[roomId]) {
                rooms[roomId] = { players: [], emoji: {} };
            }
            const room = rooms[roomId];

            if (room.players.length < 2) {
                room.players.push(ws);
                ws.room = roomId;
                const playerNum = room.players.length;
                ws.playerNum = playerNum;
                room.emoji[playerNum] = data.emoji;

                ws.send(JSON.stringify({
                    type: 'joined',
                    player: playerNum,
                    emoji: data.emoji
                }));

                if (room.players.length === 2) {
                    room.players.forEach(p => {
                        p.send(JSON.stringify({
                            type: 'start',
                            emoji1: room.emoji[1],
                            emoji2: room.emoji[2]
                        }));
                    });
                }
            } else {
                ws.send(JSON.stringify({ type: 'full' }));
            }
        }

        if (data.type === 'move') {
            const room = rooms[ws.room];
            if (room) {
                room.players.forEach(p => {
                    p.send(JSON.stringify({
                        type: 'move',
                        index: data.index,
                        player: ws.playerNum
                    }));
                });
            }
        }

        if (data.type === 'restart') {
            const room = rooms[ws.room];
            if (room) {
                room.players.forEach(p => {
                    p.send(JSON.stringify({ type: 'restart' }));
                });
            }
        }
    });

    ws.on('close', function() {
        const room = rooms[ws.room];
        if (room) {
            room.players = room.players.filter(p => p !== ws);
            room.players.forEach(p => {
                p.send(JSON.stringify({ type: 'opponent_left' }));
            });
            if (room.players.length === 0) {
                delete rooms[ws.room];
            }
        }
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
