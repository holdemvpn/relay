const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = process.env.TARGET_PATH || '/vless';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  console.log(`HTTP: ${req.method} ${req.url}`);
  
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

// WebSocket relay
const wss = new WebSocketServer({ server, path: '/vless' });

wss.on('connection', (clientWs, req) => {
  console.log('=== VPN CLIENT CONNECTED ===');
  console.log('From:', req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  
  const targetUrl = `ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`;
  console.log('Connecting to:', targetUrl);
  
  const targetWs = new WebSocket(targetUrl, {
    headers: { 'Host': `${TARGET_HOST}:${TARGET_PORT}` }
  });
  
  let bytesUp = 0, bytesDown = 0;
  let connected = false;
  
  targetWs.on('open', () => {
    console.log('✓ Connected to VPN server');
    connected = true;
  });
  
  targetWs.on('message', (data, isBinary) => {
    bytesDown += data.length;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: true });
    }
  });
  
  clientWs.on('message', (data, isBinary) => {
    bytesUp += data.length;
    console.log(`↑ ${data.length}b (total: ${bytesUp})`);
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data, { binary: true });
    } else if (!connected) {
      // Buffer until connected
      targetWs.once('open', () => {
        targetWs.send(data, { binary: true });
      });
    }
  });
  
  const cleanup = (reason) => {
    console.log(`Closed: ${reason}. Up: ${bytesUp}, Down: ${bytesDown}`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    if (targetWs.readyState === WebSocket.OPEN) targetWs.close();
  };
  
  targetWs.on('close', (code) => cleanup(`VPN ${code}`));
  clientWs.on('close', (code) => cleanup(`Client ${code}`));
  targetWs.on('error', (e) => { console.error('VPN err:', e.message); cleanup('VPN error'); });
  clientWs.on('error', (e) => { console.error('Client err:', e.message); cleanup('Client error'); });
});

server.listen(PORT, () => {
  console.log('=== VPN Relay ===');
  console.log(`Listening: ${PORT}`);
  console.log(`VPN: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
});
