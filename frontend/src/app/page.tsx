'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useIdentity, createLocalWallet, restoreFromSecret } from '../hooks/useIdentity';

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
  const [msgSearch, setMsgSearch] = useState('');
  const [missedCount, setMissedCount] = useState(0);
  const [namesList, setNamesList] = useState<any[]>([]);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    setContacts(JSON.parse(localStorage.getItem('vexdial-contacts') || '[]'));
    setHistory(JSON.parse(localStorage.getItem('vexdial-history') || '[]'));
  }, []);

  useEffect(() => {
    const hist = JSON.parse(localStorage.getItem('vexdial-history') || '[]');
    setMissedCount(hist.filter((h: any) => h.type === 'missed').length);
  }, [history]);

  useEffect(() => {
    if (webrtc.localStream && localRef.current) localRef.current.srcObject = webrtc.localStream;
  }, [webrtc.localStream]);

  useEffect(() => {
    if (!webrtc.remoteStream) return;
    const el = audioRef.current;
    if (el) {
      el.srcObject = webrtc.remoteStream;
      el.muted = false;
      el.volume = 1;
      const tryPlay = () => el.play().catch(() => {});
      tryPlay();
      document.addEventListener('click', tryPlay, { once: true });
      document.addEventListener('touchstart', tryPlay, { once: true });
    }
    if (remoteRef.current) {
      remoteRef.current.srcObject = webrtc.remoteStream;
      remoteRef.current.play().catch(() => {});
    }
  }, [webrtc.remoteStream]);

  useEffect(() => {
    if (webrtc.status !== 'connected' || !webrtc.callStart) return;
    const i = setInterval(() => setDuration(Math.floor((Date.now() - webrtc.callStart!) / 1000)), 1000);
    return () => clearInterval(i);
  }, [webrtc.status, webrtc.callStart]);

  const logCall = (addr: string, type: string, dur = 0) => {
    const next = [{ address: addr, type, ts: Date.now(), duration: dur }, ...history].slice(0, 50);
    setHistory(next);
    localStorage.setItem('vexdial-history', JSON.stringify(next));
  };

  const resolve = async (input: string) => {
    const t = input.trim();
    if (!t.endsWith('.vex')) return t;
    try {
      const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
      const r = await fetch(`${base}/api/names/${encodeURIComponent(t.toLowerCase())}`);
      const data = await r.json();
      return data.address || t;
    } catch { return t; }
  };

  const call = async (video: boolean) => {
    if (!target.trim()) return alert('Enter address or name');
    const addr = await resolve(target);
    if (addr === target.trim() && target.endsWith('.vex')) return alert('Name not found');
    webrtc.startCall(addr, undefined, video);
  };

  const addContact = () => {
    const addr = prompt('Wallet address');
    if (!addr) return;
    const name = prompt('Name') || '';
    const next = [{ address: addr.trim(), name }, ...contacts.filter(c => c.address !== addr.trim())];
    setContacts(next);
    localStorage.setItem('vexdial-contacts', JSON.stringify(next));
  };

  const exportContacts = () => {
    const blob = new Blob([JSON.stringify(contacts, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vexbook.json';
    a.click();
  };

  const loadNames = async () => {
    try {
      const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
      const r = await fetch(`${base}/api/names`);
      const data = await r.json();
      setNamesList(Array.isArray(data) ? data : data.names || []);
    } catch {}
  };

  const requestNotification = async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  };

  const makeVexWallet = () => {
    const { identity: id, secret } = createLocalWallet();
    saveIdentity(id);
    setShowSecret(secret);
  };

  const loginWithKey = () => {
    const key = prompt('Paste your Vex private key (64 hex chars)');
    if (!key) return;
    const id = restoreFromSecret(key);
    if (!id) return alert('Invalid private key');
    saveIdentity(id);
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

  const connectEVM = async (name: string) => {
    const eth = (window as any).ethereum;
    if (!eth) return alert(name + ' not found');
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (accounts[0]) saveIdentity({ address: accounts[0], chain: 'eth', label: name });
    } catch { alert(name + ' failed'); }
  };

  const sendReaction = (emoji: string) => {
    setReactions(p => [...p, emoji]);
    setTimeout(() => setReactions(p => p.slice(1)), 2000);
  };

  if (!myAddress) return (
    <div className="min-h-screen bg-[#05070a] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-lg text-center fade-in">
        <img src="/logo.svg" alt="VexDial" className="w-24 h-24 mx-auto mb-4" />
        <h1 className="text-5xl font-bold tracking-tight text-white">VexDial</h1>
        <p className="mt-2 text-cyan-400 text-sm tracking-widest">WALLET-TO-WALLET CALLING</p>
        <p className="mt-4 text-gray-400 text-sm max-w-md mx-auto">Call, message, and video chat any wallet address. Works across Solana, Ethereum, BNB, ATOM, and .vex names. End-to-end encrypted. Non-custodial.</p>
        <div className="mt-8 text-left bg-white/5 rounded-2xl p-5 border border-white/10 text-sm space-y-2">
          <p className="font-medium text-cyan-300">How it works</p>
          <p>1. Connect any wallet or create a Vex Wallet</p>
          <p>2. Enter an address or name.vex</p>
          <p>3. Call or message instantly</p>
          <p className="text-xs text-gray-500 pt-1">Supports interchain calling. Quantumproof Vex Wallet uses hybrid post-quantum design inspired by Vexlore Quantumproof Chain. Your keys never leave your device.</p>
        </div>
        <div className="mt-8 space-y-3">
          <WalletMultiButton className="!w-full !justify-center !py-3 !rounded-xl" />
          <button onClick={makeVexWallet} className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium transition">Create Quantumproof Vex Wallet</button>
          <button onClick={loginWithKey} className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-medium transition">Login with Vex Private Key</button>
          <button onClick={() => connectEVM('MetaMask')} className="w-full py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-medium transition">Connect MetaMask</button>
          <button onClick={() => connectEVM('Trust Wallet')} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium transition">Connect Trust Wallet</button>
        </div>
        <p className="mt-6 text-xs text-gray-500">Non-custodial. Keys stay on your device.</p>
        <div className="mt-4 flex justify-center gap-6 text-sm">
          <a href="https://x.com/VexDial" className="text-cyan-400 hover:underline">X @VexDial</a>
          <a href="https://t.me/vexdial" className="text-cyan-400 hover:underline">Telegram</a>
        </div>
      </div>
    </div>
  );

  if (webrtc.status === 'ringing') return (
    <div className="min-h-screen bg-[#05070a] text-white flex items-center justify-center fade-in">
      <div className="bg-[#0f1218] border border-white/10 rounded-3xl p-12 text-center max-w-sm w-full shadow-2xl">
        <div className="w-24 h-24 mx-auto rounded-full bg-cyan-500/20 flex items-center justify-center mb-6 ring-animate">
          <span className="text-4xl">📞</span>
        </div>
        <h2 className="text-3xl font-semibold">Incoming Call</h2>
        <p className="text-gray-400 text-sm mt-3 break-all">{webrtc.remoteAddress}</p>
        <div className="flex gap-4 mt-10">
          <button onClick={() => { logCall(webrtc.remoteAddress || '', 'incoming', 0); webrtc.acceptCall(); }} className="flex-1 py-4 bg-emerald-600 rounded-2xl font-medium">Accept</button>
          <button onClick={webrtc.rejectCall} className="flex-1 py-4 bg-red-600 rounded-2xl font-medium">Decline</button>
        </div>
      </div>
    </div>
  );

  if (webrtc.status === 'calling' || webrtc.status === 'connected') return (
    <div className="min-h-screen bg-[#05070a] text-white flex flex-col fade-in">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40 backdrop-blur">
        <div>
          <span className="text-cyan-400 font-semibold text-lg">VexDial</span>
          <span className="ml-3 text-sm text-gray-400">{webrtc.status === 'calling' ? 'Calling…' : `${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`}</span>
        </div>
        <span className="text-xs text-gray-500 truncate max-w-[220px]">{webrtc.remoteAddress}</span>
      </header>
      <div className="flex-1 relative p-4">
        <audio ref={audioRef} autoPlay playsInline />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video md:aspect-auto border border-white/5">
            <video ref={localRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-3 left-3 text-xs bg-black/70 px-2.5 py-1 rounded-lg">You</span>
          </div>
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video md:aspect-auto border border-white/5">
            <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-3 left-3 text-xs bg-black/70 px-2.5 py-1 rounded-lg">Remote</span>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 p-4 bg-black/30 backdrop-blur">
        <div className="flex justify-center gap-3 mb-4 flex-wrap">
          <button onClick={() => audioRef.current?.play().catch(() => {})} className="px-5 py-2.5 bg-white/10 rounded-full text-sm">Speaker</button>
          <button onClick={webrtc.toggleMute} className="px-5 py-2.5 bg-white/10 rounded-full text-sm">{webrtc.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={webrtc.toggleCamera} className="px-5 py-2.5 bg-white/10 rounded-full text-sm">{webrtc.cameraOff ? 'Cam On' : 'Cam Off'}</button>
          <button onClick={webrtc.startScreenShare} className="px-5 py-2.5 bg-white/10 rounded-full text-sm">Share</button>
          <button onClick={() => { if (webrtc.callStart) logCall(webrtc.remoteAddress || target, webrtc.status === 'calling' ? 'outgoing' : 'incoming', Math.floor((Date.now() - webrtc.callStart) / 1000)); webrtc.hangup(); }} className="px-6 py-2.5 bg-red-600 rounded-full text-sm font-medium">End</button>
        </div>
        <div className="max-w-xl mx-auto">
          <div className="bg-white/5 rounded-xl p-3 h-28 overflow-y-auto text-sm mb-2">
            {webrtc.chat.map((m,i) => (<div key={i}><span className="text-cyan-400">{m.from?.slice(0,6)}</span> {m.text}</div>))}
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
    <div className="min-h-screen bg-[#05070a] text-white flex">
      <aside className="w-56 bg-[#0a0d12] border-r border-white/10 p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <img src="/logo.svg" alt="V" className="w-8 h-8" />
          <div>
            <p className="font-bold text-cyan-400">VexDial</p>
            <p className="text-xs text-gray-500">v1.0</p>
          </div>
        </div>
        <nav className="space-y-1 flex-1">
          {['dial','contacts','history','messages','names'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm capitalize ${tab===t ? 'bg-cyan-600/20 text-cyan-400' : 'text-gray-400 hover:bg-white/5'}`}>
              {t === 'contacts' ? 'VexBook' : t}
              {t === 'history' && missedCount > 0 && <span className="ml-2 text-xs bg-red-500 text-white px-1.5 rounded-full">{missedCount}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-white/10 text-xs text-gray-500">
          <p className="font-mono truncate">{myAddress?.slice(0,8)}…</p>
          <p className="text-emerald-400">P2P Secured</p>
        </div>
      </aside>

      <main className="flex-1 p-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-gray-500">VexDial › {tab}</p>
            <h1 className="text-xl font-semibold">Call Console</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-3 py-1 rounded-full ${webrtc.connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{webrtc.connected ? 'Signaling: Online' : 'Signaling: Offline'}</span>
            <span className="text-xs px-3 py-1 bg-white/10 rounded-full font-mono">{myAddress?.slice(0,6)}…</span>
            <button onClick={() => window.location.reload()} className="text-xs px-3 py-1 bg-white/10 rounded-lg">Reconnect</button>
            {connected ? <WalletMultiButton /> : <button onClick={clearIdentity} className="text-xs px-3 py-1 bg-white/10 rounded-lg">Logout</button>}
          </div>
        </header>

        {showSecret && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-sm">
            <p className="font-medium text-amber-300 mb-2">Save your private key</p>
            <p className="font-mono text-xs break-all">{showSecret}</p>
            <button onClick={() => setShowSecret(null)} className="mt-3 text-xs px-3 py-1 bg-amber-600 rounded-lg">Done</button>
          </div>
        )}

        {tab === 'dial' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400">🛡️</div>
                <div>
                  <p className="font-medium text-sm">End-to-End Encrypted WebRTC Session</p>
                  <p className="text-xs text-gray-500">Direct peer-to-peer audio and video. No phone numbers, no recordings.</p>
                </div>
                <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">DTLS-SRTP</span>
              </div>
              <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <p className="text-xs text-gray-500 mb-2">RECIPIENT ADDRESS OR DOMAIN</p>
                <input value={target} onChange={e => { setTarget(e.target.value); setOnlineStatus('unknown'); }} placeholder="Paste address or name.vex" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 mb-3 text-sm" />
                <div className="flex items-center gap-3 mb-4">
                  <button onClick={checkOnline} className="px-3 py-1.5 text-xs bg-white/10 rounded-lg">Check</button>
                  {onlineStatus !== 'unknown' && <span className={`text-xs ${onlineStatus==='online'?'text-emerald-400':'text-red-400'}`}>{onlineStatus}</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => call(false)} className="py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-medium text-sm">Start VexVoice</button>
                  <button onClick={() => call(true)} className="py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium text-sm">Start VexVideo</button>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-sm font-medium mb-3">VexBook Address Book</p>
                {contacts.length === 0 && <p className="text-xs text-gray-500">No contacts yet</p>}
                {contacts.slice(0,3).map(c => (
                  <button key={c.address} onClick={() => { setTarget(c.address); }} className="w-full text-left py-2 text-xs border-b border-white/5 last:border-0 hover:bg-white/5 rounded">
                    <p>{c.name || 'Unnamed'}</p>
                    <p className="text-gray-500 font-mono">{c.address.slice(0,10)}…</p>
                  </button>
                ))}
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-xs">
                <p className="font-medium mb-2">Diagnostic</p>
                <p className="text-gray-500">Signaling: {webrtc.connected ? 'Online' : 'Offline'}</p>
                <p className="text-gray-500">Encryption: DTLS-SRTP</p>
              </div>
            </div>
          </div>
        )}

        {tab === 'contacts' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10 max-w-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-medium">VexBook</h2>
              <div className="flex gap-2">
                <button onClick={exportContacts} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Export</button>
                <button onClick={addContact} className="text-xs px-3 py-1.5 bg-cyan-600 rounded-lg">Add</button>
              </div>
            </div>
            {contacts.length === 0 && <p className="text-sm text-gray-500">No contacts yet</p>}
            {contacts.map(c => (
              <div key={c.address} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm">{c.name || 'Unnamed'}</p>
                  <p className="text-xs text-gray-500 font-mono">{c.address.slice(0,12)}…</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setTarget(c.address); setTab('messages'); }} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Msg</button>
                  <button onClick={() => { setTarget(c.address); setTab('dial'); }} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Call</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'messages' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10 max-w-2xl">
            <h2 className="font-medium mb-4">Messages</h2>
            <div className="flex gap-2 mb-4">
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Address or name.vex" className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm" />
              <button onClick={addContact} className="px-3 py-2 bg-white/10 rounded-xl text-xs">Add</button>
            </div>
            <input value={msgSearch} onChange={e => setMsgSearch(e.target.value)} placeholder="Search messages" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm mb-3" />
            <div className="bg-black/40 rounded-xl p-3 h-48 overflow-y-auto text-sm mb-3 space-y-2">
              {webrtc.chat.filter(m => (m.to === target || m.from === target) && (!msgSearch || m.text?.toLowerCase().includes(msgSearch.toLowerCase()))).map((m,i) => (
                <div key={i} className={`flex ${m.from === myAddress ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-xl ${m.from === myAddress ? 'bg-cyan-600' : 'bg-white/10'}`}>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={async e => { e.preventDefault(); if (target.trim()) { const addr = await resolve(target); webrtc.sendChat(chatInput, addr); setChatInput(''); } }} className="flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm" placeholder="Message" />
              <button className="px-4 py-2 bg-cyan-600 rounded-xl text-sm">Send</button>
            </form>
          </div>
        )}

        {tab === 'names' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10 max-w-2xl">
            <h2 className="font-medium mb-4">.vex Names</h2>
            <button onClick={loadNames} className="w-full py-2 mb-3 bg-white/10 rounded-xl text-sm">Load Directory</button>
            <div className="max-h-40 overflow-y-auto text-sm mb-3">
              {namesList.map((n: any, i: number) => (
                <div key={i} className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-cyan-400">{n.name}</span>
                  <button onClick={() => { setTarget(n.address); setTab('dial'); }} className="text-xs px-2 py-0.5 bg-white/10 rounded">Call</button>
                </div>
              ))}
            </div>
            <form onSubmit={async e => {
              e.preventDefault();
              const name = prompt('Name (e.g. robin.vex)');
              if (!name || !myAddress) return;
              const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
              const r = await fetch(`${base}/api/names`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, address: myAddress }),
              });
              const data = await r.json();
              alert(data.ok ? 'Registered' : data.error);
            }}>
              <button className="w-full py-3 bg-cyan-600 rounded-xl font-medium text-sm">Register Name</button>
            </form>
          </div>
        )}

        {tab === 'history' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10 max-w-2xl">
            <h2 className="font-medium mb-4">History</h2>
            {history.length === 0 && <p className="text-sm text-gray-500">No calls yet</p>}
            {history.map((h,i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm font-mono">{h.address?.slice(0,12)}…</p>
                  <p className={`text-xs ${h.type==='missed'?'text-red-400':'text-gray-500'}`}>{h.type}{h.duration ? ` · ${Math.floor(h.duration/60)}:${String(h.duration%60).padStart(2,'0')}` : ''}</p>
                </div>
                <button onClick={() => { setTarget(h.address); setTab('dial'); }} className="text-xs px-3 py-1.5 bg-white/10 rounded-lg">Call</button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
