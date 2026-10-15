// Sending: quote, build, sign and submit a transfer, then wait for its block.

import * as rpc from './rpc';
import * as sena from './sena';
import type { KeylessAccount } from './auth';

export const PRICE_SCALE = 10n ** 12n;

export interface Prepared {
  signed: string;
  hash: string;
  gas: number;
  /** The most the fee can come to, in the coin's smallest unit. */
  maxFee: bigint;
}

/**
 * A signed transfer of `amount` of `asset` to `to`, paying its fee in the same
 * stablecoin. The fee fields come from the node's quote and are checked on
 * chain, so a stale or wrong quote is refused rather than honoured.
 */
export async function prepareTransfer(
  from: KeylessAccount,
  to: string,
  asset: number,
  amount: bigint,
): Promise<Prepared> {
  await sena.loadSena();
  const [quote, acct] = await Promise.all([rpc.gasPrice(asset), rpc.account(from.address)]);
  const unsigned = sena.buildTransfer({
    sender: from.address,
    nonce: acct.nonce,
    to,
    asset,
    amount,
    feeAsset: asset,
    feeRate: quote.rate,
    feeIntrinsicGas: quote.intrinsic_gas,
    maxFeePerGas: quote.suggested_max_fee_per_gas,
    tip: 0n,
  });
  const signed = sena.signKeyless(unsigned, from.session, from.signature);
  const tx = JSON.parse(signed) as sena.Transaction;
  const maxFee = (BigInt(tx.gas_limit) * BigInt(tx.max_fee_per_gas) + PRICE_SCALE - 1n) / PRICE_SCALE;
  return { signed, hash: sena.transactionHash(signed), gas: tx.gas_limit, maxFee };
}

/** Polls until the transaction is in a block; resolves to its height. */
export async function waitForBlock(hash: string, timeoutMs = 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = await rpc.confirmation(hash);
    if (c.status !== 'pending') return c.height;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('not included within a minute; check the node');
}

/** `1.5` → 1_500_000n for six decimals, without floating point. */
export function parseAmount(text: string, decimals = 6): bigint | null {
  const m = /^\s*(\d*)(?:\.(\d*))?\s*$/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  return BigInt(m[1] || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** 1_500_000n → `1.50` (at least two decimals, up to six). */
export function formatAmount(units: bigint, decimals = 6): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const whole = v / 10n ** BigInt(decimals);
  let frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}.${frac}`;
}

export const isAddress = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s.trim());

export const shortAddress = (a: string, head = 6, tail = 4) =>
  a.length > head + tail + 2 ? `${a.slice(0, head + 2)}…${a.slice(-tail)}` : a;
