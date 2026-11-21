'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { GuildGame } = require('./lib/game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHAT_LIMIT = 100;
const MESSAGE_LIMIT = 300;
const CHAT_INTERVAL = 400;
const rooms = new Map();
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/client.js', ['client.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/media/late-workshop.webp', ['media/late-workshop.webp', 'image/webp']],
  ['/media/workshop-at-night.mp3', ['media/workshop-at-night.mp3', 'audio/mpeg']]
]);

async function serveFile(req, res, [name, type]) {
  const content = await fs.readFile(path.join(PUBLIC_DIR, name));
  const headers = {
    'Content-Type': type,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache'
  };
  if (type === 'audio/mpeg') {
    headers['Accept-Ranges'] = 'bytes';
    if (req.method === 'GET' && req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const first = match?.[1];
      const last = match?.[2];
      const start = first ? Number(first) : Math.max(0, content.length - Number(last));
      const end = first && last ? Math.min(Number(last), content.length - 1) : content.length - 1;
      if ((!first && !last) || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${content.length}` });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${content.length}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      return res.end(content.subarray(start, end + 1));
    }
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : content);
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8192) {
      const error = new Error('请求内容过长。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Invalid requests are reported below.
  }
  const error = new Error('请求格式无效。');
  error.status = 400;
  throw error;
}

function event(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastState(room) {
  for (const [res, id] of room.streams) event(res, 'state', room.game.view(id));
}

function subscribe(room, id, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  room.streams.set(res, id);
  event(res, 'state', room.game.view(id));
  event(res, 'history', room.messages);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    room.streams.delete(res);
  });
}

function sendMessage(room, member, body, res) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MESSAGE_LIMIT) {
    return json(res, 400, { error: '请输入 1 至 300 字的消息。' });
  }
  const now = Date.now();
  if (now - member.lastMessage < CHAT_INTERVAL) {
    return json(res, 429, { error: '发送太快，请稍后再试。' });
  }

  member.lastMessage = now;
  const message = { id: ++room.messageId, playerId: member.id, name: member.name, text, time: now };
  room.messages.push(message);
  if (room.messages.length > CHAT_LIMIT) room.messages.shift();
  for (const stream of room.streams.keys()) event(stream, 'chat', message);
  json(res, 201, { message });
}

async function enter(room, roomId, req, res) {
  const body = await readBody(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 20) return json(res, 400, { error: '昵称须为 1 至 20 字。' });

  const id = randomUUID();
  const key = randomBytes(24).toString('hex');
  const creating = !room;
  if (creating) {
    do {
      roomId = randomBytes(4).toString('hex').toUpperCase();
    } while (rooms.has(roomId));
    const capacity = [2, 3, 4].includes(body.capacity) ? body.capacity : 4;
    room = {
      game: new GuildGame(roomId, id, name, capacity),
      members: new Map(),
      streams: new Map(),
      messages: [],
      messageId: 0
    };
    rooms.set(roomId, room);
  } else {
    if (rooms.get(roomId) !== room) return json(res, 404, { error: '房间不存在或已关闭。' });
    const result = room.game.addPlayer(id, name);
    if (result.error) return json(res, 409, result);
  }
  room.members.set(key, { id, name, lastMessage: 0 });
  broadcastState(room);
  json(res, creating ? 201 : 200, { roomId, key, state: room.game.view(id) });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  const file = files.get(url.pathname);
  if (file && (method === 'GET' || method === 'HEAD')) return serveFile(req, res, file);
  if (method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (method === 'POST' && url.pathname === '/api/rooms') return enter(null, null, req, res);

  const route = /^\/api\/rooms\/([A-F0-9]{8})(?:\/([a-z]+))?$/i.exec(url.pathname);
  if (!route) return json(res, 404, { error: '地址不存在。' });
  const [, code, command] = route;
  const roomId = code.toUpperCase();
  const room = rooms.get(roomId);
  if (!room) return json(res, 404, { error: '房间不存在或已关闭。' });
  if (method === 'POST' && command === 'join') return enter(room, roomId, req, res);

  const streaming = method === 'GET' && command === 'events';
  const key = streaming ? url.searchParams.get('key') : req.headers.authorization?.replace(/^Bearer /, '');
  const member = room.members.get(key);
  if (!member) return json(res, 403, { error: '房间会话已失效。' });
  if (streaming) return subscribe(room, member.id, res);
  if (method === 'GET' && !command) return json(res, 200, { state: room.game.view(member.id) });
  if (method === 'GET' && command === 'history') {
    const after = Number(url.searchParams.get('after') ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return json(res, 400, { error: '回合记录位置无效。' });
    return json(res, 200, { entries: room.game.history.slice(after) });
  }
  if (method !== 'POST') return json(res, 404, { error: '地址不存在。' });

  const body = await readBody(req);
  if (!room.members.has(key)) return json(res, 403, { error: '房间会话已失效。' });
  if (command === 'chat') return sendMessage(room, member, body, res);

  let result;
  switch (command) {
    case 'start': result = room.game.start(member.id); break;
    case 'action': result = room.game.play(member.id, body.revision, body.action); break;
    case 'leave': result = room.game.leave(member.id); break;
    default: return json(res, 404, { error: '地址不存在。' });
  }
  if (result.error) return json(res, 409, result);
  if (command === 'leave') {
    room.members.delete(key);
    for (const [stream, id] of room.streams) {
      if (id === member.id) {
        room.streams.delete(stream);
        stream.end();
      }
    }
    if (!room.members.size) rooms.delete(roomId);
    broadcastState(room);
    return json(res, 200, { ok: true });
  }
  broadcastState(room);
  json(res, 200, { state: room.game.view(member.id) });
}

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务器暂时无法处理请求。' });
    else res.end();
    if (!error.status) console.error(error);
  });
}).listen(PORT, () => console.log(`棱境商会已启动 http://localhost:${PORT}`));
