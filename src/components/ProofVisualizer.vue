<script setup lang="ts">
import { ref } from 'vue';
import { 
  Binary, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Check, 
  Key, 
  FileCheck,
  ShieldAlert
} from 'lucide-vue-next';
import type { KeylessAccount } from '../types';

const props = defineProps<{
  account: KeylessAccount;
}>();

const isExpanded = ref(false);
const copiedField = ref<string | null>(null);

function copyText(field: string, text: string) {
  navigator.clipboard.writeText(text);
  copiedField.value = field;
  setTimeout(() => (copiedField.value = null), 1500);
}
</script>

<template>
  <div class="zk-inspector-card">
    <div class="inspector-trigger" @click="isExpanded = !isExpanded">
      <div class="trigger-left">
        <Binary :size="18" class="binary-icon" />
        <span class="trigger-title">Cryptographic Zero-Knowledge Attestation (BN254 / Groth16)</span>
        <span class="byte-badge">128 Bytes Compressed</span>
      </div>
      <div class="trigger-right">
        <span>{{ isExpanded ? 'Collapse' : 'Inspect ZK Proof & EPK' }}</span>
        <ChevronUp v-if="isExpanded" :size="16" />
        <ChevronDown v-else :size="16" />
      </div>
    </div>

    <!-- Collapsible Inspector Content -->
    <div v-if="isExpanded" class="inspector-content">
      <div class="proof-section">
        <div class="sec-header">
          <Key :size="15" />
          <span>Active Ephemeral Session Key (EPK)</span>
        </div>
        <div class="code-box">
          <span class="code-val mono">{{ account.ephemeralPublicKeyHex }}</span>
          <button @click="copyText('epk', account.ephemeralPublicKeyHex)" class="btn-copy-code">
            <Check v-if="copiedField === 'epk'" :size="13" class="copied" />
            <Copy v-else :size="13" />
          </button>
        </div>
        <span class="field-hint">Signs transaction payloads directly inside client memory without touching seed phrases.</span>
      </div>

      <div class="proof-section">
        <div class="sec-header">
          <FileCheck :size="15" />
          <span>Compressed Groth16 BN254 Proof Payload (&pi;)</span>
        </div>
        <div class="code-box scrollable">
          <span class="code-val mono">{{ account.zkProofHex }}</span>
          <button @click="copyText('zk', account.zkProofHex)" class="btn-copy-code">
            <Check v-if="copiedField === 'zk'" :size="13" class="copied" />
            <Copy v-else :size="13" />
          </button>
        </div>
        <div class="proof-curve-chips">
          <span class="curve-chip">Curve: BN254 (alt_bn128)</span>
          <span class="curve-chip">Point A: G1 (32B)</span>
          <span class="curve-chip">Point B: G2 (64B)</span>
          <span class="curve-chip">Point C: G1 (32B)</span>
        </div>
      </div>

      <div class="proof-section">
        <div class="sec-header">
          <ShieldAlert :size="15" />
          <span>Public Statement Inputs</span>
        </div>
        <div class="inputs-grid">
          <div class="input-cell">
            <span class="in-label">x1: EPK Commitment</span>
            <span class="in-val mono">{{ account.ephemeralPublicKeyHex.slice(0, 18) }}...</span>
          </div>
          <div class="input-cell">
            <span class="in-label">x2: Sender Address</span>
            <span class="in-val mono">{{ account.address.slice(0, 18) }}...</span>
          </div>
          <div class="input-cell">
            <span class="in-label">x3: Identity Scope</span>
            <span class="in-val mono">sena.keyless.oidc.v1</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.zk-inspector-card {
  background: rgba(13, 18, 34, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  overflow: hidden;
  margin-top: 16px;
  transition: all 0.2s ease;
}

.zk-inspector-card:hover {
  border-color: rgba(6, 182, 212, 0.25);
}

.inspector-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.02);
  user-select: none;
}

.trigger-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.binary-icon {
  color: #06b6d4;
}

.trigger-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #e2e8f0;
}

.byte-badge {
  font-size: 0.68rem;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 2px 8px;
  border-radius: 9999px;
}

.trigger-right {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #94a3b8;
}

.inspector-content {
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: rgba(0, 0, 0, 0.25);
}

.proof-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sec-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #cbd5e1;
}

.code-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 14px;
}

.code-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: #38bdf8;
  word-break: break-all;
}

.btn-copy-code {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  margin-left: 10px;
  transition: color 0.2s;
}

.btn-copy-code:hover {
  color: #f1f5f9;
}

.copied {
  color: #10b981;
}

.field-hint {
  font-size: 0.72rem;
  color: #64748b;
}

.proof-curve-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.curve-chip {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 8px;
  border-radius: 6px;
}

.inputs-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.input-cell {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.in-label {
  font-size: 0.68rem;
  color: #64748b;
  text-transform: uppercase;
}

.in-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  color: #e2e8f0;
}

@media (max-width: 640px) {
  .inputs-grid {
    grid-template-columns: 1fr;
  }
}
</style>
