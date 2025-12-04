const http = require('http');
const net = require('net');

const TARGET_HOST = process.env.TARGET_HOST || '77.221.156.175';
const TARGET_PORT = process.env.TARGET_PORT || '8080';
const TARGET_PATH = process.env.TARGET_PATH || '/vless';
const PANEL_PORT = process.env.PANEL_PORT || '9876';
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  console.log(`HTTP: ${req.method} ${req.url}`);
  
  // Проксируем на панель 3x-ui
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

// Обрабатываем WebSocket/HTTPUpgrade на /vless
server.on('upgrade', (req, clientSocket, head) => {
  console.log('=== UPGRADE REQUEST ===');
  console.log('Path:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  if (req.url !== '/vless') {
    clientSocket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    clientSocket.destroy();
    return;
  }
  
  // Подключаемся к VPN серверу
  const targetSocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
    console.log('Connected to VPN server');
    
    // Отправляем HTTPUpgrade запрос на целевой сервер
    const upgradeRequest = 
      `GET ${TARGET_PATH} HTTP/1.1\r\n` +
      `Host: ${TARGET_HOST}:${TARGET_PORT}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || 'dGVzdA=='}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `\r\n`;
    
    targetSocket.write(upgradeRequest);
    
    // Ждём ответ от сервера
    let responseReceived = false;
    let buffer = Buffer.alloc(0);
    
    targetSocket.once('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      const response = buffer.toString();
      
      if (response.includes('101')) {
        console.log('VPN server accepted upgrade');
        
        // Отправляем успешный ответ клиенту
        clientSocket.write('HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n' +
          '\r\n');
        
        // Если есть данные после заголовков, передаём их
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd !== -1 && buffer.length > headerEnd + 4) {
          const remaining = buffer.slice(headerEnd + 4);
          if (remaining.length > 0) {
            clientSocket.write(remaining);
          }
        }
        
        // Если был head от клиента, отправляем на сервер
        if (head && head.length > 0) {
          targetSocket.write(head);
        }
        
        // Пайпим в обе стороны
        let bytesUp = 0, bytesDown = 0;
        
        clientSocket.on('data', (d) => {
          bytesUp += d.length;
          targetSocket.write(d);
        });
        
        targetSocket.on('data', (d) => {
          bytesDown += d.length;
          clientSocket.write(d);
        });
        
        clientSocket.on('close', () => {
          console.log(`Client closed. Up: ${bytesUp}, Down: ${bytesDown}`);
          targetSocket.destroy();
        });
        
        targetSocket.on('close', () => {
          console.log('VPN closed');
          clientSocket.destroy();
        });
        
        responseReceived = true;
      } else {
        console.log('VPN rejected:', response.slice(0, 100));
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.destroy();
        targetSocket.destroy();
      }
    });
  });
  
  targetSocket.on('error', (err) => {
    console.error('Target error:', err.message);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
  });
  
  clientSocket.on('error', (err) => {
    console.error('Client error:', err.message);
    targetSocket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`=== VPN Relay Started ===`);
  console.log(`Port: ${PORT}`);
  console.log(`VPN: ${TARGET_HOST}:${TARGET_PORT}${TARGET_PATH}`);
  console.log(`Panel: ${TARGET_HOST}:${PANEL_PORT}`);
});
