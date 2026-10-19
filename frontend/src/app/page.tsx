'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { resolveSolDomain, resolveVexDomain, reverseVex } from '../lib/sns';

export default function Home() {
  const { publicKey, connected } = useWallet();
  const myAddress = publicKey?.toBase58() || null;
  const webrtc = useWebRTC(myAddress);
  const [target, setTarget] = useState('');
  const [tab, setTab] = useState('dial');
  const [contacts, setContacts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [myVexName, setMyVexName] = useState<string | null>(null);
  const [callerTune, setCallerTune] = useState('classic');
  const [withVideo, setWithVideo] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [mounted, setMounted] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setContacts(JSON.parse(localStorage.getItem('vexdial-contacts') || '[]'));
    setHistory(JSON.parse(localStorage.getItem('vexdial-history') || '[]'));
  }, []);

  useEffect(() => {
    if (myAddress) reverseVex(myAddress).then(r => setMyVexName(r.name));
  }, [myAddress]);

  useEffect(() => {
    if (webrtc.status !== 'connected' || !webrtc.callStart) return;
    const iv = setInterval(() => setCallDuration(Math.floor((Date.now() - (webrtc.callStart as number)) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [webrtc.status, webrtc.callStart]);

  useEffect(() => {
    if (webrtc.localStream && localVideo.current) {
      localVideo.current.srcObject = webrtc.localStream;
      localVideo.current.play?.().catch(() => {});
    }
  }, [webrtc.localStream]);

  useEffect(() => {
    if (webrtc.remoteStream && remoteVideo.current) {
      remoteVideo.current.srcObject = webrtc.remoteStream;
      remoteVideo.current.muted = false;
      remoteVideo.current.play?.().catch(() => {});
    }
    if (webrtc.remoteStream && remoteAudio.current) {
      remoteAudio.current.srcObject = webrtc.remoteStream;
      remoteAudio.current.muted = false;
      remoteAudio.current.play?.().catch(() => {});
    }
  }, [webrtc.remoteStream]);

  const getDisplayName = (addr: string) => {
    const c = contacts.find(x => x.address === addr);
    return c?.name || (addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : '');
  };

  const handleCall = async () => {
    let addr = target.trim();
    if (addr.endsWith('.sol') || addr.endsWith('.sns')) {
      const resolved = await resolveSolDomain(addr);
      if (!resolved) return alert('Could not resolve domain');
      addr = resolved;
    } else if (addr.endsWith('.vex')) {
      const resolved = await resolveVexDomain(addr);
      if (!resolved) return alert('Could not resolve .vex');
      addr = resolved.address;
    }
    if (!addr || addr.length < 32) return alert('Enter valid address');
    const log = { address: addr, type: 'outgoing', ts: Date.now(), name: target };
    const next = [log, ...history].slice(0, 50);
    setHistory(next);
    localStorage.setItem('vexdial-history', JSON.stringify(next));
    webrtc.startCall(addr, undefined, withVideo);
  };

  const addContact = () => {
    const addr = prompt('Wallet address');
    if (!addr) return;
    const name = prompt('Name') || '';
    const next = [{ address: addr, name }, ...contacts.filter(c => c.address !== addr)];
    setContacts(next);
    localStorage.setItem('vexdial-contacts', JSON.stringify(next));
  };

  const inCall = webrtc.status === 'connected' || webrtc.status === 'calling';
  const isRinging = webrtc.status === 'ringing';

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400">VexDial</h1>
            {myVexName && <p className="text-xs text-cyan-400">{myVexName}</p>}
          </div>
          <div className="flex items-center gap-3">
            {connected && <span className="text-xs text-cyan-400">{myAddress?.slice(0,6)}...{myAddress?.slice(-4)}</span>}
            {mounted && <WalletMultiButton />}
          </div>
        </header>

        {!connected ? (
          <div className="bg-gray-900/70 p-12 text-center rounded-2xl border border-cyan-500/20">
            <p className="text-xl mb-4">Connect your Solana wallet</p>
            <p className="text-sm text-gray-400 mb-4">Your wallet is your phone number</p>
            {isWalletBrowser && (
              <div className="bg-yellow-900/50 border border-yellow-600 rounded-lg p-4 mb-4 text-sm">
                <p className="font-semibold mb-2">You're inside a wallet browser</p>
                <p>Camera and calls don't work here.</p>
                <button
                  onClick={() => window.open(window.location.href, '_blank')}
                  className="mt-3 px-6 py-2 bg-cyan-600 rounded-full"
                >
                  Open in Chrome / Safari
                </button>
              </div>
            )}
          </div>
        ) : isRinging ? (
          <div className="bg-gray-900/70 p-12 text-center rounded-2xl border border-cyan-500/20">
            <p className="text-xl mb-4">Connect your Solana wallet</p>
            <p className="text-sm text-gray-400">Your wallet is your phone number</p>
          </div>
        ) : isRinging ? (
          <div className="bg-gray-900/70 p-8 text-center rounded-2xl border border-cyan-500/20">
            <p className="text-xl mb-4">Incoming call from {webrtc.remoteAddress ? getDisplayName(webrtc.remoteAddress) : '...'}</p>
            <div className="flex flex-col gap-3 items-center">
              <div className="flex justify-center gap-4">
                <button onClick={webrtc.acceptCall} className="px-8 py-3 bg-green-600 rounded-full text-lg">Accept</button>
                <button onClick={webrtc.rejectCall} className="px-8 py-3 bg-red-600 rounded-full text-lg">Reject</button>
              </div>
              <button
                onClick={() => window.open(window.location.href, '_blank')}
                className="mt-2 px-6 py-2 bg-cyan-700 rounded-full text-sm"
              >
                Open in Browser (if Accept fails)
              </button>
              <p className="text-xs text-gray-400 mt-1">Wallet browsers block camera/mic. Use Chrome or Safari for calls.</p>
            </div>
          </div>
        ) : inCall ? (
          <div className="bg-gray-900/70 p-8 text-center rounded-2xl border border-cyan-500/20">
            <p className="text-xl mb-4">Incoming call from {webrtc.remoteAddress ? getDisplayName(webrtc.remoteAddress) : '...'}</p>
            <div className="flex justify-center gap-4">
              <button onClick={webrtc.acceptCall} className="px-8 py-3 bg-green-600 rounded-full text-lg">Accept</button>
              <button onClick={webrtc.rejectCall} className="px-8 py-3 bg-red-600 rounded-full text-lg">Reject</button>
            </div>
          </div>
        ) : inCall ? (
          <div className="bg-gray-900/70 p-4 rounded-2xl border border-cyan-500/20">
            <audio ref={remoteAudio} autoPlay playsInline />
            <div className="text-center mb-2 text-sm text-cyan-400">
              {webrtc.status === 'calling' && 'Calling...'}
              {webrtc.status === 'connected' && `Connected ${Math.floor(callDuration/60)}:${String(callDuration%60).padStart(2,'0')}`}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
                <video ref={localVideo} autoPlay muted playsInline className="w-full h-full object-cover" />
                <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-1 rounded">You</span>
              </div>
              <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
                <video ref={remoteVideo} autoPlay playsInline className="w-full h-full object-cover" />
                <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-1 rounded">{webrtc.remoteAddress ? getDisplayName(webrtc.remoteAddress) : '...'}</span>
              </div>
            </div>
            <div className="flex justify-center gap-3 mb-4">
              <button onClick={webrtc.toggleMute} className="px-4 py-2 rounded-full bg-gray-800">{webrtc.muted ? 'Unmute' : 'Mute'}</button>
              <button onClick={webrtc.toggleCamera} className="px-4 py-2 rounded-full bg-gray-800">{webrtc.cameraOff ? 'Cam On' : 'Cam Off'}</button>
              <button onClick={webrtc.hangup} className="px-6 py-2 rounded-full bg-red-600">Hangup</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); webrtc.sendChat(chatInput); setChatInput(''); }} className="flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Message..." className="flex-1 bg-black/50 border border-cyan-500/30 rounded px-3 py-2 text-sm" />
              <button type="submit" className="px-4 py-2 bg-cyan-600 rounded text-sm">Send</button>
            </form>
          </div>
        ) : (
          <div>
            <div className="flex gap-2 mb-4">
              <button onClick={() => setTab('dial')} className={`px-4 py-2 rounded-lg text-sm ${tab === 'dial' ? 'bg-cyan-600' : 'bg-gray-800'}`}>Dial</button>
              <button onClick={() => setTab('contacts')} className={`px-4 py-2 rounded-lg text-sm ${tab === 'contacts' ? 'bg-cyan-600' : 'bg-gray-800'}`}>VexBook</button>
              <button onClick={() => setTab('history')} className={`px-4 py-2 rounded-lg text-sm ${tab === 'history' ? 'bg-cyan-600' : 'bg-gray-800'}`}>History</button>
            </div>

            {tab === 'dial' && (
              <div className="bg-gray-900/70 p-6 rounded-2xl border border-cyan-500/20">
                <h2 className="text-xl mb-4">Call someone</h2>
                <div className="flex gap-2 mb-4">
                  <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Wallet, name.sol or name.vex" className="flex-1 bg-black/50 border border-cyan-500/30 rounded-lg px-4 py-3" />
                  <button onClick={handleCall} className="px-6 py-3 bg-cyan-600 rounded-lg">Start Call</button>
                </div>
                <div className="flex gap-4 text-sm items-center">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={withVideo} onChange={e => setWithVideo(e.target.checked)} /> Video</label>
                </div>
              </div>
            )}

            {tab === 'contacts' && (
              <div className="bg-gray-900/70 p-6 rounded-2xl border border-cyan-500/20">
                <div className="flex justify-between mb-4">
                  <h2 className="text-xl">VexBook</h2>
                  <button onClick={addContact} className="px-4 py-2 bg-cyan-600 rounded text-sm">Add</button>
                </div>
                {contacts.map(c => (
                  <div key={c.address} className="flex justify-between items-center bg-black/40 rounded-lg p-3 mb-2">
                    <div>
                      <p>{c.name || 'Unnamed'}</p>
                      <p className="text-xs text-gray-400">{c.address.slice(0,8)}...</p>
                    </div>
                    <button onClick={() => { setTarget(c.address); setTab('dial'); }} className="px-3 py-1 bg-cyan-700 rounded text-xs">Call</button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'history' && (
              <div className="bg-gray-900/70 p-6 rounded-2xl border border-cyan-500/20">
                <h2 className="text-xl mb-4">History</h2>
                {history.map((h, i) => (
                  <div key={i} className="flex justify-between items-center bg-black/40 rounded-lg p-3 mb-2">
                    <div>
                      <p>{h.name || getDisplayName(h.address)}</p>
                      <p className="text-xs text-gray-400">{h.type}</p>
                    </div>
                    <button onClick={() => { setTarget(h.address); setTab('dial'); }} className="px-3 py-1 bg-cyan-700 rounded text-xs">Call</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
