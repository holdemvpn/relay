const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = process.env.TARGET_PATH || '/vless-ws';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  // Проксируем HTTP запросы на 3x-ui панель
  const options = {
    hostname: TARGET_HOST,
    port: PANEL_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${PANEL_PORT}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Panel proxy error:', err.message);
    res.writeHead(502);
    res.end('Panel Proxy Error: ' + err.message);
  });

  req.pipe(proxyReq);
});

// WebSocket для VPN на /vless-ws
const wss = new WebSocketServer({ server, path: '/vless-ws' });

wss.on('connection', (clientWs, req) => {
  console.log('VPN Client connected from:', req.socket.remoteAddress);
  
  const targetUrl = `ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`;
  console.log('Connecting to VPN:', targetUrl);
  
  const targetWs = new WebSocket(targetUrl);
  
  targetWs.on('open', () => {
    console.log('Connected to VPN server');
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
  
  targetWs.on('close', (code, reason) => {
    console.log('VPN connection closed:', code, reason.toString());
    clientWs.close();
  });
  
  clientWs.on('close', (code, reason) => {
    console.log('Client disconnected:', code);
    targetWs.close();
  });
  
  targetWs.on('error', (err) => {
    console.error('VPN error:', err.message);
    clientWs.close();
  });
  
  clientWs.on('error', (err) => {
    console.error('Client error:', err.message);
    targetWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`Relay running on port ${PORT}`);
  console.log(`VPN WebSocket path: /vless-ws -> ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
  console.log(`Panel proxy: / -> http://${TARGET_HOST}:${PANEL_PORT}`);
});
