'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

export function useWebRTC(myAddress: string | null) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStart, setCallStart] = useState<number | null>(null);
  const [chat, setChat] = useState<{from: string, text: string}[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOffer = useRef<any>(null);
  const callIdRef = useRef<string>('');

  const cleanup = () => {
    pcRef.current?.getSenders().forEach(s => s.track?.stop());
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
    });

    socket.on('call-answered', async ({ answer }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setStatus('connected');
        setCallStart(Date.now());
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (candidate && pcRef.current) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    socket.on('call-rejected', cleanup);
    socket.on('call-ended', cleanup);
    socket.on('chat-message', (msg) => setChat(prev => [...prev, msg]));

    return () => { socket.disconnect(); };
  }, [myAddress]);

  const getStream = async (video: boolean) => {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { width: 640, height: 480 } : false
    });
  };

  const makePC = async (stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current && remoteAddress) {
        socketRef.current.emit('ice-candidate', { to: remoteAddress, candidate: e.candidate, callId: callIdRef.current });
      }
    };
    return pc;
  };

  const startCall = async (target: string, _t?: string, withVideo = true) => {
    if (!socketRef.current || !myAddress) return alert('Not ready');
    setRemoteAddress(target);
    setStatus('calling');
    try {
      const stream = await getStream(withVideo);
      setLocalStream(stream);
      const pc = await makePC(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const cid = [myAddress, target].sort().join('_');
      callIdRef.current = cid;
      socketRef.current.emit('call-offer', { to: target, from: myAddress, offer, callId: cid });
    } catch (e) { alert('Allow mic/camera'); cleanup(); }
  };

  const acceptCall = async () => {
    if (!pendingOffer.current || !remoteAddress) return;
    try {
      const stream = await getStream(true);
      setLocalStream(stream);
      const pc = await makePC(stream);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.current));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('call-answer', { to: remoteAddress, from: myAddress, answer, callId: callIdRef.current });
      setStatus('connected');
      setCallStart(Date.now());
      pendingOffer.current = null;
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
    localStream?.getAudioTracks().forEach(t => t.enabled = muted);
    setMuted(!muted);
  };

  const toggleCamera = () => {
    localStream?.getVideoTracks().forEach(t => t.enabled = cameraOff);
    setCameraOff(!cameraOff);
  };

  const startScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(screen.getVideoTracks()[0]);
    } catch {}
  };

  const sendChat = (text: string) => {
    if (!text.trim() || !socketRef.current) return;
    socketRef.current.emit('chat-message', { callId: callIdRef.current, from: myAddress, text: text.trim() });
    setChat(prev => [...prev, { from: myAddress || '', text: text.trim() }]);
  };

  return { status, remoteAddress, localStream, remoteStream, muted, cameraOff, chat, callStart,
           startCall, acceptCall, rejectCall, hangup, toggleMute, toggleCamera, startScreenShare, sendChat };
}
