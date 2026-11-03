// Identities, after Celo's SocialConnect: being found by an email address,
// phone number or username, and sending to someone by theirs.
//
// An issuer verifies an identifier however it likes (signing in with Google,
// Apple, Twitch or GitHub, an SMS code) and signs an attestation that it
// belongs to this account. The account submits it, consenting to be found by
// it. Resolving "bob@gmail.com" asks the chain what the issuers this wallet
// trusts have attested; the plain text never leaves the browser, only its
// hash.

import { config } from '../config';
import * as rpc from './rpc';
import * as sena from './sena';
import type { KeylessAccount } from './auth';
import { waitForBlock } from './wallet';

export interface IssuerProvider {
  id: string;
  label: string;
  /** The identifier type it attests: mailto, tel, twit, github, twitch, ... */
  prefix: string;
  /** "redirect": sign in at the provider. "code": a code sent to the identifier. */
  flow: 'redirect' | 'code';
}

export interface IssuerInfo {
  issuer: string;
  providers: IssuerProvider[];
}

/** What an issuer hands back: its signed attestation, for the account to submit. */
export interface SignedAttestation {
  issuer: string;
  prefix: string;
  plaintext: string;
  identifier: string;
  account: string;
  issued_on: number;
  signature: string;
}

export async function issuerInfo(): Promise<IssuerInfo | null> {
  try {
    const r = await fetch(`${config.issuerUrl}/`, { signal: AbortSignal.timeout(3000) });
    return (await r.json()) as IssuerInfo;
  } catch {
    return null;
  }
}

/** The issuers whose word counts when resolving a recipient. */
export async function trustedIssuers(): Promise<string[]> {
  if (config.trustedIssuers.length) return config.trustedIssuers;
  const info = await issuerInfo();
  return info ? [info.issuer] : [];
}

/** Off to the provider, through the issuer; it returns here with the attestation. */
export function beginLink(provider: IssuerProvider, account: string) {
  const back = window.location.origin + '/';
  const params = new URLSearchParams({ account, return: back });
  window.location.assign(`${config.issuerUrl}/link/${provider.id}?${params}`);
}

async function post(path: string, body: object): Promise<any> {
  const r = await fetch(`${config.issuerUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `the issuer answered HTTP ${r.status}`);
  return out;
}

export const sendCode = (provider: IssuerProvider, to: string) => post(`/code/${provider.id}/start`, { to });

export const checkCode = (provider: IssuerProvider, to: string, code: string, account: string): Promise<SignedAttestation> =>
  post(`/code/${provider.id}/check`, { to, code, account });

/** An attestation (or the issuer's refusal) the issuer redirected back with; clears it from the URL. */
export function takeReturnedAttestation(): { attestation?: SignedAttestation; error?: string } {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const decode = (k: string) => {
    const b64 = hash.get(k)!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  };
  const out: { attestation?: SignedAttestation; error?: string } = {};
  if (hash.has('sena_attestation')) out.attestation = decode('sena_attestation');
  if (hash.has('sena_attestation_error')) out.error = String(decode('sena_attestation_error'));
  if (out.attestation || out.error) history.replaceState(null, '', window.location.pathname);
  return out;
}

/** Submits an attestation from its account, the account's consent; resolves once in a block. */
export async function registerAttestation(account: KeylessAccount, a: SignedAttestation): Promise<number> {
  if (a.account !== account.address) throw new Error('that attestation is for another account');
  await sena.loadSena();
  const [quote, acct, info] = await Promise.all([rpc.gasPrice(1), rpc.account(account.address), rpc.chainInfo()]);
  const unsigned = sena.buildTransaction({
    chainId: info.transaction_chain_id,
    sender: account.address,
    nonce: acct.nonce,
    payload: {
      kind: 'register_attestation',
      identifier: a.identifier,
      issuer: a.issuer,
      account: a.account,
      issued_on: a.issued_on,
      signature: a.signature,
    },
    feeAsset: 1,
    feeRate: quote.rate,
    feeIntrinsicGas: quote.intrinsic_gas,
    maxFeePerGas: quote.suggested_max_fee_per_gas,
    tip: 0n,
  });
  const hash = await rpc.submit(sena.signKeyless(unsigned, account.session, account.signature));
  return waitForBlock(hash);
}

/**
 * What the user typed, as an identifier: "bob@gmail.com" (mailto),
 * "+15551234567" (tel), or "type:value" for any other type ("twit:bob",
 * "github:bob", "twitch:bob"). Null for an address or anything else.
 */
export function parseRecipient(text: string): { prefix: string; plaintext: string } | null {
  const t = text.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return null;
  const typed = /^([a-z][a-z0-9.+-]{0,31}):(?!\/\/)(.+)$/.exec(t);
  if (typed) return { prefix: typed[1], plaintext: typed[2].replace(/^@/, '') };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { prefix: 'mailto', plaintext: t };
  if (/^\+[\d\s().-]{7,}$/.test(t)) return { prefix: 'tel', plaintext: t };
  return null;
}

export interface Resolution {
  account: string;
  issuer: string;
}

/**
 * The account the trusted issuers attest an identifier to. Refuses when they
 * disagree, rather than picking one: sending is not something to guess at.
 */
export async function resolve(prefix: string, plaintext: string): Promise<Resolution | null> {
  const [info, issuers] = await Promise.all([rpc.chainInfo(), trustedIssuers()]);
  if (!issuers.length) throw new Error('no trusted issuer is configured or reachable');
  await sena.loadSena();
  const identifier = sena.hashIdentifier(prefix, plaintext, info.network_salt);
  const found = await rpc.lookupAttestations(identifier, issuers);
  if (!found.length) return null;
  const accounts = new Set(found.map((a) => a.account));
  if (accounts.size > 1) throw new Error('the issuers you trust disagree about who this is; send to an address instead');
  return { account: found[0].account, issuer: found[0].issuer };
}

/** The identifiers this browser has linked for an account, to show which it can be found by. */
const LINKED_KEY = 'sena.linked';
export function linkedIdentities(account: string): { prefix: string; plaintext: string }[] {
  try {
    return (JSON.parse(localStorage.getItem(LINKED_KEY) ?? '{}')[account] ?? []) as { prefix: string; plaintext: string }[];
  } catch {
    return [];
  }
}
export function rememberLinked(account: string, prefix: string, plaintext: string) {
  try {
    const all = JSON.parse(localStorage.getItem(LINKED_KEY) ?? '{}');
    const list = (all[account] ?? []).filter((x: any) => !(x.prefix === prefix && x.plaintext.toLowerCase() === plaintext.toLowerCase()));
    all[account] = [{ prefix, plaintext }, ...list];
    localStorage.setItem(LINKED_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the identity is still linked on chain.
  }
}
