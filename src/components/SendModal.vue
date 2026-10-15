<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { 
  X, 
  Send, 
  Check, 
  Loader2, 
  ShieldCheck, 
  AlertCircle, 
  Sparkles 
} from 'lucide-vue-next';
import type { KeylessAccount, TransactionRecord } from '../types';
import { senaRpc } from '../services/rpc';
import { formatAddress, formatUsdc } from '../crypto/keyless';

const props = defineProps<{
  isOpen: boolean;
  account: KeylessAccount;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'transaction-sent', tx: TransactionRecord): void;
}>();

const recipientInput = ref('');
const amountInput = ref('');
const resolvedAddress = ref<string | null>(null);
const isResolving = ref(false);
const isSending = ref(false);
const sendStep = ref(0);
const errorMessage = ref('');

const feeUsdc = 1000; // 0.001 USDC

const amountMicroUsdc = computed(() => {
  const val = parseFloat(amountInput.value);
  if (isNaN(val) || val <= 0) return 0;
  return Math.round(val * 1_000_000);
});

const canSend = computed(() => {
  return (
    (resolvedAddress.value || recipientInput.value.startsWith('0x')) &&
    amountMicroUsdc.value > 0 &&
    amountMicroUsdc.value + feeUsdc <= props.account.balances.usdc &&
    !isSending.value
  );
});

watch(recipientInput, (val) => {
  resolvedAddress.value = null;
  errorMessage.value = '';
  if (!val) return;

  if (val.startsWith('@')) {
    isResolving.value = true;
    setTimeout(() => {
      const found = senaRpc.resolveSocialIdentifier(val);
      resolvedAddress.value = found;
      isResolving.value = false;
      if (!found) {
        errorMessage.value = `Identifier "${val}" not yet registered in SENA Social Connect`;
      }
    }, 200);
  } else if (val.startsWith('0x') && val.length >= 42) {
    resolvedAddress.value = val;
  }
});

function setPresetAmount(val: number) {
  amountInput.value = val.toString();
}

function setMaxAmount() {
  const max = Math.max(0, (props.account.balances.usdc - feeUsdc) / 1_000_000);
  amountInput.value = max.toFixed(2);
}

async function handleSend() {
  if (!canSend.value) return;
  const targetAddress = resolvedAddress.value || recipientInput.value;
  isSending.value = true;
  sendStep.value = 1; // Signing with Ephemeral Key

  try {
    await new Promise(r => setTimeout(r, 300));
    sendStep.value = 2; // Attaching BN254 Groth16 Proof

    await new Promise(r => setTimeout(r, 400));
    sendStep.value = 3; // Submitting to SENA Mempool via HTTP RPC

    const tx = await senaRpc.submitKeylessTransfer(
      props.account,
      targetAddress,
      amountMicroUsdc.value,
      recipientInput.value.startsWith('@') ? recipientInput.value : undefined
    );

    await new Promise(r => setTimeout(r, 300));
    sendStep.value = 4; // Block inclusion confirmed!

    await new Promise(r => setTimeout(r, 500));
    isSending.value = false;
    emit('transaction-sent', tx);
    emit('close');
    recipientInput.value = '';
    amountInput.value = '';
  } catch (err: any) {
    errorMessage.value = err?.message || 'Transaction submission failed';
    isSending.value = false;
  }
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card">
      <button class="btn-close" @click="emit('close')">
        <X :size="20" />
      </button>

      <div class="modal-header">
        <div class="icon-circle">
          <Send :size="22" />
        </div>
        <h3>Send USDC</h3>
        <p class="sub">Keyless peer-to-peer transfer authorized by BN254 Groth16 ZK Proof</p>
      </div>

      <!-- Execution Progress -->
      <div v-if="isSending" class="sending-progress">
        <div class="progress-step" :class="{ done: sendStep > 1, active: sendStep === 1 }">
          <div class="dot"></div>
          <span>Sign with Ephemeral Private Key (EPK)</span>
        </div>
        <div class="progress-step" :class="{ done: sendStep > 2, active: sendStep === 2 }">
          <div class="dot"></div>
          <span>Attach 128-byte BN254 Groth16 ZK Proof</span>
        </div>
        <div class="progress-step" :class="{ done: sendStep > 3, active: sendStep === 3 }">
          <div class="dot"></div>
          <span>Mempool Admission over HTTP JSON-RPC</span>
        </div>
        <div class="progress-step" :class="{ done: sendStep >= 4, active: sendStep === 4 }">
          <div class="dot"></div>
          <span>Sequencer Soft Confirmation (Block Inclusion)</span>
        </div>
      </div>

      <!-- Form View -->
      <div v-else class="send-form">
        <!-- Recipient -->
        <div class="form-group">
          <label class="group-label">
            <span>Recipient</span>
            <span class="label-hint">Address or @handle</span>
          </label>
          <div class="input-wrap">
            <input 
              v-model="recipientInput" 
              type="text" 
              placeholder="@bob, @alice, or 0x..." 
              class="form-input"
            />
            <Loader2 v-if="isResolving" :size="16" class="spin-icon input-trailing" />
            <Check v-else-if="resolvedAddress" :size="16" class="check-icon input-trailing" />
          </div>

          <div v-if="resolvedAddress && recipientInput.startsWith('@')" class="resolved-pill">
            <ShieldCheck :size="13" />
            <span>Resolved to: {{ formatAddress(resolvedAddress, 8, 6) }}</span>
          </div>

          <div v-if="errorMessage" class="error-msg">
            <AlertCircle :size="14" />
            <span>{{ errorMessage }}</span>
          </div>
        </div>

        <!-- Amount -->
        <div class="form-group">
          <div class="group-label-row">
            <span class="group-label">Amount</span>
            <span class="balance-helper">
              Available: <b>${{ formatUsdc(account.balances.usdc) }}</b> USDC
            </span>
          </div>

          <div class="amount-input-wrap">
            <span class="currency-tag">$</span>
            <input 
              v-model="amountInput" 
              type="number" 
              step="0.01" 
              placeholder="0.00" 
              class="amount-input"
            />
            <span class="token-name">USDC</span>
          </div>

          <!-- Quick Presets -->
          <div class="preset-pills">
            <button @click="setPresetAmount(1)" type="button" class="pill">$1.00</button>
            <button @click="setPresetAmount(5)" type="button" class="pill">$5.00</button>
            <button @click="setPresetAmount(20)" type="button" class="pill">$20.00</button>
            <button @click="setMaxAmount" type="button" class="pill max">Max</button>
          </div>
        </div>

        <!-- Summary -->
        <div class="tx-summary">
          <div class="summary-row">
            <span>Network Fee (USDC whitelist)</span>
            <span class="fee-val">${{ (feeUsdc / 1_000_000).toFixed(4) }} USDC</span>
          </div>
          <div class="summary-row">
            <span>Authenticator</span>
            <span class="zk-tag">BN254 Groth16 (128 bytes)</span>
          </div>
        </div>

        <button 
          @click="handleSend" 
          :disabled="!canSend"
          class="btn-send-submit"
        >
          <Sparkles :size="18" />
          <span>Confirm &amp; Send Keyless Transaction</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(4, 7, 14, 0.85);
  backdrop-filter: blur(14px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-card {
  position: relative;
  width: 100%;
  max-width: 480px;
  background: #0d1222;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 24px;
  padding: 32px 28px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(16, 185, 129, 0.1);
}

.btn-close {
  position: absolute;
  top: 20px;
  right: 20px;
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: all 0.2s;
}

.btn-close:hover {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
}

.modal-header {
  text-align: center;
  margin-bottom: 24px;
}

.icon-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border-radius: 16px;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
  margin-bottom: 12px;
}

.modal-header h3 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 6px 0;
}

.modal-header .sub {
  font-size: 0.8rem;
  color: #94a3b8;
  margin: 0;
}

.send-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.group-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #cbd5e1;
  display: flex;
  justify-content: space-between;
}

.label-hint {
  font-size: 0.72rem;
  color: #64748b;
  font-weight: 400;
}

.balance-helper {
  font-size: 0.75rem;
  color: #94a3b8;
}

.balance-helper b {
  color: #10b981;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.form-input {
  width: 100%;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px 14px;
  color: #f8fafc;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.88rem;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: #10b981;
}

.input-trailing {
  position: absolute;
  right: 14px;
}

.check-icon {
  color: #10b981;
}

.resolved-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  color: #34d399;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 8px;
  border-radius: 6px;
  width: fit-content;
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 8px 16px;
  transition: border-color 0.2s;
}

.amount-input-wrap:focus-within {
  border-color: #10b981;
}

.currency-tag {
  font-size: 1.4rem;
  font-weight: 700;
  color: #64748b;
  margin-right: 6px;
}

.amount-input {
  flex: 1;
  background: transparent;
  border: none;
  font-family: 'Outfit', sans-serif;
  font-size: 1.8rem;
  font-weight: 700;
  color: #ffffff;
  outline: none;
}

.token-name {
  font-size: 0.9rem;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  padding: 4px 8px;
  border-radius: 6px;
}

.preset-pills {
  display: flex;
  gap: 8px;
}

.pill {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 6px;
  color: #94a3b8;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.pill:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
}

.pill.max {
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.3);
}

.tx-summary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.78rem;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #94a3b8;
}

.fee-val {
  color: #e2e8f0;
  font-family: 'JetBrains Mono', monospace;
}

.zk-tag {
  color: #06b6d4;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}

.error-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f87171;
  font-size: 0.75rem;
}

.btn-send-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  border: none;
  border-radius: 14px;
  padding: 14px;
  color: #070a12;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.25);
}

.btn-send-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.btn-send-submit:not(:disabled):hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.4);
}

/* Sending Progress */
.sending-progress {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 0;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.85rem;
  color: #64748b;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.3s;
}

.progress-step .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #334155;
}

.progress-step.active {
  color: #38bdf8;
  background: rgba(6, 182, 212, 0.08);
}

.progress-step.active .dot {
  background: #06b6d4;
  box-shadow: 0 0 10px #06b6d4;
}

.progress-step.done {
  color: #34d399;
}

.progress-step.done .dot {
  background: #10b981;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
