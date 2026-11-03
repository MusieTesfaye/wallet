// The SENA Snap: SENA accounts in MetaMask.
//
// MetaMask cannot add SENA as a network, since its network list is for chains
// that speak Ethereum's format. This Snap gives MetaMask a SENA account
// instead:
//
//  * The key is Ed25519, derived from the user's MetaMask recovery phrase at
//    m/44'/637'/0'/0'/0' (SLIP-10, Aptos's coin type), so the same phrase
//    gives the same SENA address on every device. It never leaves the Snap.
//  * sena_signTransaction shows what the transaction does in MetaMask and
//    signs only if the user approves. The transaction is decoded here, from
//    the bytes that are signed, not from anything the website says about it.
//  * Signing is SENA's own Rust code compiled to WebAssembly, the code the
//    chain verifies with.
//
// The website builds and submits transactions; the Snap only ever signs.

import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { Box, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';
import { InvalidParamsError, MethodNotFoundError, UserRejectedRequestError } from '@metamask/snaps-sdk';
import { SLIP10Node } from '@metamask/key-tree';
import { initSync, ed25519Address, signEd25519, transactionHash } from './generated/sena_wasm.js';
import { WASM_BASE64 } from './generated/wasm-bytes';

let ready = false;
function sena() {
  if (!ready) {
    const bin = atob(WASM_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    initSync({ module: bytes });
    ready = true;
  }
}

/** The account's secret key, hex, from MetaMask's recovery phrase. */
async function secretKey(): Promise<string> {
  const root = await snap.request({
    method: 'snap_getBip32Entropy',
    params: { path: ['m', "44'", "637'"], curve: 'ed25519' },
  });
  const node = await (await SLIP10Node.fromJSON(root)).derive(["slip10:0'", "slip10:0'", "slip10:0'"]);
  if (!node.privateKey) throw new Error('MetaMask returned no private key');
  return node.privateKey.replace(/^0x/, '');
}

/** Chains whose coins this Snap can name. Elsewhere it shows asset numbers. */
const KNOWN_CHAINS: Record<string, { name: string; assets: Record<number, string> }> = {
  // sena_primitives::chain_id("sena-testnet-1")
  '47515298810947': { name: 'SENA testnet', assets: { 1: 'USDC', 2: 'USDT', 3: 'EURC', 4: 'DAI' } },
};

const PRICE_SCALE = 10n ** 12n;

/** A six-decimal amount for display. */
function amount(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

const short = (s: string) => (s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s);

interface Transaction {
  chain_id: number;
  sender: string;
  nonce: number;
  fee_asset: number;
  gas_limit: number;
  max_fee_per_gas: string;
  payload: { kind: string; [k: string]: unknown };
}

function describe(tx: Transaction) {
  const chain = KNOWN_CHAINS[String(tx.chain_id)];
  const coin = (asset: number) => chain?.assets[asset] ?? `asset #${asset}`;
  const maxFee = (BigInt(tx.gas_limit) * BigInt(tx.max_fee_per_gas) + PRICE_SCALE - 1n) / PRICE_SCALE;
  const p = tx.payload;
  let title: string;
  const rows: [string, string][] = [];
  switch (p.kind) {
    case 'transfer':
      title = `Send ${amount(BigInt(String(p.amount)))} ${coin(Number(p.asset))}`;
      rows.push(['To', short(String(p.to))]);
      break;
    case 'register_attestation':
      title = 'Link an identity to this account';
      rows.push(['Issuer', short(String(p.issuer))], ['Identifier hash', short(String(p.identifier))]);
      break;
    case 'revoke_attestation':
      title = 'Unlink an identity';
      rows.push(['Issuer', short(String(p.issuer))], ['Identifier hash', short(String(p.identifier))]);
      break;
    default:
      title = `A "${p.kind}" transaction`;
  }
  rows.push(
    ['Network fee', `up to ${amount(maxFee)} ${coin(tx.fee_asset)}`],
    ['Network', chain?.name ?? `SENA chain ${tx.chain_id}`],
    ['Nonce', String(tx.nonce)],
  );
  return { title, rows, unknownKind: !['transfer', 'register_attestation', 'revoke_attestation'].includes(p.kind) };
}

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  sena();
  switch (request.method) {
    case 'sena_getAccount': {
      return { address: ed25519Address(await secretKey()) };
    }

    case 'sena_signTransaction': {
      const params = request.params as { transaction?: unknown } | undefined;
      if (typeof params?.transaction !== 'string') throw new InvalidParamsError('expected { transaction: string }');
      let tx: Transaction;
      try {
        tx = JSON.parse(params.transaction);
      } catch {
        throw new InvalidParamsError('the transaction is not JSON');
      }
      const secret = await secretKey();
      const address = ed25519Address(secret);
      if (tx.sender?.toLowerCase() !== address) {
        throw new InvalidParamsError(`this transaction is from ${tx.sender}, not this Snap's account ${address}`);
      }
      const { title, rows, unknownKind } = describe(tx);
      const approved = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: (
            <Box>
              <Heading>{title}</Heading>
              <Text>{`Requested by ${origin}`}</Text>
              <Divider />
              {rows.map(([k, v]) => (
                <Row label={k}>
                  <Text>{v}</Text>
                </Row>
              ))}
              {unknownKind ? <Text color="warning">This Snap cannot describe this kind of transaction. Approve only if you trust the site.</Text> : null}
            </Box>
          ),
        },
      });
      if (!approved) throw new UserRejectedRequestError('The user rejected the transaction.');
      const signed = signEd25519(params.transaction, secret);
      return { signed, hash: transactionHash(signed) };
    }

    default:
      throw new MethodNotFoundError({ method: request.method });
  }
};
