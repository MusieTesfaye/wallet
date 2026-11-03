// Browser test of the SENA extension against a live node.
//
// Builds the extension for a local chain, loads it into Chromium, and checks:
// its id is the fixed one the Google and issuer redirect URIs name; the popup
// shows the account and the faucet pays it; a website connects through
// window.sena and is paid after approval in the extension's window, and is
// refused when the user rejects; and an identity is linked through the
// issuer by chrome.identity, in the worker, with stand-in providers.
//
// As in e2e.ts, Google cannot sign in here, so the extension is given the
// account a sign-in leaves, built from Aptos's keyless sample.
//
//   bun run test:extension [path/to/SENA]

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import * as sena from "../src/sena/sena_wasm.js";
import { startProviders } from "./test-providers";

const HERE = resolve(import.meta.dir, "..");
const SENA = resolve(process.argv[2] ?? join(HERE, "..", "SENA"));
const NODE = join(SENA, "target", "release", "sena-node");
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXTENSION_ID = "phkknehihpoajnkoiabbbknbjaonflad";
const P = { node: 18_746, faucet: 3_899, issuer: 3_898, dapp: 5_299, oidc: 3_894, oauth: 3_895, twilio: 3_896 };
const RPC = `http://127.0.0.1:${P.node}`;
const FAUCET = `http://127.0.0.1:${P.faucet}`;
const ISSUER = `http://127.0.0.1:${P.issuer}`;
const DAPP = `http://127.0.0.1:${P.dapp}`;

sena.initSync({ module: readFileSync(join(HERE, "src", "sena", "sena_wasm_bg.wasm")) });
const samplePath = join(SENA, "target", "keyless-sample.json");
if (!existsSync(samplePath)) throw new Error(`missing ${samplePath}; see scripts/e2e.ts`);
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ok    ${name}`); } else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rpc = async (method: string, params?: unknown): Promise<any> =>
  (await fetch(RPC, { method: "POST", body: JSON.stringify(params === undefined ? { method } : { method, params }) })).json();
async function waitFor(url: string, init?: RequestInit) {
  for (let i = 0; i < 100; i++) { try { await fetch(url, init); return; } catch { await sleep(200); } }
  throw new Error(`${url} did not come up`);
}
const balance = async (address: string, asset: number) =>
  BigInt((await rpc("sena_getAccount", { address })).balances.find((b: any) => b.asset === asset)?.amount ?? "0");

const dir = mkdtempSync(join(tmpdir(), "sena-extension-e2e-"));
const procs: ChildProcess[] = [];
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
try {
  // --- Chain, faucet, issuer, and a website that uses window.sena.
  const data = join(dir, "data");
  const faucetSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const faucet = sena.ed25519Address(faucetSecret);
  writeFileSync(join(dir, "faucet.json"), JSON.stringify({ secret: faucetSecret, address: faucet }));
  execFileSync(NODE, ["genesis", "--data-dir", data, "--dev", "--fund", `${faucet}:1`]);
  const genesis = JSON.parse(readFileSync(join(data, "genesis.json"), "utf8"));
  genesis.gas_assets = [{ asset: 1, symbol: "USDC", rate: "1000000", intrinsic_gas: 10_000, enabled: true }];
  genesis.allocations = [{ address: faucet, asset: 1, amount: "1000000000000" }];
  genesis.keyless = { setup: "aptos-keyless-devnet-insecure", allow_insecure_test_setup: true, jwks: [sample.jwk] };
  writeFileSync(join(data, "genesis.json"), JSON.stringify(genesis));
  procs.push(spawn(NODE, ["run", "--data-dir", data, "--listen", `127.0.0.1:${P.node}`, "--block-interval", "1", "--cors-origin", "*"], { stdio: "ignore" }));
  await waitFor(RPC, { method: "POST", body: '{"method":"sena_getChainInfo"}' });
  procs.push(spawn("bun", ["server.ts"], {
    cwd: HERE, stdio: "ignore",
    env: { ...process.env, FAUCET_KEY_FILE: join(dir, "faucet.json"), VITE_SENA_RPC_URL: RPC, FAUCET_PORT: String(P.faucet), WALLET_ORIGINS: "*" },
  }));
  await waitFor(`${FAUCET}/`);

  const providers = await startProviders({ oidc: P.oidc, oauth: P.oauth, twilio: P.twilio });
  const issuerSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  writeFileSync(join(dir, "issuer.json"), JSON.stringify({ secret: issuerSecret, address: sena.ed25519Address(issuerSecret) }));
  writeFileSync(join(dir, "issuer.config.json"), JSON.stringify(providers.config()));
  procs.push(spawn("bun", ["issuer.ts"], {
    cwd: HERE, stdio: "ignore",
    env: { ...process.env, ISSUER_CONFIG: join(dir, "issuer.config.json"), ISSUER_KEY_FILE: join(dir, "issuer.json"), ACME_SECRET: "oidc-secret",
      ISSUER_PORT: String(P.issuer), ISSUER_PUBLIC_URL: ISSUER, VITE_SENA_RPC_URL: RPC,
      // The extension's redirect address, where chrome.identity ends a flow.
      WALLET_ORIGINS: `https://${EXTENSION_ID}.chromiumapp.org,chrome-extension://${EXTENSION_ID}` },
  }));
  await waitFor(`${ISSUER}/`);

  const dappServer = Bun.serve({
    port: P.dapp,
    fetch: () => new Response("<!doctype html><title>Shop</title><h1>A shop that takes SENA</h1>", { headers: { "Content-Type": "text/html" } }),
  });

  // --- Build the extension for this chain.
  execFileSync("bunx", ["vite", "build", "--mode", "extension", "--logLevel", "error"], {
    cwd: HERE, stdio: "inherit",
    env: { ...process.env, VITE_SENA_RPC_URL: RPC, VITE_FAUCET_URL: FAUCET, VITE_ISSUER_URL: ISSUER, VITE_GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com" },
  });
  const ext = join(HERE, "dist-extension");

  context = await chromium.launchPersistentContext(join(dir, "profile"), {
    executablePath: CHROME,
    headless: true,
    args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  console.log("The extension");
  check(`loads with the fixed id ${id}`, id === EXTENSION_ID, id);

  // --- The popup, with the account a sign-in leaves.
  const session = JSON.parse(sena.newSession(BigInt(sample.exp_date_secs), Buffer.from(sample.random, "hex")));
  const signature = sena.assembleSignature(sample.jwt, JSON.stringify(session), sample.pepper, BigInt(sample.exp_horizon_secs),
    sample.jwk.n, sample.extra_field, JSON.stringify(sample.prover_response));
  const address = sena.keylessAddress(sample.jwt, sample.pepper);
  const account = { address, email: "sample@test.oidc.provider", name: "Aptos Sample", picture: "", jwt: sample.jwt, session, pepper: sample.pepper, signature };
  const popup = await context.newPage();
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && errors.push(`${p.url()}: ${m.text()}`));
  };
  watch(popup);
  await popup.goto(`chrome-extension://${id}/index.html?popup=1`);
  await popup.evaluate((a) => {
    localStorage.setItem("sena.accounts", JSON.stringify([a]));
    localStorage.setItem("sena.active", JSON.stringify(a.address));
  }, account);
  await popup.reload();
  await popup.locator(".coin").first().waitFor({ timeout: 15_000 });
  check("the popup shows the account", (await popup.locator(".addr").textContent())!.includes(address.slice(0, 12)));
  const width = await popup.evaluate(() => document.body.getBoundingClientRect().width);
  check(`it is laid out for the popup (${width}px wide)`, width === 380);
  await popup.locator(".coin").first().getByRole("button", { name: /Faucet/ }).click();
  await popup.locator(".coin-balance", { hasText: "100.00" }).waitFor({ timeout: 20_000 });
  check("the faucet paid 100.00 USDC into it", (await balance(address, 1)) === 100_000_000n);

  // --- A website connects and asks to be paid.
  console.log("\nA website, through window.sena");
  const shop = await context.newPage();
  watch(shop);
  await shop.goto(DAPP);
  check("window.sena is injected", await shop.evaluate(() => (window as any).sena?.isSena === true));
  check("it sees no account before connecting", (await shop.evaluate(() => (window as any).sena.request({ method: "sena_accounts" }))).length === 0);

  const connecting = shop.evaluate(() => (window as any).sena.request({ method: "sena_requestAccounts" }));
  const approval = await context.waitForEvent("page");
  watch(approval);
  await approval.getByText("Connect to 127.0.0.1").waitFor({ timeout: 10_000 });
  check("connecting opens the extension's approval window", approval.url().startsWith(`chrome-extension://${id}/index.html#/approve`));
  await approval.getByRole("button", { name: "Connect" }).click();
  const accounts = await connecting;
  check("approved: the site gets the address", accounts.join() === address, JSON.stringify(accounts));

  const shopAddress = sena.ed25519Address(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));
  const paying = shop.evaluate((to) => (window as any).sena.request({ method: "sena_sendTransfer", params: { to, asset: 1, amount: "2500000" } }), shopAddress);
  const pay = await context.waitForEvent("page");
  watch(pay);
  await pay.locator(".amount").waitFor({ timeout: 10_000 });
  const shown = (await pay.locator(".amount").textContent())!.replace(/\s+/g, " ").trim();
  check(`the payment is shown before approval: "${shown}"`, shown === "2.50 USDC");
  await pay.getByText(/up to [\d.]+ USDC/).waitFor({ timeout: 10_000 });
  await pay.getByRole("button", { name: "Approve" }).click();
  const paid = await paying;
  check(`approved: paid in block #${paid.height}`, typeof paid.hash === "string" && paid.height > 0, JSON.stringify(paid));
  check("the shop holds 2.50 USDC on chain", (await balance(shopAddress, 1)) === 2_500_000n);

  const refused = shop.evaluate((to) => (window as any).sena.request({ method: "sena_sendTransfer", params: { to, asset: 1, amount: "1000000" } })
    .then(() => "paid", (e: Error) => e.message), shopAddress);
  const second = await context.waitForEvent("page");
  await second.getByRole("button", { name: "Reject" }).waitFor({ timeout: 10_000 });
  await second.getByRole("button", { name: "Reject" }).click();
  check(`rejected: the site is told so ("${await refused}")`, /rejected/.test(await refused));
  check("and nothing moved", (await balance(shopAddress, 1)) === 2_500_000n);

  const other = await context.newPage();
  await other.goto(DAPP.replace("127.0.0.1", "localhost"));
  const sneaky = await other.evaluate(() => (window as any).sena.request({ method: "sena_sendTransfer", params: { to: "0x" + "11".repeat(32), asset: 1, amount: "1" } })
    .then(() => "paid", (e: Error) => e.message));
  check(`another site that never connected is refused ("${sneaky}")`, /Connect first/.test(sneaky));

  // --- Link an identity: issuer → provider → issuer → chromiumapp.org, in the worker.
  console.log("\nLinking an identity through chrome.identity");
  await popup.bringToFront();
  await popup.reload();
  await popup.locator(".card", { hasText: "Find me by" }).getByRole("button", { name: /Acme ID/ }).click();
  await popup.locator(".toast", { hasText: "Linked" }).waitFor({ timeout: 30_000 });
  check(`linked: "${(await popup.locator(".toast").textContent())?.trim()}"`, true);
  const info = await rpc("sena_getChainInfo");
  const found = (await rpc("sena_lookupAttestations", { identifier: sena.hashIdentifier("mailto", "alice@example.com", info.network_salt),
    trusted_issuers: [sena.ed25519Address(issuerSecret)] })).attestations ?? [];
  check("alice@example.com resolves to the account on chain", found[0]?.account === address);

  check("no errors in any extension page", errors.length === 0, errors.join("\n"));
  dappServer.stop(true);
  providers.stop();
} finally {
  await context?.close();
  for (const p of procs) p.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
