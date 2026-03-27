/**
 * UI server — serves the swarm canvas and streams events via WebSocket.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { bus } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_FILE = path.join(__dirname, '..', 'public', 'index.html');

export function startServer({ port = 7700, config } = {}) {
  const clients = new Set();

  // Replay buffer — last 500 events so new browser tabs catch up
  const buffer = [];
  const push = (evt) => {
    buffer.push(evt);
    if (buffer.length > 500) buffer.shift();
    const msg = JSON.stringify(evt);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  };

  // Forward all bus events to WebSocket clients
  bus.on('event', push);

  // HTTP server — serves index.html
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      try {
        const html = fs.readFileSync(UI_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end('UI not found');
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // WebSocket server
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    clients.add(ws);
    // Send config + buffered events so browser has full state immediately
    ws.send(JSON.stringify({ type: 'config', ...config, ts: Date.now() }));
    for (const evt of buffer) {
      if (ws.readyState === 1) ws.send(JSON.stringify(evt));
    }
    ws.on('close', () => clients.delete(ws));
  });

  server.listen(port, '127.0.0.1', () => {});
  return { url: `http://127.0.0.1:${port}` };
}
