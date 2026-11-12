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
  const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
  const [nameSearch, setNameSearch] = useState('');
  const [myName, setMyName] = useState('');
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
    if (!contacts.length) return;
    const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
    contacts.forEach(async (c) => {
      try {
        const r = await fetch(`${base}/api/online/${encodeURIComponent(c.address)}`);
        const d = await r.json();
        setOnlineMap(m => ({ ...m, [c.address]: !!d.online }));
      } catch {}
    });
  }, [contacts]);

  useEffect(() => { if (tab === 'names') loadNames(); }, [tab]);

  useEffect(() => {
    if (!myAddress) return;
    const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
    fetch(`${base}/api/names`).then(r => r.json()).then(d => {
      const list = d.names || [];
      const mine = list.find((n: any) => n.address === myAddress);
      if (mine) setMyName(mine.name);
    }).catch(() => {});
  }, [myAddress, namesList]);



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
      remoteRef.current.muted = false;
      remoteRef.current.playsInline = true;
      remoteRef.current.play().catch(() => {});
    }
    webrtc.remoteStream.getAudioTracks().forEach(t => { t.enabled = true; });
    webrtc.remoteStream.getVideoTracks().forEach(t => { t.enabled = true; });
    // Extra force after short delay
    setTimeout(() => {
      if (audioRef.current) { audioRef.current.muted = false; audioRef.current.play().catch(()=>{}); }
      if (remoteRef.current) { remoteRef.current.muted = false; remoteRef.current.play().catch(()=>{}); }
    }, 500);
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
      const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
      const r = await fetch(`${base}/api/names/${encodeURIComponent(t.toLowerCase())}`);
      const data = await r.json();
      return data.address || t;
    } catch { return t; }
  };

  const call = async (video: boolean) => {
    if (!target.trim()) return alert('Enter address or name');
    const addr = await resolve(target);
    if (addr === target.trim() && target.endsWith('.vex')) return alert('Name not found');
    webrtc.startCall(addr, video);
  };

  const addContact = async () => {
    const input = prompt('Wallet address or name.vex');
    if (!input) return;
    const addr = await resolve(input);
    if (addr === input.trim() && input.endsWith('.vex')) return alert('Name not found');
    const name = prompt('Nickname') || (input.endsWith('.vex') ? input : '');
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
      const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
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
      const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
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

  const copyAddress = () => {
    if (!myAddress) return;
    navigator.clipboard.writeText(myAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sendReaction = (emoji: string) => {
    setReactions(p => [...p, emoji]);
    setTimeout(() => setReactions(p => p.slice(1)), 2000);
  };

  const navItems = ['dial','contacts','history','messages','names','how','about','privacy'];

  if (!myAddress) return (
    <div className="min-h-screen bg-[#05070a] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-lg text-center fade-in">
        <img src="/logo.svg" alt="VexDial" className="w-24 h-24 mx-auto mb-4" />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white">VexDial</h1>
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
    <div className="min-h-screen bg-[#05070a] text-white flex items-center justify-center p-4 fade-in">
      <div className="bg-[#0f1218] border border-white/10 rounded-3xl p-8 sm:p-12 text-center max-w-sm w-full shadow-2xl">
        <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-full bg-cyan-500/20 flex items-center justify-center mb-6 ring-animate">
          <span className="text-3xl sm:text-4xl">📞</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold">Incoming {webrtc.isVideoCall ? 'Video' : 'Voice'} Call</h2>
        <p className="text-cyan-400 text-sm mt-1">{webrtc.isVideoCall ? '📹 Video' : '📞 Voice'}</p>
        <p className="text-gray-400 text-sm mt-3 break-all">{webrtc.remoteAddress}</p>
        <div className="flex gap-3 mt-8">
          <button onClick={() => { logCall(webrtc.remoteAddress || '', 'incoming', 0); webrtc.acceptCall(); }} className="flex-1 py-4 bg-emerald-600 rounded-2xl font-medium">Accept</button>
          <button onClick={webrtc.rejectCall} className="flex-1 py-4 bg-red-600 rounded-2xl font-medium">Decline</button>
        </div>
      </div>
    </div>
  );

  if (webrtc.status === 'calling' || webrtc.status === 'connected') return (
    <div className="min-h-screen bg-[#05070a] text-white flex flex-col fade-in">
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-black/40 backdrop-blur">
        <div>
          <span className="text-cyan-400 font-semibold">VexDial</span>
          <span className="ml-2 text-sm text-gray-400">{webrtc.status === 'calling' ? 'Calling…' : `${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`}</span>
        </div>
        <span className="text-xs text-gray-500 truncate max-w-[140px] sm:max-w-[220px]">{webrtc.remoteAddress}</span>
      </header>
      <div className="flex-1 relative p-3 sm:p-4">
        <audio ref={audioRef} autoPlay playsInline />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-full">
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video md:aspect-auto border border-white/5">
            <video ref={localRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 text-xs bg-black/70 px-2 py-1 rounded">You</span>
          </div>
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video md:aspect-auto border border-white/5">
            <video ref={remoteRef} autoPlay playsInline muted={false} className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 text-xs bg-black/70 px-2 py-1 rounded">Remote</span>
          </div>
        </div>
        <button onClick={() => {
          if (audioRef.current) { audioRef.current.muted = false; audioRef.current.volume = 1; audioRef.current.play().catch(()=>{}); }
          if (remoteRef.current) { remoteRef.current.muted = false; remoteRef.current.playsInline = true; remoteRef.current.play().catch(()=>{}); }
          if (localRef.current) { localRef.current.play().catch(()=>{}); }
        }} className="absolute top-4 right-4 px-3 py-1.5 bg-cyan-600 text-xs rounded-full z-10">Tap for Audio</button>
      </div>
      <div className="border-t border-white/10 p-3 sm:p-4 bg-black/30 backdrop-blur">
        <div className="flex justify-center gap-2 mb-3 flex-wrap">
          <button onClick={() => audioRef.current?.play().catch(() => {})} className="px-4 py-2 bg-white/10 rounded-full text-xs sm:text-sm">Speaker</button>
          <button onClick={webrtc.toggleMute} className="px-4 py-2 bg-white/10 rounded-full text-xs sm:text-sm">{webrtc.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={webrtc.toggleCamera} className="px-4 py-2 bg-white/10 rounded-full text-xs sm:text-sm">{webrtc.cameraOff ? 'Cam On' : 'Cam Off'}</button>
          <button onClick={webrtc.startScreenShare} className="px-4 py-2 bg-white/10 rounded-full text-xs sm:text-sm">Share</button>
          <button onClick={() => { if (webrtc.callStart) logCall(webrtc.remoteAddress || target, webrtc.status === 'calling' ? 'outgoing' : 'incoming', Math.floor((Date.now() - webrtc.callStart) / 1000)); webrtc.hangup(); }} className="px-4 py-2 bg-red-600 rounded-full text-xs sm:text-sm font-medium">End</button>
        </div>
        <div className="max-w-xl mx-auto">
          <div className="bg-white/5 rounded-xl p-2 h-20 overflow-y-auto text-sm mb-2">
            {webrtc.chat.map((m,i) => (<div key={i}><span className="text-cyan-400">{m.from?.slice(0,6)}</span> {m.text}</div>))}
          </div>
          <form onSubmit={e => { e.preventDefault(); webrtc.sendChat(chatInput); setChatInput(''); }} className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="Message" />
            <button className="px-3 py-2 bg-cyan-600 rounded-xl text-sm">Send</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#05070a] text-white flex flex-col md:flex-row">
      <aside className={`md:w-56 bg-[#0a0d12] border-b md:border-b-0 md:border-r border-white/10 p-3 md:p-4 flex flex-col ${menuOpen ? 'block' : 'hidden md:flex'}`}>
        <div className="flex items-center justify-between md:justify-start gap-2 mb-4 md:mb-8">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="V" className="w-7 h-7" />
            <p className="font-bold text-cyan-400">VexDial</p>
          </div>
          <button onClick={() => setMenuOpen(false)} className="md:hidden text-gray-400">✕</button>
        </div>
        <nav className="space-y-1 flex-1">
          {navItems.map(t => (
            <button key={t} onClick={() => { setTab(t); setMenuOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm capitalize ${tab===t ? 'bg-cyan-600/20 text-cyan-400' : 'text-gray-400 hover:bg-white/5'}`}>
              {t === 'contacts' ? 'VexBook' : t === 'how' ? 'How to Use' : t}
              {t === 'history' && missedCount > 0 && <span className="ml-2 text-xs bg-red-500 text-white px-1.5 rounded-full">{missedCount}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-4 pt-4 border-t border-white/10 text-xs text-gray-500">
          <button onClick={copyAddress} className="w-full text-left font-mono truncate hover:text-cyan-400">{copied ? 'Copied' : myAddress?.slice(0,10) + '…'}</button>
          <p className="text-emerald-400 mt-1">P2P Secured</p>
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <header className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setMenuOpen(true)} className="md:hidden p-2 bg-white/10 rounded-lg">☰</button>
            <div>
              <p className="text-xs text-gray-500 hidden sm:block">VexDial › {tab}</p>
              <h1 className="text-lg sm:text-xl font-semibold capitalize">{tab === 'dial' ? 'Call' : tab}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className={`text-xs px-2 py-1 rounded-full ${webrtc.connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{webrtc.connected ? 'On' : 'Off'}</span>
            <button onClick={copyAddress} className="text-xs px-2 py-1 bg-white/10 rounded-full font-mono">{copied ? 'Copied' : myAddress?.slice(0,6) + '…'}</button>
            <button onClick={() => window.location.reload()} className="text-xs px-2 py-1 bg-white/10 rounded-lg hidden sm:block">Reconnect</button>
            {connected ? <WalletMultiButton /> : <button onClick={clearIdentity} className="text-xs px-2 py-1 bg-white/10 rounded-lg">Logout</button>}
          </div>
        </header>

        {showSecret && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4 text-sm">
            <p className="font-medium text-amber-300 mb-2">Save your private key</p>
            <p className="font-mono text-xs break-all">{showSecret}</p>
            <button onClick={() => setShowSecret(null)} className="mt-3 text-xs px-3 py-1 bg-amber-600 rounded-lg">Done</button>
          </div>
        )}

        {tab === 'dial' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">🛡️</div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">End-to-End Encrypted</p>
                  <p className="text-xs text-gray-500">Direct peer-to-peer. No phone numbers.</p>
                </div>
                <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded shrink-0">DTLS</span>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10">
                <p className="text-xs text-gray-500 mb-2">RECIPIENT ADDRESS OR DOMAIN</p>
                <input value={target} onChange={e => { setTarget(e.target.value); setOnlineStatus('unknown'); }} placeholder="Paste address or name.vex" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 mb-3 text-sm" />
                {target.endsWith('.vex') && <p className="text-xs text-cyan-400 mb-2">Will resolve {target} to address</p>}
                <div className="flex items-center gap-3 mb-4">
                  <button onClick={checkOnline} className="px-3 py-1.5 text-xs bg-white/10 rounded-lg">Check</button>
                  {onlineStatus !== 'unknown' && <span className={`text-xs ${onlineStatus==='online'?'text-emerald-400':'text-red-400'}`}>{onlineStatus}</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => call(false)} className="py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-medium text-sm">📞 VexVoice</button>
                  <button onClick={() => call(true)} className="py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium text-sm">📹 VexVideo</button>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium">Your Address</p>
                  <div className="flex gap-1">
                    <button onClick={copyAddress} className="text-xs px-2 py-1 bg-white/10 rounded">{copied ? 'Copied' : 'Copy'}</button>
                    <button onClick={() => myAddress && navigator.share?.({ title: 'Call me on VexDial', text: myAddress })} className="text-xs px-2 py-1 bg-white/10 rounded">Share</button>
                  </div>
                </div>
                {myName && <p className="text-cyan-400 font-medium text-sm mb-1">{myName}</p>}
                <p className="font-mono text-xs break-all text-gray-300 mb-3">{myAddress}</p>
                {myAddress && (
                  <div className="flex flex-col items-center">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(myName || myAddress)}`} alt="QR" className="rounded-lg bg-white p-1" />
                    <p className="text-[10px] text-gray-500 mt-1">{myName ? 'Scan to call ' + myName : 'Scan to call'}</p>
                  </div>
                )}
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-sm font-medium mb-2">VexBook</p>
                {contacts.length === 0 && <p className="text-xs text-gray-500">No contacts yet</p>}
                {contacts.slice(0,3).map(c => (
                  <button key={c.address} onClick={() => setTarget(c.address)} className="w-full text-left py-2 text-xs border-b border-white/5 last:border-0 hover:bg-white/5 rounded flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500 shrink-0" id={`dot-${c.address.slice(0,6)}`} />
                    <div>
                      <p>{c.name || 'Unnamed'}</p>
                      <p className="text-gray-500 font-mono">{c.address.slice(0,10)}…</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'contacts' && (
          <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10">
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
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${onlineMap[c.address] ? 'bg-emerald-400' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-sm truncate">{c.name || 'Unnamed'}</p>
                    <p className="text-xs text-gray-500 font-mono">{c.address.slice(0,10)}…</p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => navigator.clipboard.writeText(c.address)} className="text-xs px-2 py-1 bg-white/10 rounded">Copy</button>
                  <button onClick={() => {
                    const name = prompt('New name', c.name || '');
                    if (name === null) return;
                    const next = contacts.map(x => x.address === c.address ? { ...x, name } : x);
                    setContacts(next);
                    localStorage.setItem('vexdial-contacts', JSON.stringify(next));
                  }} className="text-xs px-2 py-1 bg-white/10 rounded">Edit</button>
                  <button onClick={() => {
                    if (!confirm('Delete contact?')) return;
                    const next = contacts.filter(x => x.address !== c.address);
                    setContacts(next);
                    localStorage.setItem('vexdial-contacts', JSON.stringify(next));
                  }} className="text-xs px-2 py-1 bg-red-600 rounded">Del</button>
                  <button onClick={() => { setTarget(c.address); setTab('messages'); }} className="text-xs px-2 py-1 bg-white/10 rounded">Msg</button>
                  <button onClick={() => { setTarget(c.address); setTab('dial'); }} className="text-xs px-2 py-1 bg-white/10 rounded">Call</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'messages' && (
          <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10">
            <h2 className="font-medium mb-4">Messages</h2>
            <div className="flex gap-2 mb-3">
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Address or name.vex" className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm" />
              <button onClick={addContact} className="px-3 py-2 bg-white/10 rounded-xl text-xs">Add</button>
            </div>
            <input value={msgSearch} onChange={e => setMsgSearch(e.target.value)} placeholder="Search" className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm mb-3" />
            <div className="bg-black/40 rounded-xl p-3 h-40 overflow-y-auto text-sm mb-3 space-y-2">
              {webrtc.chat.filter(m => (m.to === target || m.from === target) && (!msgSearch || m.text?.toLowerCase().includes(msgSearch.toLowerCase()))).map((m,i) => (
                <div key={i} className={`flex ${m.from === myAddress ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-xl ${m.from === myAddress ? 'bg-cyan-600' : 'bg-white/10'}`}>
                    <p>{m.text}</p>
                    {m.from === myAddress && <p className="text-[10px] opacity-70 mt-0.5">{m.status || 'sent'}</p>}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={async e => { e.preventDefault(); if (target.trim()) { const addr = await resolve(target); webrtc.sendChat(chatInput, addr); setChatInput(''); } }} className="flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="Message" />
              <button className="px-3 py-2 bg-cyan-600 rounded-xl text-sm">Send</button>
            </form>
          </div>
        )}

        {tab === 'names' && (
          <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10">
            <h2 className="font-medium mb-4">.vex Names</h2>
            <input value={nameSearch} onChange={e => setNameSearch(e.target.value)} placeholder="Search names" className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm mb-3" />
            <div className="max-h-48 overflow-y-auto text-sm mb-3 space-y-1">
              {namesList.filter((n: any) => !nameSearch || n.name?.includes(nameSearch.toLowerCase())).map((n: any, i: number) => {
                const premium = ['elon.vex','trump.vex','binance.vex','solana.vex','vexlore.vex','vexdial.vex'].includes(n.name);
                return (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/5">
                    <div className="min-w-0">
                      <p className="text-cyan-400 truncate">{n.name} {premium && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1 rounded">PREMIUM</span>}</p>
                      <p className="text-xs text-gray-500 font-mono">{n.address?.slice(0,12)}…</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => navigator.clipboard.writeText(n.address)} className="text-xs px-2 py-1 bg-white/10 rounded">Copy</button>
                      <button onClick={() => { setTarget(n.address); setTab('dial'); }} className="text-xs px-2 py-1 bg-cyan-600 rounded">Call</button>
                      <button onClick={async () => {
                        if (!confirm('Delete ' + n.name + '?')) return;
                        const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
                        const r = await fetch(`${base}/api/names/${encodeURIComponent(n.name)}`, {
                          method: 'DELETE',
                          headers: { 'x-admin': myAddress || '' }
                        });
                        const d = await r.json();
                        alert(d.ok ? 'Deleted' : d.error);
                        if (d.ok) loadNames();
                      }} className="text-xs px-2 py-1 bg-red-600 rounded">Del</button>
                    </div>
                  </div>
                );
              })}
              {namesList.length === 0 && <p className="text-xs text-gray-500">No names yet</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={async () => {
                const name = prompt('Name (e.g. robin.vex)');
                if (!name || !myAddress) return;
                const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
                const r = await fetch(`${base}/api/names`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, address: myAddress }) });
                const data = await r.json();
                alert(data.ok ? 'Registered' : data.error);
                if (data.ok) loadNames();
              }} className="py-3 bg-cyan-600 rounded-xl font-medium text-sm">Register Name</button>
              <button onClick={async () => {
                const name = prompt('Premium name to request (e.g. elon.vex)');
                if (!name || !myAddress) return;
                const base = process.env.NEXT_PUBLIC_SIGNALING_URL || 'https://vexdial-production.up.railway.app';
                const r = await fetch(`${base}/api/names/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, address: myAddress }) });
                const data = await r.json();
                alert(data.message || data.error || 'Sent');
              }} className="py-3 bg-amber-600 rounded-xl font-medium text-sm">Request Premium</button>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10">
            <h2 className="font-medium mb-4">History</h2>
            {history.length === 0 && <p className="text-sm text-gray-500">No calls yet</p>}
            {history.map((h,i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-mono truncate">{h.address?.slice(0,12)}…</p>
                  <p className={`text-xs ${h.type==='missed'?'text-red-400':'text-gray-500'}`}>{h.type}{h.duration ? ` · ${Math.floor(h.duration/60)}:${String(h.duration%60).padStart(2,'0')}` : ''}</p>
                </div>
                <button onClick={() => { setTarget(h.address); setTab('dial'); }} className="text-xs px-2 py-1 bg-white/10 rounded shrink-0">Call</button>
              </div>
            ))}
          </div>
        )}

        
        {tab === 'how' && (
          <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10 space-y-4 text-sm">
            <h2 className="font-medium text-lg">How to Use VexDial</h2>
            <div>
              <p className="text-cyan-400 font-medium mb-1">1. Connect</p>
              <p className="text-gray-400">Connect Phantom, Solflare, or any wallet. Or paste any address (Solana, Ethereum, BNB, Bitcoin, etc.). Your address is your phone number.</p>
            </div>
            <div>
              <p className="text-cyan-400 font-medium mb-1">2. Call anyone</p>
              <p className="text-gray-400">Enter their wallet address or .vex name and tap VexVoice or VexVideo. Works across chains — Solana can call Ethereum, BNB, etc.</p>
            </div>
            <div>
              <p className="text-cyan-400 font-medium mb-1">3. Get a .vex name</p>
              <p className="text-gray-400">Go to Names and register one name per wallet (e.g. robin.vex). Others can call you by that name. Premium names are admin-controlled.</p>
            </div>
            <div>
              <p className="text-cyan-400 font-medium mb-1">4. Message</p>
              <p className="text-gray-400">Use the Messages tab to chat without a call. Messages are private between the two addresses.</p>
            </div>
            <div>
              <p className="text-cyan-400 font-medium mb-1">5. Stay online</p>
              <p className="text-gray-400">Keep the site open so others can reach you. Green dot = online. You can also share your QR code.</p>
            </div>
            <div className="pt-2 border-t border-white/10">
              <p className="text-xs text-gray-500">Interchain · End-to-end encrypted · No phone numbers · Your wallet is your identity</p>
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div className="bg-white/5 rounded-2xl p-5 sm:p-8 border border-white/10 space-y-5">
            <h2 className="text-xl font-semibold">About VexDial</h2>
            <p className="text-gray-400 text-sm leading-relaxed">VexDial is a wallet-to-wallet calling and messaging platform. Your wallet address is your phone number. No phone numbers, no central accounts, no middlemen.</p>
            <div className="space-y-2 text-sm">
              <p><span className="text-cyan-400">Built by</span> Vexlore</p>
              <p><span className="text-cyan-400">Features</span> Voice, video, messages, .vex names, interchain calling</p>
              <p><span className="text-cyan-400">Encryption</span> End-to-end via WebRTC DTLS-SRTP</p>
              <p><span className="text-cyan-400">Custody</span> Non-custodial. Keys never leave your device.</p>
            </div>
            <div className="flex gap-3 pt-2">
              <a href="https://x.com/VexDial" className="px-4 py-2 bg-cyan-600 rounded-lg text-sm">X @VexDial</a>
              <a href="https://t.me/vexdial" className="px-4 py-2 bg-blue-600 rounded-lg text-sm">Telegram</a>
            </div>
          </div>
        )}

        {tab === 'privacy' && (
          <div className="bg-white/5 rounded-2xl p-5 sm:p-8 border border-white/10 space-y-4 text-sm text-gray-400 leading-relaxed">
            <h2 className="text-xl font-semibold text-white">Privacy Policy</h2>
            <p>VexDial is non-custodial. We do not store your private keys, seed phrases, or call content.</p>
            <p><span className="text-white">Calls and messages</span> are peer-to-peer via WebRTC. Media is encrypted end-to-end and never touches our servers.</p>
            <p><span className="text-white">Signaling</span> uses a temporary WebSocket connection to exchange connection details only. No call audio or video is recorded or stored.</p>
            <p><span className="text-white">.vex names</span> and online presence are stored on the signaling server so others can find you. You can request deletion by contacting us.</p>
            <p><span className="text-white">Local data</span> such as contacts and call history stay in your browser only.</p>
            <p><span className="text-white">Wallets</span> connect via standard wallet adapters. We never receive or transmit your private keys.</p>
            <p>By using VexDial you agree to this policy. Last updated November 2026.</p>
            <div className="flex gap-4 pt-2">
              <a href="https://x.com/VexDial" className="text-cyan-400">X @VexDial</a>
              <a href="https://t.me/vexdial" className="text-cyan-400">Telegram</a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
