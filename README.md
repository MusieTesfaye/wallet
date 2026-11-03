# SENA Wallet

A browser wallet for [SENA](https://github.com/MusieTesfaye/SENA): sign in with
Google, hold USDC, USDT, EURC and DAI, and send them to an address, an email,
a phone number or a username. Each coin pays its own network fee, so USDT is
sent with a USDT fee and EURC with an EURC fee.

Nothing is simulated:

- **Sign-in** is Aptos Keyless. Google signs you in with a nonce that commits
  to a fresh key in your browser. Aptos's pepper service derives your pepper,
  and Aptos's prover makes a zero-knowledge proof that Google signed you in.
  SENA verifies that proof on every transaction, using the same verifying key
  Aptos uses on testnet and mainnet.
- **Signing** uses SENA's own Rust code compiled to WebAssembly (`src/sena/`).
  The wallet builds and signs transactions with exactly the code the node
  verifies them with. No transaction format is copied into TypeScript.
- **Balances, fees and history** come from the node's JSON-RPC.
- **The faucet** (`server.ts`) sends ordinary signed transfers from an account
  funded at genesis, like any testnet faucet.
- **Emails, phones and usernames** work as in Celo's SocialConnect. An issuer
  (`issuer.ts`) checks you own one, through any OpenID Connect or OAuth 2
  provider or an SMS code. It then signs an attestation, which your account
  submits to the chain. Senders look the identifier up and trust only the
  issuers they name.

## What you need

- [Bun](https://bun.sh).
- The `sena-node` program (step 1). No Rust needed.
- A Google OAuth client id (step 2).

## 1. Get sena-node

Download it ready-built:

1. Open [SENA's Binaries workflow](https://github.com/MusieTesfaye/SENA/actions/workflows/binaries.yml)
   and click the newest successful run.
2. Under **Artifacts**, download `sena-node-windows-x64`, `sena-node-macos-arm64`
   or `sena-node-linux-x64`. Downloading needs a GitHub login.
3. Unzip it into a `bin` folder in this repository:
   `bin/sena-node.exe` on Windows, `bin/sena-node` elsewhere. On macOS and
   Linux, run `chmod +x bin/sena-node`.

Each build was tested on its own OS before upload: the run started this
wallet's devnet with it and checked a faucet payment landed on chain.
Windows may warn that the program is unrecognised, because it isn't signed.
Choose *More info → Run anyway*.

With Rust installed you can build it instead: `cargo build --release -p
sena-node` in a SENA checkout, then copy `target/release/sena-node` into `bin`.

## 2. Create a Google OAuth client

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create credentials → OAuth client ID → application type **Web application**.
3. Add `http://localhost:5173` under **Authorised JavaScript origins**.
4. Add `http://localhost:5173/` under **Authorised redirect URIs**.
5. Copy the client id.

If Google asks you to configure a consent screen first, choose *External*,
fill in the required fields, and add both Google accounts you will test with
as test users.

## 3. Run it

```sh
copy .env.example .env      # Windows (cp on macOS/Linux); then set VITE_GOOGLE_CLIENT_ID
bun install
bun run devnet              # terminal 1: the SENA L2 node and the faucet
bun run dev                 # terminal 2: the wallet
```

`bun run devnet` creates a chain in `.devnet` with:
- the four stablecoins;
- Google's current signing keys;
- the Aptos Keyless mainnet parameters;
- a faucet account holding 1,000,000.00 of each coin.

It runs the node on port 8545 and the faucet on port 3001. The chain is kept
between runs; `bun run devnet --fresh` starts over.

Open http://localhost:5173. Use `localhost`, not `127.0.0.1`: Google only
redirects back to the origin you registered.

## 4. Send between two users

1. **Continue with Google** and sign in as the first user. Signing in takes a
   few seconds, while Aptos's prover makes the proof.
2. Press **Faucet** on a coin. It arrives in the next block, about a second
   later.
3. **Add account** and sign in as the second user. Both accounts stay in this
   browser, and you switch between them from the top bar. A second browser
   profile works too.
4. Switch back to the first user and press **Send**. Pick the second user
   under *To*, or paste their address from their **Receive** screen. Choose a
   coin and an amount, then send.
5. Switch to the second user: the coins are there. The activity list shows
   each transfer, its block and the fee, paid in the coin that was sent.

## 5. Link an email, phone or username

So that people can pay you at `alice@example.com` or `+1 555 010 1234`, link
those to your account. This needs the issuer.

1. Copy `issuer.config.example.json` to `issuer.config.json`. Keep the
   providers you have credentials for, and delete the rest. Put the secrets in
   `.env`; the config names them as `"env:NAME"`.
2. For each sign-in provider, register
   `http://localhost:3002/callback/<id>` as a redirect URI, where `<id>` is
   the provider's `id` in the config (`google`, `apple`, `github`, ...). A
   Google client for the issuer is a separate *Web application* client with a
   client secret; the wallet's own Google client has none.
3. Restart `bun run devnet`. It creates the issuer's key in
   `.devnet/issuer.json` and starts the issuer on port 3002.
4. In the wallet, **Identities → Link**, pick a provider and sign in there (or
   enter the SMS code). The wallet submits the attestation; once it lands, the
   identifier resolves to you.
5. To pay someone, type their email, phone number (with country code) or
   `prefix:name` in *To*, such as `github:octocat` or `twit:jack`. The wallet
   shows the address it resolved before you send.

**Any provider fits.** An `oidc` provider needs only its issuer URL; the issuer
reads the rest from its discovery document. Apple is an `oidc` provider with
`client_secret_jwt` and `form_post`. An `oauth2` provider needs its
authorize, token and user-info URLs, and the claim in the user info that holds
the username (`data.username`, for a nested one). `twilio_verify` sends SMS or
WhatsApp codes. The `prefix` says what kind of identifier it attests: `mailto`
for email, `tel` for phones, or a short lowercase name for a platform. Celo's
`twit`, `github`, `discord`, `telegram` and others are listed in SENA's
`sena_primitives::prefix`.

**Trust.** By default the wallet trusts only the issuer at `VITE_ISSUER_URL`.
To trust other issuers too, list their addresses in `VITE_TRUSTED_ISSUERS`.
When two trusted issuers attest the same identifier to different accounts,
the wallet refuses to pay it.

**Unlinking.** **Identities → Unlink** revokes the attestation on chain. The
issuer can revoke it too.

## 5b. A real testnet on this computer, over HTTPS

`bun run devnet` is a chain only this computer knows about. `bun run testnet`
runs a full SENA testnet that **settles on Aptos testnet**: every block is
posted to Aptos, and a watcher re-checks it. It runs on Windows, macOS or
Linux with just Bun and `sena-node`, with no Docker or WSL.

It needs `git` ([git-scm.com](https://git-scm.com/downloads)), because the
Aptos CLI fetches the Aptos framework with it. The script downloads the Aptos
CLI itself.

```sh
bun run testnet --host sena.<your-tailnet>.ts.net
```

1. It creates two Aptos accounts and waits. Fund them with testnet APT at the
   [Aptos faucet](https://aptos.dev/network/faucet): about 4 APT for the
   proposer and 0.3 APT for the challenger.
2. It publishes SENA's contracts to Aptos and builds the wallet for your
   address. Then it runs the node, relayer, watcher, Google key sync, faucet
   and issuer behind `http://127.0.0.1:8088`: the wallet at `/`, the services
   at `/rpc`, `/faucet` and `/issuer`.
3. For HTTPS, in another terminal: `tailscale funnel --bg 8088`. Then open
   `https://sena.<your-tailnet>.ts.net/`.

Add that address to your Google OAuth client, as an origin and as a redirect
URI (with `/`). Everything lives in `.testnet/`; run the command again to
resume, and back the folder up. Keep the computer awake: a block more than
an hour old can no longer be posted to Aptos.

## 6. The browser extension

The same wallet, as an extension for Chrome, Edge and Brave:

```sh
bun run build:extension     # dist-extension/ and sena-extension.zip
```

Load it: open `chrome://extensions` (Edge: `edge://extensions`), turn on
**Developer mode**, choose **Load unpacked** and pick `dist-extension/`.

Its id is fixed by the public key in `extension/key.txt`:
**`phkknehihpoajnkoiabbbknbjaonflad`**. For Google sign-in, add
`https://phkknehihpoajnkoiabbbknbjaonflad.chromiumapp.org/` to your Google
OAuth client's **Authorised redirect URIs**. To link identities from the
extension, add `https://phkknehihpoajnkoiabbbknbjaonflad.chromiumapp.org`
and `chrome-extension://phkknehihpoajnkoiabbbknbjaonflad` to the issuer's
`WALLET_ORIGINS`.

Websites talk to it through `window.sena`:

```js
const [address] = await window.sena.request({ method: 'sena_requestAccounts' });
const { hash, height } = await window.sena.request({
  method: 'sena_sendTransfer',
  params: { to: 'bob@gmail.com', asset: 1, amount: '2500000' }, // 2.50 USDC
});
```

Connecting and every payment open the extension's own approval window. A
site that has not connected gets nothing.

## 7. MetaMask

MetaMask cannot add SENA as a network, because SENA is not an Ethereum-format
chain. Instead the **SENA Snap** (`snap/`) gives MetaMask a SENA account: an
Ed25519 key from the MetaMask recovery phrase, with every transaction shown in
MetaMask before it is signed. In the wallet, press **Use MetaMask**. See
[`snap/README.md`](snap/README.md) for building, testing and publishing it.

## 8. Deploy to Vercel

1. Import this repository in Vercel. `vercel.json` sets the build: the
   extension first (served at `/sena-extension.zip`), then the web wallet.
2. Set the environment variables. `deploy/setup.sh` in SENA prints the URLs.
   - `VITE_SENA_RPC_URL`, `VITE_FAUCET_URL`, `VITE_ISSUER_URL` and
     `VITE_TRUSTED_ISSUERS` for your testnet;
   - `VITE_GOOGLE_CLIENT_ID` for the Google sign-in;
   - `VITE_SNAP_ID` (default `npm:@sena-network/snap`).
3. In the Google OAuth client, add the Vercel address, e.g.
   `https://sena-wallet.vercel.app`, under both *Authorised JavaScript
   origins* and *Authorised redirect URIs* (with a trailing `/` for the
   redirect). Do the same for the extension's `chromiumapp.org` address
   above.

## How it is built

| Path | What it does |
|---|---|
| `src/sena/` | SENA's wallet logic as WebAssembly. Rebuild with `scripts/update-sena-wasm.sh ../SENA`. |
| `src/services/auth.ts` | Google sign-in, Aptos pepper and prover, assembling the keyless signature |
| `src/services/wallet.ts` | Quoting, building, signing and submitting a transfer |
| `src/services/rpc.ts` | The node's JSON-RPC |
| `server.ts` | The faucet |
| `issuer.ts` | The attestation issuer: OIDC, OAuth 2 and Twilio Verify, configured in `issuer.config.json` |
| `src/services/identity.ts` | Linking identities, and resolving a recipient through trusted issuers |
| `scripts/devnet.ts` | `bun run devnet`: creates the chain, starts the node and the faucet |
| `scripts/e2e.ts` | The browser test (below) |
| `extension/`, `scripts/extension-e2e.ts` | The extension's worker, content scripts and manifest, and its test |
| `src/components/Approval.vue` | The extension's approval window for websites |
| `snap/` | The MetaMask Snap |
| `scripts/issuer-e2e.ts`, `scripts/test-providers.ts` | The issuer's test, and the stand-in providers it signs in with |

## Test

```sh
bun run test:e2e ../SENA
```

The test starts a node, the faucet and the wallet, then drives the wallet in
Chromium. For each coin, it:
1. asks the faucet for it;
2. sends 12.50 of it;
3. checks the fee was paid in that coin;
4. checks every balance the wallet shows against the chain.

It also links a phone number through the issuer and pays it by number.

```sh
bun run test:issuer ../SENA
bun run test:extension ../SENA   # the extension, loaded into Chromium
cd snap && npm test              # the Snap, in MetaMask's simulator
```

This tests the issuer against a live node. No real provider can sign in during
a test, so the test serves stand-ins: an OpenID Connect provider with its own
RSA key, an OAuth 2 provider and a Twilio Verify API. They speak the same
protocols the real ones do. It checks that an unverified email, a forged ID
token, a foreign return address, a wrong code and a third party submitting
someone's attestation are all refused.

Google can't sign in during an automated test, so the browser is given the
account a sign-in would leave in storage. It is built from Aptos's published
keyless sample, whose proof is a real proof from Aptos's circuit, using the
insecure devnet parameters. Everything after sign-in is the real wallet.

This needs, in SENA:

```sh
cargo build --release -p sena-node
cargo run -q -p sena-wasm --example keyless_sample > target/keyless-sample.json
```

## Know before you use it

- **Devnet only.** SENA is unaudited beta software. The faucet holds its key in
  a plain file.
- **Your sign-in key lives in this browser** (`localStorage`) for two days.
  After that, sign in again. Anyone with access to this browser profile can
  spend from your account until the key expires.
- **Google rotates its signing keys** every few weeks. The devnet accepts the
  keys Google published when the chain was created. After a rotation, new
  sign-ins fail until you run `bun run devnet --fresh`, because adding keys to
  a running chain needs a council vote, and no tool sends one yet.
- **The issuer's key is a plain file** (`.devnet/issuer.json`). Whoever has
  it can attest any identifier to any account that consents, so it is a devnet
  issuer, not a production one.
- **Identifiers are hashed with a public salt.** A phone number on chain can be
  found by trying every number. Celo prevents this with ODIS, a rate-limited
  service; SENA does not have one yet.
- **Coins come only from the faucet.** Deposits from Aptos are not credited on
  the L2 yet.
- **Aptos's keyless services are rate limited.** For heavier use, set
  `VITE_APTOS_API_KEY` to an [Aptos Build](https://build.aptoslabs.com) key.
