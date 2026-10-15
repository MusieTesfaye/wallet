<script setup lang="ts">
import { ref, computed } from 'vue';
import { 
  Zap, 
  ArrowLeftRight, 
  Wifi, 
  WifiOff, 
  Database, 
  Clock, 
  Play, 
  Square,
  ArrowRight
} from 'lucide-vue-next';
import type { KeylessAccount, StreamEvent } from '../types';
import { streamService } from '../services/stream';
import { formatAddress, formatUsdc } from '../crypto/keyless';

const props = defineProps<{
  accounts: KeylessAccount[];
  activeAccount: KeylessAccount | null;
}>();

const emit = defineEmits<{
  (e: 'select-account', email: string): void;
  (e: 'stream-sent', event: StreamEvent): void;
}>();

const isWsConnected = streamService.isConnected;
const wsLatency = streamService.latencyMs;
const streamFeed = streamService.streamFeed;

// Dual Account Selection
const senderEmail = ref<string>('');
const recipientEmail = ref<string>('');
const amountInput = ref('1.00');
const isStreaming = ref(false);
const burstActive = ref(false);
const burstCounter = ref(0);
let burstInterval: any = null;

// Initialize selections from available accounts
if (props.accounts.length >= 2) {
  senderEmail.value = props.accounts[0].email;
  recipientEmail.value = props.accounts[1].email;
} else if (props.accounts.length === 1) {
  senderEmail.value = props.accounts[0].email;
}

const senderAccount = computed(() => {
  return props.accounts.find(a => a.email === senderEmail.value) || props.activeAccount || props.accounts[0] || null;
});

const recipientAccount = computed(() => {
  return props.accounts.find(a => a.email === recipientEmail.value) || props.accounts[1] || props.accounts[0] || null;
});

const amountMicroUsdc = computed(() => {
  const v = parseFloat(amountInput.value);
  if (isNaN(v) || v <= 0) return 1_000_000;
  return Math.round(v * 1_000_000);
});

function swapAccounts() {
  const temp = senderEmail.value;
  senderEmail.value = recipientEmail.value;
  recipientEmail.value = temp;
}

async function executeSingleStream() {
  if (!senderAccount.value || !recipientAccount.value) return;
  if (senderAccount.value.address === recipientAccount.value.address) {
    alert("Sender and recipient must be different accounts.");
    return;
  }

  isStreaming.value = true;
  try {
    const packet = await streamService.executeStreamingTransfer({
      sender: senderAccount.value,
      recipientAddress: recipientAccount.value.address,
      amountMicroUsdc: amountMicroUsdc.value,
      feeMicroUsdc: 1000,
      recipientEmail: recipientAccount.value.email,
    });

    if (packet) {
      emit('stream-sent', packet);
    }
  } catch (err: any) {
    alert(err?.message || "Streaming transfer failed");
  } finally {
    isStreaming.value = false;
  }
}

function startBurstStream() {
  if (burstActive.value) {
    stopBurstStream();
    return;
  }

  burstActive.value = true;
  burstCounter.value = 0;

  burstInterval = setInterval(async () => {
    if (burstCounter.value >= 5) {
      stopBurstStream();
      return;
    }

    try {
      if (senderAccount.value && recipientAccount.value) {
        await streamService.executeStreamingTransfer({
          sender: senderAccount.value,
          recipientAddress: recipientAccount.value.address,
          amountMicroUsdc: amountMicroUsdc.value,
          feeMicroUsdc: 1000,
          recipientEmail: recipientAccount.value.email,
        });
        burstCounter.value += 1;
      }
    } catch {
      stopBurstStream();
    }
  }, 900);
}

function stopBurstStream() {
  burstActive.value = false;
  if (burstInterval) {
    clearInterval(burstInterval);
    burstInterval = null;
  }
}
</script>

<template>
  <div class="stream-panel">
    <!-- Header with WebSocket & SQLite Status -->
    <div class="panel-header">
      <div class="header-left">
        <div class="bolt-icon-wrap">
          <Zap :size="20" class="bolt-icon" />
        </div>
        <div>
          <h3 class="panel-title">Fast WebSocket Streaming & SQLite Engine</h3>
          <p class="panel-sub">Stream peer-to-peer micro-transactions between accounts in real-time</p>
        </div>
      </div>

      <div class="status-group">
        <!-- SQLite WAL Badge -->
        <div class="tech-badge sqlite-badge">
          <Database :size="13" />
          <span>Bun SQLite (WAL)</span>
        </div>

        <!-- WebSocket Stream Status -->
        <div class="tech-badge ws-badge" :class="{ connected: isWsConnected }">
          <component :is="isWsConnected ? Wifi : WifiOff" :size="13" />
          <span>{{ isWsConnected ? `WS Connected (${wsLatency}ms)` : 'WS Disconnected' }}</span>
        </div>
      </div>
    </div>

    <!-- P2P Transfer Stage (Account 1 <-> Account 2) -->
    <div class="transfer-stage">
      <!-- Account A (Sender) -->
      <div class="account-card" :class="{ 'is-active': senderAccount?.email === activeAccount?.email }">
        <div class="card-top">
          <span class="role-badge sender-badge">Sender</span>
          <select v-model="senderEmail" class="account-select">
            <option v-for="acc in accounts" :key="acc.email" :value="acc.email">
              {{ acc.name }} ({{ acc.email }})
            </option>
          </select>
        </div>

        <div v-if="senderAccount" class="account-body">
          <div class="user-row">
            <img :src="senderAccount.picture" :alt="senderAccount.name" class="avatar" />
            <div class="user-details">
              <span class="name">{{ senderAccount.name }}</span>
              <span class="addr">{{ formatAddress(senderAccount.address, 6, 4) }}</span>
            </div>
          </div>
          <div class="balance-display">
            <span class="bal-label">SQLite Balance</span>
            <span class="bal-val">${{ formatUsdc(senderAccount.balances.usdc) }} <span class="unit">USDC</span></span>
          </div>
        </div>
      </div>

      <!-- Center Action Hub -->
      <div class="bridge-action-hub">
        <button @click="swapAccounts" class="btn-swap" title="Swap Sender and Recipient">
          <ArrowLeftRight :size="18" />
        </button>

        <div class="amount-field-wrap">
          <span class="currency-sym">$</span>
          <input 
            v-model="amountInput" 
            type="number" 
            step="0.5" 
            min="0.1" 
            placeholder="1.00" 
            class="stream-amount-input" 
          />
          <span class="unit-sym">USDC</span>
        </div>

        <div class="action-buttons-column">
          <!-- 1-Click Stream Send -->
          <button 
            @click="executeSingleStream" 
            :disabled="isStreaming || !senderAccount || !recipientAccount || senderAccount.address === recipientAccount.address"
            class="btn-stream-send"
          >
            <Zap :size="16" />
            <span>{{ isStreaming ? 'Streaming...' : 'Stream 1x Tx' }}</span>
          </button>

          <!-- Burst 5x Continuous Stream -->
          <button 
            @click="startBurstStream" 
            :class="{ 'btn-burst-active': burstActive }"
            class="btn-burst"
          >
            <component :is="burstActive ? Square : Play" :size="14" />
            <span>{{ burstActive ? `Burst (${burstCounter}/5)... Stop` : '🚀 Stream 5x Burst' }}</span>
          </button>
        </div>
      </div>

      <!-- Account B (Recipient) -->
      <div class="account-card" :class="{ 'is-active': recipientAccount?.email === activeAccount?.email }">
        <div class="card-top">
          <span class="role-badge recipient-badge">Recipient</span>
          <select v-model="recipientEmail" class="account-select">
            <option v-for="acc in accounts" :key="acc.email" :value="acc.email">
              {{ acc.name }} ({{ acc.email }})
            </option>
          </select>
        </div>

        <div v-if="recipientAccount" class="account-body">
          <div class="user-row">
            <img :src="recipientAccount.picture" :alt="recipientAccount.name" class="avatar" />
            <div class="user-details">
              <span class="name">{{ recipientAccount.name }}</span>
              <span class="addr">{{ formatAddress(recipientAccount.address, 6, 4) }}</span>
            </div>
          </div>
          <div class="balance-display">
            <span class="bal-label">SQLite Balance</span>
            <span class="bal-val positive">${{ formatUsdc(recipientAccount.balances.usdc) }} <span class="unit">USDC</span></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Live WebSocket Stream Packet Terminal -->
    <div class="stream-terminal">
      <div class="terminal-bar">
        <div class="bar-left">
          <span class="pulse-indicator" :class="{ live: isWsConnected }"></span>
          <span class="bar-title">LIVE WEBSOCKET PACKET STREAM (`wallet-stream`)</span>
        </div>
        <span class="packet-count">{{ streamFeed.length }} frames captured</span>
      </div>

      <div class="packet-feed">
        <div v-if="streamFeed.length === 0" class="empty-feed">
          <Clock :size="16" />
          <span>Waiting for stream packets... Click "Stream 1x Tx" above to send live over WebSocket.</span>
        </div>

        <div 
          v-for="pkt in streamFeed" 
          :key="pkt.id" 
          class="stream-packet-row"
          :class="pkt.type"
        >
          <span class="pkt-time">{{ new Date(pkt.timestamp).toLocaleTimeString() }}</span>
          <span class="pkt-tag" :class="pkt.type">{{ pkt.type }}</span>
          
          <div v-if="pkt.type === 'TX_STREAM'" class="pkt-content">
            <span class="pkt-status" :class="pkt.status">{{ pkt.status }}</span>
            <span class="pkt-details">
              Sent <b>${{ pkt.amountUsdc ? (pkt.amountUsdc / 1_000_000).toFixed(2) : '0.00' }} USDC</b>
              <ArrowRight :size="12" class="arrow" />
              Hash: <span class="mono">{{ pkt.hash ? pkt.hash.slice(0, 14) : '' }}...</span>
              <span v-if="pkt.blockHeight" class="block-ref">Block #{{ pkt.blockHeight }}</span>
            </span>
          </div>

          <div v-else-if="pkt.type === 'FAUCET_CLAIMED'" class="pkt-content">
            <span class="pkt-details">
              Faucet +${{ pkt.amountAdded ? (pkt.amountAdded / 1_000_000).toFixed(2) : '50.00' }} USDC &bull;
              New Bal: ${{ pkt.newBalance ? (pkt.newBalance / 1_000_000).toFixed(2) : '0' }}
            </span>
          </div>

          <div v-else class="pkt-content">
            <span class="pkt-details">{{ pkt.message || JSON.stringify(pkt) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stream-panel {
  background: radial-gradient(circle at 10% 20%, rgba(18, 25, 44, 0.85) 0%, rgba(10, 14, 26, 0.95) 100%);
  border: 1px solid rgba(59, 130, 246, 0.22);
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 12px 36px -10px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  padding-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.bolt-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(234, 179, 8, 0.2), rgba(249, 115, 22, 0.25));
  border: 1px solid rgba(234, 179, 8, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fbbf24;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: #ffffff;
}

.panel-sub {
  margin: 2px 0 0 0;
  font-size: 0.84rem;
  color: #94a3b8;
}

.status-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tech-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 100px;
  font-size: 0.78rem;
  font-weight: 600;
}

.sqlite-badge {
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(14, 165, 233, 0.3);
  color: #38bdf8;
}

.ws-badge {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
  transition: all 0.3s ease;
}

.ws-badge.connected {
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

/* P2P Transfer Stage */
.transfer-stage {
  display: grid;
  grid-template-columns: 1fr 220px 1fr;
  gap: 16px;
  align-items: stretch;
}

@media (max-width: 900px) {
  .transfer-stage {
    grid-template-columns: 1fr;
  }
}

.account-card {
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.2s ease;
}

.account-card.is-active {
  border-color: rgba(59, 130, 246, 0.45);
  background: rgba(30, 58, 138, 0.15);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.role-badge {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}

.sender-badge {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.recipient-badge {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.account-select {
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #cbd5e1;
  font-size: 0.78rem;
  border-radius: 6px;
  padding: 4px 8px;
  max-width: 170px;
  outline: none;
}

.account-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(59, 130, 246, 0.4);
}

.user-details {
  display: flex;
  flex-direction: column;
}

.user-details .name {
  font-weight: 600;
  font-size: 0.95rem;
  color: #f1f5f9;
}

.user-details .addr {
  font-family: monospace;
  font-size: 0.75rem;
  color: #64748b;
}

.balance-display {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  padding: 8px 12px;
}

.bal-label {
  font-size: 0.72rem;
  color: #94a3b8;
}

.bal-val {
  font-size: 1.25rem;
  font-weight: 700;
  color: #f8fafc;
}

.bal-val.positive {
  color: #38bdf8;
}

.bal-val .unit {
  font-size: 0.8rem;
  font-weight: 500;
  color: #94a3b8;
}

/* Center Bridge Actions */
.bridge-action-hub {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.btn-swap {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-swap:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: rotate(180deg);
}

.amount-field-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.currency-sym {
  position: absolute;
  left: 10px;
  color: #94a3b8;
  font-weight: 600;
  font-size: 0.9rem;
}

.stream-amount-input {
  width: 100%;
  background: #0f172a;
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 10px;
  color: #ffffff;
  padding: 8px 36px 8px 24px;
  font-size: 1.05rem;
  font-weight: 700;
  text-align: center;
  outline: none;
}

.stream-amount-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.3);
}

.unit-sym {
  position: absolute;
  right: 10px;
  font-size: 0.72rem;
  color: #64748b;
  font-weight: 700;
}

.action-buttons-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.btn-stream-send {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 700;
  font-size: 0.88rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
  transition: all 0.2s;
}

.btn-stream-send:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
}

.btn-stream-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-burst {
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.35);
  color: #fbbf24;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-burst:hover {
  background: rgba(234, 179, 8, 0.22);
}

.btn-burst-active {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #f87171;
}

/* Terminal Feed */
.stream-terminal {
  background: #060911;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  overflow: hidden;
}

.terminal-bar {
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
}

.pulse-indicator.live {
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  animation: pulse 1.8s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.9); }
}

.bar-title {
  font-size: 0.75rem;
  font-family: monospace;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.05em;
}

.packet-count {
  font-size: 0.72rem;
  color: #64748b;
  font-family: monospace;
}

.packet-feed {
  max-height: 180px;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: monospace;
  font-size: 0.78rem;
}

.empty-feed {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  padding: 16px;
  justify-content: center;
}

.stream-packet-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  border-left: 3px solid #3b82f6;
  animation: fadeIn 0.25s ease-out;
}

.stream-packet-row.FAUCET_CLAIMED {
  border-left-color: #eab308;
}

.stream-packet-row.CONNECTED {
  border-left-color: #22c55e;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}

.pkt-time {
  color: #64748b;
  font-size: 0.72rem;
}

.pkt-tag {
  font-size: 0.68rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.pkt-tag.FAUCET_CLAIMED {
  background: rgba(234, 179, 8, 0.2);
  color: #facc15;
}

.pkt-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.pkt-status {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.68rem;
  text-transform: uppercase;
  font-weight: 700;
}

.pkt-status.pending {
  background: rgba(234, 179, 8, 0.2);
  color: #facc15;
}

.pkt-status.soft_confirmed {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.pkt-details {
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.arrow {
  color: #94a3b8;
}

.mono {
  color: #38bdf8;
}

.block-ref {
  color: #a78bfa;
  font-weight: 600;
}
</style>
