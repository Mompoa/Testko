const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Nebulous Server Running!');
});

const wss = new WebSocket.Server({ server });

// World config — tiny room, low CPU
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 1000;
const FOOD_COUNT = 80;
const TICK_RATE = 100; // 10Hz
const MIN_RADIUS = 20;
const MAX_SPEED = 5;
const EAT_RATIO = 1.15;
const VIEW_RANGE = 600; // viewport culling

let players = {};
let foods = [];
let nextId = 1;

function randomColor() {
    const colors = ['#FF4444','#FF8800','#FFDD00','#44FF44','#00CCFF','#AA44FF','#FF44AA','#44FFDD'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function spawnFood() {
    return {
        id: nextId++,
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        r: 6 + Math.random() * 6,
        color: randomColor()
    };
}

for (let i = 0; i < FOOD_COUNT; i++) foods.push(spawnFood());

function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function sendTo(ws, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// --- Game loop ---
setInterval(() => {
    const playerList = Object.values(players);

    // Move players toward target
    for (const p of playerList) {
        if (p.targetX == null) continue;
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 2) continue;
        const speed = Math.max(1.5, MAX_SPEED - p.r * 0.04);
        const move = Math.min(speed, d);
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        p.x = Math.max(p.r, Math.min(WORLD_WIDTH - p.r, p.x));
        p.y = Math.max(p.r, Math.min(WORLD_HEIGHT - p.r, p.y));
    }

    // Food eating
    for (const p of playerList) {
        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            if (dist(p, f) < p.r) {
                p.r += f.r * 0.3;
                foods.splice(i, 1);
            }
        }
    }

    // Respawn food
    while (foods.length < FOOD_COUNT) foods.push(spawnFood());

    // Player eating
    for (let i = 0; i < playerList.length; i++) {
        for (let j = 0; j < playerList.length; j++) {
            if (i === j) continue;
            const big = playerList[i];
            const small = playerList[j];
            if (big.r > small.r * EAT_RATIO && dist(big, small) < big.r - small.r * 0.5) {
                big.r += small.r * 0.5;
                big.score += small.score + 10;
                sendTo(small.ws, { type: 'eaten', by: big.name });
                small.x = Math.random() * WORLD_WIDTH;
                small.y = Math.random() * WORLD_HEIGHT;
                small.r = MIN_RADIUS;
                small.score = 0;
            }
        }
    }

    // Leaderboard
    const leaderboard = [...playerList]
        .sort((a, b) => b.r - a.r)
        .slice(0, 5)
        .map(p => ({ name: p.name, r: Math.round(p.r), score: p.score }));

    // Per-player viewport culling — send only nearby foods & players
    for (const p of playerList) {
        const nearbyFoods = foods.filter(f =>
            Math.abs(f.x - p.x) < VIEW_RANGE && Math.abs(f.y - p.y) < VIEW_RANGE
        );
        const nearbyPlayers = playerList.filter(other =>
            Math.abs(other.x - p.x) < VIEW_RANGE * 1.5 && Math.abs(other.y - p.y) < VIEW_RANGE * 1.5
        );

        sendTo(p.ws, {
            type: 'state',
            players: nearbyPlayers.map(q => ({
                id: q.id, name: q.name,
                x: Math.round(q.x), y: Math.round(q.y),
                r: Math.round(q.r), color: q.color, score: q.score
            })),
            foods: nearbyFoods.map(f => ({
                id: f.id, x: Math.round(f.x), y: Math.round(f.y),
                r: Math.round(f.r), color: f.color
            })),
            leaderboard
        });
    }

}, TICK_RATE);

// --- Connection ---
wss.on('connection', function(ws) {
    console.log('Client connected');

    ws.on('message', function(message) {
        let data;
        try { data = JSON.parse(message.toString()); } catch(e) { return; }

        if (data.type === 'join') {
            const id = nextId++;
            const name = (data.name || 'Player').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Player';
            const color = randomColor();
            const player = {
                id, ws, name, color,
                x: Math.random() * WORLD_WIDTH,
                y: Math.random() * WORLD_HEIGHT,
                r: MIN_RADIUS,
                score: 0,
                targetX: null,
                targetY: null
            };
            players[id] = player;
            ws.playerId = id;
            sendTo(ws, {
                type: 'joined', id, name, color,
                worldWidth: WORLD_WIDTH,
                worldHeight: WORLD_HEIGHT
            });
            console.log(`${name} joined (id=${id})`);
        }

        if (data.type === 'move') {
            const p = players[ws.playerId];
            if (!p) return;
            p.targetX = Math.max(0, Math.min(WORLD_WIDTH, data.x));
            p.targetY = Math.max(0, Math.min(WORLD_HEIGHT, data.y));
        }
    });

    ws.on('close', function() {
        const id = ws.playerId;
        if (id && players[id]) {
            console.log(`${players[id].name} left`);
            delete players[id];
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Nebulous server running on port ${PORT}`);
});
            
