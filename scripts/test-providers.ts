// Stand-in identity providers for the tests: an OpenID Connect provider with
// its own RSA key, an OAuth 2 provider, and a Twilio Verify API. No real
// provider signs in an automated test; these speak the same protocols, so
// every code path the issuer runs against Google, Apple, GitHub or Twilio runs
// against them: discovery, PKCE, the token exchange, ID-token verification,
// user-info and code checks.

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");
const keyPair = () =>
  crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

export interface Providers {
  oidc: string;
  oauth: string;
  twilio: string;
  /** Who signs in at the OIDC provider next. */
  user: Record<string, unknown>;
  /** Sign ID tokens with a key the provider does not publish. */
  impersonate: boolean;
  /** Issuer configuration naming these providers. */
  config(): object;
  stop(): void;
}

export async function startProviders(ports: { oidc: number; oauth: number; twilio: number }): Promise<Providers> {
  const rsa = await keyPair();
  const impostor = await keyPair();
  const jwk = { ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const OIDC = `http://127.0.0.1:${ports.oidc}`;
  const OAUTH = `http://127.0.0.1:${ports.oauth}`;
  const TWILIO = `http://127.0.0.1:${ports.twilio}`;
  const codes = new Map<string, { nonce: string; challenge: string; client: string }>();

  const p: Providers = {
    oidc: OIDC,
    oauth: OAUTH,
    twilio: TWILIO,
    user: { sub: "1", email: "Alice@Example.com", email_verified: true },
    impersonate: false,
    config: () => ({
      providers: [
        { id: "acme", label: "Acme ID", type: "oidc", issuer: OIDC, client_id: "acme-client", client_secret: "env:ACME_SECRET",
          identifier: { prefix: "mailto", claim: "email", require: "email_verified" } },
        { id: "x", label: "X", type: "oauth2", authorize_url: `${OAUTH}/authorize`, token_url: `${OAUTH}/token`,
          userinfo_url: `${OAUTH}/me`, client_id: "oauth-client", client_secret: "oauth-secret", token_auth: "basic",
          identifier: { prefix: "twit", claim: "data.username" } },
        { id: "phone", label: "Phone", type: "twilio_verify", account_sid: "AC1", auth_token: "tok", service_sid: "VA1", api_base: TWILIO },
      ],
    }),
    stop: () => servers.forEach((s) => s.stop(true)),
  };

  async function idToken(claims: object): Promise<string> {
    const head = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
    const body = b64url(JSON.stringify(claims));
    const key = p.impersonate ? impostor.privateKey : rsa.privateKey;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${b64url(sig)}`;
  }

  const servers = [
    Bun.serve({
      port: ports.oidc,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/.well-known/openid-configuration") {
          return Response.json({ issuer: OIDC, authorization_endpoint: `${OIDC}/authorize`, token_endpoint: `${OIDC}/token`, jwks_uri: `${OIDC}/jwks` });
        }
        if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
        if (url.pathname === "/authorize") {
          // The user approves at once.
          if (url.searchParams.get("code_challenge_method") !== "S256") return new Response("PKCE required", { status: 400 });
          const code = crypto.randomUUID();
          codes.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")!, client: url.searchParams.get("client_id")! });
          const back = new URL(url.searchParams.get("redirect_uri")!);
          back.searchParams.set("code", code);
          back.searchParams.set("state", url.searchParams.get("state")!);
          return Response.redirect(back.toString(), 302);
        }
        if (url.pathname === "/token") {
          const form = new URLSearchParams(await req.text());
          const c = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? ""))));
          if (!c || challenge !== c.challenge || form.get("client_secret") !== "oidc-secret") {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          const now = Math.floor(Date.now() / 1000);
          return Response.json({ access_token: "x", id_token: await idToken({ iss: OIDC, aud: c.client, iat: now, exp: now + 300, nonce: c.nonce, ...p.user }) });
        }
        return new Response("not found", { status: 404 });
      },
    }),
    Bun.serve({
      port: ports.oauth,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/authorize") {
          const back = new URL(url.searchParams.get("redirect_uri")!);
          back.searchParams.set("code", "oauth-code");
          back.searchParams.set("state", url.searchParams.get("state")!);
          return Response.redirect(back.toString(), 302);
        }
        if (url.pathname === "/token") {
          const ok = req.headers.get("Authorization") === "Basic " + btoa("oauth-client:oauth-secret");
          return ok ? Response.json({ access_token: "token-for-bob" }) : Response.json({ error: "invalid_client" }, { status: 401 });
        }
        if (url.pathname === "/me") {
          return req.headers.get("Authorization") === "Bearer token-for-bob"
            ? Response.json({ data: { username: "Bob_On_X" } })
            : new Response("unauthorised", { status: 401 });
        }
        return new Response("not found", { status: 404 });
      },
    }),
    Bun.serve({
      port: ports.twilio,
      async fetch(req) {
        const url = new URL(req.url);
        const form = new URLSearchParams(await req.text());
        if (req.headers.get("Authorization") !== "Basic " + btoa("AC1:tok")) return Response.json({ message: "auth" }, { status: 401 });
        if (url.pathname.endsWith("/Verifications")) return Response.json({ status: "pending", to: form.get("To") });
        if (url.pathname.endsWith("/VerificationCheck")) return Response.json({ status: form.get("Code") === "123456" ? "approved" : "pending" });
        return new Response("not found", { status: 404 });
      },
    }),
  ];
  return p;
}
