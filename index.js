const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = '/vless';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

console.log('=== VPN Relay v2 Starting ===');
console.log(`Target VPN: ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
console.log(`Panel: http://${TARGET_HOST}:${PANEL_PORT}`);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
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
    console.error('[PANEL] Error:', err.message);
    res.writeHead(502);
    res.end('Panel connection error');
  });
  req.pipe(proxyReq);
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (clientWs, req) => {
  const clientId = Math.random().toString(36).substring(7);
  console.log(`[${clientId}] Client connected`);
  
  // Parse early-data from URL if present (for ed parameter)
  const url = new URL(req.url, 'http://localhost');
  const earlyData = url.searchParams.get('ed');
  
  // Connect to VPN server with binary type
  const targetWs = new WebSocket(`ws://${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`, {
    // Important: receive data as buffers, not strings
    perMessageDeflate: false,
    maxPayload: 100 * 1024 * 1024 // 100MB
  });
  
  // Set binary type for proper VLESS data handling
  targetWs.binaryType = 'arraybuffer';
  clientWs.binaryType = 'arraybuffer';
  
  let vpnReady = false;
  let pendingMessages = [];
  
  targetWs.on('open', () => {
    console.log(`[${clientId}] VPN connected`);
    vpnReady = true;
    
    // Send any pending messages
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift();
      targetWs.send(msg);
    }
    
    // Send early-data if present
    if (earlyData) {
      try {
        const decoded = Buffer.from(earlyData, 'base64');
        targetWs.send(decoded);
        console.log(`[${clientId}] Sent early-data: ${decoded.length} bytes`);
      } catch (e) {
        console.log(`[${clientId}] Early-data decode error: ${e.message}`);
      }
    }
  });
  
  targetWs.on('message', (data, isBinary) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        // Forward as binary
        clientWs.send(data, { binary: true });
      }
    } catch (e) {
      console.error(`[${clientId}] Send to client error:`, e.message);
    }
  });
  
  clientWs.on('message', (data, isBinary) => {
    try {
      if (vpnReady && targetWs.readyState === WebSocket.OPEN) {
        // Forward as binary
        targetWs.send(data, { binary: true });
      } else if (!vpnReady) {
        // Queue message until VPN is ready
        pendingMessages.push(data);
      }
    } catch (e) {
      console.error(`[${clientId}] Send to VPN error:`, e.message);
    }
  });
  
  const cleanup = (reason) => {
    console.log(`[${clientId}] Connection closed: ${reason}`);
    pendingMessages = [];
    try { clientWs.close(); } catch (e) {}
    try { targetWs.close(); } catch (e) {}
  };
  
  targetWs.on('close', (code, reason) => cleanup(`VPN (code=${code})`));
  clientWs.on('close', (code, reason) => cleanup(`Client (code=${code})`));
  targetWs.on('error', (e) => cleanup(`VPN error: ${e.message}`));
  clientWs.on('error', (e) => cleanup(`Client error: ${e.message}`));
});

server.on('upgrade', (req, socket, head) => {
  const url = req.url.split('?')[0];
  console.log(`[UPGRADE] ${req.url}`);
  
  if (url === '/vless') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log(`[UPGRADE] Rejected: ${url}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

server.on('error', (err) => {
  console.error('[SERVER] Error:', err);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=== Relay listening on port ${PORT} ===`);
});
