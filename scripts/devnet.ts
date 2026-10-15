// Starts a SENA devnet and the faucet for this wallet: `bun run devnet`.
//
// Needs only Bun and the sena-node program: put sena-node.exe (Windows) or
// sena-node (macOS, Linux) in ./bin, or point SENA_NODE at it.
//
// The chain it creates, all real:
//   * keyless accounts on the Aptos Keyless mainnet parameters, which Aptos's
//     prover proves for, accepting Google sign-ins signed by the keys Google
//     publishes right now;
//   * USDC, USDT and DAI at par and EURC at 0.925, each paying its own fees;
//   * a faucet account holding 1,000,000.00 of each, which `server.ts` sends
//     from with ordinary signed transfers.
//
// The chain lives in ./.devnet and survives restarts; `bun run devnet --fresh`
// starts a new one. Google rotates its signing keys every few weeks; after a
// rotation, new sign-ins are refused until you start with --fresh.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as sena from "../src/sena/sena_wasm.js";

const HERE = resolve(import.meta.dir, "..");
const EXE = process.platform === "win32" ? ".exe" : "";
const NODE = process.env.SENA_NODE ?? join(HERE, "bin", `sena-node${EXE}`);
const DIR = join(HERE, ".devnet");
const CHAIN = join(DIR, "chain");
const RPC_PORT = Number(process.env.SENA_RPC_PORT ?? 8545);
const ORIGINS = (process.env.WALLET_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",");

const STABLECOINS: [number, string, string, number][] = [
  [1, "USDC", "1000000", 10_000],
  [2, "USDT", "1000000", 10_000],
  [3, "EURC", "925000", 15_000],
  [4, "DAI", "1000000", 10_000],
];
const FAUCET_FUNDS = "1000000000000"; // 1,000,000.000000 of each

if (!existsSync(NODE)) {
  console.error(`sena-node not found at ${NODE}.`);
  console.error(`Download it (see README, "Get sena-node") and put it in ${join(HERE, "bin")},`);
  console.error("or set SENA_NODE to its path.");
  process.exit(1);
}
sena.initSync({ module: readFileSync(join(HERE, "src", "sena", "sena_wasm_bg.wasm")) });

function newKey() {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  return { secret, address: sena.ed25519Address(secret) };
}

async function create() {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const faucet = newKey();
  const sequencer = newKey();
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = (await res.json()) as { keys: { kid: string; n: string; kty: string }[] };
  const jwks = keys.filter((k) => k.kty === "RSA").map((k) => ({ iss: "https://accounts.google.com", kid: k.kid, n: k.n }));

  // `genesis` writes the file and its layout; the sections below replace the
  // development defaults.
  execFileSync(NODE, ["genesis", "--data-dir", CHAIN, "--dev", "--fund", `${faucet.address}:1`], { stdio: "ignore" });
  const path = join(CHAIN, "genesis.json");
  const genesis = JSON.parse(readFileSync(path, "utf8"));
  genesis.chain_id = "sena-wallet-devnet-1";
  genesis.network_salt = "sena-wallet-devnet-1-salt";
  genesis.gas_assets = STABLECOINS.map(([asset, symbol, rate, intrinsic_gas]) => ({ asset, symbol, rate, intrinsic_gas, enabled: true }));
  genesis.allocations = STABLECOINS.map(([asset]) => ({ address: faucet.address, asset, amount: FAUCET_FUNDS }));
  genesis.keyless = { setup: "aptos-keyless-mainnet-2025-01", jwks };
  writeFileSync(path, JSON.stringify(genesis, null, 2));
  writeFileSync(join(DIR, "faucet.json"), JSON.stringify(faucet, null, 2));
  writeFileSync(join(DIR, "sequencer.json"), JSON.stringify(sequencer, null, 2));
  console.log("new chain in .devnet");
  console.log(`  Google keys  ${jwks.map((j) => j.kid.slice(0, 12)).join(", ")}`);
  console.log(`  faucet       ${faucet.address}`);
}

if (process.argv.includes("--fresh") || !existsSync(join(CHAIN, "genesis.json"))) {
  await create();
} else {
  console.log("resuming the chain in .devnet (bun run devnet --fresh starts a new one)");
}

const FAUCET_PORT = Number(process.env.FAUCET_PORT ?? 3001);
const rpc = `http://127.0.0.1:${RPC_PORT}`;
const answers = (url: string) =>
  fetch(url, { method: "POST", body: '{"method":"sena_getChainInfo"}', signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
for (const [port, what] of [[RPC_PORT, "SENA node"], [FAUCET_PORT, "faucet"]] as const) {
  if (await answers(`http://127.0.0.1:${port}`)) {
    console.error(`Something is already listening on port ${port}, where the ${what} goes.`);
    console.error("Stop it (an earlier `bun run devnet`?) and try again.");
    process.exit(1);
  }
}

const sequencer = JSON.parse(readFileSync(join(DIR, "sequencer.json"), "utf8"));
const chainId = JSON.parse(readFileSync(join(CHAIN, "genesis.json"), "utf8")).chain_id;
const children: ChildProcess[] = [];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const nodeArgs = ["run", "--data-dir", CHAIN, "--listen", `127.0.0.1:${RPC_PORT}`, "--block-interval", "1",
  "--fee-recipient", sequencer.address, ...ORIGINS.flatMap((o) => ["--cors-origin", o])];
const node = spawn(NODE, nodeArgs, { stdio: "inherit" });
children.push(node);
node.on("exit", (code) => {
  console.error(`sena-node exited (${code})`);
  stop();
});

for (let i = 0; ; i++) {
  try {
    const info = await (await fetch(rpc, { method: "POST", body: '{"method":"sena_getChainInfo"}' })).json();
    if (info.chain_id !== chainId) throw new Error(`port ${RPC_PORT} is serving another chain (${info.chain_id})`);
    break;
  } catch (e) {
    if ((e as Error).message.startsWith("port")) throw e;
    if (i > 100) throw new Error("sena-node did not start");
    await Bun.sleep(100);
  }
}

const faucet = spawn(process.execPath, [join(HERE, "server.ts")], {
  stdio: "inherit",
  env: { ...process.env, FAUCET_KEY_FILE: join(DIR, "faucet.json"), VITE_SENA_RPC_URL: rpc, FAUCET_PORT: String(FAUCET_PORT), WALLET_ORIGINS: ORIGINS.join(",") },
});
children.push(faucet);

console.log("\nDevnet running. In another terminal: bun run dev, then open http://localhost:5173");
console.log("Ctrl+C stops it; the chain is kept for next time.\n");
