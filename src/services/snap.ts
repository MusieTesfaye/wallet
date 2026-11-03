// MetaMask, through the SENA Snap.
//
// MetaMask cannot add SENA as a network: its network list is for chains that
// speak Ethereum's format. A Snap is a plug-in that teaches it a new chain.
// The SENA Snap (snap/ in this repository) derives an Ed25519 key from the
// user's MetaMask recovery phrase, shows each transaction in MetaMask before
// signing it, and signs with SENA's own code. The wallet builds transactions
// and submits them; MetaMask only ever signs.

import { config } from '../config';
import type { SnapAccount } from './auth';

interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<any>;
}

let provider: Eip1193 | null = null;

/**
 * MetaMask's provider, found through EIP-6963 so that other wallet extensions
 * claiming window.ethereum do not get in the way.
 */
export function findMetaMask(timeoutMs = 400): Promise<Eip1193 | null> {
  if (provider) return Promise.resolve(provider);
  return new Promise((resolve) => {
    const onAnnounce = (e: any) => {
      const { info, provider: p } = e.detail ?? {};
      if (typeof info?.rdns === 'string' && info.rdns.startsWith('io.metamask')) {
        provider = p;
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
        resolve(p);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const legacy = (window as any).ethereum;
      provider = provider ?? (legacy?.isMetaMask ? legacy : null);
      resolve(provider);
    }, timeoutMs);
  });
}

async function invoke<T>(method: string, params: object = {}): Promise<T> {
  const mm = await findMetaMask();
  if (!mm) throw new Error('MetaMask is not installed in this browser');
  return mm.request({ method: 'wallet_invokeSnap', params: { snapId: config.snapId, request: { method, params } } });
}

/** Installs (or reuses) the SENA Snap and returns its account. */
export async function connect(): Promise<SnapAccount> {
  const mm = await findMetaMask();
  if (!mm) throw new Error('MetaMask is not installed in this browser. Install MetaMask Flask to use the SENA Snap.');
  try {
    await mm.request({ method: 'wallet_requestSnaps', params: { [config.snapId]: {} } });
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    if (/not.*allowlist|not allowed|Snaps.*not supported|method.*not.*found/i.test(m)) {
      throw new Error(`MetaMask refused the SENA Snap (${m}). Until MetaMask reviews it, use MetaMask Flask.`);
    }
    throw e;
  }
  const { address } = await invoke<{ address: string }>('sena_getAccount');
  return { kind: 'snap', address, email: 'MetaMask (SENA Snap)', name: 'MetaMask', picture: '' };
}

/** Has MetaMask show the transaction and sign it; returns the signed transaction. */
export async function signTransaction(unsigned: string): Promise<string> {
  const { signed } = await invoke<{ signed: string }>('sena_signTransaction', { transaction: unsigned });
  return signed;
}
