// Browser test of the wallet against a live SENA node and the faucet.
//
// Starts a sequencer, the faucet (server.ts) and the wallet (vite), then
// drives the wallet in Chromium: ask the faucet for each stablecoin, send
// some of each, paying the fee in that coin, and check what the wallet shows
// against the node.
//
// Google cannot sign in here, so the browser is given an account the way a
// sign-in leaves it, built from Aptos's published keyless sample (whose proof
// is Aptos's real circuit proof, for the insecure devnet parameters) with the
// same SENA code the wallet uses. Everything after sign-in is the real wallet.
//
//   bun run test:e2e [path/to/SENA]
// needs, in SENA: cargo build --release -p sena-node, and
//   cargo run -q -p sena-wasm --example keyless_sample > target/keyless-sample.json

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import * as sena from "../src/sena/sena_wasm.js";

const HERE = resolve(import.meta.dir, "..");
const SENA = resolve(process.argv[2] ?? join(HERE, "..", "SENA"));
const NODE = join(SENA, "target", "release", "sena-node");
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const NODE_PORT = 18_546, FAUCET_PORT = 3_999, WEB_PORT = 5_199;
const RPC = `http://127.0.0.1:${NODE_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const SHOTS = process.env.SHOTS_DIR ?? tmpdir();

sena.initSync({ module: readFileSync(join(HERE, "src", "sena", "sena_wasm_bg.wasm")) });
const samplePath = join(SENA, "target", "keyless-sample.json");
if (!existsSync(samplePath)) throw new Error(`missing ${samplePath}; see the header of this file`);
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

const COINS: [number, string, string, number][] = [
  [1, "USDC", "1000000", 10_000],
  [2, "USDT", "1000000", 10_000],
  [3, "EURC", "925000", 15_000],
  [4, "DAI", "1000000", 10_000],
];

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ok    ${name}`); } else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc(method: string, params?: unknown): Promise<any> {
  const r = await fetch(RPC, { method: "POST", body: JSON.stringify(params === undefined ? { method } : { method, params }) });
  return r.json();
}
async function waitFor(url: string, init?: RequestInit) {
  for (let i = 0; i < 100; i++) {
    try { await fetch(url, init); return; } catch { await sleep(200); }
  }
  throw new Error(`${url} did not come up`);
}
const units = (s: string) => {
  const [w, f = ""] = s.replace(/,/g, "").split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"));
};

const dir = mkdtempSync(join(tmpdir(), "sena-wallet-e2e-"));
const procs: ChildProcess[] = [];
try {
  // --- A chain with four stablecoins, a funded faucet, and keyless accounts.
  const data = join(dir, "data");
  const faucetSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const faucet = sena.ed25519Address(faucetSecret);
  writeFileSync(join(dir, "faucet.json"), JSON.stringify({ secret: faucetSecret, address: faucet }));
  execFileSync(NODE, ["genesis", "--data-dir", data, "--dev", "--fund", `${faucet}:1`]);
  const genesis = JSON.parse(readFileSync(join(data, "genesis.json"), "utf8"));
  genesis.gas_assets = COINS.map(([asset, symbol, rate, intrinsic_gas]) => ({ asset, symbol, rate, intrinsic_gas, enabled: true }));
  genesis.allocations = COINS.map(([asset]) => ({ address: faucet, asset, amount: "1000000000000" }));
  genesis.keyless = { setup: "aptos-keyless-devnet-insecure", allow_insecure_test_setup: true, jwks: [sample.jwk] };
  writeFileSync(join(data, "genesis.json"), JSON.stringify(genesis));

  procs.push(spawn(NODE, ["run", "--data-dir", data, "--listen", `127.0.0.1:${NODE_PORT}`, "--block-interval", "1", "--cors-origin", WEB], { stdio: "ignore" }));
  await waitFor(RPC, { method: "POST", body: '{"method":"sena_getChainInfo"}' });
  const env = { ...process.env, FAUCET_KEY_FILE: join(dir, "faucet.json"), VITE_SENA_RPC_URL: RPC, FAUCET_PORT: String(FAUCET_PORT), WALLET_ORIGINS: WEB };
  const fp = spawn("bun", ["server.ts"], { cwd: HERE, env, stdio: ["ignore", "pipe", "pipe"] });
  let faucetOut = "";
  fp.stdout!.on("data", (d) => (faucetOut += d));
  fp.stderr!.on("data", (d) => (faucetOut += d));
  procs.push(fp);
  await waitFor(`http://127.0.0.1:${FAUCET_PORT}/`);
  procs.push(spawn("bunx", ["vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: HERE, stdio: "ignore",
    env: { ...process.env, VITE_SENA_RPC_URL: RPC, VITE_FAUCET_URL: `http://127.0.0.1:${FAUCET_PORT}`, VITE_GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com" },
  }));
  await waitFor(WEB);

  // --- The account a sign-in leaves in storage, from the Aptos sample.
  const session = JSON.parse(sena.newSession(BigInt(sample.exp_date_secs), Buffer.from(sample.random, "hex")));
  const signature = sena.assembleSignature(sample.jwt, JSON.stringify(session), sample.pepper, BigInt(sample.exp_horizon_secs),
    sample.jwk.n, sample.extra_field, JSON.stringify(sample.prover_response));
  const address = sena.keylessAddress(sample.jwt, sample.pepper);
  const account = { address, email: "sample@test.oidc.provider", name: "Aptos Sample", picture: "", jwt: sample.jwt, session, pepper: sample.pepper, signature };
  const bob = sena.ed25519Address(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("request", (r) => { if (r.url().includes(String(FAUCET_PORT))) logs.push(`request ${r.method()} ${r.url()}`); });
  page.on("requestfailed", (r) => logs.push(`failed ${r.url()} ${r.failure()?.errorText}`));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} for ${r.url()}`); });
  await page.addInitScript(([a]) => {
    localStorage.setItem("sena.accounts", JSON.stringify([a]));
    localStorage.setItem("sena.active", JSON.stringify(a.address));
  }, [account] as const);
  // Vite optimises dependencies on a first run and reloads the page; let it settle.
  await page.goto(WEB, { waitUntil: "networkidle" });
  await sleep(1000);
  await page.waitForLoadState("networkidle");

  console.log("Wallet loads from the node");
  await page.getByText("sena-devnet-1").waitFor({ timeout: 15_000 });
  check("network badge shows the node's chain", true);
  await page.locator(".coin").first().waitFor();
  const symbols = await page.locator(".coin-symbol").allTextContents();
  check(`coins listed from sena_getFeeAssets: ${symbols.join(", ")}`, symbols.join() === "USDC,USDT,EURC,DAI");
  check("address shown is the keyless account's", (await page.locator(".addr").textContent())!.includes(address.slice(0, 12)));

  for (const [assetId, symbol] of COINS) {
    console.log(`\n${symbol}`);
    const card = page.locator(".coin", { has: page.locator(".coin-symbol", { hasText: new RegExp(`^${symbol}$`) }) });
    await card.getByRole("button", { name: /Faucet/ }).click();
    try {
      await card.locator(".coin-balance", { hasText: "100.00" }).waitFor({ timeout: 20_000 });
    } catch {
      await page.screenshot({ path: join(SHOTS, "wallet-e2e-failure.png"), fullPage: true });
      throw new Error(`no faucet payment.\nfaucet log:\n${faucetOut}\npage: ${errors.join(" | ")}\nlogs: ${logs.join(" | ")}`);
    }
    check(`faucet: 100.00 ${symbol} arrived`, true);

    await card.getByRole("button", { name: /Send/ }).click();
    await page.locator(".modal-card input.mono").first().fill(bob);
    await page.locator(".modal-card input[inputmode=decimal]").fill("12.5");
    await page.locator(".modal-card .btn-primary").click();
    await page.locator(".modal-card .alert-ok").waitFor({ timeout: 30_000 });
    const okText = (await page.locator(".modal-card .alert-ok").textContent()) ?? "";
    check(`sent 12.50 ${symbol}: "${okText.split(".")[0].trim()}…"`, /block #\d+/.test(okText), okText);
    await page.getByRole("button", { name: /Done/ }).click();

    const hist = await rpc("sena_getAccountTransactions", { address });
    const sent = hist.transactions.find((t: any) => t.transaction.sender === address && t.transaction.payload.asset === assetId);
    const fee = BigInt(sent.fee_paid);
    check(`${symbol} fee ${fee} paid in ${symbol}`, sent.transaction.fee_asset === assetId && fee > 0n);
    const expected = 100_000_000n - 12_500_000n - fee;
    await sleep(2500); // the wallet polls every 2 s
    const shown = units((await card.locator(".coin-balance").textContent())!.trim());
    check(`${symbol} balance shown ${shown} = 100 − 12.5 − fee`, shown === expected, `expected ${expected}`);
    const onChain = (await rpc("sena_getAccount", { address: bob })).balances.find((b: any) => b.asset === assetId);
    check(`recipient holds 12.50 ${symbol} on chain`, onChain?.amount === "12500000");
  }

  console.log("\nActivity");
  const rows = await page.locator(".row").count();
  check(`activity lists ${rows} entries (4 faucet payments, 4 sends)`, rows === 8);
  check("faucet payments are labelled", (await page.getByText("From Faucet").count()) === 4);
  await page.screenshot({ path: join(SHOTS, "wallet-e2e.png"), fullPage: true });

  console.log("\nRefusals");
  const card = page.locator(".coin").first();
  await card.getByRole("button", { name: /Send/ }).click();
  await page.locator(".modal-card input.mono").first().fill(bob);
  await page.locator(".modal-card input[inputmode=decimal]").fill("1000");
  check("sending more than the balance is blocked", await page.locator(".modal-card .btn-primary").isDisabled());
  await page.locator(".modal-card input.mono").first().fill("0x1234");
  check("a malformed address is blocked", await page.locator(".modal-card .btn-primary").isDisabled());

  check(`no errors in the page${errors.length ? `: ${errors.join(" | ")}` : ""}`, errors.length === 0);
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
