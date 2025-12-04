const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = '/vless-ws';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

console.log('=== VPN Relay Starting ===');
console.log(`Target VPN: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
console.log(`Target Panel: http://${TARGET_HOST}:${PANEL_PORT}`);

const server = http.createServer((req, res) => {
  console.log(`HTTP ${req.method} ${req.url}`);
  
  // Health check
  if (req.url === '/health') {
    res.writeHead(200);
    return res.end('OK');
  }
  
  // Proxy to 3x-ui panel
  const options = {
    hostname: TARGET_HOST,
    port: PANEL_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${TARGET_HOST}:${PANEL_PORT}` }
  };
  
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    console.error('Panel proxy error:', err.message);
    res.writeHead(502);
    res.end('Proxy Error');
  });
  req.pipe(proxyReq);
});

// WebSocket server - noServer mode for manual upgrade handling
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (clientWs, req) => {
  const clientIP = req.headers['x-forwarded-for'] || 'unknown';
  console.log(`[WS] Client connected: ${clientIP}`);
  
  const targetWs = new WebSocket(`ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
  
  targetWs.on('open', () => {
    console.log('[WS] Connected to VPN server');
  });
  
  targetWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });
  
  clientWs.on('message', (data) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data);
    }
  });
  
  const cleanup = (reason) => {
    console.log(`[WS] Closed: ${reason}`);
    if (clientWs.readyState !== WebSocket.CLOSED) clientWs.close();
    if (targetWs.readyState !== WebSocket.CLOSED) targetWs.close();
  };
  
  targetWs.on('close', () => cleanup('VPN closed'));
  clientWs.on('close', () => cleanup('Client closed'));
  targetWs.on('error', (e) => cleanup(`VPN error: ${e.message}`));
  clientWs.on('error', (e) => cleanup(`Client error: ${e.message}`));
});

// Handle WebSocket upgrade manually
server.on('upgrade', (req, socket, head) => {
  console.log(`[UPGRADE] ${req.url}`);
  
  if (req.url === '/vless-ws' || req.url.startsWith('/vless-ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log(`[UPGRADE] Unknown path: ${req.url}, destroying socket`);
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
