const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = process.env.TARGET_PATH || '/vless-ws';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  console.log(`HTTP: ${req.method} ${req.url}`);
  
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

// WebSocket relay для VPN
const wss = new WebSocketServer({ server, path: '/vless-ws' });

wss.on('connection', (clientWs, req) => {
  console.log('=== NEW VPN CONNECTION ===');
  console.log('Client IP:', req.socket.remoteAddress);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  const targetUrl = `ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`;
  console.log('Connecting to:', targetUrl);
  
  const targetWs = new WebSocket(targetUrl, {
    perMessageDeflate: false,
    headers: {
      'Host': `${TARGET_HOST}:${TARGET_PORT}`
    }
  });
  
  let bytesFromClient = 0;
  let bytesToClient = 0;
  
  targetWs.on('open', () => {
    console.log('✓ Connected to VPN server');
  });
  
  targetWs.on('message', (data, isBinary) => {
    bytesToClient += data.length;
    console.log(`VPN→Client: ${data.length} bytes (total: ${bytesToClient})`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });
  
  clientWs.on('message', (data, isBinary) => {
    bytesFromClient += data.length;
    console.log(`Client→VPN: ${data.length} bytes (total: ${bytesFromClient})`);
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data, { binary: isBinary });
    }
  });
  
  targetWs.on('close', (code, reason) => {
    console.log(`VPN closed: ${code} ${reason.toString()}`);
    clientWs.close();
  });
  
  clientWs.on('close', (code, reason) => {
    console.log(`Client closed: ${code}`);
    console.log(`Stats: Client→VPN: ${bytesFromClient}, VPN→Client: ${bytesToClient}`);
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
  console.log(`=== VPN Relay Started ===`);
  console.log(`Port: ${PORT}`);
  console.log(`VPN: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
  console.log(`Panel: http://${TARGET_HOST}:${PANEL_PORT}`);
});
