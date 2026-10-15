<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X, Send, ExternalLink } from 'lucide-vue-next';
import type { KeylessAccount } from '../services/auth';
import type { FeeAsset } from '../services/rpc';
import * as rpc from '../services/rpc';
import { formatAmount, isAddress, parseAmount, prepareTransfer, shortAddress, waitForBlock } from '../services/wallet';

const props = defineProps<{
  account: KeylessAccount;
  assets: FeeAsset[];
  balances: Map<number, bigint>;
  contacts: KeylessAccount[];
  initialAsset: number;
}>();

const emit = defineEmits<{ (e: 'close'): void; (e: 'sent'): void }>();

const to = ref('');
const asset = ref(props.initialAsset);
const amountText = ref('');
const stage = ref<'form' | 'signing' | 'submitting' | 'waiting' | 'done'>('form');
const error = ref<string | null>(null);
const result = ref<{ hash: string; height: number; fee: string | null } | null>(null);
const maxFee = ref<bigint | null>(null);

const coin = computed(() => props.assets.find((a) => a.asset === asset.value));
const balance = computed(() => props.balances.get(asset.value) ?? 0n);
const amount = computed(() => parseAmount(amountText.value));
const others = computed(() => props.contacts.filter((c) => c.address !== props.account.address));

const formError = computed(() => {
  if (to.value && !isAddress(to.value)) return 'An address is 0x followed by 64 hex digits.';
  if (to.value.trim().toLowerCase() === props.account.address.toLowerCase()) return 'That is your own address.';
  if (amountText.value && amount.value === null) return 'Enter an amount with at most six decimals.';
  if (amount.value !== null && amount.value > balance.value) return `You have ${formatAmount(balance.value)} ${coin.value?.symbol}.`;
  return null;
});
const canSend = computed(() => isAddress(to.value) && !!amount.value && amount.value > 0n && !formError.value);

// The fee is paid in the coin being sent; the most it can come to is the gas
// limit at the quoted maximum price. What it actually costs is shown after.
watch([asset, to], async () => {
  maxFee.value = null;
  try {
    const q = await rpc.gasPrice(asset.value);
    // A keyless transfer: 21,000 + the coin's intrinsic gas + debit and credit + keyless verification.
    const gas = 21_000n + BigInt(q.intrinsic_gas) + 10_000n + 100_000n;
    maxFee.value = (gas * BigInt(q.suggested_max_fee_per_gas) + 10n ** 12n - 1n) / 10n ** 12n;
  } catch {
    maxFee.value = null;
  }
}, { immediate: true });

async function send() {
  if (!canSend.value || amount.value === null) return;
  error.value = null;
  try {
    stage.value = 'signing';
    const p = await prepareTransfer(props.account, to.value.trim(), asset.value, amount.value);
    if (amount.value + p.maxFee > balance.value) {
      throw new Error(`Sending ${formatAmount(amount.value)} leaves too little for a fee of up to ${formatAmount(p.maxFee)} ${coin.value?.symbol}.`);
    }
    stage.value = 'submitting';
    const hash = await rpc.submit(p.signed);
    stage.value = 'waiting';
    const height = await waitForBlock(hash);
    const mine = await rpc.history(props.account.address, 20);
    const fee = mine.find((e) => e.hash === hash)?.fee_paid ?? null;
    result.value = { hash, height, fee };
    stage.value = 'done';
    emit('sent');
  } catch (e) {
    error.value = (e as Error).message;
    stage.value = 'form';
  }
}

const order = ['signing', 'submitting', 'waiting', 'done'];
const cls = (s: string) => {
  const i = order.indexOf(stage.value);
  const j = order.indexOf(s);
  return i > j ? 'done' : i === j ? 'active' : '';
};
</script>

<template>
  <div class="modal-backdrop" @click.self="stage === 'form' || stage === 'done' ? emit('close') : null">
    <div class="modal-card">
      <button class="btn-close" @click="emit('close')"><X :size="20" /></button>
      <div class="modal-header">
        <span class="icon-circle"><Send :size="22" /></span>
        <h3>Send {{ coin?.symbol }}</h3>
        <p>The fee is paid in {{ coin?.symbol }} too, signed by your keyless key.</p>
      </div>

      <template v-if="stage === 'form'">
        <div class="field">
          <label>Coin</label>
          <select v-model.number="asset" class="input">
            <option v-for="a in assets" :key="a.asset" :value="a.asset" :disabled="!a.enabled">
              {{ a.symbol }} — balance {{ formatAmount(balances.get(a.asset) ?? 0n) }}{{ a.enabled ? '' : ' (fees off)' }}
            </option>
          </select>
        </div>

        <div class="field">
          <label>To <span class="muted">SENA address</span></label>
          <input v-model="to" class="input mono" placeholder="0x…" spellcheck="false" autocomplete="off" />
          <div v-if="others.length" class="contacts">
            <button v-for="c in others" :key="c.address" class="btn mini" :title="c.address" @click="to = c.address">
              {{ c.name.split(' ')[0] }} · {{ shortAddress(c.address, 4, 4) }}
            </button>
          </div>
        </div>

        <div class="field">
          <label>Amount <button class="link" @click="amountText = formatAmount(balance).replace(/,/g, '')">balance {{ formatAmount(balance) }}</button></label>
          <input v-model="amountText" class="input mono" placeholder="0.00" inputmode="decimal" />
        </div>

        <div class="fee muted">
          Network fee: up to <b class="secondary">{{ maxFee === null ? '…' : formatAmount(maxFee) }} {{ coin?.symbol }}</b>,
          usually about half of that; the rest is refunded.
        </div>

        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div v-if="error" class="alert alert-error">{{ error }}</div>

        <button class="btn btn-primary btn-block" :disabled="!canSend" @click="send">
          Send {{ amount ? formatAmount(amount) : '' }} {{ coin?.symbol }}
        </button>
      </template>

      <template v-else>
        <div class="steps">
          <div class="step" :class="cls('signing')"><span class="dot"></span>Signing with your ephemeral key</div>
          <div class="step" :class="cls('submitting')"><span class="dot"></span>Submitting to the sequencer</div>
          <div class="step" :class="cls('waiting')"><span class="dot"></span>Waiting for a block</div>
          <div class="step" :class="cls('done')"><span class="dot"></span>Included</div>
        </div>
        <div v-if="result" class="alert alert-ok">
          Sent {{ amount ? formatAmount(amount) : '' }} {{ coin?.symbol }} in block #{{ result.height }}.
          <span v-if="result.fee">Fee: {{ formatAmount(BigInt(result.fee)) }} {{ coin?.symbol }}.</span>
          <div class="mono hash">{{ result.hash }}</div>
          <div class="muted small">Soft-confirmed by the sequencer: final once its assertion survives the challenge window on Aptos.</div>
        </div>
        <button v-if="stage === 'done'" class="btn btn-block" @click="emit('close')"><ExternalLink :size="15" /> Done</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.contacts { display: flex; gap: 6px; flex-wrap: wrap; }
.mini { padding: 5px 9px; font-size: 0.75rem; border-radius: 9px; }
.link { background: none; border: none; color: var(--emerald-400); cursor: pointer; font-size: 0.75rem; text-transform: none; letter-spacing: 0; }
.fee { font-size: 0.82rem; margin: -4px 0 16px; line-height: 1.5; }
.alert { margin-bottom: 14px; }
.hash { font-size: 0.72rem; margin: 6px 0; overflow-wrap: anywhere; }
.small { font-size: 0.75rem; }
</style>
