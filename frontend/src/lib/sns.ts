import { Connection, clusterApiUrl } from '@solana/web3.js';
import { resolve } from '@bonfida/spl-name-service/domain';

const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
const SIGNALING = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

export async function resolveSolDomain(name: string): Promise<string | null> {
  if (!name.endsWith('.sol') && !name.endsWith('.sns')) return null;
  try {
    const owner = await resolve(connection, name);
    return owner.toBase58();
  } catch (e) {
    console.warn('SNS resolve failed:', e);
    return null;
  }
}

export async function resolveVexDomain(name: string): Promise<{address: string, verified: boolean} | null> {
  if (!name.endsWith('.vex')) return null;
  try {
    const res = await fetch(`${SIGNALING}/api/vex/resolve/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { address: data.address, verified: data.verified };
  } catch {
    return null;
  }
}

export async function reverseVex(address: string): Promise<{name: string | null, verified: boolean}> {
  try {
    const res = await fetch(`${SIGNALING}/api/vex/reverse/${address}`);
    const data = await res.json();
    return { name: data.name, verified: data.verified || false };
  } catch {
    return { name: null, verified: false };
  }
}
