'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Room, RoomEvent, Track } from 'livekit-client';

const SIGNALING = 'https://vexdial-production.up.railway.app';

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
  const roomRef = useRef<Room | null>(null);
  const pendingOffer = useRef<any>(null);
  const callIdRef = useRef('');
  const ringInterval = useRef<any>(null);
  const remoteAddrRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const stopRing = () => {
    if (ringInterval.current) clearInterval(ringInterval.current);
    ringInterval.current = null;
  };

  const cleanup = async () => {
    stopRing();
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch {}
      roomRef.current = null;
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

    socket.on('connect', () => { setConnected(true); register(); });
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

    socket.on('call-answered', async () => {
      stopRing();
      setStatus('connected');
      setCallStart(Date.now());
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
    try {
      const constraints: MediaStreamConstraints = {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      };
      if (video) constraints.video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      return stream;
    } catch (err) {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioOnly;
        return audioOnly;
      } catch (e2) {
        throw new Error('Mic permission denied. Allow microphone and try again.');
      }
    }
  };

  const connectLiveKit = async (roomName: string, identity: string, video: boolean) => {
    const url = `${SIGNALING}/api/livekit-token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`;
    console.log('Fetching token from', url);
    const res = await fetch(url);
    const data = await res.json();
    if (data.error || !data.token || !data.url) throw new Error((data.error || 'No LiveKit token') + ' | url=' + SIGNALING);

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio || track.kind === Track.Kind.Video) {
        const remote = new MediaStream();
        room.remoteParticipants.forEach(p => {
          p.trackPublications.forEach(pub => {
            if (pub.track) remote.addTrack(pub.track.mediaStreamTrack);
          });
        });
        setRemoteStream(remote);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, () => {
      const remote = new MediaStream();
      room.remoteParticipants.forEach(p => {
        p.trackPublications.forEach(pub => {
          if (pub.track) remote.addTrack(pub.track.mediaStreamTrack);
        });
      });
      setRemoteStream(remote.getTracks().length ? remote : null);
    });

    await room.connect(data.url, data.token);

    const stream = await getStream(video);
    setLocalStream(stream);
    for (const track of stream.getTracks()) {
      await room.localParticipant.publishTrack(track);
    }
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
      const cid = [myAddress.trim(), cleanTarget].sort().join('_');
      callIdRef.current = cid;

      await connectLiveKit(cid, myAddress.trim(), withVideo);

      socketRef.current.emit('call-offer', {
        to: cleanTarget,
        from: myAddress.trim(),
        offer: { type: 'livekit', room: cid },
        callId: cid,
      });
      socketRef.current.emit('join-room', cid);
    } catch (err: any) {
      console.error(err);
      stopRing();
      cleanup();
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const acceptCall = async () => {
    stopRing();
    if (!remoteAddress || !callIdRef.current || !myAddress) return;

    try {
      // Prefer audio first so mobile permission issues don't kill the call
      await connectLiveKit(callIdRef.current, myAddress.trim(), false);

      socketRef.current?.emit('call-answer', {
        to: remoteAddress,
        from: myAddress,
        answer: { type: 'livekit' },
        callId: callIdRef.current,
      });
      socketRef.current?.emit('join-room', callIdRef.current);

      setStatus('connected');
      setCallStart(Date.now());
      pendingOffer.current = null;
    } catch (err: any) {
      console.error(err);
      cleanup();
      alert('Accept failed: ' + (err?.message || String(err)));
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
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    if (roomRef.current) roomRef.current.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  };

  const toggleCamera = () => {
    const next = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !next; });
    if (roomRef.current) roomRef.current.localParticipant.setCameraEnabled(!next);
    setCameraOff(next);
  };

  const startScreenShare = async () => {
    try {
      if (!roomRef.current) return;
      await roomRef.current.localParticipant.setScreenShareEnabled(true);
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
