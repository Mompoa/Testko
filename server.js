const WebSocket = require('ws');
const http = require('http');

// HTTP server para sa health check ng Render
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('WebSocket Server Running!');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', function(ws) {
    console.log('Client connected');

    ws.on('message', function(message) {
        console.log('Received: ' + message);

        // I-broadcast sa lahat
        wss.clients.forEach(function(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', function() {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});