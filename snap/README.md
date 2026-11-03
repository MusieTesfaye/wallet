# The SENA Snap

SENA accounts in MetaMask. MetaMask cannot add SENA as a network, because its
network list is for chains that speak Ethereum's format. A Snap is MetaMask's
way to support other chains, as it does for Solana and Bitcoin.

- **The key** is Ed25519, derived from your MetaMask recovery phrase at
  `m/44'/637'/0'/0'/0'` (Aptos's path). The same phrase gives the same SENA
  address everywhere. The key never leaves the Snap.
- **Every transaction is shown before it is signed**: what it does, the most
  its fee can be, the network and the requesting site. The Snap decodes the
  transaction itself; it does not take the website's word for it.
- **Signing is SENA's own code**, compiled to WebAssembly from the node's Rust.

The web wallet builds and submits transactions; the Snap only signs.

## Methods

| Method | Params | Returns |
|---|---|---|
| `sena_getAccount` | — | `{ address }` |
| `sena_signTransaction` | `{ transaction }`, an unsigned transaction from `sena-wasm` | `{ signed, hash }` after the user approves |

## Develop

```sh
npm install
npm run build          # embeds ../src/sena's wasm, bundles dist/bundle.js
npm test               # runs the Snap in MetaMask's simulator against a live node
npm run serve          # serves it at local:http://localhost:8080
```

To use the local build from the wallet, set `VITE_SNAP_ID=local:http://localhost:8080`
and open the wallet in a browser with [MetaMask Flask](https://metamask.io/flask/).

## Publish

```sh
npm publish --access public
```

The wallet then installs it as `npm:@sena-network/snap`. The `@sena-network`
scope must belong to your npm account or organisation; otherwise rename the
package in `package.json` and `snap.manifest.json`.

Production MetaMask installs only Snaps that MetaMask has reviewed. Until
this one is reviewed, people use MetaMask Flask.
