const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('TicTacToe Server Running!');
});

const wss = new WebSocket.Server({ server });

let rooms = {};

function generateRoomId() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function findAvailableRoom() {
    for (let id in rooms) {
        if (rooms[id].players.length === 1) return id;
    }
    return null;
}

wss.on('connection', function(ws) {
    console.log('Client connected');

    ws.on('message', function(message) {
        const data = JSON.parse(message.toString());

        if (data.type === 'join') {
            let roomId = findAvailableRoom();
            if (!roomId) {
                roomId = generateRoomId();
                rooms[roomId] = {
                    players: [],
                    board: Array(9).fill(null),
                    currentTurn: 1
                };
            }
            const room = rooms[roomId];
            room.players.push(ws);
            ws.room = roomId;
            ws.playerNum = room.players.length;
            ws.playerName = data.name || ('Player ' + ws.playerNum);

            ws.send(JSON.stringify({
                type: 'joined',
                player: ws.playerNum,
                room: roomId,
                name: ws.playerName
            }));

            if (room.players.length === 2) {
                const p1 = room.players[0];
                const p2 = room.players[1];
                p1.send(JSON.stringify({
                    type: 'start',
                    room: roomId,
                    opponentName: p2.playerName
                }));
                p2.send(JSON.stringify({
                    type: 'start',
                    room: roomId,
                    opponentName: p1.playerName
                }));
            }
        }

        if (data.type === 'move') {
            const room = rooms[ws.room];
            if (!room) return;
            if (room.currentTurn !== ws.playerNum) return;
            const idx = data.index;
            if (idx < 0 || idx > 8 || room.board[idx] !== null) return;

            room.board[idx] = ws.playerNum;
            room.currentTurn = ws.playerNum === 1 ? 2 : 1;

            room.players.forEach(p => {
                p.send(JSON.stringify({
                    type: 'move',
                    index: idx,
                    player: ws.playerNum
                }));
            });
        }

        if (data.type === 'chat') {
            const room = rooms[ws.room];
            if (room) {
                room.players.forEach(p => {
                    p.send(JSON.stringify({
                        type: 'chat',
                        player: ws.playerNum,
                        name: ws.playerName,
                        msg: data.msg
                    }));
                });
            }
        }

        if (data.type === 'leave') {
            handleLeave(ws);
        }
    });

    ws.on('close', function() {
        handleLeave(ws);
        console.log('Client disconnected');
    });
});

function handleLeave(ws) {
    if (ws.hasLeft) return;
    ws.hasLeft = true;
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
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
