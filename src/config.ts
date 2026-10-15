// Where the wallet's services are. Set them in .env (see .env.example).

const env = import.meta.env;

export const config = {
  /** The SENA node's JSON-RPC endpoint. */
  rpcUrl: (env.VITE_SENA_RPC_URL as string | undefined) || 'http://127.0.0.1:8545',
  /** Google OAuth 2.0 web client id. Sign-in is impossible without one. */
  googleClientId: (env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '',
  /**
   * Aptos's keyless services: `<base>/pepper/v0/fetch` and
   * `<base>/prover/v0/prove`. Testnet and mainnet prove for the same
   * parameters, which are the ones SENA verifies against.
   */
  aptosKeylessUrl:
    (env.VITE_APTOS_KEYLESS_URL as string | undefined) || 'https://api.testnet.aptoslabs.com/keyless',
  /** Optional Aptos Build API key, for higher rate limits. */
  aptosApiKey: (env.VITE_APTOS_API_KEY as string | undefined) || '',
  /** The faucet server (`bun run faucet`). */
  faucetUrl: (env.VITE_FAUCET_URL as string | undefined) || 'http://127.0.0.1:3001',
};

/** Google's issuer and published signing keys. */
export const GOOGLE_ISS = 'https://accounts.google.com';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** How long a sign-in's ephemeral key lasts. */
export const SESSION_LIFETIME_SECS = 2 * 24 * 60 * 60;

/**
 * The expiry horizon proofs are requested for: Aptos's maximum, which SENA's
 * mainnet parameters also allow. The ephemeral key must expire within this of
 * the JWT being issued.
 */
export const EXP_HORIZON_SECS = 10_000_000;

/** Every stablecoin on SENA has six decimals. */
export const DECIMALS = 6;
