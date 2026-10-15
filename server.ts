// SENA devnet faucet.
//
// Sends stablecoins from the faucet account that scripts/wallet-devnet.py in
// the SENA repo funds at genesis, as ordinary signed transfers through the
// node: the wallet sees them arrive like any other payment. It holds the
// faucet's Ed25519 key, so run it only on a devnet.
//
//   bun run devnet        (starts the devnet and this faucet together), or
//   bun run faucet        (alone; reads FAUCET_KEY_FILE and VITE_SENA_RPC_URL from .env)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initSync, buildTransfer, signEd25519, ed25519Address, submitRequest } from "./src/sena/sena_wasm.js";

initSync({ module: readFileSync(fileURLToPath(new URL("./src/sena/sena_wasm_bg.wasm", import.meta.url))) });

const PORT = Number(process.env.FAUCET_PORT ?? 3001);
const RPC = process.env.VITE_SENA_RPC_URL ?? "http://127.0.0.1:8545";
const ORIGINS = (process.env.WALLET_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",");
const DRIP = 100_000_000n; // 100.00 of a six-decimal stablecoin
const COOLDOWN_MS = 60_000;

const keyFile = process.env.FAUCET_KEY_FILE;
if (!keyFile) {
  console.error("To run the SENA devnet and its faucet together, use: bun run devnet");
  console.error("(`bun run faucet` alone needs FAUCET_KEY_FILE, the faucet.json of a devnet already running.)");
  process.exit(1);
}
const { secret } = JSON.parse(readFileSync(keyFile, "utf8")) as { secret: string };
const FAUCET = ed25519Address(secret);

async function rpc(method: string, params?: unknown): Promise<any> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params === undefined ? { method } : { method, params }),
  });
  return r.json();
}

// Transfers from one account must carry consecutive nonces, so they are sent
// one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const next = queue.then(f, f);
  queue = next.catch(() => undefined);
  return next;
};
const lastDrip = new Map<string, number>();

async function drip(to: string, asset: number) {
  const [quote, account, pending] = await Promise.all([
    rpc("sena_gasPrice", { asset }),
    rpc("sena_getAccount", { address: FAUCET }),
    rpc("sena_getAccountTransactions", { address: FAUCET, limit: 100 }),
  ]);
  if (quote.result === "error") throw new Error(quote.message);
  // The account's nonce counts included transactions; queued ones are ahead.
  const queued = (pending.transactions ?? []).filter(
    (t: any) => t.confirmation.status === "pending" && t.transaction.sender === FAUCET,
  ).length;
  const tx = buildTransfer(FAUCET, BigInt(account.nonce + queued), to, asset, DRIP.toString(), asset,
    quote.rate, BigInt(quote.intrinsic_gas), quote.suggested_max_fee_per_gas, "0");
  const signed = signEd25519(tx, secret);
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: submitRequest(signed) });
  const out = await res.json();
  if (out.result !== "submitted") throw new Error(out.message ?? "the node refused the transfer");
  return out.hash as string;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const origin = req.headers.get("Origin") ?? "";
    const cors: Record<string, string> = ORIGINS.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
      : {};
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (url.pathname === "/faucet" && req.method === "POST") {
      let body: { address?: string; asset?: number };
      try { body = await req.json(); } catch { return json({ error: "send JSON" }, 400); }
      const { address, asset } = body;
      if (typeof address !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(address)) return json({ error: "address must be 0x and 64 hex digits" }, 400);
      if (typeof asset !== "number") return json({ error: "asset must be a fee asset id" }, 400);
      const key = `${address.toLowerCase()}:${asset}`;
      const wait = (lastDrip.get(key) ?? 0) + COOLDOWN_MS - Date.now();
      if (wait > 0) return json({ error: `wait ${Math.ceil(wait / 1000)}s before asking for this coin again` }, 429);
      try {
        const hash = await serial(() => drip(address, asset));
        lastDrip.set(key, Date.now());
        console.log(`sent ${DRIP} of asset ${asset} to ${address}: ${hash}`);
        return json({ hash, amount: DRIP.toString() });
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }
    if (url.pathname === "/" && req.method === "GET") return json({ faucet: FAUCET, rpc: RPC });
    return json({ error: "not found" }, 404);
  },
});

console.log(`SENA faucet on http://127.0.0.1:${PORT}`);
console.log(`  account  ${FAUCET}`);
console.log(`  node     ${RPC}`);
