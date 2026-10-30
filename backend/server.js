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
const rooms = new Map();

function getRoomId(a, b) { return [a, b].sort().join('_'); }

app.get('/health', (req, res) => res.json({ status: 'ok', online: presence.size }));

app.get('/api/online/:address', (req, res) => {
  const addr = decodeURIComponent(req.params.address);
  const p = presence.get(addr);
  res.json({ online: !!p, status: p?.status || 'offline' });
});

io.on('connection', (socket) => {
  socket.on('register', ({ address, status = 'online' }) => {
    if (!address) return;
    presence.set(address, { socketId: socket.id, status, lastSeen: Date.now() });
    socket.data.address = address;
    socket.join(address);
    io.emit('presence-update', Object.fromEntries(presence));
  });

  socket.on('call-offer', ({ to, from, offer, callId }) => {
    const target = presence.get(to);
    if (!target) {
      socket.emit('call-error', { error: 'User offline. Ask them to refresh and stay on the page.' });
      return;
    }
    const roomId = callId || getRoomId(from, to);
    if (!rooms.has(roomId)) rooms.set(roomId, { participants: new Set([from]), started: Date.now() });
    rooms.get(roomId).participants.add(from);
    io.to(target.socketId).emit('incoming-call', { from, offer, callId: roomId });
  });

  socket.on('call-answer', ({ to, from, answer, callId }) => {
    const target = presence.get(to);
    if (target) io.to(target.socketId).emit('call-answered', { from, answer, callId });
    else io.emit('call-answered', { from, answer, callId, to });
  });

  socket.on('ice-candidate', ({ to, candidate, callId }) => {
    const target = presence.get(to);
    if (target) io.to(target.socketId).emit('ice-candidate', { candidate, callId });
  });

  socket.on('call-reject', ({ to, from, callId }) => {
    const target = presence.get(to);
    if (target) io.to(target.socketId).emit('call-rejected', { from, callId });
    if (callId && rooms.has(callId)) rooms.delete(callId);
  });

  socket.on('call-hangup', ({ to, from, callId }) => {
    const target = presence.get(to);
    if (target) io.to(target.socketId).emit('call-ended', { from, callId });
    if (callId && rooms.has(callId)) rooms.delete(callId);
  });

  socket.on('chat-message', ({ callId, from, text }) => {
    if (!callId || !text) return;
    io.to(callId).emit('chat-message', { from, text, ts: Date.now() });
  });

  socket.on('join-room', (callId) => { if (callId) socket.join(callId); });

  socket.on('disconnect', () => {
    const addr = socket.data.address;
    if (addr) {
      presence.delete(addr);
      io.emit('presence-update', Object.fromEntries(presence));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`Signaling on ${PORT}`));
