'use client';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export function useWebRTC(myAddress: string | null) {
  const [status, setStatus] = useState<'idle'|'calling'|'ringing'|'connected'>('idle');
  const [remoteAddress, setRemoteAddress] = useState<string|null>(null);
  const [localStream, setLocalStream] = useState<MediaStream|null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream|null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStart, setCallStart] = useState<number|null>(null);
  const [chat, setChat] = useState<any[]>([]);

  const pcRef = useRef<RTCPeerConnection|null>(null);
  const socketRef = useRef<any>(null);
  const pendingOffer = useRef<any>(null);
  const pendingCands = useRef<any[]>([]);
  const remoteAddrRef = useRef<string|null>(null);
  const callIdRef = useRef<string|null>(null);
  const localStreamRef = useRef<MediaStream|null>(null);

  useEffect(() => { remoteAddrRef.current = remoteAddress; }, [remoteAddress]);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

  const cleanup = () => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteAddress(null);
    setCallStart(null);
    setChat([]);
    pendingOffer.current = null;
    pendingCands.current = [];
  };

  useEffect(() => {
    if (!myAddress) return;
    const socket = io(SIGNALING, { transports: ['websocket','polling'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('register', { address: myAddress, status: 'online' }));
    socket.on('incoming-call', ({ from, offer, callId }) => {
      setRemoteAddress(from);
      callIdRef.current = callId;
      setStatus('ringing');
      pendingOffer.current = offer;
    });
    socket.on('call-answered', async ({ answer }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(answer);
        setStatus('connected');
        setCallStart(Date.now());
        for (const c of pendingCands.current) try { await pcRef.current.addIceCandidate(c); } catch {}
        pendingCands.current = [];
      }
    });
    socket.on('ice-candidate', async ({ candidate }) => {
      if (!candidate) return;
      if (pcRef.current?.remoteDescription) try { await pcRef.current.addIceCandidate(candidate); } catch {}
      else pendingCands.current.push(candidate);
    });
    socket.on('call-rejected', cleanup);
    socket.on('call-ended', cleanup);
    socket.on('chat-message', (m) => setChat(c => [...c, m]));
    return () => socket.disconnect();
  }, [myAddress]);

  const getMedia = async (video: boolean) => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  };

  const createPC = async (withVideo: boolean) => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pcRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current && remoteAddrRef.current) {
        socketRef.current.emit('ice-candidate', { to: remoteAddrRef.current, candidate: e.candidate, callId: callIdRef.current });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      setRemoteStream(stream);
    };
    const stream = await getMedia(withVideo);
    setLocalStream(stream);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    return pc;
  };

  const startCall = async (target: string, _t?: string, withVideo = true) => {
    if (!socketRef.current || !myAddress) return alert('Not connected');
    setRemoteAddress(target);
    remoteAddrRef.current = target;
    setStatus('calling');
    try {
      const pc = await createPC(withVideo);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const cid = [myAddress, target].sort().join('_');
      callIdRef.current = cid;
      socketRef.current.emit('call-offer', { to: target, from: myAddress, offer, callId: cid });
      socketRef.current.emit('join-room', cid);
    } catch (e) { cleanup(); }
  };

  const acceptCall = async () => {
    if (!socketRef.current || !remoteAddress || !pendingOffer.current) return alert('Call not ready');
    try {
      const pc = await createPC(true);
      await pc.setRemoteDescription(pendingOffer.current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('call-answer', { to: remoteAddress, from: myAddress, answer, callId: callIdRef.current });
      socketRef.current.emit('join-room', callIdRef.current);
      for (const c of pendingCands.current) try { await pc.addIceCandidate(c); } catch {}
      pendingCands.current = [];
      pendingOffer.current = null;
      setStatus('connected');
      setCallStart(Date.now());
    } catch (e) { alert('Allow mic/camera'); cleanup(); }
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
    localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = muted);
    setMuted(!muted);
  };
  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => t.enabled = cameraOff);
    setCameraOff(!cameraOff);
  };
  const startScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screen.getVideoTracks()[0]);
      screen.getVideoTracks()[0].onended = async () => {
        const cam = localStreamRef.current?.getVideoTracks()[0];
        if (cam && sender) await sender.replaceTrack(cam);
      };
    } catch {}
  };
  const sendChat = (text: string) => {
    if (text.trim()) socketRef.current?.emit('chat-message', { callId: callIdRef.current, from: myAddress, text: text.trim() });
  };

  return { status, remoteAddress, localStream, remoteStream, muted, cameraOff, chat, callStart,
    startCall, acceptCall, rejectCall, hangup, toggleMute, toggleCamera, startScreenShare, sendChat };
}
