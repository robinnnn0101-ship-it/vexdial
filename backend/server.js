const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const NAMES_FILE = process.env.NAMES_FILE || '/tmp/vex-names.json';

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const presence = new Map();
const offlineMessages = new Map();
const missedCalls = new Map();
const names = new Map();

function loadNames() {
  try {
    if (fs.existsSync(NAMES_FILE)) {
      const data = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) names.set(k, v);
    }
  } catch {}
}
function saveNames() {
  try {
    const dir = require('path').dirname(NAMES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(names);
    fs.writeFileSync(NAMES_FILE, JSON.stringify(obj));
  } catch {}
}
loadNames();

const ADMIN = process.env.ADMIN_ADDRESS || '';
const PREMIUM = new Set(['elon.vex','trump.vex','binance.vex','solana.vex','vexlore.vex','vexdial.vex']);

function getRoomId(a, b) { return [a, b].sort().join('_'); }

app.get('/', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ status: 'ok', online: presence.size }));

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

app.get('/api/livekit-token', async (req, res) => {
  const room = String(req.query.room || '').trim();
  const identity = String(req.query.identity || '').trim();
  if (!room || !identity) return res.json({ error: 'room and identity required' });
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return res.json({ error: 'LiveKit not configured on server' });
  }
  try {
    const { AccessToken } = require('livekit-server-sdk');
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();
    res.json({ token, url: LIVEKIT_URL });
  } catch (e) {
    res.json({ error: 'token failed', detail: String(e) });
  }
});


app.get('/api/online', (req, res) => {
  const list = Array.from(presence.keys());
  res.json({ count: list.length, addresses: list });
});

app.get('/api/online/:address', (req, res) => {
  const addr = decodeURIComponent(req.params.address).trim();
  const p = presence.get(addr);
  res.json({ online: !!p, status: p?.status || 'offline', lastSeen: p?.lastSeen || null });
});

app.get('/api/names', (req, res) => {
  const list = Array.from(names.entries()).map(([name, data]) => ({ name, ...data }));
  res.json({ count: list.length, names: list });
});

app.get('/api/names/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name).toLowerCase().trim();
  const data = names.get(name);
  res.json(data || { error: 'not found' });
});

app.post('/api/names', (req, res) => {
  const name = String(req.body?.name || '').toLowerCase().trim();
  const address = String(req.body?.address || '').trim();
  const admin = String(req.headers['x-admin'] || '');
  if (!name || !address) return res.json({ ok: false, error: 'name and address required' });
  if (!name.endsWith('.vex')) return res.json({ ok: false, error: 'must end with .vex' });
  if (names.has(name)) return res.json({ ok: false, error: 'name taken' });
  if (PREMIUM.has(name) && admin !== ADMIN) return res.json({ ok: false, error: 'premium name' });
  // Permanent: one name per wallet, cannot be changed by user
  for (const [n, d] of names.entries()) {
    if (d.address === address) return res.json({ ok: false, error: 'this wallet already has a name' });
  }
  names.set(name, { address, registered: Date.now() });
  saveNames();
  res.json({ ok: true, name, address });
});

app.delete('/api/names/:name', (req, res) => {
  const admin = String(req.headers['x-admin'] || '');
  if (ADMIN && admin !== ADMIN) return res.json({ ok: false, error: 'admin only' });
  const name = decodeURIComponent(req.params.name).toLowerCase().trim();
  names.delete(name);
  saveNames();
  res.json({ ok: true });
});


const nameRequests = [];
app.post('/api/names/request', (req, res) => {
  const name = String(req.body?.name || '').toLowerCase().trim();
  const address = String(req.body?.address || '').trim();
  if (!name || !address) return res.json({ ok: false, error: 'name and address required' });
  nameRequests.push({ name, address, ts: Date.now() });
  res.json({ ok: true, message: 'Request sent. Admin will review.' });
});
app.get('/api/names/requests', (req, res) => {
  const admin = String(req.headers['x-admin'] || '');
  if (ADMIN && admin !== ADMIN) return res.json({ error: 'admin only' });
  res.json(nameRequests);
});


app.post('/api/names/approve', (req, res) => {
  const admin = String(req.headers['x-admin'] || '');
  if (ADMIN && admin !== ADMIN) return res.json({ ok: false, error: 'admin only' });
  const name = String(req.body?.name || '').toLowerCase().trim();
  const address = String(req.body?.address || '').trim();
  if (!name || !address) return res.json({ ok: false, error: 'missing' });
  if (names.has(name)) return res.json({ ok: false, error: 'taken' });
  names.set(name, { address, registered: Date.now(), premium: true });
  saveNames();
  res.json({ ok: true, name });
});

app.post('/api/register', (req, res) => {
  const address = String(req.body?.address || '').trim();
  if (!address) return res.json({ ok: false });
  const existing = presence.get(address);
  presence.set(address, { socketId: existing?.socketId || 'http', status: 'online', lastSeen: Date.now() });
  res.json({ ok: true, address });
});

function deliverOffline(addr, socketId) {
  const msgs = offlineMessages.get(addr) || [];
  const calls = missedCalls.get(addr) || [];
  if (msgs.length) {
    io.to(socketId).emit('offline-messages', msgs);
    offlineMessages.delete(addr);
  }
  if (calls.length) {
    io.to(socketId).emit('missed-calls', calls);
    missedCalls.delete(addr);
  }
}

io.on('connection', (socket) => {
  socket.on('register', ({ address, status = 'online' }) => {
    if (!address) return;
    const clean = String(address).trim();
    if (!clean) return;
    presence.set(clean, { socketId: socket.id, status, lastSeen: Date.now() });
    socket.data.address = clean;
    socket.join(clean);
    socket.emit('registered', { address: clean, ok: true });
    deliverOffline(clean, socket.id);
  });

  socket.on('call-offer', ({ to, from, offer, callId }) => {
    const targetAddr = String(to || '').trim();
    const fromAddr = String(from || '').trim();
    const target = presence.get(targetAddr);
    if (!target || target.socketId === 'http') {
      const list = missedCalls.get(targetAddr) || [];
      list.push({ from: fromAddr, ts: Date.now() });
      missedCalls.set(targetAddr, list);
      socket.emit('call-error', { error: 'User offline. Missed call saved.' });
      return;
    }
    const roomId = callId || getRoomId(fromAddr, targetAddr);
    io.to(target.socketId).emit('incoming-call', { from: fromAddr, offer, callId: roomId });
  });

  socket.on('call-answer', ({ to, from, answer, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target && target.socketId !== 'http') io.to(target.socketId).emit('call-answered', { from, answer, callId });
    else io.emit('call-answered', { from, answer, callId, to });
  });

  socket.on('ice-candidate', ({ to, candidate, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target && target.socketId !== 'http') io.to(target.socketId).emit('ice-candidate', { candidate, callId });
  });

  socket.on('call-reject', ({ to, from, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target && target.socketId !== 'http') io.to(target.socketId).emit('call-rejected', { from, callId });
  });

  socket.on('call-hangup', ({ to, from, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target && target.socketId !== 'http') io.to(target.socketId).emit('call-ended', { from, callId });
  });

  socket.on('chat-message', (data) => {
    const to = String(data?.to || '').trim();
    const from = String(data?.from || '').trim();
    if (!to || !from) return;
    const msg = { ...data, to, from, ts: data.ts || Date.now(), id: data.id || Date.now().toString(36), status: 'sent' };
    const target = presence.get(to);
    if (target && target.socketId && target.socketId !== 'http') {
      io.to(target.socketId).emit('chat-message', { ...msg, status: 'delivered' });
      socket.emit('msg-status', { id: msg.id, status: 'delivered' });
    } else {
      const list = offlineMessages.get(to) || [];
      list.push(msg);
      offlineMessages.set(to, list);
      socket.emit('msg-status', { id: msg.id, status: 'sent' });
    }
  });

  socket.on('msg-read', ({ to, id }) => {
    const target = presence.get(String(to || '').trim());
    if (target && target.socketId !== 'http') {
      io.to(target.socketId).emit('msg-status', { id, status: 'read' });
    }
  });

  socket.on('join-room', (callId) => { if (callId) socket.join(callId); });

  socket.on('disconnect', () => {
    const addr = socket.data.address;
    if (!addr) return;
    const p = presence.get(addr);
    if (p && p.socketId === socket.id) presence.delete(addr);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [addr, p] of presence) {
    if (now - p.lastSeen > 60000) presence.delete(addr);
  }
  console.log(`keepalive online=${presence.size}`);
}, 30000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server listening on 0.0.0.0:${PORT}`);
});
