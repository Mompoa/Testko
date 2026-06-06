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
                rooms[roomId] = { players: [], board: Array(9).fill(null) };
            }
            const room = rooms[roomId];
            room.players.push(ws);
            ws.room = roomId;
            ws.playerNum = room.players.length;

            ws.send(JSON.stringify({
                type: 'joined',
                player: ws.playerNum,
                room: roomId
            }));

            if (room.players.length === 2) {
                room.players.forEach(p => {
                    p.send(JSON.stringify({ type: 'start', room: roomId }));
                });
            }
        }

        if (data.type === 'move') {
            const room = rooms[ws.room];
            if (room) {
                room.board[data.index] = ws.playerNum;
                room.players.forEach(p => {
                    p.send(JSON.stringify({
                        type: 'move',
                        index: data.index,
                        player: ws.playerNum
                    }));
                });
            }
        }

        if (data.type === 'chat') {
            const room = rooms[ws.room];
            if (room) {
                room.players.forEach(p => {
                    p.send(JSON.stringify({
                        type: 'chat',
                        player: ws.playerNum,
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
