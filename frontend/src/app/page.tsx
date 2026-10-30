'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useIdentity, createLocalWallet } from '../hooks/useIdentity';

export default function Home() {
  const { publicKey, connected } = useWallet();
  const { identity, save: saveIdentity, clear: clearIdentity } = useIdentity();
  const myAddress = publicKey?.toBase58() || identity?.address || null;
  const webrtc = useWebRTC(myAddress);
  const [target, setTarget] = useState('');
  const [tab, setTab] = useState('dial');
  const [contacts, setContacts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [duration, setDuration] = useState(0);
  const [isMobileWallet, setIsMobileWallet] = useState(false);
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    setIsMobileWallet(/Phantom|Solflare|Trust/i.test(ua));
  }, []);

  useEffect(() => {
    setContacts(JSON.parse(localStorage.getItem('vexdial-contacts') || '[]'));
    setHistory(JSON.parse(localStorage.getItem('vexdial-history') || '[]'));
  }, []);

  useEffect(() => {
    if (webrtc.localStream && localRef.current) localRef.current.srcObject = webrtc.localStream;
  }, [webrtc.localStream]);

  useEffect(() => {
    if (webrtc.remoteStream) {
      if (remoteRef.current) {
        remoteRef.current.srcObject = webrtc.remoteStream;
        remoteRef.current.play().catch(() => {});
      }
      if (audioRef.current) {
        audioRef.current.srcObject = webrtc.remoteStream;
        audioRef.current.play().catch(() => {});
      }
    }
  }, [webrtc.remoteStream]);

  useEffect(() => {
    if (webrtc.status !== 'connected' || !webrtc.callStart) return;
    const i = setInterval(() => setDuration(Math.floor((Date.now() - webrtc.callStart!) / 1000)), 1000);
    return () => clearInterval(i);
  }, [webrtc.status, webrtc.callStart]);

  const logCall = (addr: string, type: string) => {
    const next = [{ address: addr, type, ts: Date.now() }, ...history].slice(0, 40);
    setHistory(next);
    localStorage.setItem('vexdial-history', JSON.stringify(next));
  };

  const call = (video: boolean) => {
    if (!target.trim()) return alert('Enter address');
    logCall(target.trim(), 'outgoing');
    webrtc.startCall(target.trim(), undefined, video);
  };

  const addContact = () => {
    const addr = prompt('Wallet address (any chain)');
    if (!addr) return;
    const name = prompt('Name') || '';
    const next = [{ address: addr, name }, ...contacts.filter(c => c.address !== addr)];
    setContacts(next);
    localStorage.setItem('vexdial-contacts', JSON.stringify(next));
  };

  const makeVexWallet = () => {
    const { identity: id, secret } = createLocalWallet();
    saveIdentity(id);
    setShowSecret(secret);
  };

  if (!myAddress) return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-5xl font-bold text-cyan-400 mb-2">VexDial</h1>
      <p className="text-gray-400 mb-6 text-center">Wallet-to-wallet encrypted calls across chains</p>
      <WalletMultiButton />
      <button onClick={makeVexWallet} className="mt-4 px-6 py-3 bg-cyan-600 rounded-full font-semibold">
        Create Vex Wallet
      </button>
      <p className="text-xs text-gray-500 mt-3 max-w-xs text-center">Keys are generated in your browser and never sent to any server.</p>
      {isMobileWallet && (
        <button onClick={() => window.open(window.location.href, '_blank')} className="mt-4 px-6 py-2 bg-gray-700 rounded-full text-sm">
          Open in Chrome / Safari
        </button>
      )}
      <a href="https://x.com/VexDial" target="_blank" className="mt-6 text-sm text-cyan-400 hover:underline">@VexDial</a>
    </div>
  );

  if (webrtc.status === 'ringing') return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
      <div className="text-center bg-gray-900/80 p-10 rounded-2xl border border-cyan-500/30">
        <p className="text-2xl mb-2">Incoming Call</p>
        <p className="text-sm text-gray-400 mb-6">{webrtc.remoteAddress?.slice(0,8)}...{webrtc.remoteAddress?.slice(-4)}</p>
        <div className="flex gap-4 justify-center">
          <button onClick={webrtc.acceptCall} className="px-10 py-3 bg-green-600 rounded-full text-lg font-semibold">Accept</button>
          <button onClick={webrtc.rejectCall} className="px-10 py-3 bg-red-600 rounded-full text-lg font-semibold">Reject</button>
        </div>
      </div>
    </div>
  );

  if (webrtc.status === 'calling' || webrtc.status === 'connected') return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center text-cyan-400 mb-4 text-lg">
          {webrtc.status === 'calling' ? 'Calling...' : `Connected ${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`}
        </div>
        <audio ref={audioRef} autoPlay />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-black rounded-xl overflow-hidden aspect-video relative">
            <video ref={localRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 text-xs bg-black/60 px-2 py-1 rounded">You</span>
          </div>
          <div className="bg-black rounded-xl overflow-hidden aspect-video relative">
            <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 text-xs bg-black/60 px-2 py-1 rounded">Remote</span>
          </div>
        </div>
        <div className="flex justify-center gap-3 mb-4 flex-wrap">
          <button onClick={webrtc.toggleMute} className="px-4 py-2 bg-gray-800 rounded-full">{webrtc.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={webrtc.toggleCamera} className="px-4 py-2 bg-gray-800 rounded-full">{webrtc.cameraOff ? 'Cam On' : 'Cam Off'}</button>
          <button onClick={webrtc.startScreenShare} className="px-4 py-2 bg-purple-700 rounded-full">Share</button>
          <button onClick={webrtc.hangup} className="px-6 py-2 bg-red-600 rounded-full">Hangup</button>
        </div>
        <div className="bg-gray-900/70 rounded-xl p-3 mb-2 h-28 overflow-y-auto text-sm">
          {webrtc.chat.map((m,i) => <div key={i}><b className="text-cyan-400">{m.from?.slice(0,6)}:</b> {m.text}</div>)}
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
      <div className="max-w-lg mx-auto">
        <header className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400">VexDial</h1>
            <a href="https://x.com/VexDial" target="_blank" className="text-xs text-cyan-400 hover:underline">@VexDial</a>
          </div>
          <div className="flex items-center gap-2">
            {connected ? <WalletMultiButton /> : (
              <button onClick={clearIdentity} className="px-3 py-1 text-xs bg-gray-700 rounded">Logout</button>
            )}
            <button onClick={() => window.location.reload()} className="px-3 py-1 text-xs bg-gray-700 rounded">Reconnect</button>
          </div>
        </header>

        {showSecret && (
          <div className="bg-yellow-900/40 border border-yellow-600 rounded-xl p-4 mb-4 text-sm">
            <p className="font-semibold mb-2">Backup your secret (shown once)</p>
            <p className="font-mono break-all text-xs">{showSecret}</p>
            <button onClick={() => setShowSecret(null)} className="mt-2 px-3 py-1 bg-yellow-700 rounded text-xs">I saved it</button>
          </div>
        )}

        <div className="text-xs text-gray-400 mb-4">Your ID: {myAddress?.slice(0,12)}...{myAddress?.slice(-6)}</div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('dial')} className={`px-4 py-2 rounded-lg text-sm ${tab==='dial'?'bg-cyan-600':'bg-gray-800'}`}>Dial</button>
          <button onClick={() => setTab('contacts')} className={`px-4 py-2 rounded-lg text-sm ${tab==='contacts'?'bg-cyan-600':'bg-gray-800'}`}>VexBook</button>
          <button onClick={() => setTab('history')} className={`px-4 py-2 rounded-lg text-sm ${tab==='history'?'bg-cyan-600':'bg-gray-800'}`}>History</button>
        </div>

        {tab === 'dial' && (
          <div className="bg-gray-900/70 p-6 rounded-2xl border border-cyan-500/20">
            <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Any wallet address (SOL, ETH, BTC, BNB...)" className="w-full bg-black border border-cyan-700 rounded-lg px-4 py-3 mb-4" />
            <div className="flex gap-3">
              <button onClick={() => call(false)} className="flex-1 py-3 bg-emerald-600 rounded-lg font-semibold">VexVoice</button>
              <button onClick={() => call(true)} className="flex-1 py-3 bg-cyan-600 rounded-lg font-semibold">VexVideo</button>
            </div>
            <p className="text-xs text-gray-500 mt-3">Interchain calling works. Enter any address to call.</p>
          </div>
        )}

        {tab === 'contacts' && (
          <div className="bg-gray-900/70 p-6 rounded-2xl border border-cyan-500/20">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl">VexBook</h2>
              <button onClick={addContact} className="px-3 py-1 bg-cyan-600 rounded text-sm">Add</button>
            </div>
            {contacts.map(c => (
              <div key={c.address} className="flex justify-between items-center bg-black/40 rounded-lg p-3 mb-2">
                <div>
                  <p>{c.name || 'Unnamed'}</p>
                  <p className="text-xs text-gray-400">{c.address.slice(0,10)}...</p>
                </div>
                <button onClick={() => { setTarget(c.address); setTab('dial'); }} className="px-3 py-1 bg-cyan-700 rounded text-xs">Call</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className="bg-gray-900/70 p-6 rounded-2xl border border-cyan-500/20">
            <h2 className="text-xl mb-4">History</h2>
            {history.map((h,i) => (
              <div key={i} className="flex justify-between items-center bg-black/40 rounded-lg p-3 mb-2">
                <div>
                  <p className="text-sm">{h.address?.slice(0,10)}...</p>
                  <p className="text-xs text-gray-400">{h.type}</p>
                </div>
                <button onClick={() => { setTarget(h.address); setTab('dial'); }} className="px-3 py-1 bg-cyan-700 rounded text-xs">Call</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
