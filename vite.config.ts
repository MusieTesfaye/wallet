import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// https://vite.dev/config/
//
// To serve the wallet from another machine (a tunnel, a VM), set
// PROXY_SENA_RPC and PROXY_FAUCET to where the node and faucet listen, and
// point the wallet at /sena-rpc and /sena-faucet: everything is then one
// origin, and neither service needs to be reachable from the browser.
// ALLOWED_HOSTS lists the public host names the dev server may answer for.

/** The origin of a URL the wallet calls, or nothing for a same-origin path. */
const originOf = (url: string | undefined, fallback: string) => {
  try {
    return new URL(url || fallback).origin
  } catch {
    return ''
  }
}

/**
 * A Content-Security-Policy for the page: its own scripts only (and its
 * WebAssembly), and network access only to the services it is configured for.
 * The session key and the Google token live in this page's storage, so an
 * injected script must have nowhere to send them.
 */
function contentSecurityPolicy(env: Record<string, string | undefined>, dev: boolean): Plugin {
  const connect = [
    "'self'",
    originOf(env.VITE_SENA_RPC_URL, 'http://127.0.0.1:8545'),
    originOf(env.VITE_FAUCET_URL, 'http://127.0.0.1:3001'),
    originOf(env.VITE_ISSUER_URL, 'http://localhost:3002'),
    originOf(env.VITE_APTOS_KEYLESS_URL, 'https://api.testnet.aptoslabs.com/keyless'),
    'https://www.googleapis.com',
    // Vite's hot reload, in development only.
    ...(dev ? ['ws:', 'wss:'] : []),
  ].filter(Boolean)
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "img-src 'self' data: https://*.googleusercontent.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'sena-csp',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

/**
 * `vite build --mode extension`: the same app, packaged as the SENA browser
 * extension (Manifest V3) in dist-extension/. The manifest gets the
 * extension's public key, which fixes its id, and host permissions for the
 * services the wallet is configured to call.
 */
function extension(env: Record<string, string | undefined>): Plugin {
  const hosts = [
    originOf(env.VITE_SENA_RPC_URL, 'http://127.0.0.1:8545'),
    originOf(env.VITE_FAUCET_URL, 'http://127.0.0.1:3001'),
    originOf(env.VITE_ISSUER_URL, 'http://localhost:3002'),
    originOf(env.VITE_APTOS_KEYLESS_URL, 'https://api.testnet.aptoslabs.com/keyless'),
    'https://www.googleapis.com',
  ]
    .filter(Boolean)
    .map((o) => `${o}/*`)
  return {
    name: 'sena-extension',
    apply: 'build',
    generateBundle() {
      const manifest = readFileSync('extension/manifest.json', 'utf8')
        .replace('"__KEY__"', JSON.stringify(readFileSync('extension/key.txt', 'utf8').trim()))
        .replace('"__HOSTS__"', JSON.stringify([...new Set(hosts)]))
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: manifest })
      for (const f of ['background.js', 'content.js', 'inpage.js', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png']) {
        this.emitFile({ type: 'asset', fileName: f, source: readFileSync(`extension/${f}`) })
      }
    },
  }
}

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const isExtension = mode === 'extension'
  const proxy: Record<string, object> = {}
  if (env.PROXY_SENA_RPC) {
    proxy['/sena-rpc'] = { target: env.PROXY_SENA_RPC, changeOrigin: true, rewrite: () => '/' }
  }
  if (env.PROXY_FAUCET) {
    proxy['/sena-faucet'] = {
      target: env.PROXY_FAUCET,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/sena-faucet/, '') || '/',
    }
  }
  return {
    plugins: [vue(), contentSecurityPolicy(env, command === 'serve'), ...(isExtension ? [extension(env)] : [])],
    // Extension pages load from chrome-extension://<id>/, so paths are relative.
    base: isExtension ? './' : '/',
    build: isExtension ? { outDir: 'dist-extension', emptyOutDir: true } : undefined,
    server: {
      proxy,
      allowedHosts: env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : undefined,
    },
  }
})
