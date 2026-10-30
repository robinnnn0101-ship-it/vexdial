const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const presence = new Map();

function getRoomId(a, b) { return [a, b].sort().join('_'); }

app.get('/', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ status: 'ok', online: presence.size }));

app.get('/api/online', (req, res) => {
  const list = Array.from(presence.keys());
  res.json({ count: list.length, addresses: list });
});

app.get('/api/online/:address', (req, res) => {
  const addr = decodeURIComponent(req.params.address).trim();
  const p = presence.get(addr);
  res.json({ online: !!p, status: p?.status || 'offline' });
});

io.on('connection', (socket) => {
  socket.on('register', ({ address, status = 'online' }) => {
    if (!address) return;
    const clean = String(address).trim();
    if (!clean) return;
    presence.set(clean, { socketId: socket.id, status, lastSeen: Date.now() });
    socket.data.address = clean;
    socket.join(clean);
  });

  socket.on('call-offer', ({ to, from, offer, callId }) => {
    const targetAddr = String(to || '').trim();
    const fromAddr = String(from || '').trim();
    const target = presence.get(targetAddr);
    if (!target) {
      socket.emit('call-error', { error: 'User offline. Ask them to refresh and stay on the page.' });
      return;
    }
    const roomId = callId || getRoomId(fromAddr, targetAddr);
    io.to(target.socketId).emit('incoming-call', { from: fromAddr, offer, callId: roomId });
  });

  socket.on('call-answer', ({ to, from, answer, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target) io.to(target.socketId).emit('call-answered', { from, answer, callId });
    else io.emit('call-answered', { from, answer, callId, to });
  });

  socket.on('ice-candidate', ({ to, candidate, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target) io.to(target.socketId).emit('ice-candidate', { candidate, callId });
  });

  socket.on('call-reject', ({ to, from, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target) io.to(target.socketId).emit('call-rejected', { from, callId });
  });

  socket.on('call-hangup', ({ to, from, callId }) => {
    const target = presence.get(String(to || '').trim());
    if (target) io.to(target.socketId).emit('call-ended', { from, callId });
  });

  socket.on('chat-message', ({ callId, from, text }) => {
    if (!callId || !text) return;
    io.to(callId).emit('chat-message', { from, text, ts: Date.now() });
  });

  socket.on('join-room', (callId) => { if (callId) socket.join(callId); });

  socket.on('disconnect', () => {
    const addr = socket.data.address;
    if (!addr) return;
    const p = presence.get(addr);
    if (p && p.socketId === socket.id) presence.delete(addr);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server listening on 0.0.0.0:${PORT}`);
});
