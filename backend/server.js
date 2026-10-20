const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const presence = new Map();
const rooms = new Map();

const vexNames = new Map();
const addressToVex = new Map();

function getRoomId(a, b) {
  return [a, b].sort().join('_');
}

app.post('/api/vex/register', (req, res) => {
  const { name, address } = req.body;
  if (!name || !address || !name.endsWith('.vex')) {
    return res.status(400).json({ error: 'Need name.vex and address' });
  }
  const clean = name.toLowerCase().replace('.vex', '');
  if (vexNames.has(clean)) return res.status(409).json({ error: 'Name taken' });
  vexNames.set(clean, { address, verified: false, owner: address });
  addressToVex.set(address, clean);
  res.json({ ok: true, name: clean + '.vex' });
});

app.get('/api/vex/resolve/:name', (req, res) => {
  let name = req.params.name.toLowerCase();
  if (name.endsWith('.vex')) name = name.slice(0, -4);
  const entry = vexNames.get(name);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json({ address: entry.address, verified: entry.verified, name: name + '.vex' });
});

app.get('/api/vex/reverse/:address', (req, res) => {
  const name = addressToVex.get(req.params.address);
  if (!name) return res.json({ name: null });
  const entry = vexNames.get(name);
  res.json({ name: name + '.vex', verified: entry?.verified || false });
});

app.get('/health', (req, res) => res.json({ status: 'ok', online: presence.size, names: vexNames.size }));

io.on('connection', (socket) => {
  socket.on('register', ({ address, status = 'online' }) => {
    if (!address) return;
    presence.set(address, { socketId: socket.id, status, lastSeen: Date.now() });
    socket.data.address = address;
    socket.join(address);
  });

  socket.on('call-offer', ({ to, from, offer, callId }) => {
    const target = presence.get(to);
    if (!target) {
      socket.emit('call-error', { error: 'User offline' });
      return;
    }
    const roomId = callId || getRoomId(from, to);
    if (!rooms.has(roomId)) rooms.set(roomId, { participants: new Set([from]), started: Date.now() });
    rooms.get(roomId).participants.add(from);
    io.to(target.socketId).emit('incoming-call', { from, offer, callId: roomId });
  });

  socket.on('call-answer', ({ to, from, answer, callId }) => {
    const target = presence.get(to);
    if (target) {
      const roomId = callId || getRoomId(from, to);
      if (rooms.has(roomId)) rooms.get(roomId).participants.add(from);
      io.to(target.socketId).emit('call-answered', { from, answer, callId: roomId });
    }
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

  socket.on('join-room', (callId) => {
    if (callId) socket.join(callId);
  });

  socket.on('disconnect', () => {
    const addr = socket.data.address;
    if (addr) presence.delete(addr);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT}`);
});
