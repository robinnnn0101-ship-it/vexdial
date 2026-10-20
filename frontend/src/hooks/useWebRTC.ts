'use client';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function useWebRTC(myAddress: string | null) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [chat, setChat] = useState<any[]>([]);
  const [callStart, setCallStart] = useState<number | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<any>(null);
  const pendingOfferRef = useRef<any>(null);
  const pendingCandidates = useRef<any[]>([]);
  const remoteAddressRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);

  useEffect(() => { remoteAddressRef.current = remoteAddress; }, [remoteAddress]);
  useEffect(() => { callIdRef.current = callId; }, [callId]);

  const cleanup = () => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteAddress(null);
    setCallId(null);
    setCallStart(null);
    setChat([]);
    pendingOfferRef.current = null;
    pendingCandidates.current = [];
  };

  useEffect(() => {
    if (!myAddress) return;
    const socket = io(SIGNALING, { transports: ['websocket', 'polling'], reconnection: true });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('register', { address: myAddress, status: 'online' }));
    socket.on('reconnect', () => socket.emit('register', { address: myAddress, status: 'online' }));

    socket.on('incoming-call', ({ from, offer, callId: cid }) => {
      setRemoteAddress(from);
      setCallId(cid);
      setStatus('ringing');
      pendingOfferRef.current = offer;
    });

    socket.on('call-answered', async ({ answer }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(answer);
          setStatus('connected');
          setCallStart(Date.now());
          for (const c of pendingCandidates.current) {
            try { await pcRef.current.addIceCandidate(c); } catch {}
          }
          pendingCandidates.current = [];
        } catch (e) { console.error(e); }
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (!candidate) return;
      if (pcRef.current?.remoteDescription) {
        try { await pcRef.current.addIceCandidate(candidate); } catch {}
      } else pendingCandidates.current.push(candidate);
    });

    socket.on('call-rejected', cleanup);
    socket.on('call-ended', cleanup);
    socket.on('chat-message', (msg) => setChat(c => [...c, msg]));
    socket.on('call-error', ({ error }) => { alert(error); cleanup(); });

    return () => socket.disconnect();
  }, [myAddress]);

  const createPC = async (withVideo = true) => {
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
        setRemoteStream(new MediaStream([e.track]));
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
    });
    setLocalStream(stream);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    return pc;
  };

  const startCall = async (target: string, _tune?: string, withVideo = true) => {
    if (!socketRef.current || !myAddress) return alert('Not connected');
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
    } catch (e) {
      alert('Could not start call. Allow mic/camera.');
      cleanup();
    }
  };

  const acceptCall = async () => {
    if (!socketRef.current || !remoteAddress || !pendingOfferRef.current) {
      return alert('Call not ready');
    }
    try {
      const pc = await createPC(true);
      await pc.setRemoteDescription(pendingOfferRef.current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('call-answer', { to: remoteAddress, from: myAddress, answer, callId });
      socketRef.current.emit('join-room', callId);
      for (const c of pendingCandidates.current) {
        try { await pc.addIceCandidate(c); } catch {}
      }
      pendingCandidates.current = [];
      pendingOfferRef.current = null;
      setStatus('connected');
      setCallStart(Date.now());
    } catch (e) {
      alert('Allow camera & microphone, then try again');
      cleanup();
    }
  };

  const rejectCall = () => {
    if (socketRef.current && remoteAddress) {
      socketRef.current.emit('call-reject', { to: remoteAddress, from: myAddress, callId });
    }
    cleanup();
  };

  const hangup = () => {
    if (socketRef.current && remoteAddress) {
      socketRef.current.emit('call-hangup', { to: remoteAddress, from: myAddress, callId });
    }
    cleanup();
  };

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

  const startScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screen.getVideoTracks()[0]);
    } catch {}
  };

  const sendChat = (text: string) => {
    if (socketRef.current && callId && text.trim()) {
      socketRef.current.emit('chat-message', { callId, from: myAddress, text: text.trim() });
    }
  };

  return {
    status, remoteAddress, localStream, remoteStream,
    muted, cameraOff, chat, callStart,
    startCall, acceptCall, rejectCall, hangup,
    toggleMute, toggleCamera, sendChat, startScreenShare
  };
}
