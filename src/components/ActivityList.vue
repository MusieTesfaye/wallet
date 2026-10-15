<script setup lang="ts">
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Clock, 
  Copy, 
  Check 
} from 'lucide-vue-next';
import { ref } from 'vue';
import type { TransactionRecord } from '../types';
import { formatAddress, formatUsdc } from '../crypto/keyless';

const props = defineProps<{
  transactions: TransactionRecord[];
  currentAddress: string;
}>();

const copiedHash = ref<string | null>(null);

function copyHash(hash: string) {
  navigator.clipboard.writeText(hash);
  copiedHash.value = hash;
  setTimeout(() => (copiedHash.value = null), 1500);
}

function timeAgo(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}
</script>

<template>
  <div class="activity-card">
    <div class="activity-header">
      <h4>Recent Activity</h4>
      <span class="activity-count">{{ transactions.length }} transactions</span>
    </div>

    <div v-if="transactions.length === 0" class="empty-state">
      <div class="empty-icon">
        <Clock :size="24" />
      </div>
      <p class="empty-title">No transactions yet</p>
      <p class="empty-desc">Send testnet USDC or claim testnet tokens to see real-time block activity.</p>
    </div>

    <div v-else class="tx-list">
      <div 
        v-for="tx in transactions" 
        :key="tx.hash" 
        class="tx-item"
      >
        <div class="tx-icon" :class="tx.sender.toLowerCase() === currentAddress.toLowerCase() ? 'sent' : 'received'">
          <ArrowUpRight v-if="tx.sender.toLowerCase() === currentAddress.toLowerCase()" :size="16" />
          <ArrowDownLeft v-else :size="16" />
        </div>

        <div class="tx-main">
          <div class="tx-title-row">
            <span class="tx-type">
              {{ tx.sender.toLowerCase() === currentAddress.toLowerCase() ? 'Sent USDC' : 'Received USDC' }}
            </span>
            <span class="tx-amount" :class="tx.sender.toLowerCase() === currentAddress.toLowerCase() ? 'negative' : 'positive'">
              {{ tx.sender.toLowerCase() === currentAddress.toLowerCase() ? '-' : '+' }}${{ formatUsdc(tx.amountUsdc) }}
            </span>
          </div>

          <div class="tx-subtitle-row">
            <span class="tx-peer">
              To: {{ tx.recipientEmail || formatAddress(tx.recipient, 6, 4) }}
            </span>
            <span class="tx-time">{{ timeAgo(tx.timestamp) }}</span>
          </div>

          <div class="tx-footer">
            <div class="tx-status" :class="tx.status">
              <span class="dot"></span>
              <span v-if="tx.status === 'pending'">Mempool Pending</span>
              <span v-else-if="tx.status === 'soft_confirmed'">Soft Confirmed (Block #{{ tx.blockHeight || 1 }})</span>
              <span v-else>Aptos L1 Finalized</span>
            </div>

            <button @click="copyHash(tx.hash)" class="btn-hash" title="Copy transaction hash">
              <span class="hash-text">{{ formatAddress(tx.hash, 6, 4) }}</span>
              <Check v-if="copiedHash === tx.hash" :size="12" class="copied" />
              <Copy v-else :size="12" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-card {
  background: rgba(13, 18, 34, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 24px;
  backdrop-filter: blur(16px);
  margin-top: 24px;
}

.activity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.activity-header h4 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  color: #f1f5f9;
  margin: 0;
}

.activity-count {
  font-size: 0.75rem;
  color: #64748b;
  font-weight: 600;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 20px;
  text-align: center;
}

.empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #94a3b8;
  margin: 0 0 4px 0;
}

.empty-desc {
  font-size: 0.8rem;
  color: #64748b;
  max-width: 320px;
  margin: 0;
}

.tx-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tx-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  padding: 14px 16px;
  transition: all 0.2s;
}

.tx-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.tx-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.tx-icon.sent {
  background: rgba(244, 63, 94, 0.12);
  color: #fb7185;
}

.tx-icon.received {
  background: rgba(16, 185, 129, 0.12);
  color: #34d399;
}

.tx-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tx-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tx-type {
  font-size: 0.9rem;
  font-weight: 600;
  color: #f1f5f9;
}

.tx-amount {
  font-family: 'Outfit', sans-serif;
  font-size: 1rem;
  font-weight: 700;
}

.tx-amount.negative {
  color: #f87171;
}

.tx-amount.positive {
  color: #34d399;
}

.tx-subtitle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  color: #64748b;
}

.tx-peer {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  color: #94a3b8;
}

.tx-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.tx-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-weight: 600;
}

.tx-status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.tx-status.pending {
  color: #fbbf24;
}
.tx-status.pending .dot {
  background: #fbbf24;
  box-shadow: 0 0 6px #fbbf24;
}

.tx-status.soft_confirmed {
  color: #38bdf8;
}
.tx-status.soft_confirmed .dot {
  background: #06b6d4;
  box-shadow: 0 0 6px #06b6d4;
}

.tx-status.finalized {
  color: #34d399;
}
.tx-status.finalized .dot {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.btn-hash {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s;
}

.btn-hash:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.copied {
  color: #10b981;
}
</style>
