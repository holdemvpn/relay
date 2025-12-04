const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = '/vless';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

console.log('=== VPN Relay Starting ===');
console.log(`Target VPN: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    return res.end('OK');
  }
  
  // Proxy to panel
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
    res.writeHead(502);
    res.end('Error');
  });
  req.pipe(proxyReq);
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (clientWs, req) => {
  console.log('[WS] Client connected');
  
  const targetWs = new WebSocket(`ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
  
  targetWs.on('open', () => console.log('[WS] VPN connected'));
  
  targetWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });
  
  clientWs.on('message', (data) => {
    if (targetWs.readyState === WebSocket.OPEN) targetWs.send(data);
  });
  
  const cleanup = (r) => {
    console.log(`[WS] Closed: ${r}`);
    clientWs.close();
    targetWs.close();
  };
  
  targetWs.on('close', () => cleanup('VPN'));
  clientWs.on('close', () => cleanup('Client'));
  targetWs.on('error', (e) => cleanup(e.message));
  clientWs.on('error', (e) => cleanup(e.message));
});

server.on('upgrade', (req, socket, head) => {
  console.log(`[UPGRADE] ${req.url}`);
  
  if (req.url === '/vless' || req.url.startsWith('/vless?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => console.log(`Relay on ${PORT}`));
