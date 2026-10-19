'use client';
// @ts-nocheck
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export function useWebRTC(myAddress: string | null) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [chat, setChat] = useState<{from: string; text: string; ts: number}[]>([]);
  const [reactions, setReactions] = useState<{from: string; emoji: string; ts: number}[]>([]);
  const [presence, setPresence] = useState<Record<string, any>>({});
  const [callStart, setCallStart] = useState<number | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<any>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const remoteAddressRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const ringtoneAudio = useRef<any>(null);
  const ringbackRef = useRef<any>(null);

  useEffect(() => { remoteAddressRef.current = remoteAddress; }, [remoteAddress]);
  useEffect(() => { callIdRef.current = callId; }, [callId]);

  const stopRingtone = useCallback(() => {
    if (ringtoneAudio.current) {
      try { ringtoneAudio.current.pause?.(); } catch {}
      ringtoneAudio.current = null;
    }
  }, []);

  const stopRingback = useCallback(() => {
    if (ringbackRef.current) {
      try { ringbackRef.current.pause?.(); } catch {}
      ringbackRef.current = null;
    }
  }, []);

  const playRingtone = useCallback(() => {
    stopRingtone();
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.1;
    gain.connect(ctx.destination);
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.3);
      osc.stop(ctx.currentTime + i * 0.3 + 0.25);
    });
    ringtoneAudio.current = { pause: () => { try { ctx.close(); } catch {} } };
  }, [stopRingtone]);

  const playRingback = useCallback(() => {
    stopRingback();
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.connect(gain);
    osc.start();
    ringbackRef.current = { pause: () => { try { osc.stop(); ctx.close(); } catch {} } };
  }, [stopRingback]);

  const cleanup = useCallback(() => {
    stopRingtone();
    stopRingback();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteAddress(null);
    setCallId(null);
    setCallStart(null);
    setChat([]);
    setReactions([]);
    pendingOfferRef.current = null;
    pendingCandidates.current = [];
  }, [localStream, stopRingtone, stopRingback]);

  useEffect(() => {
    if (!myAddress) return;
    const socket = io(SIGNALING, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('register', { address: myAddress, status: 'online' });
    });

    socket.on('presence-update', (p) => setPresence(p));

    socket.on('incoming-call', ({ from, offer, callId }) => {
      setRemoteAddress(from);
      setCallId(callId);
      setStatus('ringing');
      pendingOfferRef.current = offer;
      playRingtone();
    });

    socket.on('call-answered', async ({ answer }) => {
      stopRingback();
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(answer);
          setStatus('connected');
          setCallStart(Date.now());
          for (const c of pendingCandidates.current) await pcRef.current.addIceCandidate(c);
          pendingCandidates.current = [];
        } catch (e) { console.error(e); }
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (!candidate) return;
      if (pcRef.current?.remoteDescription) {
        try { await pcRef.current.addIceCandidate(candidate); } catch { pendingCandidates.current.push(candidate); }
      } else pendingCandidates.current.push(candidate);
    });

    socket.on('call-rejected', () => { stopRingtone(); cleanup(); });
    socket.on('call-ended', () => { stopRingtone(); cleanup(); });
    socket.on('chat-message', (msg) => setChat(c => [...c, msg]));
    socket.on('reaction', (r) => {
      setReactions(rs => [...rs, r]);
      setTimeout(() => setReactions(rs => rs.filter(x => x.ts !== r.ts)), 3000);
    });
    socket.on('call-error', ({ error }) => { alert(error); cleanup(); });

    return () => socket.disconnect();
  }, [myAddress, cleanup, playRingtone, stopRingback]);

  const createPC = useCallback(async (withVideo = true) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current && remoteAddressRef.current) {
        socketRef.current.emit('ice-candidate', { to: remoteAddressRef.current, candidate: e.candidate, callId: callIdRef.current });
      }
    };
    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        setRemoteStream(e.streams[0]);
      } else if (e.track) {
        const stream = new MediaStream([e.track]);
        setRemoteStream(stream);
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { facingMode: 'user' } : false
    });
    setLocalStream(stream);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    return pc;
  }, []);

  const startCall = useCallback(async (target: string, _tune?: string, withVideo = true) => {
    if (!socketRef.current || !myAddress) return;
    setRemoteAddress(target);
    remoteAddressRef.current = target;
    setStatus('calling');
    try {
      const pc = await createPC(withVideo);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const cid = [myAddress, target].sort().join('_');
      setCallId(cid);
      callIdRef.current = cid;
      socketRef.current.emit('call-offer', { to: target, from: myAddress, offer, callId: cid });
      socketRef.current.emit('join-room', cid);
      playRingback();
    } catch (e) {
      cleanup();
    }
  }, [myAddress, createPC, cleanup, playRingback]);

  const acceptCall = useCallback(async () => {
    stopRingtone();
    if (!socketRef.current || !remoteAddress || !pendingOfferRef.current) return;
    setStatus('connected');
    setCallStart(Date.now());
    try {
      const pc = await createPC(true);
      await pc.setRemoteDescription(pendingOfferRef.current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('call-answer', { to: remoteAddress, from: myAddress, answer, callId });
      socketRef.current.emit('join-room', callId);
      for (const c of pendingCandidates.current) await pc.addIceCandidate(c);
      pendingCandidates.current = [];
      pendingOfferRef.current = null;
    } catch (e) {
      cleanup();
    }
  }, [myAddress, remoteAddress, callId, createPC, cleanup, stopRingtone]);

  const rejectCall = useCallback(() => {
    stopRingtone();
    if (socketRef.current && remoteAddress) {
      socketRef.current.emit('call-reject', { to: remoteAddress, from: myAddress, callId });
    }
    cleanup();
  }, [myAddress, remoteAddress, callId, cleanup, stopRingtone]);

  const hangup = useCallback(() => {
    if (socketRef.current && remoteAddress) {
      socketRef.current.emit('call-hangup', { to: remoteAddress, from: myAddress, callId });
    }
    cleanup();
  }, [myAddress, remoteAddress, callId, cleanup]);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = muted; });
      setMuted(!muted);
    }
  };
  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = cameraOff; });
      setCameraOff(!cameraOff);
    }
  };

  const sendChat = (text: string) => {
    if (socketRef.current && callId && text.trim()) {
      socketRef.current.emit('chat-message', { callId, from: myAddress, text: text.trim() });
    }
  };
  const sendReaction = (emoji: string) => {
    if (socketRef.current && callId) {
      socketRef.current.emit('reaction', { callId, from: myAddress, emoji });
    }
  };

  const isOnline = (addr: string) => !!presence[addr];

  return {
    status, remoteAddress, localStream, remoteStream,
    muted, cameraOff, chat, reactions, presence, callStart,
    startCall, acceptCall, rejectCall, hangup,
    toggleMute, toggleCamera, sendChat, sendReaction, isOnline
  };
}
