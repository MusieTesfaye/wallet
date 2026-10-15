<script setup lang="ts">
import { ArrowUpRight, ArrowDownLeft, Activity } from 'lucide-vue-next';
import type { FeeAsset, HistoryEntry } from '../services/rpc';
import type { KeylessAccount } from '../services/auth';
import { formatAmount, shortAddress } from '../services/wallet';

const props = defineProps<{
  entries: HistoryEntry[];
  address: string;
  assets: FeeAsset[];
  contacts: KeylessAccount[];
  faucet: string | null;
}>();

const symbol = (id?: number) => props.assets.find((a) => a.asset === id)?.symbol ?? `asset ${id}`;

function who(address?: string) {
  if (!address) return '';
  if (address === props.faucet) return 'Faucet';
  const c = props.contacts.find((x) => x.address === address);
  return c ? c.name.split(' ')[0] : shortAddress(address, 6, 4);
}

const outgoing = (e: HistoryEntry) => e.transaction.sender === props.address;
const time = (e: HistoryEntry) => (e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : 'queued');
</script>

<template>
  <div class="card">
    <div class="card-title"><Activity :size="18" /> Activity</div>
    <div v-if="entries.length === 0" class="empty muted">
      Nothing yet. Ask the faucet for coins, or share your address.
    </div>
    <ul v-else class="list">
      <li v-for="e in entries" :key="e.hash" class="row" :title="e.hash">
        <span class="icon" :class="outgoing(e) ? 'out' : 'in'">
          <ArrowUpRight v-if="outgoing(e)" :size="16" /><ArrowDownLeft v-else :size="16" />
        </span>
        <div class="main">
          <div class="line">
            <span v-if="e.transaction.payload.kind === 'transfer'">
              {{ outgoing(e) ? 'To' : 'From' }} {{ outgoing(e) ? who(e.transaction.payload.to) : who(e.transaction.sender) }}
            </span>
            <span v-else>{{ e.transaction.payload.kind }}</span>
            <span class="amount mono" :class="outgoing(e) ? 'neg' : 'pos'" v-if="e.transaction.payload.amount">
              {{ outgoing(e) ? '−' : '+' }}{{ formatAmount(BigInt(e.transaction.payload.amount)) }}
              {{ symbol(e.transaction.payload.asset) }}
            </span>
          </div>
          <div class="sub muted">
            <span>{{ time(e) }}</span>
            <span v-if="outgoing(e) && e.fee_paid">fee {{ formatAmount(BigInt(e.fee_paid)) }} {{ symbol(e.transaction.fee_asset) }}</span>
            <span class="pill" :class="e.confirmation.status === 'pending' ? 'pill-wait' : 'pill-ok'">
              {{ e.confirmation.status === 'pending' ? 'pending' : e.confirmation.status === 'finalized' ? 'final' : `block #${e.confirmation.height}` }}
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.card-title { display: flex; align-items: center; gap: 8px; }
.empty { font-size: 0.88rem; padding: 12px 0; }
.list { list-style: none; display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; gap: 12px; align-items: center; padding: 10px 4px; border-bottom: 1px solid var(--border-subtle); }
.row:last-child { border-bottom: none; }
.icon { width: 34px; height: 34px; flex: none; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.icon.in { background: rgba(16, 185, 129, 0.12); color: var(--emerald-400); }
.icon.out { background: rgba(56, 189, 248, 0.1); color: var(--cyan-400); }
.main { flex: 1; min-width: 0; }
.line { display: flex; justify-content: space-between; gap: 8px; font-size: 0.9rem; font-weight: 600; flex-wrap: wrap; }
.amount.pos { color: var(--emerald-400); }
.amount.neg { color: var(--text-primary); }
.sub { display: flex; gap: 10px; align-items: center; font-size: 0.74rem; margin-top: 3px; flex-wrap: wrap; }
</style>
