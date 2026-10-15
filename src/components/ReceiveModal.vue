<script setup lang="ts">
import { ref } from 'vue';
import { X, Copy, Check, QrCode } from 'lucide-vue-next';
import type { KeylessAccount } from '../types';

const props = defineProps<{
  isOpen: boolean;
  account: KeylessAccount;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const copied = ref(false);

function copyAddress() {
  navigator.clipboard.writeText(props.account.address);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1800);
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card">
      <button class="btn-close" @click="emit('close')">
        <X :size="20" />
      </button>

      <div class="receive-header">
        <div class="icon-circle">
          <QrCode :size="24" />
        </div>
        <h3>Receive USDC</h3>
        <p class="sub">Your self-custodial SENA L2 address</p>
      </div>

      <!-- QR Code Simulation -->
      <div class="qr-container">
        <div class="qr-box">
          <!-- Stylized QR Grid SVG -->
          <svg viewBox="0 0 160 160" width="160" height="160" class="qr-svg">
            <rect width="160" height="160" fill="#ffffff" rx="12" />
            <!-- Finder patterns -->
            <rect x="16" y="16" width="36" height="36" fill="#070a12" rx="4" />
            <rect x="24" y="24" width="20" height="20" fill="#ffffff" rx="2" />
            <rect x="28" y="28" width="12" height="12" fill="#10b981" rx="2" />

            <rect x="108" y="16" width="36" height="36" fill="#070a12" rx="4" />
            <rect x="116" y="24" width="20" height="20" fill="#ffffff" rx="2" />
            <rect x="120" y="28" width="12" height="12" fill="#10b981" rx="2" />

            <rect x="16" y="108" width="36" height="36" fill="#070a12" rx="4" />
            <rect x="24" y="116" width="20" height="20" fill="#ffffff" rx="2" />
            <rect x="28" y="120" width="12" height="12" fill="#10b981" rx="2" />

            <!-- Dynamic data dots -->
            <circle cx="70" cy="24" r="4" fill="#070a12" />
            <circle cx="88" cy="32" r="4" fill="#070a12" />
            <circle cx="76" cy="48" r="4" fill="#070a12" />
            <circle cx="64" cy="72" r="4" fill="#070a12" />
            <circle cx="80" cy="80" r="5" fill="#10b981" />
            <circle cx="96" cy="72" r="4" fill="#070a12" />
            <circle cx="112" cy="88" r="4" fill="#070a12" />
            <circle cx="70" cy="112" r="4" fill="#070a12" />
            <circle cx="88" cy="120" r="4" fill="#070a12" />
            <circle cx="120" cy="128" r="4" fill="#070a12" />
          </svg>
        </div>
      </div>

      <!-- Address Box -->
      <div class="address-box">
        <span class="addr-label">L2 Public Address</span>
        <div class="addr-val-wrap">
          <span class="addr-val">{{ account.address }}</span>
          <button @click="copyAddress" class="btn-copy">
            <Check v-if="copied" :size="16" class="icon-copied" />
            <Copy v-else :size="16" />
          </button>
        </div>
      </div>

      <!-- Identity Badges -->
      <div class="identity-info">
        <div class="info-row">
          <span class="info-label">Bound Google Account</span>
          <span class="info-val">{{ account.email }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Network</span>
          <span class="info-val">SENA Devnet-1 (Aptos L1)</span>
        </div>
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
  max-width: 440px;
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
}

.btn-close:hover {
  color: #f1f5f9;
}

.receive-header {
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
  background: rgba(6, 182, 212, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(6, 182, 212, 0.3);
  margin-bottom: 12px;
}

.receive-header h3 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 6px 0;
}

.receive-header .sub {
  font-size: 0.8rem;
  color: #94a3b8;
  margin: 0;
}

.qr-container {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
}

.qr-box {
  background: #ffffff;
  padding: 12px;
  border-radius: 20px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
}

.address-box {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 20px;
}

.addr-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
  display: block;
}

.addr-val-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.addr-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: #e2e8f0;
  word-break: break-all;
}

.btn-copy {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: #94a3b8;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}

.btn-copy:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
}

.icon-copied {
  color: #10b981;
}

.identity-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 12px 14px;
}

.info-row {
  display: flex;
  justify-content: space-between;
}

.info-label {
  color: #64748b;
}

.info-val {
  color: #94a3b8;
  font-weight: 500;
}
</style>
