// A SENA testnet on this computer, settling on Aptos testnet: `bun run testnet`.
//
// Windows, macOS or Linux, with nothing but Bun and sena-node (in ./bin). No
// Docker, no WSL. It does what SENA's deploy/setup.sh does on a server:
//
//   1. downloads the Aptos CLI into ./bin if it is not there;
//   2. creates two Aptos accounts, the proposer (publishes the contracts,
//      posts every block) and the challenger (the watcher's), and waits
//      while you fund them with testnet APT;
//   3. creates the L2 keys and genesis: four stablecoins, Google sign-in, and
//      a one-key council that follows Google's key rotations;
//   4. publishes SENA's contracts to Aptos and initialises them;
//   5. builds the web wallet for your address, and runs the node, relayer,
//      watcher, jwk-sync, faucet and (with issuer.config.json) the issuer;
//   6. serves it all on http://127.0.0.1:8088: the wallet at /, and /rpc,
//      /faucet and /issuer. Point a tunnel at it for HTTPS:
//        tailscale funnel --bg 8088
//
//   bun run testnet --host sena.tailXXXX.ts.net    (your tunnel's address)
//   bun run testnet                                (http://localhost:8088 only)
//
// Everything is kept in ./.testnet; run it again to resume. Back that folder
// up: it holds the chain, its keys and the Aptos accounts.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import * as sena from "../src/sena/sena_wasm.js";

const HERE = resolve(import.meta.dir, "..");
const DIR = join(HERE, ".testnet");
const BIN = join(HERE, "bin");
const EXE = process.platform === "win32" ? ".exe" : "";
const NODE = process.env.SENA_NODE ?? join(BIN, `sena-node${EXE}`);
const APTOS_VERSION = "7.9.0";
const APTOS_NETWORK = process.env.APTOS_NETWORK ?? "testnet"; // or "custom", with the two URLs below
const APTOS_URL = process.env.APTOS_URL ?? "https://api.testnet.aptoslabs.com/v1";
const SENA_REF = process.env.SENA_REF ?? "claude/exciting-ritchie-8g61na";
const CHAIN_NAME = process.env.SENA_CHAIN_NAME ?? "sena-testnet-1";
const PORT = Number(process.env.SENA_PORT ?? 8088);
const P = { node: 8545, faucet: 3001, issuer: 3002 };
const PROPOSER_NEEDS = 400_000_000n; // octas: ~2.3 APT to publish, the rest for bonds and gas
const CHALLENGER_NEEDS = 30_000_000n;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const host = arg("--host")?.replace(/^https?:\/\//, "").replace(/\/$/, "");
const BASE = host ? `https://${host}` : `http://localhost:${PORT}`;
const EXTENSION_ID = "phkknehihpoajnkoiabbbknbjaonflad";

const step = (s: string) => console.log(`\n\x1b[1m== ${s}\x1b[0m`);
const note = (s: string) => console.log(`   ${s}`);
const fail = (s: string): never => {
  console.error(`\n${s}`);
  process.exit(1);
};

sena.initSync({ module: readFileSync(join(HERE, "src", "sena", "sena_wasm_bg.wasm")) });

// --- 1. Tools ---------------------------------------------------------------

step("1. Tools");
if (!existsSync(NODE)) fail(`sena-node not found at ${NODE}. Download it (README, "Get sena-node") into ${BIN}.`);
const nodeVersion = spawnSync(NODE, ["--version"], { encoding: "utf8" }).stdout.trim();
if (!spawnSync(NODE, ["inspect-genesis", "--help"], { encoding: "utf8" }).stdout?.includes("genesis")) {
  fail(`${NODE} (${nodeVersion}) is older than this script. Download the newest sena-node (README, "Get sena-node").`);
}
note(nodeVersion);
if (spawnSync("git", ["--version"]).status !== 0) {
  fail("git is needed to publish the contracts (the Aptos CLI fetches the Aptos framework with it).\n" +
    "Install it from https://git-scm.com/downloads, open a new terminal, and run this again.");
}

let APTOS = process.env.APTOS_BIN ?? join(BIN, `aptos${EXE}`);
if (!existsSync(APTOS)) {
  const platform =
    process.platform === "win32" ? "Windows-x86_64"
    : process.platform === "darwin" ? (process.arch === "arm64" ? "macOS-arm64" : "macOS-x86_64")
    : process.arch === "arm64" ? "Linux-aarch64" : "Linux-x86_64";
  const url = `https://github.com/aptos-labs/aptos-core/releases/download/aptos-cli-v${APTOS_VERSION}/aptos-cli-${APTOS_VERSION}-${platform}.zip`;
  note(`downloading the Aptos CLI ${APTOS_VERSION} (${platform})`);
  const res = await fetch(url);
  if (!res.ok) fail(`could not download ${url}: HTTP ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const name = Object.keys(files).find((f) => /(^|\/)aptos(\.exe)?$/.test(f));
  if (!name) fail("the Aptos CLI download has no aptos binary in it");
  mkdirSync(BIN, { recursive: true });
  writeFileSync(APTOS, files[name!]);
  if (EXE === "") chmodSync(APTOS, 0o755);
}
note(spawnSync(APTOS, ["--version"], { encoding: "utf8" }).stdout.trim());

// SENA's Move package: a SENA checkout next to this one, or its source from GitHub.
let PACKAGE = process.env.SENA_DIR ? join(process.env.SENA_DIR, "move", "sena") : join(HERE, "..", "SENA", "move", "sena");
if (!existsSync(join(PACKAGE, "Move.toml"))) {
  PACKAGE = join(DIR, "sena-move");
  if (!existsSync(join(PACKAGE, "Move.toml"))) {
    note(`downloading SENA's contracts (${SENA_REF})`);
    const res = await fetch(`https://codeload.github.com/MusieTesfaye/SENA/zip/refs/heads/${SENA_REF}`);
    if (!res.ok) fail(`could not download SENA's source: HTTP ${res.status}`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => /^[^/]+\/move\/sena\//.test(f.name) });
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const rel = name.split("/").slice(3).join(sep);
      mkdirSync(join(PACKAGE, rel, ".."), { recursive: true });
      writeFileSync(join(PACKAGE, rel), data);
    }
  }
}

// --- 2. Aptos accounts ------------------------------------------------------

step("2. Aptos accounts");
const APTOS_DIR = join(DIR, "aptos");
mkdirSync(APTOS_DIR, { recursive: true });
const aptos = (args: string[]) => spawnSync(APTOS, args, { cwd: APTOS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const accountOf = (profile: string): string | null => {
  try {
    const text = readFileSync(join(APTOS_DIR, ".aptos", "config.yaml"), "utf8");
    const m = new RegExp(`^  ${profile}:\\r?\\n(?:    .*\\r?\\n)*?    account: ([0-9a-f]+)`, "m").exec(text);
    return m ? `0x${m[1]}` : null;
  } catch {
    return null;
  }
};
const network = APTOS_NETWORK === "custom"
  ? ["--network", "custom", "--rest-url", APTOS_URL, "--faucet-url", process.env.APTOS_FAUCET_URL ?? ""]
  : ["--network", APTOS_NETWORK];
for (const profile of ["proposer", "challenger"]) {
  // stdin is empty, so `aptos init` generates a key instead of asking for one.
  if (!accountOf(profile)) aptos(["init", "--profile", profile, ...network, "--skip-faucet", "--assume-yes"]);
  if (!accountOf(profile)) fail(`could not create the Aptos profile ${profile}`);
}
const CONTRACT = accountOf("proposer")!;
const CHALLENGER = accountOf("challenger")!;
note(`proposer   ${CONTRACT}  (publishes the contracts and posts blocks)`);
note(`challenger ${CHALLENGER}  (the watcher)`);

async function balance(address: string): Promise<bigint> {
  try {
    const r = await fetch(`${APTOS_URL}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ function: "0x1::coin::balance", type_arguments: ["0x1::aptos_coin::AptosCoin"], arguments: [address] }),
    });
    return r.ok ? BigInt((await r.json())[0]) : 0n;
  } catch {
    return 0n;
  }
}
const apt = (o: bigint) => `${o / 100_000_000n}.${String((o % 100_000_000n) / 1_000_000n).padStart(2, "0")} APT`;
const PUBLISHED = join(DIR, ".published");
if (!existsSync(PUBLISHED)) {
  for (;;) {
    const [p, c] = await Promise.all([balance(CONTRACT), balance(CHALLENGER)]);
    if (p >= PROPOSER_NEEDS && c >= CHALLENGER_NEEDS) break;
    note(`waiting for testnet APT: proposer has ${apt(p)} of ${apt(PROPOSER_NEEDS)}, challenger ${apt(c)} of ${apt(CHALLENGER_NEEDS)}`);
    note("  fund them at https://aptos.dev/network/faucet (sign in, mint several times), or from a wallet such as Petra.");
    note("  Checking again in 30s; Ctrl+C to stop, and run this again later to carry on.");
    await Bun.sleep(30_000);
  }
  note("both accounts funded");
}

// --- 3. L2 keys and genesis -------------------------------------------------

step("3. L2 keys and genesis");
const KEYS = join(DIR, "keys");
const CHAIN = join(DIR, "chain");
const key = (name: string): { secret: string; address: string } => JSON.parse(readFileSync(join(KEYS, `${name}.json`), "utf8"));
if (!existsSync(join(CHAIN, "genesis.json"))) {
  mkdirSync(KEYS, { recursive: true });
  for (const name of ["faucet", "sequencer", "council", "issuer"]) {
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    writeFileSync(join(KEYS, `${name}.json`), JSON.stringify({ secret, address: sena.ed25519Address(secret) }, null, 2), { mode: 0o600 });
  }
  const { keys } = (await (await fetch("https://www.googleapis.com/oauth2/v3/certs")).json()) as { keys: { kid: string; n: string; kty: string; alg?: string }[] };
  const r = spawnSync(NODE, ["genesis", "--data-dir", CHAIN, "--dev", "--fund", `${key("faucet").address}:1`], { encoding: "utf8" });
  if (r.status !== 0) fail(`sena-node genesis failed: ${r.stderr}`);
  const path = join(CHAIN, "genesis.json");
  const g = JSON.parse(readFileSync(path, "utf8"));
  const coins: [number, string, string, number][] = [[1, "USDC", "1000000", 10_000], [2, "USDT", "1000000", 10_000], [3, "EURC", "925000", 15_000], [4, "DAI", "1000000", 10_000]];
  g.chain_id = CHAIN_NAME;
  g.network_salt = `${CHAIN_NAME}-salt`;
  g.gas_assets = coins.map(([asset, symbol, rate, intrinsic_gas]) => ({ asset, symbol, rate, intrinsic_gas, enabled: true }));
  g.allocations = [
    ...coins.map(([asset]) => ({ address: key("faucet").address, asset, amount: "100000000000000" })),
    { address: key("council").address, asset: 1, amount: "10000000000" },
  ];
  g.council = { members: [key("council").address.slice(2)], threshold: 1 };
  g.keyless = {
    setup: "aptos-keyless-mainnet-2025-01",
    jwks: keys.filter((k) => k.kty === "RSA" && (k.alg ?? "RS256") === "RS256").map((k) => ({ iss: "https://accounts.google.com", kid: k.kid, n: k.n })),
  };
  writeFileSync(path, JSON.stringify(g, null, 2));
}
const inspected = spawnSync(NODE, ["inspect-genesis", "--data-dir", CHAIN], { encoding: "utf8" });
if (inspected.status !== 0) fail(`the genesis does not validate: ${inspected.stderr}`);
const { state_root: ROOT, transaction_chain_id: CHAIN_ID } = JSON.parse(inspected.stdout);
mkdirSync(join(DIR, "watcher"), { recursive: true });
cpSync(join(CHAIN, "genesis.json"), join(DIR, "watcher", "genesis.json"));
note(`chain ${CHAIN_NAME}, id ${CHAIN_ID}, genesis root ${ROOT}`);

// --- 4. Publish and initialise on Aptos --------------------------------------

step("4. Publish and initialise on Aptos");
const ok = (r: { stdout: string; stderr: string }) => r.stdout.includes('"success": true');
if (!existsSync(PUBLISHED)) {
  note("publishing (a few minutes; the package goes up in chunks)");
  const r = aptos(["move", "publish", "--package-dir", PACKAGE, "--named-addresses", `sena=${CONTRACT}`,
    "--chunked-publish", "--large-packages-module-address", "0x7", "--profile", "proposer",
    "--max-gas", "2000000", "--gas-unit-price", "100", "--assume-yes"]);
  if (!ok(r)) fail(`publish failed:\n${(r.stdout + r.stderr).slice(-3000)}`);
  writeFileSync(PUBLISHED, CONTRACT);
  note(`package published at ${CONTRACT}`);
}
const INITIALISED = join(DIR, ".initialised");
if (!existsSync(INITIALISED)) {
  const run = (fn: string, args: string[]) =>
    aptos(["move", "run", "--profile", "proposer", "--max-gas", "200000", "--gas-unit-price", "100", "--assume-yes",
      "--function-id", `${CONTRACT}::${fn}`, "--args", ...args]);
  // Genesis root, 24-hour window, 0.01 APT minimum bond in APT (0xa), the
  // proposer as treasury, batches at most an hour behind L1.
  let r = run("assertions::initialize", [`hex:0x${ROOT}`, "u64:86400", "u128:1000000", "address:0xa", `address:${CONTRACT}`, "u64:3600"]);
  if (!ok(r)) fail(`assertions::initialize failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
  // Keyless setup 1: the Aptos Keyless mainnet ceremony, which Aptos's prover proves for.
  r = run("disputes::initialize", [`address:${CONTRACT}`, "u8:1", `u64:${CHAIN_ID}`]);
  if (!ok(r)) fail(`disputes::initialize failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
  writeFileSync(INITIALISED, "");
  note("initialised");
}

// --- 5. The web wallet ------------------------------------------------------

step(`5. Build the web wallet for ${BASE}`);
const ISSUER = key("issuer").address;
if (!process.argv.includes("--no-build")) {
  const r = spawnSync(process.execPath, ["run", "build:all"], {
    cwd: HERE, encoding: "utf8",
    env: { ...process.env, VITE_SENA_RPC_URL: `${BASE}/rpc`, VITE_FAUCET_URL: `${BASE}/faucet`, VITE_ISSUER_URL: `${BASE}/issuer`,
      VITE_TRUSTED_ISSUERS: ISSUER, VITE_POLL_MS: "5000" },
  });
  if (r.status !== 0) fail(`the wallet did not build:\n${(r.stdout + r.stderr).slice(-3000)}`);
}
const DIST = join(HERE, "dist");
if (!existsSync(join(DIST, "index.html"))) fail("no dist/index.html; run without --no-build");

// --- 6. Run -----------------------------------------------------------------

step("6. Start");
for (const port of [P.node, P.faucet, P.issuer, PORT]) {
  const taken = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
  if (taken) fail(`port ${port} is in use (an earlier \`bun run testnet\` or \`bun run devnet\`?). Stop it and try again.`);
}
const RPC = `http://127.0.0.1:${P.node}`;
const children = new Map<string, ChildProcess>();
let stopping = false;
const aptosArgs = ["--aptos-url", APTOS_URL, "--contract", CONTRACT, "--aptos-bin", APTOS];
const services: { name: string; cmd: string; args: string[]; cwd?: string; env?: Record<string, string>; when?: boolean }[] = [
  { name: "node", cmd: NODE, args: ["run", "--data-dir", CHAIN, "--listen", `127.0.0.1:${P.node}`, "--block-interval", "2",
    "--fee-recipient", key("sequencer").address, "--cors-origin", "*", "--trust-forwarded-for", "--rate-limit", "300"] },
  { name: "relayer", cmd: NODE, cwd: APTOS_DIR, args: ["relay", "--rpc", RPC, ...aptosArgs, "--profile", "proposer", "--account", CONTRACT,
    "--state", join(DIR, "relayer.json"), "--poll-interval", "15"] },
  { name: "watcher", cmd: NODE, cwd: APTOS_DIR, args: ["watch", "--data-dir", join(DIR, "watcher"), ...aptosArgs, "--profile", "challenger",
    "--account", CHALLENGER, "--state", join(DIR, "watcher.json"), "--poll-interval", "30"] },
  { name: "jwk-sync", cmd: NODE, args: ["jwk-sync", "--rpc", RPC, "--key-file", join(KEYS, "council.json"), "--state", join(DIR, "jwk-sync.json"), "--interval", "3600"] },
  { name: "faucet", cmd: process.execPath, args: [join(HERE, "server.ts")], env: {
    FAUCET_KEY_FILE: join(KEYS, "faucet.json"), VITE_SENA_RPC_URL: RPC, FAUCET_PORT: String(P.faucet), FAUCET_HOST: "127.0.0.1",
    WALLET_ORIGINS: "*", FAUCET_TRUST_PROXY: "1", FAUCET_COOLDOWN_SECS: "300", FAUCET_PER_IP_PER_HOUR: "12", FAUCET_TOTAL_PER_HOUR: "600" } },
  { name: "issuer", cmd: process.execPath, args: [join(HERE, "issuer.ts")], when: existsSync(join(HERE, "issuer.config.json")), env: {
    ISSUER_KEY_FILE: join(KEYS, "issuer.json"), VITE_SENA_RPC_URL: RPC, ISSUER_PORT: String(P.issuer), ISSUER_HOST: "127.0.0.1",
    ISSUER_PUBLIC_URL: `${BASE}/issuer`, WALLET_ORIGINS: `${BASE},https://${EXTENSION_ID}.chromiumapp.org,chrome-extension://${EXTENSION_ID}` } },
];

function start(s: (typeof services)[number]) {
  const child = spawn(s.cmd, s.args, { cwd: s.cwd ?? HERE, env: { ...process.env, ...s.env }, stdio: ["ignore", "pipe", "pipe"] });
  children.set(s.name, child);
  const tag = `[${s.name}]`.padEnd(11);
  for (const stream of [child.stdout!, child.stderr!]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop()!;
      for (const line of lines) if (line.trim()) console.log(`${tag} ${line}`);
    });
  }
  child.on("exit", (code) => {
    if (stopping) return;
    console.log(`${tag} exited (${code}); restarting in 5s`);
    setTimeout(() => !stopping && start(s), 5000);
  });
}
const stopAll = () => {
  stopping = true;
  for (const c of children.values()) c.kill();
  process.exit(0);
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

start(services[0]);
for (let i = 0; ; i++) {
  try {
    await fetch(RPC, { method: "POST", body: '{"method":"sena_getChainInfo"}' });
    break;
  } catch {
    if (i > 100) fail("sena-node did not start");
    await Bun.sleep(100);
  }
}
for (const s of services.slice(1)) if (s.when !== false) start(s);
if (!existsSync(join(HERE, "issuer.config.json"))) note("no issuer.config.json, so no identity issuer (see README, section 5)");

// The one address a tunnel forwards to. A tunnel ends TLS and connects from
// this machine, adding the visitor's address to X-Forwarded-For; the
// rightmost entry is the one the tunnel added, and only it is passed on.
const ROUTES: [string, number][] = [["/rpc", P.node], ["/faucet", P.faucet], ["/issuer", P.issuer]];
const SECURITY = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};
Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url);
    const route = ROUTES.find(([prefix]) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    if (route) {
      const [prefix, port] = route;
      const forwarded = req.headers.get("X-Forwarded-For")?.split(",").pop()?.trim();
      const client = forwarded || server.requestIP(req)?.address || "unknown";
      const headers = new Headers(req.headers);
      headers.set("X-Forwarded-For", client);
      headers.delete("Host");
      try {
        const upstream = await fetch(`http://127.0.0.1:${port}${url.pathname.slice(prefix.length) || "/"}${url.search}`, {
          method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(), redirect: "manual",
        });
        // fetch has already decoded the body, so its encoding and length go.
        const out = new Headers(upstream.headers);
        out.delete("Content-Encoding");
        out.delete("Content-Length");
        return new Response(upstream.body, { status: upstream.status, headers: out });
      } catch {
        return Response.json({ error: `${prefix.slice(1)} is not running` }, { status: 502 });
      }
    }
    // The wallet: a file from dist/, or index.html for the app's own paths.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    let file = resolve(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    return new Response(Bun.file(file), { headers: SECURITY });
  },
});

writeFileSync(join(DIR, "testnet.json"), JSON.stringify({
  chain: CHAIN_NAME, transaction_chain_id: CHAIN_ID, genesis_state_root: ROOT, wallet: `${BASE}/`, rpc: `${BASE}/rpc`,
  faucet: `${BASE}/faucet`, issuer: `${BASE}/issuer`, issuer_address: ISSUER, faucet_address: key("faucet").address,
  aptos_contract: CONTRACT, aptos_network: APTOS_NETWORK,
}, null, 2));

step("Running");
note(`wallet     ${BASE}/   (served on http://127.0.0.1:${PORT})`);
note(`rpc        ${BASE}/rpc`);
note(`contracts  https://explorer.aptoslabs.com/account/${CONTRACT}/modules?network=${APTOS_NETWORK}`);
if (host) note(`HTTPS: in another terminal, run  tailscale funnel --bg ${PORT}  (once is enough; it stays on)`);
note("Ctrl+C stops everything; run `bun run testnet` again to resume. Back up the .testnet folder.");
console.log("");
