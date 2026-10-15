// Keyless sign-in with Google, the Aptos Keyless way:
//
//  1. A fresh ephemeral key; the OAuth nonce commits to it, its expiry and a
//     blinder (computed by SENA's code, not here).
//  2. Google signs the user in and issues an ID token carrying that nonce.
//  3. Aptos's pepper service derives the user's pepper from the token.
//  4. Aptos's prover proves, in zero knowledge, that the token is validly
//     signed by Google and commits to the ephemeral key.
//  5. SENA's code assembles the keyless signature, checking the proof is for
//     exactly this sign-in's public inputs.
//
// From then on transactions are signed by the ephemeral key until it expires.
// The ephemeral secret stays in this browser's storage; nobody else holds it.

import { config, EXP_HORIZON_SECS, GOOGLE_ISS, GOOGLE_JWKS_URL, SESSION_LIFETIME_SECS } from '../config';
import * as sena from './sena';
import type { Session } from './sena';

export interface KeylessAccount {
  address: string;
  email: string;
  name: string;
  picture: string;
  /** The Google ID token the proof is for. */
  jwt: string;
  session: Session;
  pepper: string;
  /** The keyless signature (with the proof), as JSON. */
  signature: string;
}

const ACCOUNTS_KEY = 'sena.accounts';
const ACTIVE_KEY = 'sena.active';
const PENDING_KEY = 'sena.pendingSession';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private window): the account lasts this page only.
  }
}

export const savedAccounts = (): KeylessAccount[] => read<KeylessAccount[]>(ACCOUNTS_KEY, []);
export const activeAddress = (): string | null => read<string | null>(ACTIVE_KEY, null);
export const setActive = (address: string | null) => write(ACTIVE_KEY, address);

export function saveAccount(a: KeylessAccount) {
  write(ACCOUNTS_KEY, [a, ...savedAccounts().filter((x) => x.address !== a.address)]);
  setActive(a.address);
}

export function forgetAccount(address: string) {
  write(ACCOUNTS_KEY, savedAccounts().filter((x) => x.address !== address));
  if (activeAddress() === address) setActive(savedAccounts()[0]?.address ?? null);
}

export const isExpired = (a: KeylessAccount) => a.session.exp_date_secs <= Date.now() / 1000;

const redirectUri = () => window.location.origin + '/';

/** Step 1–2: a new ephemeral key, then off to Google with its nonce. */
export function beginGoogleSignIn() {
  if (!config.googleClientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  const session = sena.newSession(Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECS);
  write(PENDING_KEY, session);
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: session.nonce,
    prompt: 'select_account',
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/** The ID token Google redirected back with, if any; clears it from the URL. */
export function takeRedirectToken(): { jwt?: string; error?: string } {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const jwt = hash.get('id_token') ?? undefined;
  const error = hash.get('error') ?? undefined;
  if (jwt || error) history.replaceState(null, '', window.location.pathname);
  return { jwt, error };
}

async function aptos(path: string, body: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.aptosApiKey) headers.Authorization = `Bearer ${config.aptosApiKey}`;
  const res = await fetch(`${config.aptosKeylessUrl}${path}`, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`Aptos ${path} answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

async function googleJwkN(kid: string | undefined): Promise<string> {
  const res = await fetch(GOOGLE_JWKS_URL);
  const { keys } = (await res.json()) as { keys: { kid: string; n: string }[] };
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new Error(`Google no longer publishes the key ${kid} that signed this token`);
  return key.n;
}

export type Progress = (step: string) => void;

/** Steps 3–5, for the token Google returned. */
export async function completeSignIn(jwt: string, progress: Progress): Promise<KeylessAccount> {
  await sena.loadSena();
  const session = read<Session | null>(PENDING_KEY, null);
  if (!session) throw new Error('no sign-in was started in this browser; start again');
  const { header, claims } = sena.decodeJwt(jwt);
  if (claims.iss !== GOOGLE_ISS) throw new Error(`unexpected issuer ${claims.iss}`);
  if (claims.aud !== config.googleClientId) throw new Error('the token is for another app');
  if (claims.nonce !== session.nonce) {
    throw new Error("the token's nonce does not commit to this browser's ephemeral key");
  }

  progress('Fetching your pepper from Aptos');
  const pepper = sena.parsePepper(await aptos('/pepper/v0/fetch', sena.pepperRequest(jwt, session)));
  const address = sena.keylessAddress(jwt, pepper);

  progress('Proving your sign-in in zero knowledge (Aptos prover, a few seconds)');
  const proof = await aptos('/prover/v0/prove', sena.proverRequest(jwt, session, pepper, EXP_HORIZON_SECS));

  progress('Checking the proof and assembling your keyless signature');
  const n = await googleJwkN(header.kid);
  const signature = sena.assembleSignature(jwt, session, pepper, EXP_HORIZON_SECS, n, proof);
  if (sena.signatureAddress(signature) !== address) throw new Error('the signature is for another address');

  localStorage.removeItem(PENDING_KEY);
  const account: KeylessAccount = {
    address,
    email: claims.email ?? '',
    name: claims.name ?? claims.email ?? 'Google account',
    picture: claims.picture ?? '',
    jwt,
    session,
    pepper,
    signature,
  };
  saveAccount(account);
  return account;
}
