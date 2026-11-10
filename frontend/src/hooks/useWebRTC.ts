'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

function playRingtone() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o1.frequency.value = 440;
    o2.frequency.value = 480;
    o1.connect(g); o2.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    o1.start(now); o2.start(now);
    o1.stop(now + 0.35); o2.stop(now + 0.35);
  } catch {}
}

export function useWebRTC(myAddress: string | null) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStart, setCallStart] = useState<number | null>(null);
  const [chat, setChat] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOffer = useRef<any>(null);
  const pendingCands = useRef<RTCIceCandidateInit[]>([]);
  const callIdRef = useRef('');
  const ringInterval = useRef<any>(null);
  const remoteAddrRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const stopRing = () => {
    if (ringInterval.current) clearInterval(ringInterval.current);
    ringInterval.current = null;
  };

  const cleanup = () => {
    stopRing();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteAddress(null);
    setCallStart(null);
    pendingOffer.current = null;
    pendingCands.current = [];
  };

  useEffect(() => {
    remoteAddrRef.current = remoteAddress;
  }, [remoteAddress]);

  useEffect(() => {
    if (!myAddress) return;

    const socket = io(SIGNALING, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      timeout: 20000,
    });
    socketRef.current = socket;

    const register = async () => {
      if (!myAddress || !socket.connected) return;
      const addr = myAddress.trim();
      socket.emit('register', { address: addr, status: 'online' });
      try {
        await fetch(`${SIGNALING}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr }),
        });
        setConnected(true);
      } catch {}
    };

    socket.on('connect', () => {
      setConnected(true);
      register();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('reconnect', register);
    socket.on('registered', () => setConnected(true));

    const regInterval = setInterval(register, 5000);
    window.addEventListener('focus', register);
    document.addEventListener('visibilitychange', register);

    socket.on('incoming-call', ({ from, offer, callId }) => {
      setRemoteAddress(from);
      remoteAddrRef.current = from;
      callIdRef.current = callId;
      pendingOffer.current = offer;
      setStatus('ringing');
      stopRing();
      ringInterval.current = setInterval(() => playRingtone(), 1400);
    });

    socket.on('call-answered', async ({ answer }) => {
      stopRing();
      if (!pcRef.current || !answer) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setStatus('connected');
        setCallStart(Date.now());
        for (const c of pendingCands.current) {
          try { await pcRef.current!.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
        pendingCands.current = [];
      } catch (e) {
        console.error('setRemoteDescription failed', e);
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
    socket.on('call-ended', () => {
      stopRing();
      cleanup();
    });

    socket.on('chat-message', (msg) => {
      setChat(p => [...p, msg]);
      if (msg.from !== myAddress) {
        socket.emit('msg-read', { to: msg.from, id: msg.id });
      }
    });
    socket.on('offline-messages', (msgs) => {
      setChat(p => [...p, ...msgs.map((m: any) => ({ ...m, status: 'delivered' }))]);
    });
    socket.on('missed-calls', (calls) => {
      setChat(p => [...p, ...calls.map((c: any) => ({ from: c.from, text: 'Missed call', ts: c.ts, missed: true }))]);
    });
    socket.on('msg-status', ({ id, status }) => {
      setChat(p => p.map(m => m.id === id ? { ...m, status } : m));
    });

    return () => {
      clearInterval(regInterval);
      window.removeEventListener('focus', register);
      document.removeEventListener('visibilitychange', register);
      socket.disconnect();
    };
  }, [myAddress]);

  const getStream = async (video: boolean) => {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
    if (video) {
      constraints.video = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getAudioTracks().forEach(t => { t.enabled = true; });
      if (video) stream.getVideoTracks().forEach(t => { t.enabled = true; });
      localStreamRef.current = stream;
      return stream;
    } catch (err) {
      if (video) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = audioOnly;
          return audioOnly;
        } catch {}
      }
      throw err;
    }
  };

  const makePC = (stream: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ],
    });
    pcRef.current = pc;

    stream.getTracks().forEach(track => {
      track.enabled = true;
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
      const track = event.track;
      if (!track) return;
      track.enabled = true;

      let remote = event.streams?.[0];
      if (!remote) {
        remote = new MediaStream([track]);
      }
      remote.getTracks().forEach(t => { t.enabled = true; });
      setRemoteStream(remote);

      setTimeout(() => {
        remote.getAudioTracks().forEach(t => { t.enabled = true; });
        remote.getVideoTracks().forEach(t => { t.enabled = true; });
      }, 300);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current && remoteAddrRef.current) {
        socketRef.current.emit('ice-candidate', {
          to: remoteAddrRef.current,
          candidate: e.candidate,
          callId: callIdRef.current,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      }
    };

    return pc;
  };

  const startCall = async (target: string, withVideo = false) => {
    if (!socketRef.current) return alert('Not connected to server');
    if (!socketRef.current.connected) {
      socketRef.current.connect();
      await new Promise(r => setTimeout(r, 1500));
      if (!socketRef.current.connected) return alert('Cannot reach signaling server');
    }
    if (!myAddress) return alert('No identity');

    const cleanTarget = target.trim();
    setRemoteAddress(cleanTarget);
    remoteAddrRef.current = cleanTarget;
    setStatus('calling');
    stopRing();
    ringInterval.current = setInterval(() => playRingtone(), 1600);

    try {
      const stream = await getStream(withVideo);
      setLocalStream(stream);
      const pc = makePC(stream);

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: withVideo });
      await pc.setLocalDescription(offer);

      const cid = [myAddress.trim(), cleanTarget].sort().join('_');
      callIdRef.current = cid;

      socketRef.current.emit('call-offer', {
        to: cleanTarget,
        from: myAddress.trim(),
        offer,
        callId: cid,
      });
      socketRef.current.emit('join-room', cid);
    } catch (err) {
      console.error(err);
      stopRing();
      cleanup();
      alert('Failed to start call. Allow mic/camera permission.');
    }
  };

  const acceptCall = async () => {
    stopRing();
    if (!pendingOffer.current || !remoteAddress) return;

    try {
      const isVideo = String(pendingOffer.current.sdp || '').includes('m=video');
      const stream = await getStream(isVideo);
      setLocalStream(stream);
      const pc = makePC(stream);

      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.current));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit('call-answer', {
        to: remoteAddress,
        from: myAddress,
        answer,
        callId: callIdRef.current,
      });
      socketRef.current?.emit('join-room', callIdRef.current);

      for (const c of pendingCands.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      pendingCands.current = [];

      setStatus('connected');
      setCallStart(Date.now());
      pendingOffer.current = null;
    } catch (err) {
      console.error(err);
      cleanup();
      alert('Failed to accept call');
    }
  };

  const rejectCall = () => {
    socketRef.current?.emit('call-reject', { to: remoteAddress, from: myAddress, callId: callIdRef.current });
    cleanup();
  };

  const hangup = () => {
    socketRef.current?.emit('call-hangup', { to: remoteAddress, from: myAddress, callId: callIdRef.current });
    cleanup();
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = muted; });
    setMuted(!muted);
  };

  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = cameraOff; });
    setCameraOff(!cameraOff);
  };

  const startScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender && screen.getVideoTracks()[0]) {
        await sender.replaceTrack(screen.getVideoTracks()[0]);
      }
    } catch {}
  };

  const sendChat = (text: string, to?: string) => {
    if (!text.trim()) return;
    const dest = (to || remoteAddress || '').trim();
    if (!dest) return alert('Enter address first');
    const msg = {
      from: myAddress,
      to: dest,
      text: text.trim(),
      ts: Date.now(),
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      status: 'sent',
    };
    socketRef.current?.emit('chat-message', msg);
    setChat(p => [...p, msg]);
  };

  return {
    status,
    remoteAddress,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    chat,
    callStart,
    connected,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleMute,
    toggleCamera,
    startScreenShare,
    sendChat,
  };
}
