/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
  readonly VITE_SENA_RPC_URL?: string;
  readonly VITE_SQLITE_API_URL?: string;
  readonly VITE_WS_STREAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
