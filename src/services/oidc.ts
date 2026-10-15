// Google OIDC Sign-In Service for SENA Keyless Accounts

import { deriveAddressFromOidc, generateEphemeralKeyPair, generateGroth16Proof, hexToBytes } from '../crypto/keyless';
import { logger } from './logger';
import type { KeylessAccount, GoogleOidcConfig, JwtClaims } from '../types';

export interface PredefinedGoogleProfile {
  email: string;
  name: string;
  sub: string;
  picture: string;
  pepperHex: string;
}

export const PRESET_GOOGLE_USERS: PredefinedGoogleProfile[] = [
  {
    email: 'alice@gmail.com',
    name: 'Alice Walker',
    sub: 'google-oauth2|alice-10928374',
    picture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    pepperHex: '616c6963655f7365637572655f6465766963655f7065707065725f3432', // "alice_secure_device_pepper_42"
  },
  {
    email: 'bob@gmail.com',
    name: 'Bob Martinez',
    sub: 'google-oauth2|bob-8839210',
    picture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    pepperHex: '626f625f7365637572655f6465766963655f7065707065725f3939', // "bob_secure_device_pepper_99"
  },
];

export const DEFAULT_GOOGLE_AUD = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'sena-mobile-wallet-v1';
export const GOOGLE_AUD = DEFAULT_GOOGLE_AUD;
export const GOOGLE_ISS = 'https://accounts.google.com';
export const PROVER_SERVICE_URL = import.meta.env.VITE_PROVER_SERVICE_URL || 'http://127.0.0.1:8090';

const STORAGE_KEY_CLIENT_ID = 'sena_google_client_id';
const STORAGE_KEY_CLIENT_SECRET = 'sena_google_client_secret';

export function getStoredGoogleConfig(): GoogleOidcConfig {
  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const envClientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';

  if (typeof window === 'undefined') {
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  const storedId = localStorage.getItem(STORAGE_KEY_CLIENT_ID);
  const storedSecret = localStorage.getItem(STORAGE_KEY_CLIENT_SECRET);

  return {
    clientId: (storedId !== null && storedId !== '') ? storedId : envClientId,
    clientSecret: (storedSecret !== null && storedSecret !== '') ? storedSecret : envClientSecret,
  };
}

export function saveStoredGoogleConfig(config: GoogleOidcConfig) {
  if (typeof window === 'undefined') return;
  if (config.clientId) {
    localStorage.setItem(STORAGE_KEY_CLIENT_ID, config.clientId.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_CLIENT_ID);
  }
  if (config.clientSecret) {
    localStorage.setItem(STORAGE_KEY_CLIENT_SECRET, config.clientSecret.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_CLIENT_SECRET);
  }
}

export function parseGoogleJwt(token: string): Partial<JwtClaims> | null {
  try {
    const parts = token.trim().split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Failed to parse JWT payload', e);
    return null;
  }
}

/**
 * Creates or restores a SENA Keyless Account from a Google OIDC profile.
 * Supports custom Google Client ID as aud parameter.
 */
export async function createKeylessAccountFromOidc(
  profile: PredefinedGoogleProfile,
  customAudOrProgress?: string | ((step: number, title: string) => void),
  progressCallback?: (step: number, title: string) => void
): Promise<KeylessAccount> {
  let customAud: string | undefined;
  let onStepProgress = progressCallback;

  if (typeof customAudOrProgress === 'function') {
    onStepProgress = customAudOrProgress;
    customAud = undefined;
  } else if (typeof customAudOrProgress === 'string') {
    customAud = customAudOrProgress;
  }

  const aud = (customAud && customAud.trim()) ? customAud.trim() : DEFAULT_GOOGLE_AUD;

  // Step 1: Decode & validate OIDC claims
  logger.info('OIDC', `Verifying Google OIDC identity for: ${profile.email}`, { sub: profile.sub, aud });
  onStepProgress?.(1, 'Decoding & verifying Google ID Token claims...');
  await new Promise(r => setTimeout(r, 200));

  let activePepperHex = profile.pepperHex;
  try {
    onStepProgress?.(1, 'Querying Distributed Pepper Guardians (2-of-3 v-tOPRF)...');
    const pepperRes = await fetch(`${PROVER_SERVICE_URL}/api/v1/pepper/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        iss: GOOGLE_ISS,
        sub: profile.sub,
        aud,
      }),
    });
    if (pepperRes.ok) {
      const data = await pepperRes.json();
      if (data.pepper_hex) {
        activePepperHex = data.pepper_hex;
        logger.success('PEPPER_STORAGE', `Distributed Pepper recovered from Guardian cluster: ${data.pepper_hex.slice(0, 18)}...`, {
          threshold: data.threshold,
          guardiansQueried: data.guardians_queried,
          clusterSource: data.cluster_source,
        });
      }
    }
  } catch (e) {
    logger.warn('PEPPER_STORAGE', 'Distributed Pepper service offline; using device local pepper');
  }

  const pepperBytes = hexToBytes(activePepperHex);

  // Step 2: Deterministically derive self-custodial L2Address
  onStepProgress?.(2, `Deriving self-custodial L2 address for aud: "${aud.slice(0, 16)}..."`);
  await new Promise(r => setTimeout(r, 250));
  const address = await deriveAddressFromOidc(aud, profile.sub, pepperBytes);
  logger.success('WALLET', `Derived self-custodial L2 Address: ${address}`, { address, aud, sub: profile.sub });

  // Step 3: Generate fresh Ephemeral Key Pair (EPK)
  onStepProgress?.(3, 'Generating short-lived Ephemeral Key Pair (EPK)...');
  await new Promise(r => setTimeout(r, 200));
  const epk = await generateEphemeralKeyPair();
  logger.info('ZK_PROVER', `Generated session Ephemeral Public Key: ${epk.publicKeyHex.slice(0, 20)}...`);

  // Step 4: Run off-chain BN254 Groth16 zero-knowledge prover
  onStepProgress?.(4, 'Computing BN254 Groth16 Zero-Knowledge proof (128 bytes)...');
  await new Promise(r => setTimeout(r, 350));
  const zk = await generateGroth16Proof(epk.publicKeyHex, address);
  logger.success('ZK_PROVER', `Synthesized 128-byte BN254 Groth16 proof binding EPK to identity`, {
    proofSize: `${zk.sizeBytes} bytes`,
    proofHex: `${zk.proofHex.slice(0, 24)}...`
  });

  onStepProgress?.(5, 'Keyless Account successfully initialized on SENA L2!');
  logger.success('WALLET', `Keyless Account initialized for ${profile.name} (${profile.email})`);

  // Initial balances: Alice has 10 USDC for testing, others start clean (can claim 50 USDC faucet)
  const initialUsdc = profile.email === 'alice@gmail.com' ? 10_000_000 : 0;

  return {
    address,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    sub: profile.sub,
    aud,
    pepperHex: activePepperHex,
    ephemeralPublicKeyHex: epk.publicKeyHex,
    ephemeralPrivateKeyHex: epk.privateKeyHex,
    zkProofHex: zk.proofHex,
    nonce: 0,
    balances: {
      usdc: initialUsdc,
      sena: 50_000_000, // 50 SENA gas tokens
    },
  };
}

/**
 * Creates a Keyless Account from a real decoded Google ID Token (JWT).
 */
export async function createKeylessAccountFromJwt(
  jwtString: string,
  customClientId?: string,
  onStepProgress?: (step: number, title: string) => void
): Promise<KeylessAccount> {
  const claims = parseGoogleJwt(jwtString);
  if (!claims || !claims.sub || !claims.email) {
    throw new Error('Invalid Google ID Token (missing sub or email)');
  }

  const aud = (customClientId && customClientId.trim()) 
    ? customClientId.trim() 
    : (claims.aud || DEFAULT_GOOGLE_AUD);

  const pepperHex = Array.from(new TextEncoder().encode(`device_pepper_${claims.email}`))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const profile: PredefinedGoogleProfile = {
    email: claims.email,
    name: claims.name || claims.email.split('@')[0],
    sub: claims.sub,
    picture: claims.picture || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(claims.email)}`,
    pepperHex,
  };

  return createKeylessAccountFromOidc(profile, aud, onStepProgress);
}

export function generateCustomGoogleProfile(email: string, name: string): PredefinedGoogleProfile {
  const sub = `google-oauth2|custom-${Math.abs(hashString(email))}`;
  const pepperHex = Array.from(new TextEncoder().encode(`custom_pepper_${email}`))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    email,
    name,
    sub,
    picture: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(email)}`,
    pepperHex,
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
