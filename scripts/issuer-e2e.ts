// End-to-end test of the attestation issuer (issuer.ts) against a live node.
//
// Real issuer, real node, real attestations on chain. The identity providers
// are stand-ins served by this test — an OpenID Connect provider with its own
// RSA key, an OAuth 2 provider and a Twilio Verify API — since no real one
// signs in an automated test. They speak the same protocols the real ones do,
// so every code path the issuer runs against Google, Apple, GitHub or Twilio
// runs here: discovery, PKCE, the token exchange, ID-token verification,
// user-info, code checks.
//
//   bun scripts/issuer-e2e.ts [path/to/SENA]   (needs SENA's release sena-node)

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as sena from "../src/sena/sena_wasm.js";
import { startProviders } from "./test-providers";

const HERE = resolve(import.meta.dir, "..");
const SENA = resolve(process.argv[2] ?? join(HERE, "..", "SENA"));
const NODE = join(SENA, "target", "release", "sena-node");
const P = { node: 18_646, issuer: 3_903, oidc: 3_904, oauth: 3_905, twilio: 3_906 };
const RPC = `http://127.0.0.1:${P.node}`;
const ISSUER = `http://localhost:${P.issuer}`;
const WALLET = "http://localhost:5173";

sena.initSync({ module: readFileSync(join(HERE, "src", "sena", "sena_wasm_bg.wasm")) });

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ok    ${name}`); } else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function rpc(method: string, params?: unknown): Promise<any> {
  const r = await fetch(RPC, { method: "POST", body: JSON.stringify(params === undefined ? { method } : { method, params }) });
  return r.json();
}
async function up(url: string, init?: RequestInit) {
  for (let i = 0; i < 100; i++) { try { await fetch(url, init); return; } catch { await sleep(100); } }
  throw new Error(`${url} did not come up`);
}

// --- Stand-in providers --------------------------------------------------------

const providers = await startProviders({ oidc: P.oidc, oauth: P.oauth, twilio: P.twilio });

// --- The chain, and the issuer ---------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "sena-issuer-e2e-"));
const procs: ChildProcess[] = [];
try {
  const key = () => {
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    return { secret, address: sena.ed25519Address(secret) };
  };
  const alice = key(), bob = key(), issuerKey = key();
  execFileSync(NODE, ["genesis", "--data-dir", join(dir, "chain"), "--dev", "--fund", `${alice.address}:100000000`, "--fund", `${bob.address}:100000000`]);
  procs.push(spawn(NODE, ["run", "--data-dir", join(dir, "chain"), "--listen", `127.0.0.1:${P.node}`, "--block-interval", "1"], { stdio: "ignore" }));
  await up(RPC, { method: "POST", body: '{"method":"sena_getChainInfo"}' });
  const info = await rpc("sena_getChainInfo");

  writeFileSync(join(dir, "issuer.json"), JSON.stringify(issuerKey));
  writeFileSync(join(dir, "issuer.config.json"), JSON.stringify(providers.config()));
  let issuerOut = "";
  const ip = spawn(process.execPath, [join(HERE, "issuer.ts")], {
    env: { ...process.env, ISSUER_CONFIG: join(dir, "issuer.config.json"), ISSUER_KEY_FILE: join(dir, "issuer.json"), ACME_SECRET: "oidc-secret",
      ISSUER_PORT: String(P.issuer), ISSUER_PUBLIC_URL: ISSUER, VITE_SENA_RPC_URL: RPC, WALLET_ORIGINS: WALLET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  ip.stdout!.on("data", (d) => (issuerOut += d));
  ip.stderr!.on("data", (d) => (issuerOut += d));
  procs.push(ip);
  await up(`${ISSUER}/`);

  // What a wallet does: follow the redirects, read the attestation the issuer
  // hands back in the URL fragment, and submit it from the account.
  async function link(provider: string, account: string, back = `${WALLET}/`): Promise<{ attestation?: any; error?: string; status?: number }> {
    let url = `${ISSUER}/link/${provider}?account=${account}&return=${encodeURIComponent(back)}`;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(url, { redirect: "manual" });
      const loc = res.headers.get("Location");
      if (!loc) return { status: res.status, error: (await res.json().catch(() => ({}))).error };
      if (loc.startsWith(WALLET)) {
        const frag = new URLSearchParams(new URL(loc).hash.slice(1));
        const decode = (k: string) => JSON.parse(Buffer.from(frag.get(k)!, "base64url").toString());
        return frag.has("sena_attestation") ? { attestation: decode("sena_attestation") } : { error: decode("sena_attestation_error") };
      }
      url = loc;
    }
    throw new Error("too many redirects");
  }
  async function submit(from: { secret: string; address: string }, a: any) {
    const q = await rpc("sena_gasPrice", { asset: 1 });
    const nonce = (await rpc("sena_getAccount", { address: from.address })).nonce;
    const payload = JSON.stringify({ kind: "register_attestation", identifier: a.identifier, issuer: a.issuer, account: a.account, issued_on: a.issued_on, signature: a.signature });
    const tx = sena.buildTransaction(BigInt(info.transaction_chain_id), from.address, BigInt(nonce), payload, 1, q.rate, BigInt(q.intrinsic_gas), q.suggested_max_fee_per_gas, "0");
    const signed = sena.signEd25519(tx, from.secret);
    const res = await (await fetch(RPC, { method: "POST", body: sena.submitRequest(signed) })).json();
    const hash = sena.transactionHash(signed);
    for (let i = 0; i < 40 && res.result === "submitted"; i++) {
      if ((await rpc("sena_getConfirmation", { hash })).status === "soft_confirmed") return true;
      await sleep(250);
    }
    return false;
  }
  const lookup = async (prefix: string, plaintext: string) =>
    ((await rpc("sena_lookupAttestations", { identifier: sena.hashIdentifier(prefix, plaintext, info.network_salt), trusted_issuers: [issuerKey.address] })).attestations ?? [])
      .map((a: any) => a.account);

  console.log("Issuer");
  const about = await (await fetch(`${ISSUER}/`)).json();
  check(`lists its providers: ${about.providers.map((p: any) => `${p.id}→${p.prefix}`).join(", ")}`,
    about.issuer === issuerKey.address && about.providers.length === 3);

  console.log("\nOpenID Connect (any provider: Google, Apple, Twitch, ...)");
  let r = await link("acme", alice.address);
  check(`signed in, attested ${r.attestation?.prefix}:${r.attestation?.plaintext}`, r.attestation?.account === alice.address, JSON.stringify(r));
  check("the account submits it (consent), and it lands", r.attestation && (await submit(alice, r.attestation)));
  check("alice@example.com now resolves to Alice", (await lookup("mailto", "alice@example.com")).join() === alice.address);

  providers.user = { sub: "2", email: "mallory@example.com", email_verified: false };
  r = await link("acme", bob.address);
  check("an unverified email is refused", !r.attestation && /email_verified/.test(r.error ?? ""), JSON.stringify(r));
  providers.user = { sub: "3", email: "eve@example.com", email_verified: true };
  providers.impersonate = true;
  r = await link("acme", bob.address);
  check("an ID token the provider did not sign is refused", !r.attestation && /signature/.test(r.error ?? ""), JSON.stringify(r));
  providers.impersonate = false;
  r = await link("acme", bob.address, "https://evil.example/");
  check("a return address the issuer does not serve is refused", r.status === 400 && /does not return/.test(r.error ?? ""), JSON.stringify(r));

  console.log("\nOAuth 2 (any provider with user info: GitHub, Discord, X, ...)");
  r = await link("x", bob.address);
  check(`attested ${r.attestation?.prefix}:${r.attestation?.plaintext}`, r.attestation?.prefix === "twit" && r.attestation?.account === bob.address, JSON.stringify(r));
  check("someone else cannot submit Bob's attestation", r.attestation && !(await submit(alice, r.attestation).catch(() => false)));
  check("Bob submits it", r.attestation && (await submit(bob, r.attestation)));
  check("twit:bob_on_x resolves to Bob (case-insensitive)", (await lookup("twit", "bob_on_x")).join() === bob.address);

  console.log("\nCodes (Twilio Verify)");
  const post = (path: string, body: object) => fetch(`${ISSUER}${path}`, { method: "POST", body: JSON.stringify(body) }).then((x) => x.json());
  check("a code is sent", (await post("/code/phone/start", { to: "+1 (555) 010-1234" })).sent === true);
  const wrong = await post("/code/phone/check", { to: "+15550101234", code: "000000", account: bob.address });
  check("a wrong code is refused", /wrong/.test(wrong.error ?? ""), JSON.stringify(wrong));
  const right = await post("/code/phone/check", { to: "+15550101234", code: "123456", account: bob.address });
  check(`attested ${right.prefix}:${right.plaintext}`, right.prefix === "tel" && right.account === bob.address, JSON.stringify(right));
  check("Bob submits it", await submit(bob, right));
  check("+1 555 010 1234 resolves to Bob", (await lookup("tel", "+1 555 010 1234")).join() === bob.address);

  check("an untrusted issuer resolves nothing",
    ((await rpc("sena_lookupAttestations", { identifier: sena.hashIdentifier("mailto", "alice@example.com", info.network_salt), trusted_issuers: [bob.address] })).attestations ?? []).length === 0);
  if (failed) console.log("\nissuer log:\n" + issuerOut);
} finally {
  for (const p of procs) p.kill();
  providers.stop();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
