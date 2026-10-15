// The SENA node's JSON-RPC: everything the wallet shows comes from here.

import { config } from '../config';
import { submitRequest } from './sena';
import type { Transaction } from './sena';

export class RpcError extends Error {}

async function call<T>(body: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RpcError(`cannot reach the SENA node at ${config.rpcUrl}`);
  }
  const data = await res.json();
  if (data.result === 'error') throw new RpcError(data.message);
  return data as T;
}

const rpc = <T>(method: string, params?: unknown) =>
  call<T>(JSON.stringify(params === undefined ? { method } : { method, params }));

export interface ChainInfo {
  chain_id: string;
  height: number;
  finalized_height: number;
  challenge_window_secs: number;
  state_root: string;
  mempool_size: number;
}

export interface FeeAsset {
  asset: number;
  symbol: string;
  rate: string;
  intrinsic_gas: number;
  enabled: boolean;
}

export interface GasQuote {
  asset: number;
  rate: string;
  intrinsic_gas: number;
  base_fee_native: string;
  base_fee_per_gas: string;
  suggested_max_fee_per_gas: string;
}

export interface Account {
  nonce: number;
  balances: Map<number, bigint>;
}

export type Confirmation =
  | { status: 'pending' }
  | { status: 'soft_confirmed'; height: number }
  | { status: 'finalized'; height: number };

export interface HistoryEntry {
  hash: string;
  confirmation: Confirmation;
  timestamp: number | null;
  transaction: Transaction;
  fee_paid: string | null;
}

export const chainInfo = () => rpc<ChainInfo>('sena_getChainInfo');

export async function feeAssets(): Promise<FeeAsset[]> {
  return (await rpc<{ assets: FeeAsset[] }>('sena_getFeeAssets')).assets;
}

export const gasPrice = (asset: number) => rpc<GasQuote>('sena_gasPrice', { asset });

export async function account(address: string): Promise<Account> {
  const a = await rpc<{ nonce: number; balances: { asset: number; amount: string }[] }>(
    'sena_getAccount',
    { address },
  );
  return { nonce: a.nonce, balances: new Map(a.balances.map((b) => [b.asset, BigInt(b.amount)])) };
}

export async function history(address: string, limit = 50): Promise<HistoryEntry[]> {
  return (
    await rpc<{ transactions: HistoryEntry[] }>('sena_getAccountTransactions', { address, limit })
  ).transactions;
}

export async function confirmation(hash: string): Promise<Confirmation> {
  const c = await rpc<Confirmation & { result: string }>('sena_getConfirmation', { hash });
  return c.status === 'pending' ? { status: 'pending' } : { status: c.status, height: c.height };
}

/** Submits a signed transaction; resolves to its hash once queued. */
export async function submit(signedTx: string): Promise<string> {
  return (await call<{ hash: string }>(submitRequest(signedTx))).hash;
}
