import { WebSocketServer, WebSocket } from 'ws';

const PORT = 3003;
const wss = new WebSocketServer({ port: PORT });

let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  console.log(`[Notification Service] Client connected (${clientCount} total)`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'WB Notification Service',
    timestamp: new Date().toISOString(),
    clients: clientCount,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[Notification Service] Received: ${msg.type}`);
      
      // Broadcast to all OTHER clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            ...msg,
            timestamp: new Date().toISOString(),
          }));
        }
      });
    } catch (e) {
      console.error('[Notification Service] Invalid message:', e);
    }
  });

  ws.on('close', () => {
    clientCount--;
    console.log(`[Notification Service] Client disconnected (${clientCount} total)`);
  });

  ws.on('error', (err) => {
    console.error('[Notification Service] WebSocket error:', err);
  });
});

// Health check endpoint via HTTP
import { createServer } from 'http';
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'wb-notification-service',
      port: PORT,
      clients: clientCount,
      uptime: process.uptime(),
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT + 1, () => {
  console.log(`[Notification Service] HTTP health check on port ${PORT + 1}`);
});

console.log(`[Notification Service] WebSocket server running on ws://localhost:${PORT}`);
console.log(`[Notification Service] Health check: http://localhost:${PORT + 1}/health`);
