const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = '/vless-ws';  // Фиксированный путь
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  // Proxy HTTP to 3x-ui panel
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
    res.end('Error: ' + err.message);
  });
  req.pipe(proxyReq);
});

// WebSocket relay для VLESS
const wss = new WebSocketServer({ server, path: '/vless-ws' });

wss.on('connection', (clientWs, req) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[+] Client: ${clientIP}`);
  
  const targetUrl = `ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`;
  const targetWs = new WebSocket(targetUrl);
  
  let up = 0, down = 0;
  
  targetWs.on('open', () => console.log('[+] VPN connected'));
  
  targetWs.on('message', (data) => {
    down += data.length;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });
  
  clientWs.on('message', (data) => {
    up += data.length;
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data);
    }
  });
  
  const close = (who) => {
    console.log(`[-] ${who}. Up:${up} Down:${down}`);
    clientWs.close();
    targetWs.close();
  };
  
  targetWs.on('close', () => close('VPN'));
  clientWs.on('close', () => close('Client'));
  targetWs.on('error', (e) => { console.error('VPN:', e.message); close('VPN err'); });
  clientWs.on('error', (e) => { console.error('Client:', e.message); close('Client err'); });
});

server.listen(PORT, () => {
  console.log(`VPN Relay on ${PORT}`);
  console.log(`Target: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
});
