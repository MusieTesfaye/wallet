import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
//
// To serve the wallet from another machine (a tunnel, a VM), set
// PROXY_SENA_RPC and PROXY_FAUCET to where the node and faucet listen, and
// point the wallet at /sena-rpc and /sena-faucet: everything is then one
// origin, and neither service needs to be reachable from the browser.
// ALLOWED_HOSTS lists the public host names the dev server may answer for.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
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
    plugins: [vue()],
    server: {
      proxy,
      allowedHosts: env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : undefined,
    },
  }
})
