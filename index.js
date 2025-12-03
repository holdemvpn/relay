const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = process.env.TARGET_PATH || '/ws';
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
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Proxy Error: ' + err.message);
  });

  req.pipe(proxyReq);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (clientWs, req) => {
  console.log('Client connected from:', req.socket.remoteAddress);
  
  const targetUrl = `ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`;
  console.log('Connecting to target:', targetUrl);
  
  const targetWs = new WebSocket(targetUrl);
  
  targetWs.on('open', () => {
    console.log('Connected to target VPN server');
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
  
  targetWs.on('close', () => {
    console.log('Target connection closed');
    clientWs.close();
  });
  
  clientWs.on('close', () => {
    console.log('Client disconnected');
    targetWs.close();
  });
  
  targetWs.on('error', (err) => {
    console.error('Target error:', err.message);
    clientWs.close();
  });
  
  clientWs.on('error', (err) => {
    console.error('Client error:', err.message);
    targetWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`Relay server running on port ${PORT}`);
  console.log(`VPN WebSocket: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
  console.log(`Panel proxy: http://${TARGET_HOST}:${PANEL_PORT}`);
});
