<script setup lang="ts">
import { ref } from 'vue';
import { 
  Copy, 
  Check, 
  Send, 
  ArrowDownLeft, 
  Coins, 
  ShieldCheck, 
  Sparkles, 
  Zap 
} from 'lucide-vue-next';
import type { KeylessAccount } from '../types';
import { formatAddress, formatUsdc } from '../crypto/keyless';

const props = defineProps<{
  account: KeylessAccount;
}>();

const emit = defineEmits<{
  (e: 'open-send'): void;
  (e: 'open-receive'): void;
  (e: 'airdrop'): void;
  (e: 'verify-client'): void;
}>();

const copied = ref(false);

function copyAddress() {
  navigator.clipboard.writeText(props.account.address);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1800);
}
</script>

<template>
  <div class="wallet-card">
    <div class="card-glow"></div>

    <div class="card-top">
      <div class="user-identity">
        <img :src="account.picture" :alt="account.name" class="avatar" />
        <div class="user-info">
          <div class="user-row">
            <span class="name">{{ account.name }}</span>
            <span class="badge-google">Google OIDC</span>
          </div>
          <button @click="copyAddress" class="btn-address" title="Click to copy full L2 address">
            <span class="addr-text">{{ formatAddress(account.address, 8, 6) }}</span>
            <Check v-if="copied" :size="13" class="icon-copied" />
            <Copy v-else :size="13" class="icon-copy" />
          </button>
        </div>
      </div>

      <div class="keyless-badge">
        <Zap :size="14" class="zap-icon" />
        <span>Keyless Account</span>
      </div>
    </div>

    <!-- Balance Section -->
    <div class="balance-section">
      <span class="balance-label">Total Balance (USDC Native Stablecoin)</span>
      <div class="balance-amount">
        <span class="currency-symbol">$</span>
        <span class="currency-value">{{ formatUsdc(account.balances.usdc) }}</span>
        <span class="currency-tag">USDC</span>
      </div>
      <div class="secondary-balance">
        <Coins :size="14" class="token-icon" />
        <span>{{ formatUsdc(account.balances.sena) }} SENA</span>
        <span class="token-rate">• Network Gas Fee Token</span>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="card-actions">
      <button @click="emit('open-send')" class="btn-action primary">
        <div class="btn-icon-circle">
          <Send :size="16" />
        </div>
        <span>Send</span>
      </button>

      <button @click="emit('open-receive')" class="btn-action">
        <div class="btn-icon-circle">
          <ArrowDownLeft :size="16" />
        </div>
        <span>Receive</span>
      </button>

      <button @click="emit('airdrop')" class="btn-action airdrop" title="Claim 50.00 Testnet USDC">
        <div class="btn-icon-circle">
          <Sparkles :size="16" />
        </div>
        <span>+50 USDC</span>
      </button>

      <button @click="emit('verify-client')" class="btn-action verify" title="Run instant Sparse Merkle Light Client verification">
        <div class="btn-icon-circle">
          <ShieldCheck :size="16" />
        </div>
        <span>Verify (&lt;0.2ms)</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wallet-card {
  position: relative;
  background: linear-gradient(135deg, rgba(13, 20, 38, 0.9) 0%, rgba(7, 10, 20, 0.95) 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 28px;
  padding: 32px 36px;
  backdrop-filter: blur(20px);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  overflow: hidden;
}

.card-glow {
  position: absolute;
  top: -80px;
  right: -80px;
  width: 260px;
  height: 260px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, rgba(6, 182, 212, 0.08) 50%, transparent 70%);
  border-radius: 50%;
  pointer-events: none;
  filter: blur(20px);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.user-identity {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #10b981;
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.3);
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  font-family: 'Outfit', sans-serif;
  font-size: 1.15rem;
  font-weight: 700;
  color: #f8fafc;
}

.badge-google {
  font-size: 0.65rem;
  font-weight: 700;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  padding: 2px 8px;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.btn-address {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 3px 8px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  width: fit-content;
}

.btn-address:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
}

.icon-copied {
  color: #10b981;
}

.keyless-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
  padding: 6px 12px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.zap-icon {
  color: #10b981;
}

.balance-section {
  margin-bottom: 32px;
}

.balance-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.balance-amount {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 6px 0 10px 0;
}

.currency-symbol {
  font-family: 'Outfit', sans-serif;
  font-size: 2.2rem;
  font-weight: 700;
  color: #94a3b8;
}

.currency-value {
  font-family: 'Outfit', sans-serif;
  font-size: 3.4rem;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -0.02em;
  text-shadow: 0 0 40px rgba(16, 185, 129, 0.2);
}

.currency-tag {
  font-size: 1.1rem;
  font-weight: 700;
  color: #10b981;
  margin-left: 6px;
}

.secondary-balance {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #94a3b8;
  font-weight: 600;
}

.token-icon {
  color: #06b6d4;
}

.token-rate {
  font-size: 0.75rem;
  color: #64748b;
  font-weight: 400;
}

.card-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.btn-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 14px 10px;
  color: #e2e8f0;
  font-weight: 600;
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.btn-icon-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
}

.btn-action.primary {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2));
  border-color: rgba(16, 185, 129, 0.4);
  color: #ffffff;
}

.btn-action.primary .btn-icon-circle {
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  color: #070a12;
}

.btn-action.primary:hover {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(6, 182, 212, 0.35));
  border-color: #10b981;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
}

.btn-action.airdrop:hover .btn-icon-circle {
  color: #38bdf8;
}

.btn-action.verify:hover .btn-icon-circle {
  color: #34d399;
}

@media (max-width: 640px) {
  .wallet-card {
    padding: 24px 20px;
  }
  .currency-value {
    font-size: 2.6rem;
  }
  .card-actions {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
