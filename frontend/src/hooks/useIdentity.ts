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
  const bytes = randomBytes(28);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + toHex(bytes));
  let addr = '';
  while (num > 0n) {
    addr = alphabet[Number(num % 58n)] + addr;
    num = num / 58n;
  }
  const address = (addr.padStart(40, '1').slice(0, 40)) + 'vex';
  return {
    identity: { address, chain: 'sol', label: 'Vex Wallet' },
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
