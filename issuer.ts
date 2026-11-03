// SENA attestation issuer, after Celo's SocialConnect.
//
// An issuer verifies that someone owns an identifier — an email address, a
// phone number, a Twitch or GitHub username — and signs an attestation that it
// belongs to their SENA account. The account submits the attestation itself,
// consenting to be found by it; wallets that trust this issuer can then send
// to "bob@gmail.com", "+15551234567" or "twitch:bob" instead of an address.
//
// The chain is issuer-agnostic, as Celo's FederatedAttestations is: anyone can
// run an issuer, each verifies however it likes, and every lookup names the
// issuers it trusts. This one is provider-agnostic too: what it verifies is
// configuration, in issuer.config.json (see issuer.config.example.json):
//
//   oidc           any OpenID Connect provider, found from its issuer URL:
//                  Google, Apple, Twitch, Microsoft, Okta, ...
//   oauth2         any OAuth 2 provider with a user-info endpoint: GitHub,
//                  Discord, X, Facebook, ...
//   twilio_verify  a code sent by SMS (or call, WhatsApp) through Twilio Verify
//
// Each provider names the identifier type it attests (a Celo prefix: mailto,
// tel, twit, github, twitch, ...) and where the identifier comes from.
//
// Because the account consents by submitting, the issuer never has to verify
// who owns the account — only who owns the identifier.
//
//   bun issuer.ts       (bun run devnet starts it when issuer.config.json exists)

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as sena from "./src/sena/sena_wasm.js";

sena.initSync({ module: readFileSync(fileURLToPath(new URL("./src/sena/sena_wasm_bg.wasm", import.meta.url))) });

const PORT = Number(process.env.ISSUER_PORT ?? 3002);
const PUBLIC_URL = (process.env.ISSUER_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const RPC = process.env.VITE_SENA_RPC_URL ?? "http://127.0.0.1:8545";
const ORIGINS = (process.env.WALLET_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",");
const CONFIG_PATH = process.env.ISSUER_CONFIG ?? fileURLToPath(new URL("./issuer.config.json", import.meta.url));

// --- Configuration -------------------------------------------------------------

interface Identifier {
  /** The Celo identifier type it attests: mailto, tel, twit, github, twitch, ... */
  prefix: string;
  /** Where the plain text is: an ID-token claim or a user-info field, dotted for nesting. */
  claim: string;
  /** A claim or field that must be true for the identifier to count, e.g. email_verified. */
  require?: string;
}

interface OidcProvider {
  type: "oidc";
  id: string;
  label: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  /** Apple: the client secret is a JWT this issuer signs with an Apple key. */
  client_secret_jwt?: { team_id: string; key_id: string; private_key: string };
  scopes?: string;
  /** Extra authorization parameters, e.g. Twitch's {"claims": "..."} or Apple's {"response_mode": "form_post"}. */
  authorize_params?: Record<string, string>;
  identifier: Identifier;
}

interface OAuth2Provider {
  type: "oauth2";
  id: string;
  label: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  client_id: string;
  client_secret: string;
  scopes?: string;
  /** How the client authenticates to the token endpoint. */
  token_auth?: "post" | "basic";
  pkce?: boolean;
  authorize_params?: Record<string, string>;
  identifier: Identifier;
}

interface TwilioProvider {
  type: "twilio_verify";
  id: string;
  label: string;
  account_sid: string;
  auth_token: string;
  service_sid: string;
  /** sms (default), call or whatsapp. */
  channel?: string;
  prefix?: string;
  /** Twilio's API, for tests against a stand-in. */
  api_base?: string;
}

type Provider = OidcProvider | OAuth2Provider | TwilioProvider;

/** Replaces "env:NAME" values with the environment variable, so secrets stay in .env. */
function fromEnv<T>(v: T): T {
  if (typeof v === "string" && v.startsWith("env:")) {
    const name = v.slice(4);
    const value = process.env[name];
    if (value === undefined) throw new Error(`issuer.config.json refers to ${name}, which is not set`);
    return value as T;
  }
  if (Array.isArray(v)) return v.map(fromEnv) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromEnv(x)])) as T;
  return v;
}

function loadConfig(): { key_file?: string; providers: Provider[] } {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`No issuer configuration at ${CONFIG_PATH}. Copy issuer.config.example.json and fill it in.`);
    process.exit(1);
  }
  const config = fromEnv(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  for (const p of config.providers as Provider[]) {
    if (!/^[a-z0-9-]{1,32}$/.test(p.id)) throw new Error(`provider id ${JSON.stringify(p.id)}: use lowercase letters, digits and '-'`);
    const prefix = p.type === "twilio_verify" ? (p.prefix ?? "tel") : p.identifier.prefix;
    // Validated by SENA's own rule, as the chain's clients hash it.
    sena.hashIdentifier(prefix, "x", "00");
  }
  return config;
}

const config = loadConfig();
const providers = new Map(config.providers.map((p) => [p.id, p]));
const keyFile = process.env.ISSUER_KEY_FILE ?? config.key_file;
if (!keyFile) {
  console.error("Set ISSUER_KEY_FILE (or key_file in issuer.config.json) to the issuer's key; bun run devnet writes .devnet/issuer.json.");
  process.exit(1);
}
const { secret } = JSON.parse(readFileSync(keyFile, "utf8")) as { secret: string };
const ISSUER = sena.ed25519Address(secret);
const prefixOf = (p: Provider) => (p.type === "twilio_verify" ? (p.prefix ?? "tel") : p.identifier.prefix);

// --- The chain -----------------------------------------------------------------

let chain: { id: bigint; salt: string } | null = null;
async function chainInfo() {
  if (!chain) {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"method":"sena_getChainInfo"}' });
    const info = await r.json();
    if (info.result === "error") throw new Error(info.message);
    chain = { id: BigInt(info.transaction_chain_id), salt: info.network_salt };
  }
  return chain;
}

// The chain keeps an attestation only if it is later than the one it replaces.
const lastIssued = new Map<string, number>();

/** Signs that `plaintext` of type `prefix` belongs to `account`, for the account to submit. */
async function attestation(prefix: string, plaintext: string, account: string) {
  const { id, salt } = await chainInfo();
  const identifier = sena.hashIdentifier(prefix, plaintext, salt);
  const issuedOn = Math.max(Math.floor(Date.now() / 1000), (lastIssued.get(identifier) ?? 0) + 1);
  lastIssued.set(identifier, issuedOn);
  const signature = sena.signAttestation(secret, id, identifier, account, BigInt(issuedOn));
  return { issuer: ISSUER, prefix, plaintext, identifier, account, issued_on: issuedOn, signature, chain_id: id.toString() };
}

// --- Helpers -------------------------------------------------------------------

class Refused extends Error {}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** A dotted path into an object: "data.username". */
function pick(obj: any, path: string): unknown {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const isTrue = (v: unknown) => v === true || v === "true";

function identifierFrom(source: any, spec: Identifier): string {
  if (spec.require && !isTrue(pick(source, spec.require))) {
    throw new Refused(`the provider does not vouch for it (${spec.require} is not true)`);
  }
  const value = pick(source, spec.claim);
  if (typeof value !== "string" && typeof value !== "number") throw new Refused(`the provider gave no ${spec.claim}`);
  const text = String(value).trim();
  if (!text) throw new Refused(`the provider gave an empty ${spec.claim}`);
  return text;
}

// --- OpenID Connect ------------------------------------------------------------

const discovery = new Map<string, { doc: any; at: number }>();
async function discover(issuer: string): Promise<any> {
  const cached = discovery.get(issuer);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.doc;
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`${issuer} has no OpenID configuration (HTTP ${res.status})`);
  const doc = await res.json();
  discovery.set(issuer, { doc, at: Date.now() });
  return doc;
}

const jwksCache = new Map<string, { keys: any[]; at: number }>();
async function jwk(uri: string, kid: string): Promise<any> {
  let c = jwksCache.get(uri);
  if (!c || Date.now() - c.at > 3_600_000 || !c.keys.some((k) => k.kid === kid)) {
    const res = await fetch(uri);
    c = { keys: (await res.json()).keys ?? [], at: Date.now() };
    jwksCache.set(uri, c);
  }
  const key = c.keys.find((k) => k.kid === kid);
  if (!key) throw new Refused("the ID token is signed by a key the provider does not publish");
  return key;
}

const ALGORITHMS: Record<string, { import: any; verify: any }> = {
  RS256: { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: { name: "RSASSA-PKCS1-v1_5" } },
  ES256: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } },
};

/** An ID token's claims, once its signature, issuer, audience, expiry and nonce check out. */
async function verifyIdToken(p: OidcProvider, idToken: string, nonce: string): Promise<any> {
  const doc = await discover(p.issuer);
  const [h, c, sig] = idToken.split(".");
  if (!sig) throw new Refused("the provider returned a malformed ID token");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
  const alg = ALGORITHMS[header.alg];
  if (!alg) throw new Refused(`the ID token uses ${header.alg}, which this issuer does not accept`);
  const key = await crypto.subtle.importKey("jwk", await jwk(doc.jwks_uri, header.kid), alg.import, false, ["verify"]);
  if (!(await crypto.subtle.verify(alg.verify, key, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`)))) {
    throw new Refused("the ID token's signature does not verify");
  }
  if (claims.iss !== doc.issuer) throw new Refused("the ID token is from another issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(p.client_id)) throw new Refused("the ID token is for another app");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Refused("the ID token has expired");
  if (claims.nonce !== nonce) throw new Refused("the ID token was not issued for this sign-in");
  return claims;
}

/** Apple's client secret: an ES256 JWT signed with the app's Apple key. */
async function appleClientSecret(p: OidcProvider): Promise<string> {
  const s = p.client_secret_jwt!;
  const pem = s.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Buffer.from(pem, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "ES256", kid: s.key_id })}.${enc({ iss: s.team_id, iat: now, exp: now + 300, aud: p.issuer, sub: p.client_id })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

// --- The redirect flows (OIDC and OAuth 2) -------------------------------------

interface Pending {
  provider: string;
  account: string;
  back: string;
  verifier: string;
  nonce: string;
  at: number;
}
const pending = new Map<string, Pending>();

function backTo(raw: string | null): string {
  let u: URL;
  try { u = new URL(raw ?? ""); } catch { throw new Refused("missing or malformed return address"); }
  if (!ORIGINS.includes(u.origin)) throw new Refused(`this issuer does not return to ${u.origin}`);
  return `${u.origin}${u.pathname}`;
}

async function startRedirect(p: OidcProvider | OAuth2Provider, account: string, back: string): Promise<string> {
  const state = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  pending.set(state, { provider: p.id, account, back, verifier, nonce, at: Date.now() });
  const authorize = p.type === "oidc" ? (await discover(p.issuer)).authorization_endpoint : p.authorize_url;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: p.client_id,
    redirect_uri: `${PUBLIC_URL}/callback/${p.id}`,
    scope: p.scopes ?? (p.type === "oidc" ? "openid email" : ""),
    state,
    ...(p.type === "oidc" ? { nonce } : {}),
    ...(p.type === "oidc" || p.pkce !== false ? { code_challenge: b64url(await sha256(verifier)), code_challenge_method: "S256" } : {}),
    ...(p.authorize_params ?? {}),
  });
  return `${authorize}?${params}`;
}

async function exchange(p: OidcProvider | OAuth2Provider, code: string, verifier: string): Promise<any> {
  const tokenUrl = p.type === "oidc" ? (await discover(p.issuer)).token_endpoint : p.token_url;
  const secretValue = p.type === "oidc" && p.client_secret_jwt ? await appleClientSecret(p) : p.client_secret ?? "";
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: `${PUBLIC_URL}/callback/${p.id}`,
    code_verifier: verifier,
  };
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (p.type === "oauth2" && p.token_auth === "basic") {
    headers.Authorization = "Basic " + btoa(`${p.client_id}:${secretValue}`);
  } else {
    form.client_id = p.client_id;
    if (secretValue) form.client_secret = secretValue;
  }
  const res = await fetch(tokenUrl, { method: "POST", headers, body: new URLSearchParams(form) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Refused(`the provider refused the sign-in: ${out.error_description ?? out.error ?? res.status}`);
  return out;
}

async function finishRedirect(p: OidcProvider | OAuth2Provider, state: string, code: string) {
  const req = pending.get(state);
  pending.delete(state);
  if (!req || req.provider !== p.id || Date.now() - req.at > 600_000) {
    throw new Refused("this sign-in has expired or was not started here; try again");
  }
  const tokens = await exchange(p, code, req.verifier);
  let source: any;
  if (p.type === "oidc") {
    if (!tokens.id_token) throw new Refused("the provider returned no ID token");
    source = await verifyIdToken(p, tokens.id_token, req.nonce);
  } else {
    const res = await fetch(p.userinfo_url, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json", "User-Agent": "sena-issuer" },
    });
    if (!res.ok) throw new Refused(`the provider would not say who signed in (HTTP ${res.status})`);
    source = await res.json();
  }
  const plaintext = identifierFrom(source, p.identifier);
  return { back: req.back, result: await attestation(p.identifier.prefix, plaintext, req.account) };
}

// --- Twilio Verify -------------------------------------------------------------

async function twilio(p: TwilioProvider, path: string, form: Record<string, string>): Promise<any> {
  const base = (p.api_base ?? "https://verify.twilio.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v2/Services/${p.service_sid}/${path}`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${p.account_sid}:${p.auth_token}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`Twilio answered HTTP ${res.status}: ${out.message ?? ""}`);
  return out;
}

function e164(phone: unknown): string {
  const p = String(phone ?? "").replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(p)) throw new Refused("give the number in international form, e.g. +15551234567");
  return p;
}

// --- Rate limiting -------------------------------------------------------------

const hits = new Map<string, number[]>();
function limited(key: string, perHour: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > perHour;
}

// --- HTTP ----------------------------------------------------------------------

const isAccount = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{64}$/.test(a);
const fragment = (back: string, key: string, value: unknown) =>
  `${back}#${key}=${b64url(new TextEncoder().encode(JSON.stringify(value)))}`;

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") ?? "";
    const cors: Record<string, string> = ORIGINS.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
      : {};
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const client = server.requestIP(req)?.address ?? "unknown";

    // What this issuer is and what it verifies.
    if (url.pathname === "/" && req.method === "GET") {
      const info = await chainInfo().catch(() => null);
      return json({
        issuer: ISSUER,
        chain_id: info?.id.toString() ?? null,
        providers: [...providers.values()].map((p) => ({
          id: p.id,
          label: p.label,
          prefix: prefixOf(p),
          flow: p.type === "twilio_verify" ? "code" : "redirect",
        })),
      });
    }

    const [, kind, id, step] = url.pathname.split("/");
    const p = providers.get(id ?? "");

    // Redirect flows: /link/<provider>?account=0x..&return=<wallet url>
    if (kind === "link" && req.method === "GET" && p && p.type !== "twilio_verify") {
      try {
        if (limited(`ip:${client}`, 60)) throw new Refused("too many requests; try again later");
        const account = url.searchParams.get("account");
        if (!isAccount(account)) throw new Refused("missing or malformed account");
        return Response.redirect(await startRedirect(p, account, backTo(url.searchParams.get("return"))), 302);
      } catch (e) {
        return json({ error: (e as Error).message }, e instanceof Refused ? 400 : 502);
      }
    }

    // The provider sends the user back here (GET, or POST for form_post).
    if (kind === "callback" && p && p.type !== "twilio_verify") {
      const params = req.method === "POST" ? new URLSearchParams(await req.text()) : url.searchParams;
      const state = params.get("state") ?? "";
      const back = pending.get(state)?.back;
      try {
        if (params.get("error")) throw new Refused(`the provider says: ${params.get("error_description") ?? params.get("error")}`);
        const { back: to, result } = await finishRedirect(p, state, params.get("code") ?? "");
        console.log(`attested ${result.prefix}:${result.plaintext} for ${result.account}`);
        return Response.redirect(fragment(to, "sena_attestation", result), 302);
      } catch (e) {
        if (!(e instanceof Refused)) console.error(e);
        if (back) return Response.redirect(fragment(back, "sena_attestation_error", (e as Error).message), 302);
        return json({ error: (e as Error).message }, 400);
      }
    }

    // Code flows: /code/<provider>/start {to}, /code/<provider>/check {to, code, account}
    if (kind === "code" && req.method === "POST" && p && p.type === "twilio_verify") {
      try {
        if (limited(`ip:${client}`, 30)) throw new Refused("too many requests; try again later");
        const body = await req.json().catch(() => ({}));
        const to = e164(body.to);
        if (step === "start") {
          if (limited(`to:${to}`, 5)) throw new Refused("too many codes sent to this number; try again later");
          await twilio(p, "Verifications", { To: to, Channel: p.channel ?? "sms" });
          return json({ sent: true });
        }
        if (step === "check") {
          if (!isAccount(body.account)) throw new Refused("missing or malformed account");
          const check = await twilio(p, "VerificationCheck", { To: to, Code: String(body.code ?? "") });
          if (check.status !== "approved") throw new Refused("that code is wrong or has expired");
          const result = await attestation(prefixOf(p), to, body.account);
          console.log(`attested ${result.prefix}:${to} for ${body.account}`);
          return json(result);
        }
      } catch (e) {
        if (!(e instanceof Refused)) console.error(e);
        return json({ error: (e as Error).message }, e instanceof Refused ? 403 : 502);
      }
    }

    return json({ error: "not found" }, 404);
  },
});

// Forget sign-ins nobody finished.
setInterval(() => {
  for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
}, 60_000);

console.log(`SENA attestation issuer on ${PUBLIC_URL}`);
console.log(`  issuer     ${ISSUER}`);
for (const p of providers.values()) console.log(`  ${p.id.padEnd(10)} ${p.label} → ${prefixOf(p)}`);
