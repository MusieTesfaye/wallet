// SENA's wallet logic, compiled from the node's own Rust (src/sena, built by
// scripts/update-sena-wasm.sh). Nothing about a transaction or a keyless
// signature is computed in TypeScript: it is all the code the chain verifies.

import init, * as wasm from '../sena/sena_wasm.js';
import wasmUrl from '../sena/sena_wasm_bg.wasm?url';

let ready: Promise<unknown> | null = null;

/** Loads the WebAssembly module once. */
export function loadSena(): Promise<unknown> {
  ready ??= init({ module_or_path: wasmUrl });
  return ready;
}

/** An ephemeral key and what the OAuth nonce commits to. */
export interface Session {
  secret: string;
  blinder: string;
  exp_date_secs: number;
  public_key: string;
  nonce: string;
}

export interface JwtParts {
  header: { kid?: string; alg?: string };
  claims: { iss: string; aud: string; sub: string; nonce: string; email?: string; name?: string; picture?: string; iat?: number };
}

/** A transaction as the node's JSON carries it. */
export interface Transaction {
  sender: string;
  nonce: number;
  fee_asset: number;
  fee_rate: string;
  fee_intrinsic_gas: number;
  gas_limit: number;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  payload: { kind: string; to?: string; asset?: number; amount?: string };
  authenticator: { scheme: string };
}

export function newSession(expDateSecs: number): Session {
  const random = crypto.getRandomValues(new Uint8Array(63));
  return JSON.parse(wasm.newSession(BigInt(expDateSecs), random));
}

export function decodeJwt(jwt: string): JwtParts {
  return JSON.parse(wasm.decodeJwt(jwt));
}

export const pepperRequest = (jwt: string, s: Session) => wasm.pepperRequest(jwt, JSON.stringify(s));
export const parsePepper = (response: string) => wasm.parsePepper(response);
export const keylessAddress = (jwt: string, pepper: string) => wasm.keylessAddress(jwt, pepper);

export const proverRequest = (jwt: string, s: Session, pepper: string, horizon: number) =>
  wasm.proverRequest(jwt, JSON.stringify(s), pepper, BigInt(horizon), '');

/** The keyless signature for a sign-in; refuses a proof for other inputs. */
export const assembleSignature = (
  jwt: string,
  s: Session,
  pepper: string,
  horizon: number,
  jwkN: string,
  proverResponse: string,
) => wasm.assembleSignature(jwt, JSON.stringify(s), pepper, BigInt(horizon), jwkN, '', proverResponse);

export const signatureAddress = (signature: string) => wasm.signatureAddress(signature);

export interface TransferArgs {
  sender: string;
  nonce: number;
  to: string;
  asset: number;
  amount: bigint;
  feeAsset: number;
  feeRate: string;
  feeIntrinsicGas: number;
  maxFeePerGas: string;
  tip: bigint;
}

/** An unsigned transfer, metered to exactly the gas it uses. */
export function buildTransfer(a: TransferArgs): string {
  return wasm.buildTransfer(
    a.sender, BigInt(a.nonce), a.to, a.asset, a.amount.toString(), a.feeAsset,
    a.feeRate, BigInt(a.feeIntrinsicGas), a.maxFeePerGas, a.tip.toString(),
  );
}

/** Signs with the session's ephemeral key; adds keyless verification gas. */
export const signKeyless = (tx: string, s: Session, signature: string) =>
  wasm.signKeyless(tx, JSON.stringify(s), signature);

export const transactionHash = (tx: string) => wasm.transactionHash(tx);
export const submitRequest = (tx: string) => wasm.submitRequest(tx);
