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
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const [onlineStatus, setOnlineStatus] = useState<'unknown'|'online'|'offline'>('unknown');
  const [reactions, setReactions] = useState<string[]>([]);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    const addr = prompt('Wallet address');
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

  const checkOnline = async () => {
    if (!target.trim()) return;
    try {
      const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
      const r = await fetch(`${base}/api/online/${encodeURIComponent(target.trim())}`);
      const data = await r.json();
      setOnlineStatus(data.online ? 'online' : 'offline');
    } catch { setOnlineStatus('unknown'); }
  };

  const connectMetaMask = async () => {
    const eth = (window as any).ethereum;
    if (!eth) return alert('MetaMask not found');
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (accounts[0]) saveIdentity({ address: accounts[0], chain: 'eth', label: 'MetaMask' });
    } catch { alert('MetaMask failed'); }
  };

  const sendReaction = (emoji: string) => {
    setReactions(p => [...p, emoji]);
    setTimeout(() => setReactions(p => p.slice(1)), 2000);
  };

  if (!myAddress) return (
    <div className="min-h-screen bg-[#0b0b10] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-5xl font-bold tracking-tight text-cyan-400">VexDial</h1>
        <p className="mt-2 text-gray-400">Encrypted wallet-to-wallet calls</p>
        <div className="mt-10 space-y-3">
          <WalletMultiButton className="!w-full !justify-center !py-3 !rounded-xl" />
          <button onClick={makeVexWallet} className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium transition">Create Vex Wallet</button>
          <button onClick={connectMetaMask} className="w-full py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-medium transition">Connect MetaMask</button>
        </div>
        <p className="mt-6 text-xs text-gray-500">Non-custodial. Keys stay on your device.</p>
        <a href="https://x.com/VexDial" className="mt-4 inline-block text-sm text-cyan-400">@VexDial</a>
      </div>
    </div>
  );

  if (webrtc.status === 'ringing') return (
    <div className="min-h-screen bg-[#0b0b10] text-white flex items-center justify-center">
      <div className="bg-[#16161d] border border-white/10 rounded-2xl p-10 text-center max-w-sm w-full">
        <div className="w-16 h-16 mx-auto rounded-full bg-cyan-500/20 flex items-center justify-center mb-4">
          <span className="text-2xl">📞</span>
        </div>
        <h2 className="text-2xl font-semibold">Incoming Call</h2>
        <p className="text-gray-400 text-sm mt-2 break-all">{webrtc.remoteAddress}</p>
        <div className="flex gap-3 mt-8">
          <button onClick={webrtc.acceptCall} className="flex-1 py-3 bg-emerald-600 rounded-xl font-medium">Accept</button>
          <button onClick={webrtc.rejectCall} className="flex-1 py-3 bg-red-600 rounded-xl font-medium">Decline</button>
        </div>
      </div>
    </div>
  );

  if (webrtc.status === 'calling' || webrtc.status === 'connected') return (
    <div className="min-h-screen bg-[#0b0b10] text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <span className="text-cyan-400 font-semibold">VexDial</span>
          <span className="ml-3 text-sm text-gray-400">
            {webrtc.status === 'calling' ? 'Calling…' : `${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`}
          </span>
        </div>
        <span className="text-xs text-gray-500 truncate max-w-[200px]">{webrtc.remoteAddress}</span>
      </header>

      <div className="flex-1 relative p-4">
        <audio ref={audioRef} autoPlay />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video md:aspect-auto">
            <video ref={localRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-3 left-3 text-xs bg-black/70 px-2 py-1 rounded-lg">You</span>
          </div>
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video md:aspect-auto">
            <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-3 left-3 text-xs bg-black/70 px-2 py-1 rounded-lg">Remote</span>
          </div>
        </div>
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none">
          {reactions.map((r, i) => <span key={i} className="text-3xl animate-bounce">{r}</span>)}
        </div>
      </div>

      <div className="border-t border-white/10 p-4">
        <div className="flex justify-center gap-2 mb-4">
          {['👍','❤️','😂','👏','🔥'].map(e => (
            <button key={e} onClick={() => sendReaction(e)} className="text-xl hover:scale-110 transition">{e}</button>
          ))}
        </div>
        <div className="flex justify-center gap-3 mb-4">
          <button onClick={webrtc.toggleMute} className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-full text-sm">{webrtc.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={webrtc.toggleCamera} className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-full text-sm">{webrtc.cameraOff ? 'Cam On' : 'Cam Off'}</button>
          <button onClick={webrtc.startScreenShare} className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-full text-sm">Share</button>
          <button onClick={webrtc.hangup} className="px-6 py-2.5 bg-red-600 hover:bg-red-500 rounded-full text-sm font-medium">End</button>
        </div>
        <div className="max-w-xl mx-auto">
          <div className="bg-white/5 rounded-xl p-3 h-24 overflow-y-auto text-sm mb-2">
            {webrtc.chat.map((m,i) => <div key={i}><span className="text-cyan-400">{m.from?.slice(0,6)}</span> {m.text}</div>)}
          </div>
          <form onSubmit={e => { e.preventDefault(); webrtc.sendChat(chatInput); setChatInput(''); }} className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm" placeholder="Message" />
            <button className="px-4 py-2 bg-cyan-600 rounded-xl text-sm">Send</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0b0b10] text-white">
      <div className="max-w-lg mx-auto p-6">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">VexDial</h1>
            <a href="https://x.com/VexDial" className="text-xs text-cyan-400/70">@VexDial</a>
          </div>
          <div className="flex items-center gap-2">
            {connected ? <WalletMultiButton /> : <button onClick={clearIdentity} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Logout</button>}
            <button onClick={() => window.location.reload()} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Reconnect</button>
          </div>
        </header>

        {showSecret && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-sm">
            <p className="font-medium text-amber-300 mb-2">Save your secret</p>
            <p className="font-mono text-xs break-all text-amber-100/80">{showSecret}</p>
            <button onClick={() => setShowSecret(null)} className="mt-3 text-xs px-3 py-1 bg-amber-600 rounded-lg">Done</button>
          </div>
        )}

        <div className="bg-white/5 rounded-xl p-3 mb-6 flex items-center justify-between text-sm">
          <span className="font-mono text-xs break-all text-gray-300">{myAddress}</span>
          <button onClick={() => navigator.clipboard.writeText(myAddress || '')} className="ml-2 shrink-0 px-3 py-1 bg-white/10 rounded-lg text-xs">Copy</button>
        </div>

        <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-6">
          {['dial','contacts','history'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2 rounded-lg text-sm capitalize ${tab===t ? 'bg-cyan-600' : 'text-gray-400'}`}>{t === 'contacts' ? 'VexBook' : t}</button>
          ))}
        </div>

        {tab === 'dial' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <input value={target} onChange={e => { setTarget(e.target.value); setOnlineStatus('unknown'); }} placeholder="Wallet address" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 mb-3 text-sm" />
            <div className="flex items-center gap-3 mb-4">
              <button onClick={checkOnline} className="px-3 py-1.5 text-xs bg-white/10 rounded-lg">Check</button>
              {onlineStatus !== 'unknown' && <span className={`text-xs ${onlineStatus==='online'?'text-emerald-400':'text-red-400'}`}>{onlineStatus}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => call(false)} className="py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-medium text-sm">VexVoice</button>
              <button onClick={() => call(true)} className="py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium text-sm">VexVideo</button>
            </div>
          </div>
        )}

        {tab === 'contacts' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-medium">VexBook</h2>
              <button onClick={addContact} className="text-xs px-3 py-1.5 bg-cyan-600 rounded-lg">Add</button>
            </div>
            {contacts.length === 0 && <p className="text-sm text-gray-500">No contacts yet</p>}
            {contacts.map(c => (
              <div key={c.address} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm">{c.name || 'Unnamed'}</p>
                  <p className="text-xs text-gray-500 font-mono">{c.address.slice(0,12)}…</p>
                </div>
                <button onClick={() => { setTarget(c.address); setTab('dial'); }} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Call</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h2 className="font-medium mb-4">History</h2>
            {history.length === 0 && <p className="text-sm text-gray-500">No calls yet</p>}
            {history.map((h,i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm font-mono">{h.address?.slice(0,12)}…</p>
                  <p className="text-xs text-gray-500">{h.type}</p>
                </div>
                <button onClick={() => { setTarget(h.address); setTab('dial'); }} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Call</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
