/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_SENA_RPC_URL?: string;
  readonly VITE_APTOS_KEYLESS_URL?: string;
  readonly VITE_APTOS_API_KEY?: string;
  readonly VITE_FAUCET_URL?: string;
  readonly VITE_ISSUER_URL?: string;
  readonly VITE_TRUSTED_ISSUERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
