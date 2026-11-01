'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

function playTone(freq = 440, dur = 0.3) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch {}
}

export function useWebRTC(myAddress: string | null) {
  const [status, setStatus] = useState<'idle'|'calling'|'ringing'|'connected'>('idle');
  const [remoteAddress, setRemoteAddress] = useState<string|null>(null);
  const [localStream, setLocalStream] = useState<MediaStream|null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream|null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStart, setCallStart] = useState<number|null>(null);
  const [chat, setChat] = useState<{from:string,text:string,ts?:number,id?:string,status?:string,missed?:boolean,to?:string}[]>([]);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket|null>(null);
  const pcRef = useRef<RTCPeerConnection|null>(null);
  const pendingOffer = useRef<any>(null);
  const pendingCands = useRef<any[]>([]);
  const callIdRef = useRef('');
  const ringInterval = useRef<any>(null);
  const remoteAddrRef = useRef<string|null>(null);

  const stopRing = () => { if (ringInterval.current) clearInterval(ringInterval.current); ringInterval.current = null; };

  const cleanup = () => {
    stopRing();
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteAddress(null);
    setCallStart(null);
    pendingOffer.current = null;
    pendingCands.current = [];
  };

  useEffect(() => { remoteAddrRef.current = remoteAddress; }, [remoteAddress]);

  useEffect(() => {
    if (!myAddress) return;
    const socket = io(SIGNALING, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: false,
    });
    socketRef.current = socket;

    const register = async () => {
      if (!myAddress) return;
      const addr = myAddress.trim();
      if (socket.connected) {
        socket.emit('register', { address: addr, status: 'online' });
      }
      try {
        await fetch(`${SIGNALING}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr }),
          mode: 'cors',
        });
        setConnected(true);
      } catch (e) {
        console.log('register failed', e);
      }
    };
    socket.on('connect', () => { setConnected(true); register(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('reconnect', register);
    socket.on('registered', () => setConnected(true));
    const regInterval = setInterval(register, 5000);
    const pingInterval = setInterval(() => {
      fetch(`${SIGNALING}/health`).catch(() => {});
    }, 15000);
    window.addEventListener('focus', register);
    document.addEventListener('visibilitychange', register);
    setTimeout(register, 300);
    setTimeout(register, 1000);
    setTimeout(register, 2500);

    socket.on('incoming-call', ({ from, offer, callId }) => {
      setRemoteAddress(from);
      callIdRef.current = callId;
      pendingOffer.current = offer;
      setStatus('ringing');
      stopRing();
      ringInterval.current = setInterval(() => playTone(880, 0.2), 1500);
    });

    socket.on('call-answered', async ({ answer }) => {
      stopRing();
      if (pcRef.current && answer) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          setStatus('connected');
          setCallStart(Date.now());
          for (const c of pendingCands.current) {
            try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
          pendingCands.current = [];
        } catch (e) { console.error(e); }
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (!candidate) return;
      if (pcRef.current?.remoteDescription) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      } else {
        pendingCands.current.push(candidate);
      }
    });

    socket.on('call-error', ({ error }) => {
      alert(error || 'Call failed');
      stopRing();
      cleanup();
    });
    socket.on('call-ended', () => { stopRing(); cleanup(); });
    socket.on('chat-message', (msg) => {
      setChat(p => [...p, msg]);
      if (msg.from !== myAddress) {
        socket.emit('msg-read', { to: msg.from, id: msg.id });
      }
    });
    socket.on('offline-messages', (msgs) => {
      setChat(p => [...p, ...msgs.map(m => ({ ...m, status: 'delivered' }))]);
    });
    socket.on('missed-calls', (calls) => {
      setChat(p => [...p, ...calls.map(c => ({ from: c.from, text: 'Missed call', ts: c.ts, missed: true }))]);
      const hist = JSON.parse(localStorage.getItem('vexdial-history') || '[]');
      const next = [...calls.map(c => ({ address: c.from, type: 'missed', ts: c.ts, duration: 0 })), ...hist].slice(0, 40);
      localStorage.setItem('vexdial-history', JSON.stringify(next));
    });
    socket.on('msg-status', ({ id, status }) => {
      setChat(p => p.map(m => m.id === id ? { ...m, status } : m));
    });

    return () => {
      clearInterval(regInterval);
      clearInterval(pingInterval);
      window.removeEventListener('focus', register);
      socket.disconnect();
    };
  }, [myAddress]);

  const getStream = async (video: boolean) => {
    const constraints: MediaStreamConstraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    };
    if (video) constraints.video = { width: 640, height: 480 };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getAudioTracks().forEach(t => { t.enabled = true; });
    return stream;
  };

  const makePC = async (stream: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ]
    });
    pcRef.current = pc;
    stream.getTracks().forEach(t => {
      t.enabled = true;
      pc.addTrack(t, stream);
    });
    pc.ontrack = (e) => {
      const track = e.track;
      if (!track) return;
      track.enabled = true;
      let stream = e.streams?.[0];
      if (!stream) stream = new MediaStream([track]);
      stream.getTracks().forEach(t => { t.enabled = true; });
      setRemoteStream(stream);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current && remoteAddrRef.current) {
        socketRef.current.emit('ice-candidate', { to: remoteAddrRef.current, candidate: e.candidate, callId: callIdRef.current });
      }
    };
    return pc;
  };

  const startCall = async (target: string, _t?: string, withVideo = false) => {
    if (!socketRef.current) return alert('Socket not ready');
    if (!socketRef.current.connected) {
      socketRef.current.connect();
      await new Promise(r => setTimeout(r, 1500));
      if (!socketRef.current.connected) return alert('Cannot reach server. Try Reconnect.');
    }
    if (!myAddress) return alert('No identity');
    setRemoteAddress(target.trim());
    remoteAddrRef.current = target.trim();
    setStatus('calling');
    stopRing();
    ringInterval.current = setInterval(() => playTone(440, 0.15), 2000);
    try {
      const stream = await getStream(withVideo);
      setLocalStream(stream);
      const pc = await makePC(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const cid = [myAddress.trim(), target.trim()].sort().join('_');
      callIdRef.current = cid;
      socketRef.current.emit('register', { address: myAddress.trim(), status: 'online' });
      setTimeout(() => socketRef.current?.emit('register', { address: myAddress.trim(), status: 'online' }), 200);
      socketRef.current.emit('call-offer', { to: target.trim(), from: myAddress.trim(), offer, callId: cid });
      socketRef.current.emit('join-room', cid);
    } catch { stopRing(); cleanup(); }
  };

  const acceptCall = async () => {
    stopRing();
    if (!pendingOffer.current || !remoteAddress) return;
    try {
      const isVideo = String(pendingOffer.current.sdp || '').includes('m=video');
      const stream = await getStream(isVideo);
      setLocalStream(stream);
      const pc = await makePC(stream);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.current));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('call-answer', { to: remoteAddress, from: myAddress, answer, callId: callIdRef.current });
      socketRef.current?.emit('join-room', callIdRef.current);
      for (const c of pendingCands.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      pendingCands.current = [];
      setStatus('connected');
      setCallStart(Date.now());
      pendingOffer.current = null;
    } catch { cleanup(); }
  };

  const rejectCall = () => { socketRef.current?.emit('call-reject', { to: remoteAddress, from: myAddress, callId: callIdRef.current }); cleanup(); };
  const hangup = () => { socketRef.current?.emit('call-hangup', { to: remoteAddress, from: myAddress, callId: callIdRef.current }); cleanup(); };
  const toggleMute = () => { localStream?.getAudioTracks().forEach(t => t.enabled = muted); setMuted(!muted); };
  const toggleCamera = () => { localStream?.getVideoTracks().forEach(t => t.enabled = cameraOff); setCameraOff(!cameraOff); };
  const startScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screen.getVideoTracks()[0]);
    } catch {}
  };
  const sendChat = (text: string, to?: string) => {
    if (!text.trim()) return;
    const dest = to || remoteAddress;
    if (!dest) return alert('Enter address first');
    const msg = { from: myAddress, to: dest, text: text.trim(), ts: Date.now(), id: Date.now().toString(36), status: 'sent' };
    socketRef.current?.emit('chat-message', msg);
    setChat(p => [...p, msg]);
  };

  return { status, remoteAddress, localStream, remoteStream, muted, cameraOff, chat, callStart, connected,
           startCall, acceptCall, rejectCall, hangup, toggleMute, toggleCamera, startScreenShare, sendChat };
}
