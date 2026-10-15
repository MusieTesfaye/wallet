// The devnet faucet (server.ts): it sends real transfers from an account
// funded at genesis, the way any testnet faucet does.

import { config } from '../config';

export async function requestCoins(address: string, asset: number): Promise<{ hash: string; amount: string }> {
  let res: Response;
  try {
    res = await fetch(`${config.faucetUrl}/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, asset }),
    });
  } catch {
    throw new Error(`the faucet at ${config.faucetUrl} is not running (bun run faucet)`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `faucet answered HTTP ${res.status}`);
  return data;
}

/** The faucet's own address, to label its payments; null if it is not running. */
export async function faucetAddress(): Promise<string | null> {
  try {
    const res = await fetch(`${config.faucetUrl}/`, { signal: AbortSignal.timeout(3000) });
    return ((await res.json()) as { faucet?: string }).faucet ?? null;
  } catch {
    return null;
  }
}
