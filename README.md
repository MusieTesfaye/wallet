# SENA Wallet

A browser wallet for [SENA](https://github.com/MusieTesfaye/SENA): sign in with
Google, hold USDC, USDT, EURC and DAI, and send them. Each coin pays its own
network fee, so USDT is sent with a USDT fee and EURC with an EURC fee.

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

## What you need

- [Rust](https://rustup.rs) 1.85+ and Python 3, to build and start the SENA
  node.
- [Bun](https://bun.sh).
- A Google OAuth client id (step 2).

Check out SENA next to this repository: `../SENA`.

## 1. Start a SENA devnet

In the SENA checkout:

```sh
cargo build --release -p sena-node
python3 scripts/wallet-devnet.py
```

That creates a chain with:
- the four stablecoins;
- Google's current signing keys;
- the Aptos Keyless mainnet parameters;
- a faucet account holding 1,000,000.00 of each coin.

It then runs the node at `http://127.0.0.1:8545`, with browsers at
`http://localhost:5173` allowed to call it. It prints two lines for your
`.env`:

```
  VITE_SENA_RPC_URL=http://127.0.0.1:8545
  FAUCET_KEY_FILE=/…/SENA/wallet-devnet/faucet.json
```

Leave it running. To pick the chain up again later, run the same command; add
`--fresh` to start over.

## 2. Create a Google OAuth client

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create credentials → OAuth client ID → application type **Web application**.
3. Add `http://localhost:5173` under **Authorised JavaScript origins**.
4. Add `http://localhost:5173/` under **Authorised redirect URIs**.
5. Copy the client id.

If Google asks you to configure a consent screen first, choose *External*,
fill in the required fields, and add both Google accounts you will test with
as test users.

## 3. Run the wallet and the faucet

```sh
cp .env.example .env    # then set VITE_GOOGLE_CLIENT_ID and FAUCET_KEY_FILE
bun install
bun run faucet          # terminal 1
bun run dev             # terminal 2
```

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

## How it is built

| Path | What it does |
|---|---|
| `src/sena/` | SENA's wallet logic as WebAssembly. Rebuild with `scripts/update-sena-wasm.sh ../SENA`. |
| `src/services/auth.ts` | Google sign-in, Aptos pepper and prover, assembling the keyless signature |
| `src/services/wallet.ts` | Quoting, building, signing and submitting a transfer |
| `src/services/rpc.ts` | The node's JSON-RPC |
| `server.ts` | The faucet |
| `scripts/e2e.ts` | The browser test (below) |

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
  sign-ins fail until you restart with `--fresh`, because adding keys to a
  running chain needs a council vote, and no tool sends one yet.
- **Coins come only from the faucet.** Deposits from Aptos are not credited on
  the L2 yet.
- **Aptos's keyless services are rate limited.** For heavier use, set
  `VITE_APTOS_API_KEY` to an [Aptos Build](https://build.aptoslabs.com) key.
