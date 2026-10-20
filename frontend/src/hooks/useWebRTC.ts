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
  const [chat, setChat] = useState<{from:string,text:string}[]>([]);

  const socketRef = useRef<Socket|null>(null);
  const pcRef = useRef<RTCPeerConnection|null>(null);
  const pendingOffer = useRef<any>(null);
  const callIdRef = useRef('');
  const ringInterval = useRef<any>(null);

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
    setChat([]);
    pendingOffer.current = null;
  };

  useEffect(() => {
    if (!myAddress) return;
    const socket = io(SIGNALING);
    socketRef.current = socket;
    socket.emit('register', { address: myAddress, status: 'online' });

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
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setStatus('connected');
        setCallStart(Date.now());
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (candidate && pcRef.current?.remoteDescription) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    socket.on('call-rejected', () => { stopRing(); cleanup(); });
    socket.on('call-ended', () => { stopRing(); cleanup(); });
    socket.on('chat-message', (msg) => setChat(p => [...p, msg]));

    return () => socket.disconnect();
  }, [myAddress]);

  const getStream = async (video: boolean) => navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { width: 640, height: 480 } : false });

  const makePC = async (stream: MediaStream, remote: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) socketRef.current.emit('ice-candidate', { to: remote, candidate: e.candidate, callId: callIdRef.current });
    };
    return pc;
  };

  const startCall = async (target: string, _t?: string, withVideo = true) => {
    if (!socketRef.current || !myAddress) return alert('Not ready');
    setRemoteAddress(target);
    setStatus('calling');
    stopRing();
    ringInterval.current = setInterval(() => playTone(440, 0.15), 2000);
    try {
      const stream = await getStream(withVideo);
      setLocalStream(stream);
      const pc = await makePC(stream, target);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const cid = [myAddress, target].sort().join('_');
      callIdRef.current = cid;
      socketRef.current.emit('call-offer', { to: target, from: myAddress, offer, callId: cid });
    } catch { stopRing(); cleanup(); }
  };

  const acceptCall = async () => {
    stopRing();
    if (!pendingOffer.current || !remoteAddress) return;
    try {
      const stream = await getStream(true);
      setLocalStream(stream);
      const pc = await makePC(stream, remoteAddress);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.current));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('call-answer', { to: remoteAddress, from: myAddress, answer, callId: callIdRef.current });
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
  const sendChat = (text: string) => {
    if (!text.trim()) return;
    socketRef.current?.emit('chat-message', { callId: callIdRef.current, from: myAddress, text: text.trim() });
    setChat(p => [...p, { from: myAddress || '', text: text.trim() }]);
  };

  return { status, remoteAddress, localStream, remoteStream, muted, cameraOff, chat, callStart,
           startCall, acceptCall, rejectCall, hangup, toggleMute, toggleCamera, startScreenShare, sendChat };
}
