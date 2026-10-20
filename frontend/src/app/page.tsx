'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';

export default function Home() {
  const { publicKey, connected } = useWallet();
  const myAddress = publicKey?.toBase58() || null;
  const webrtc = useWebRTC(myAddress);
  const [target, setTarget] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [duration, setDuration] = useState(0);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (webrtc.localStream && localRef.current) localRef.current.srcObject = webrtc.localStream;
  }, [webrtc.localStream]);

  useEffect(() => {
    if (webrtc.remoteStream && remoteRef.current) {
      remoteRef.current.srcObject = webrtc.remoteStream;
      remoteRef.current.play().catch(() => {});
    }
  }, [webrtc.remoteStream]);

  useEffect(() => {
    if (webrtc.status !== 'connected' || !webrtc.callStart) return;
    const i = setInterval(() => setDuration(Math.floor((Date.now() - webrtc.callStart!) / 1000)), 1000);
    return () => clearInterval(i);
  }, [webrtc.status, webrtc.callStart]);

  const call = (video: boolean) => {
    if (!target.trim()) return alert('Enter address');
    webrtc.startCall(target.trim(), undefined, video);
  };

  if (!connected) return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-cyan-400 mb-4">VexDial</h1>
        <WalletMultiButton />
      </div>
    </div>
  );

  if (webrtc.status === 'ringing') return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
      <div className="text-center bg-gray-900 p-8 rounded-2xl">
        <p className="text-xl mb-6">Incoming call</p>
        <div className="flex gap-4">
          <button onClick={webrtc.acceptCall} className="px-8 py-3 bg-green-600 rounded-full">Accept</button>
          <button onClick={webrtc.rejectCall} className="px-8 py-3 bg-red-600 rounded-full">Reject</button>
        </div>
      </div>
    </div>
  );

  if (webrtc.status === 'calling' || webrtc.status === 'connected') return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center text-cyan-400 mb-4">
          {webrtc.status === 'calling' ? 'Calling...' : `Connected ${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-black rounded-xl overflow-hidden aspect-video relative">
            <video ref={localRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 text-xs bg-black/60 px-2 py-1 rounded">You</span>
          </div>
          <div className="bg-black rounded-xl overflow-hidden aspect-video relative">
            <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 text-xs bg-black/60 px-2 py-1 rounded">Remote</span>
          </div>
        </div>
        <div className="flex justify-center gap-3 mb-4">
          <button onClick={webrtc.toggleMute} className="px-4 py-2 bg-gray-800 rounded-full">{webrtc.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={webrtc.toggleCamera} className="px-4 py-2 bg-gray-800 rounded-full">{webrtc.cameraOff ? 'Cam On' : 'Cam Off'}</button>
          <button onClick={webrtc.startScreenShare} className="px-4 py-2 bg-purple-700 rounded-full">Share</button>
          <button onClick={webrtc.hangup} className="px-6 py-2 bg-red-600 rounded-full">Hangup</button>
        </div>
        <div className="bg-gray-900 rounded-xl p-3 mb-2 h-32 overflow-y-auto text-sm">
          {webrtc.chat.map((m, i) => <div key={i} className="mb-1"><b>{m.from?.slice(0,4)}:</b> {m.text}</div>)}
        </div>
        <form onSubmit={e => { e.preventDefault(); webrtc.sendChat(chatInput); setChatInput(''); }} className="flex gap-2">
          <input value={chatInput} onChange={e => setChatInput(e.target.value)} className="flex-1 bg-black border border-cyan-700 rounded px-3 py-2" placeholder="Message..." />
          <button className="px-4 py-2 bg-cyan-600 rounded">Send</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4">
      <div className="max-w-md mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-cyan-400">VexDial</h1>
          <WalletMultiButton />
        </header>
        <div className="bg-gray-900/70 p-6 rounded-2xl">
          <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Wallet address" className="w-full bg-black border border-cyan-700 rounded-lg px-4 py-3 mb-4" />
          <div className="flex gap-3">
            <button onClick={() => call(false)} className="flex-1 py-3 bg-emerald-600 rounded-lg font-semibold">VexVoice</button>
            <button onClick={() => call(true)} className="flex-1 py-3 bg-cyan-600 rounded-lg font-semibold">VexVideo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
