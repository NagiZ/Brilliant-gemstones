'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SplendorGame } = require('./lib/game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('无效的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeName(name) {
  return String(name || '').trim().slice(0, 20);
}

function normalizeMaxPlayers(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2 && number <= 4 ? number : 4;
}

function broadcastState(room) {
  for (const player of room.players) {
    const clients = room.sseClients.get(player.id);
    if (!clients || clients.size === 0) continue;
    const state = room.viewForPlayer(player.id);
    const data = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const res of clients) {
      res.write(data);
    }
  }
}

function subscribeToRoom(room, playerId, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  res.write(`event: state\ndata: ${JSON.stringify(room.viewForPlayer(playerId))}\n\n`);

  if (!room.sseClients.has(playerId)) {
    room.sseClients.set(playerId, new Set());
  }
  room.sseClients.get(playerId).add(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = room.sseClients.get(playerId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) room.sseClients.delete(playerId);
    }
  });
}

function getRoomPlayer(req, res, roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { error: '房间不存在或已关闭。' });
    return null;
  }

  const player = room.playerById(playerId);
  if (!player) {
    sendJson(res, 403, { error: '你不是该房间的玩家。' });
    return null;
  }

  return { room, player };
}

function serveStatic(req, res, urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const decoded = decodeURIComponent(requested);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: '禁止访问。' });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: '页面不存在。' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon'
    };

    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  const method = req.method;
  const segments = route.split('/').filter(Boolean);

  try {
    if (method === 'GET' && route === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'POST' && route === '/api/rooms') {
      const body = await readJsonBody(req);
      const name = normalizeName(body.name);
      const maxPlayers = normalizeMaxPlayers(body.maxPlayers);
      if (!name) {
        sendJson(res, 400, { error: '请输入昵称。' });
        return;
      }

      const roomId = crypto.randomBytes(4).toString('hex').toUpperCase();
      const playerId = crypto.randomUUID();
      const room = new SplendorGame(roomId, playerId, name, maxPlayers);
      room.sseClients = new Map();
      rooms.set(roomId, room);
      sendJson(res, 201, {
        roomId,
        playerId,
        state: room.viewForPlayer(playerId)
      });
      return;
    }

    if (
      method === 'POST'
      && segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'rooms'
      && segments[3] === 'join'
    ) {
      const roomId = segments[2];
      const body = await readJsonBody(req);
      const name = normalizeName(body.name);
      const room = rooms.get(roomId);
      if (!room) {
        sendJson(res, 404, { error: '房间不存在或已关闭。' });
        return;
      }
      if (!name) {
        sendJson(res, 400, { error: '请输入昵称。' });
        return;
      }

      const playerId = crypto.randomUUID();
      const result = room.addPlayer(playerId, name);
      if (!result.ok) {
        sendJson(res, 409, { error: result.error });
        return;
      }

      broadcastState(room);
      sendJson(res, 200, {
        roomId,
        playerId,
        state: room.viewForPlayer(playerId)
      });
      return;
    }

    if (
      method === 'GET'
      && segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'rooms'
      && segments[3] === 'events'
    ) {
      const roomId = segments[2];
      const playerId = url.searchParams.get('playerId') || '';
      const room = rooms.get(roomId);
      if (!room) {
        sendJson(res, 404, { error: '房间不存在或已关闭。' });
        return;
      }
      const player = room.playerById(playerId);
      if (!player) {
        sendJson(res, 403, { error: '你不是该房间的玩家。' });
        return;
      }
      subscribeToRoom(room, playerId, req, res);
      return;
    }

    if (
      method === 'GET'
      && segments.length === 3
      && segments[0] === 'api'
      && segments[1] === 'rooms'
    ) {
      const roomId = segments[2];
      const playerId = url.searchParams.get('playerId') || '';
      const found = getRoomPlayer(req, res, roomId, playerId);
      if (!found) return;
      sendJson(res, 200, { state: found.room.viewForPlayer(playerId) });
      return;
    }

    if (
      method === 'POST'
      && segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'rooms'
      && segments[3] === 'start'
    ) {
      const roomId = segments[2];
      const body = await readJsonBody(req);
      const playerId = String(body.playerId || '');
      const found = getRoomPlayer(req, res, roomId, playerId);
      if (!found) return;

      if (playerId !== found.room.hostId) {
        sendJson(res, 403, { error: '只有房主可以开始游戏。' });
        return;
      }

      const result = found.room.start();
      if (!result.ok) {
        sendJson(res, 409, { error: result.error });
        return;
      }
      broadcastState(found.room);
      sendJson(res, 200, { state: found.room.viewForPlayer(playerId) });
      return;
    }

    if (
      method === 'POST'
      && segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'rooms'
      && segments[3] === 'action'
    ) {
      const roomId = segments[2];
      const body = await readJsonBody(req);
      const playerId = String(body.playerId || '');
      const found = getRoomPlayer(req, res, roomId, playerId);
      if (!found) return;

      const { room, player } = found;
      if (room.status !== 'playing') {
        sendJson(res, 409, { error: '游戏尚未开始或已经结束。' });
        return;
      }
      if (room.currentPlayerId !== playerId) {
        sendJson(res, 409, { error: '还没轮到你操作。' });
        return;
      }

      const action = body.action || {};
      let result;

      switch (action.type) {
        case 'takeGems':
          result = room.takeGems(player, action.colors);
          if (result.ok) {
            const overflow = Object.values(player.tokens).reduce((a, b) => a + b, 0) - 10;
            if (overflow > 0) {
              room.pendingDiscard = { playerId: player.id, count: overflow };
            } else {
              room.endTurn(player);
            }
          }
          break;

        case 'returnTokens':
          result = room.returnTokens(player, action.colors);
          if (result.ok) {
            room.endTurnAfterDiscard(player);
          }
          break;

        case 'reserveCard':
          result = room.reserveCard(player, action.payload);
          if (result.ok) {
            const overflow = Object.values(player.tokens).reduce((a, b) => a + b, 0) - 10;
            if (overflow > 0) {
              room.pendingDiscard = { playerId: player.id, count: overflow };
            } else {
              room.endTurn(player);
            }
          }
          break;

        case 'buyCard':
          result = room.buyCard(player, action.payload);
          if (result.ok) {
            room.endTurn(player);
          }
          break;

        case 'chooseNoble':
          result = room.chooseNoble(player, action.nobleId);
          break;

        default:
          result = { ok: false, error: '未知操作。' };
      }

      if (!result.ok) {
        sendJson(res, 409, { error: result.error });
        return;
      }

      broadcastState(room);
      sendJson(res, 200, { state: room.viewForPlayer(playerId) });
      return;
    }

    if (method === 'GET') {
      serveStatic(req, res, route);
      return;
    }

    sendJson(res, 404, { error: '接口不存在。' });
  } catch (error) {
    const message = error && error.message ? error.message : '服务器内部错误';
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`璀璨宝石服务器已启动：http://localhost:${PORT}`);
});
