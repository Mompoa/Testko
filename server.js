const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Nebulous Server Running!');
});

const wss = new WebSocket.Server({ server });

// World config
const WORLD_WIDTH  = 1000;
const WORLD_HEIGHT = 1000;
const FOOD_COUNT   = 80;
const TICK_RATE    = 100;   // 10Hz
const MIN_RADIUS   = 20;
const MAX_SPEED    = 5;
const EAT_RATIO    = 1.15;
const VIEW_RANGE   = 600;

// Virus config
const VIRUS_COUNT  = 5;
const VIRUS_RADIUS = 35;    // fixed size
const VIRUS_SPLIT_THRESHOLD = 50; // blob must be bigger than this to get split

let players  = {};
let blobs    = {};  // split blobs: { id, ownerId, x, y, r, color, vx, vy, mergeTimer }
let foods    = [];
let viruses  = [];
let ejected  = []; // ejected mass pellets
let nextId   = 1;

// ---- Helpers ----
function randomColor() {
    const colors = ['#FF4444','#FF8800','#FFDD00','#44FF44','#00CCFF','#AA44FF','#FF44AA','#44FFDD'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function sendTo(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function spawnFood() {
    return {
        id: nextId++,
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        r: 5,           // uniform size
        color: randomColor()
    };
}

function spawnVirus() {
    return {
        id: nextId++,
        x: 50 + Math.random() * (WORLD_WIDTH  - 100),
        y: 50 + Math.random() * (WORLD_HEIGHT - 100),
        r: VIRUS_RADIUS
    };
}

for (let i = 0; i < FOOD_COUNT; i++) foods.push(spawnFood());
for (let i = 0; i < VIRUS_COUNT; i++) viruses.push(spawnVirus());

// ---- Game loop ----
setInterval(() => {
    const playerList = Object.values(players);
    const blobList   = Object.values(blobs);

    // --- Move main blobs ---
    for (const p of playerList) {
        if (p.targetX == null) continue;
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 2) continue;
        const speed = Math.max(1.5, MAX_SPEED - p.r * 0.04);
        const move  = Math.min(speed, d);
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        p.x = Math.max(p.r, Math.min(WORLD_WIDTH  - p.r, p.x));
        p.y = Math.max(p.r, Math.min(WORLD_HEIGHT - p.r, p.y));
    }

    // --- Move split blobs (momentum) ---
    for (const b of blobList) {
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed > 0.1) {
            b.x += b.vx;
            b.y += b.vy;
            b.vx *= 0.85;
            b.vy *= 0.85;
        }
        b.x = Math.max(b.r, Math.min(WORLD_WIDTH  - b.r, b.x));
        b.y = Math.max(b.r, Math.min(WORLD_HEIGHT - b.r, b.y));

        // Move toward owner target slowly
        const owner = players[b.ownerId];
        if (owner && owner.targetX != null) {
            const dx = owner.targetX - b.x;
            const dy = owner.targetY - b.y;
            const d  = Math.sqrt(dx * dx + dy * dy);
            if (d > 5) {
                const s = Math.max(1, MAX_SPEED * 0.6 - b.r * 0.03);
                b.x += (dx / d) * s;
                b.y += (dy / d) * s;
            }
        }

        // Merge timer countdown
        b.mergeTimer = Math.max(0, b.mergeTimer - TICK_RATE);

        // Re-merge with owner blob when timer expires
        if (b.mergeTimer <= 0 && owner) {
            const d = dist(b, owner);
            if (d < owner.r) {
                owner.r = Math.sqrt(owner.r * owner.r + b.r * b.r);
                delete blobs[b.id];
            }
        }
    }

    // --- Move ejected mass ---
    for (let i = ejected.length - 1; i >= 0; i--) {
        const e = ejected[i];
        e.x += e.vx;
        e.y += e.vy;
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.x = Math.max(e.r, Math.min(WORLD_WIDTH  - e.r, e.x));
        e.y = Math.max(e.r, Math.min(WORLD_HEIGHT - e.r, e.y));
    }

    // --- Food eating (main blobs + split blobs) ---
    const allBlobs = [...playerList, ...Object.values(blobs)];
    for (const p of allBlobs) {
        for (let i = foods.length - 1; i >= 0; i--) {
            if (dist(p, foods[i]) < p.r) {
                // Give mass to owner
                const owner = p.ownerId ? players[p.ownerId] : p;
                if (owner) owner.r += 0.3;
                foods.splice(i, 1);
            }
        }
        // Eat ejected mass (not own)
        for (let i = ejected.length - 1; i >= 0; i--) {
            const e = ejected[i];
            const ownerId = p.ownerId || p.id;
            if (e.ownerId === ownerId) continue;
            if (dist(p, e) < p.r) {
                const owner = p.ownerId ? players[p.ownerId] : p;
                if (owner) owner.r += e.r;
                ejected.splice(i, 1);
            }
        }
    }

    // Respawn food
    while (foods.length < FOOD_COUNT) foods.push(spawnFood());

    // --- Virus collision ---
    for (const p of playerList) {
        for (const v of viruses) {
            if (dist(p, v) < p.r && p.r > VIRUS_SPLIT_THRESHOLD) {
                // Split blob into many pieces
                const pieces = Math.min(8, Math.floor(p.r / 15));
                const pieceR  = p.r / Math.sqrt(pieces + 1);
                p.r = pieceR;
                for (let k = 0; k < pieces; k++) {
                    const angle = (k / pieces) * Math.PI * 2;
                    const nb = {
                        id: nextId++,
                        ownerId: p.id,
                        x: p.x + Math.cos(angle) * p.r,
                        y: p.y + Math.sin(angle) * p.r,
                        r: pieceR,
                        color: p.color,
                        vx: Math.cos(angle) * 4,
                        vy: Math.sin(angle) * 4,
                        mergeTimer: 5000
                    };
                    blobs[nb.id] = nb;
                }
            }
        }
    }

    // Respawn viruses
    while (viruses.length < VIRUS_COUNT) viruses.push(spawnVirus());

    // --- Player eating player ---
    for (let i = 0; i < playerList.length; i++) {
        for (let j = 0; j < playerList.length; j++) {
            if (i === j) continue;
            const big   = playerList[i];
            const small = playerList[j];
            if (big.r > small.r * EAT_RATIO && dist(big, small) < big.r - small.r * 0.5) {
                big.r    += small.r * 0.5;
                big.score += small.score + 10;
                sendTo(small.ws, { type: 'eaten', by: big.name });
                small.x     = Math.random() * WORLD_WIDTH;
                small.y     = Math.random() * WORLD_HEIGHT;
                small.r     = MIN_RADIUS;
                small.score = 0;
                // Remove small's split blobs
                for (const bid in blobs) {
                    if (blobs[bid].ownerId === small.id) delete blobs[bid];
                }
            }
        }
    }

    // Leaderboard
    const leaderboard = [...playerList]
        .sort((a, b) => b.r - a.r)
        .slice(0, 5)
        .map(p => ({ name: p.name, r: Math.round(p.r), score: p.score }));

    // Per-player send (viewport culling)
    for (const p of playerList) {
        const vr = VIEW_RANGE;
        const nearbyFoods   = foods.filter(f   => Math.abs(f.x - p.x) < vr && Math.abs(f.y - p.y) < vr);
        const nearbyPlayers = playerList.filter(q => Math.abs(q.x - p.x) < vr * 1.5 && Math.abs(q.y - p.y) < vr * 1.5);
        const nearbyBlobs   = Object.values(blobs).filter(b => Math.abs(b.x - p.x) < vr && Math.abs(b.y - p.y) < vr);
        const nearbyEjected = ejected.filter(e => Math.abs(e.x - p.x) < vr && Math.abs(e.y - p.y) < vr);
        const nearbyViruses = viruses.filter(v => Math.abs(v.x - p.x) < vr && Math.abs(v.y - p.y) < vr);

        sendTo(p.ws, {
            type: 'state',
            players: nearbyPlayers.map(q => ({
                id: q.id, name: q.name,
                x: Math.round(q.x), y: Math.round(q.y),
                r: Math.round(q.r), color: q.color, score: q.score
            })),
            blobs: nearbyBlobs.map(b => ({
                id: b.id, ownerId: b.ownerId,
                x: Math.round(b.x), y: Math.round(b.y),
                r: Math.round(b.r), color: b.color
            })),
            foods: nearbyFoods.map(f => ({
                id: f.id, x: Math.round(f.x), y: Math.round(f.y),
                r: f.r, color: f.color
            })),
            ejected: nearbyEjected.map(e => ({
                id: e.id, x: Math.round(e.x), y: Math.round(e.y),
                r: e.r, color: e.color
            })),
            viruses: nearbyViruses.map(v => ({
                id: v.id, x: Math.round(v.x), y: Math.round(v.y), r: v.r
            })),
            leaderboard
        });
    }

}, TICK_RATE);

// ---- Connection ----
wss.on('connection', function(ws) {
    console.log('Client connected');

    ws.on('message', function(message) {
        let data;
        try { data = JSON.parse(message.toString()); } catch(e) { return; }

        if (data.type === 'join') {
            const id    = nextId++;
            const name  = (data.name || 'Player').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Player';
            const color = randomColor();
            players[id] = {
                id, ws, name, color,
                x: Math.random() * WORLD_WIDTH,
                y: Math.random() * WORLD_HEIGHT,
                r: MIN_RADIUS, score: 0,
                targetX: null, targetY: null
            };
            ws.playerId = id;
            sendTo(ws, { type: 'joined', id, name, color, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT });
            console.log(`${name} joined (id=${id})`);
        }

        if (data.type === 'move') {
            const p = players[ws.playerId];
            if (!p) return;
            p.targetX = Math.max(0, Math.min(WORLD_WIDTH,  data.x));
            p.targetY = Math.max(0, Math.min(WORLD_HEIGHT, data.y));
            // Also update split blobs target
            for (const bid in blobs) {
                if (blobs[bid].ownerId === p.id) {
                    blobs[bid].targetX = p.targetX;
                    blobs[bid].targetY = p.targetY;
                }
            }
        }

        // Eject mass — W button equivalent
        if (data.type === 'eject') {
            const p = players[ws.playerId];
            if (!p || p.r < 22) return;
            const dx = (data.tx - p.x) || 1;
            const dy = (data.ty - p.y) || 0;
            const d  = Math.sqrt(dx * dx + dy * dy) || 1;
            const speed = 8;
            ejected.push({
                id: nextId++,
                ownerId: p.id,
                x: p.x + (dx / d) * (p.r + 6),
                y: p.y + (dy / d) * (p.r + 6),
                r: 5,
                color: p.color,
                vx: (dx / d) * speed,
                vy: (dy / d) * speed
                // no life — stays until eaten
            });
            p.r = Math.max(MIN_RADIUS, p.r - 2);
        }

        // Split blob — min r=20, max 5 blobs total
        if (data.type === 'split') {
            const p = players[ws.playerId];
            const myBlobCount = Object.values(blobs).filter(b => b.ownerId === p.id).length;
            if (!p || p.r < MIN_RADIUS) return;
            if (myBlobCount >= 4) return; // main blob + 4 splits = 5 total
            const dx = (data.tx - p.x) || 1;
            const dy = (data.ty - p.y) || 0;
            const d  = Math.sqrt(dx * dx + dy * dy) || 1;
            const newR = p.r / Math.SQRT2;
            p.r = newR;
            const nb = {
                id: nextId++,
                ownerId: p.id,
                x: p.x + (dx / d) * newR,
                y: p.y + (dy / d) * newR,
                r: newR,
                color: p.color,
                vx: (dx / d) * 7,
                vy: (dy / d) * 7,
                mergeTimer: 5000
            };
            blobs[nb.id] = nb;
        }
    });

    ws.on('close', function() {
        const id = ws.playerId;
        if (id && players[id]) {
            console.log(`${players[id].name} left`);
            delete players[id];
            for (const bid in blobs) {
                if (blobs[bid].ownerId === id) delete blobs[bid];
            }
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Nebulous server on port ${PORT}`));
