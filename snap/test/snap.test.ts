// The SENA Snap, run in MetaMask's Snap simulator against a live SENA node.
//
// The account is derived from the simulator's recovery phrase and funded at
// genesis. A transfer is built with SENA's code, shown in the Snap's dialog,
// approved, signed by the Snap and accepted by the node; a rejected one, and
// one from another account, are not signed.
//
//   npm test        (needs SENA's release sena-node at ../../SENA, or SENA_NODE)

import { installSnap } from '@metamask/snaps-jest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as sena from '../src/generated/sena_wasm.js';

const NODE = process.env.SENA_NODE ?? resolve(__dirname, '..', '..', '..', 'SENA', 'target', 'release', 'sena-node');
const PORT = 18_846;
const RPC = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'https://wallet.example';
const rpc = async (method: string, params?: unknown): Promise<any> =>
  (await fetch(RPC, { method: 'POST', body: JSON.stringify(params === undefined ? { method } : { method, params }) })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

sena.initSync({ module: readFileSync(resolve(__dirname, '..', '..', 'src', 'sena', 'sena_wasm_bg.wasm')) });

let dir: string;
let node: ChildProcess;
let snapAddress: string;

async function unsignedTransfer(sender: string, to: string, amount: bigint) {
  const [q, info, acct] = await Promise.all([rpc('sena_gasPrice', { asset: 1 }), rpc('sena_getChainInfo'), rpc('sena_getAccount', { address: sender })]);
  return sena.buildTransfer(BigInt(info.transaction_chain_id), sender, BigInt(acct.nonce), to, 1, amount.toString(), 1,
    q.rate, BigInt(q.intrinsic_gas), q.suggested_max_fee_per_gas, '0');
}

beforeAll(async () => {
  // The simulator's default recovery phrase gives a fixed account; read it
  // first, then start a chain that funds it.
  const probe = await installSnap();
  const res: any = await probe.request({ method: 'sena_getAccount', origin: ORIGIN });
  snapAddress = res.response.result.address;

  dir = mkdtempSync(join(tmpdir(), 'sena-snap-'));
  execFileSync(NODE, ['genesis', '--data-dir', dir, '--dev', '--fund', `${snapAddress}:100000000`]);
  node = spawn(NODE, ['run', '--data-dir', dir, '--listen', `127.0.0.1:${PORT}`, '--block-interval', '1'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await rpc('sena_getChainInfo'); break; } catch { await sleep(100); }
  }
}, 60_000);

afterAll(() => {
  node?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('the account is an Ed25519 SENA address from the recovery phrase', async () => {
  const { request } = await installSnap();
  const res: any = await request({ method: 'sena_getAccount', origin: ORIGIN });
  expect(res.response.result.address).toMatch(/^0x[0-9a-f]{64}$/);
  expect(res.response.result.address).toBe(snapAddress);
});

test('a transfer is shown, approved, signed, and accepted by the node', async () => {
  const { request } = await installSnap();
  const bob = sena.ed25519Address('11'.repeat(32));
  const tx = await unsignedTransfer(snapAddress, bob, 2_500_000n);
  const pending = request({ method: 'sena_signTransaction', params: { transaction: tx }, origin: ORIGIN });
  const ui: any = await pending.getInterface();
  const shown = JSON.stringify(ui.content);
  expect(shown).toContain('Send 2.50 asset #1');
  expect(shown).toContain(ORIGIN);
  expect(shown).toContain(bob.slice(0, 10));
  expect(shown).toMatch(/up to 0\.\d+ asset #1/);
  await ui.ok();
  const res: any = await pending;
  const { signed, hash } = res.response.result;
  expect(sena.transactionHash(signed)).toBe(hash);

  const submitted = await (await fetch(RPC, { method: 'POST', body: sena.submitRequest(signed) })).json();
  expect(submitted.result).toBe('submitted');
  for (let i = 0; i < 40 && (await rpc('sena_getConfirmation', { hash })).status === 'pending'; i++) await sleep(250);
  const bobBalance = (await rpc('sena_getAccount', { address: bob })).balances.find((b: any) => b.asset === 1)?.amount;
  expect(bobBalance).toBe('2500000');
});

test('a rejected transaction is not signed', async () => {
  const { request } = await installSnap();
  const tx = await unsignedTransfer(snapAddress, sena.ed25519Address('22'.repeat(32)), 1_000_000n);
  const pending = request({ method: 'sena_signTransaction', params: { transaction: tx }, origin: ORIGIN });
  const ui: any = await pending.getInterface();
  await ui.cancel();
  const res: any = await pending;
  expect(res.response.error.code).toBe(4001);
});

test("a transaction from another account is refused without a dialog", async () => {
  const { request } = await installSnap();
  const other = sena.ed25519Address('33'.repeat(32));
  const tx = await unsignedTransfer(other, snapAddress, 1n);
  const res: any = await request({ method: 'sena_signTransaction', params: { transaction: tx }, origin: ORIGIN });
  expect(res.response.error.message).toContain('not this Snap');
});
