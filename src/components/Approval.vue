<script setup lang="ts">
// The extension's approval window: a website asked to see an address, or to be
// paid. Nothing happens until the user approves here, in the extension's own
// window, which the website cannot see or script.
import { computed, onMounted, ref } from 'vue';
import * as auth from '../services/auth';
import type { Account } from '../services/auth';
import * as rpc from '../services/rpc';
import type { FeeAsset } from '../services/rpc';
import * as identity from '../services/identity';
import { loadSena } from '../services/sena';
import { formatAmount, isAddress, prepareTransfer, shortAddress, waitForBlock } from '../services/wallet';
import type { Prepared } from '../services/wallet';

declare const chrome: any;

interface ConnectRequest { type: 'connect'; origin: string }
interface TransferRequest { type: 'transfer'; origin: string; from: string; to: string; asset: number; amount: string }
type Request = ConnectRequest | TransferRequest;

const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('id') ?? '';
const request = ref<Request | null>(null);
const accounts = ref<Account[]>(auth.savedAccounts().filter((a) => !auth.isExpired(a)));
const chosen = ref<string>(auth.activeAddress() ?? accounts.value[0]?.address ?? '');
const assets = ref<FeeAsset[]>([]);
const recipient = ref<{ address: string; via?: string } | null>(null);
const prepared = ref<Prepared | null>(null);
const error = ref<string | null>(null);
const working = ref(false);
const done = ref<string | null>(null);

const site = computed(() => {
  try { return new URL(request.value!.origin).host; } catch { return request.value?.origin ?? ''; }
});
const symbol = (asset: number) => assets.value.find((a) => a.asset === asset)?.symbol ?? `asset ${asset}`;
const payer = computed(() => {
  const r = request.value;
  return r?.type === 'transfer' ? auth.savedAccounts().find((a) => a.address === r.from) ?? null : null;
});

function settle(result?: unknown, err?: string) {
  chrome.runtime.sendMessage({ type: 'sena:approval:settle', id, result, error: err });
}

onMounted(async () => {
  request.value = await chrome.runtime.sendMessage({ type: 'sena:approval:get', id });
  if (!request.value) {
    error.value = 'This request has expired. Close this window and try again from the website.';
    return;
  }
  const r = request.value;
  if (r.type !== 'transfer') return;
  try {
    await loadSena();
    assets.value = await rpc.feeAssets();
    if (!payer.value) throw new Error(`The account ${shortAddress(r.from)} this site is connected to is not in this wallet any more.`);
    if (auth.isExpired(payer.value)) throw new Error('Your sign-in has expired. Open SENA and sign in again, then retry.');
    if (isAddress(r.to)) recipient.value = { address: r.to.toLowerCase() };
    else {
      const parsed = identity.parseRecipient(r.to);
      if (!parsed) throw new Error(`"${r.to}" is neither an address nor an email, phone number or prefix:name.`);
      const found = await identity.resolve(parsed.prefix, parsed.plaintext);
      if (!found) throw new Error(`Nobody your trusted issuers know is ${r.to}.`);
      recipient.value = { address: found.account, via: r.to };
    }
    prepared.value = await prepareTransfer(payer.value, recipient.value.address, r.asset, BigInt(r.amount));
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function approve() {
  const r = request.value!;
  error.value = null;
  if (r.type === 'connect') return settle({ address: chosen.value });
  working.value = true;
  try {
    // Re-prepared so the nonce and base fee are current; a MetaMask account
    // shows it once more in MetaMask before signing.
    const p = await prepareTransfer(payer.value!, recipient.value!.address, r.asset, BigInt(r.amount));
    const hash = await rpc.submit(p.signed);
    const height = await waitForBlock(hash);
    done.value = `Sent in block #${height}`;
    settle({ hash, height });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
  }
}

const reject = () => settle(undefined, 'The user rejected the request.');
</script>

<template>
  <div class="approval">
    <header>
      <img src="/favicon.svg" alt="" width="28" height="28" />
      <span>SENA</span>
    </header>

    <div v-if="!request && !error" class="muted">Loading…</div>

    <template v-else-if="request?.type === 'connect'">
      <h1>Connect to {{ site }}?</h1>
      <p class="secondary">The site will see the address you choose and can ask you to approve payments. It cannot move coins on its own.</p>
      <div v-if="accounts.length === 0" class="alert alert-info">Sign in to SENA first: open the extension from the toolbar.</div>
      <label v-for="a in accounts" :key="a.address" class="choice" :class="{ on: chosen === a.address }">
        <input v-model="chosen" type="radio" :value="a.address" />
        <div><div class="name">{{ a.email || a.name }}</div><div class="mono muted">{{ shortAddress(a.address, 10, 8) }}</div></div>
      </label>
      <div class="actions">
        <button class="btn" @click="reject">Cancel</button>
        <button class="btn btn-primary" :disabled="!chosen" @click="approve">Connect</button>
      </div>
    </template>

    <template v-else-if="request?.type === 'transfer'">
      <h1>{{ site }} asks you to pay</h1>
      <div v-if="assets.length" class="amount">{{ formatAmount(BigInt(request.amount)) }} <span>{{ symbol(request.asset) }}</span></div>
      <table>
        <tbody>
          <tr><td>To</td><td class="mono">{{ recipient ? shortAddress(recipient.address, 10, 8) : '…' }}<div v-if="recipient?.via" class="muted">{{ recipient.via }}</div></td></tr>
          <tr><td>From</td><td>{{ payer?.email || payer?.name }}<div class="mono muted">{{ shortAddress(request.from, 10, 8) }}</div></td></tr>
          <tr><td>Network fee</td><td>{{ prepared ? `up to ${formatAmount(prepared.maxFee)} ${symbol(request.asset)}` : '…' }}</td></tr>
        </tbody>
      </table>
      <div v-if="done" class="alert alert-ok">{{ done }}</div>
      <div class="actions" v-else>
        <button class="btn" :disabled="working" @click="reject">Reject</button>
        <button class="btn btn-primary" :disabled="!prepared || working" @click="approve">{{ working ? 'Sending…' : 'Approve' }}</button>
      </div>
    </template>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.approval { max-width: 400px; margin: 0 auto; padding: 18px 18px 24px; display: flex; flex-direction: column; gap: 14px; }
header { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.05rem; }
h1 { font-size: 1.15rem; margin: 4px 0 0; }
.secondary { font-size: 0.86rem; line-height: 1.5; }
.choice { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: 12px; cursor: pointer; }
.choice.on { border-color: rgba(16, 185, 129, 0.6); }
.name { font-weight: 600; font-size: 0.9rem; }
.mono { font-family: var(--font-mono); font-size: 0.8rem; }
.amount { font-size: 2rem; font-weight: 700; }
.amount span { font-size: 1.1rem; color: var(--text-secondary); }
table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
td { padding: 8px 0; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
td:first-child { color: var(--text-secondary); width: 100px; }
.actions { display: flex; gap: 10px; }
.actions .btn { flex: 1; justify-content: center; }
</style>
