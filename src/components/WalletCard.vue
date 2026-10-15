<script setup lang="ts">
import { ref } from 'vue';
import { Copy, Check, Send, ArrowDownLeft, Droplets, Zap, Clock } from 'lucide-vue-next';
import type { KeylessAccount } from '../services/auth';
import type { FeeAsset } from '../services/rpc';
import { formatAmount, shortAddress } from '../services/wallet';

const props = defineProps<{
  account: KeylessAccount;
  assets: FeeAsset[];
  balances: Map<number, bigint>;
  faucetBusy: number | null;
}>();

const emit = defineEmits<{
  (e: 'send', asset: number): void;
  (e: 'receive'): void;
  (e: 'faucet', asset: number): void;
}>();

const copied = ref(false);
function copy() {
  navigator.clipboard.writeText(props.account.address);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

const expiry = () => new Date(props.account.session.exp_date_secs * 1000);
</script>

<template>
  <div class="card wallet-card">
    <div class="card-glow"></div>
    <div class="top">
      <div class="identity">
        <img v-if="account.picture" :src="account.picture" referrerpolicy="no-referrer" class="avatar" alt="" />
        <div>
          <div class="name">{{ account.name }}</div>
          <div class="email muted">{{ account.email }}</div>
          <button class="addr mono" title="Copy your SENA address" @click="copy">
            {{ shortAddress(account.address, 10, 8) }}
            <Check v-if="copied" :size="13" class="ok" /><Copy v-else :size="13" />
          </button>
        </div>
      </div>
      <div class="badges">
        <span class="pill pill-ok"><Zap :size="12" /> Keyless</span>
        <span class="pill pill-wait" :title="`The ephemeral key in this browser expires ${expiry().toLocaleString()}; sign in again after that.`">
          <Clock :size="12" /> key until {{ expiry().toLocaleDateString() }}
        </span>
      </div>
    </div>

    <div class="coins">
      <div v-for="a in assets" :key="a.asset" class="coin">
        <div class="coin-name">
          <span class="coin-symbol">{{ a.symbol }}</span>
          <span v-if="!a.enabled" class="pill pill-off">fees off</span>
        </div>
        <div class="coin-balance mono">{{ formatAmount(balances.get(a.asset) ?? 0n) }}</div>
        <div class="coin-actions">
          <button class="btn mini" :disabled="(balances.get(a.asset) ?? 0n) === 0n || !a.enabled" @click="emit('send', a.asset)">
            <Send :size="13" /> Send
          </button>
          <button class="btn mini" :disabled="faucetBusy !== null" title="100.00 from the devnet faucet" @click="emit('faucet', a.asset)">
            <Droplets :size="13" :class="{ spin: faucetBusy === a.asset }" /> Faucet
          </button>
        </div>
      </div>
      <div v-if="assets.length === 0" class="muted">No stablecoins listed by the node yet.</div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" :disabled="assets.length === 0" @click="emit('send', assets[0]?.asset ?? 1)"><Send :size="16" /> Send</button>
      <button class="btn" @click="emit('receive')"><ArrowDownLeft :size="16" /> Receive</button>
    </div>
  </div>
</template>

<style scoped>
.wallet-card { overflow: hidden; }
.card-glow {
  position: absolute;
  top: -80px;
  right: -80px;
  width: 260px;
  height: 260px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.22) 0%, rgba(6, 182, 212, 0.08) 50%, transparent 70%);
  pointer-events: none;
}
.top { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.identity { display: flex; gap: 14px; align-items: center; }
.avatar { width: 52px; height: 52px; border-radius: 50%; border: 2px solid var(--emerald-500); }
.name { font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; }
.email { font-size: 0.8rem; margin-bottom: 4px; }
.addr {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 3px 8px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}
.addr:hover { color: var(--text-primary); }
.ok { color: var(--emerald-500); }
.badges { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.coins { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-bottom: 22px; }
.coin { background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 16px; padding: 14px; }
.coin-name { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.coin-symbol { font-weight: 700; color: var(--text-secondary); letter-spacing: 0.04em; }
.coin-balance { font-size: 1.45rem; font-weight: 600; margin-bottom: 10px; overflow-wrap: anywhere; }
.coin-actions { display: flex; gap: 6px; }
.mini { padding: 6px 10px; font-size: 0.78rem; border-radius: 10px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.actions .btn { flex: 1; min-width: 140px; padding: 12px 16px; }
</style>
