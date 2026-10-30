'use client';
import { useState, useEffect } from 'react';

export type Chain = 'sol' | 'eth' | 'btc' | 'bnb' | 'vex';

export interface VexIdentity {
  address: string;
  chain: Chain;
  label: string;
}

function randomBytes(n: number) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createLocalWallet(): { identity: VexIdentity; secret: string } {
  const secret = toHex(randomBytes(32));
  const address = 'vex_' + toHex(randomBytes(16)).slice(0, 20);
  return {
    identity: { address, chain: 'vex', label: 'Vex Wallet' },
    secret,
  };
}

export function useIdentity() {
  const [identity, setIdentity] = useState<VexIdentity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vexdial-identity');
      if (saved) setIdentity(JSON.parse(saved));
    } catch {}
    setReady(true);
  }, []);

  const save = (id: VexIdentity) => {
    setIdentity(id);
    localStorage.setItem('vexdial-identity', JSON.stringify(id));
  };

  const clear = () => {
    setIdentity(null);
    localStorage.removeItem('vexdial-identity');
  };

  return { identity, ready, save, clear };
}
