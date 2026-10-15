<script setup lang="ts">
import { 
  ShieldCheck, 
  Cpu, 
  LogOut 
} from 'lucide-vue-next';
import type { KeylessAccount, ChainInfo } from '../types';
import { formatAddress } from '../crypto/keyless';

defineProps<{
  account: KeylessAccount | null;
  chainInfo: ChainInfo;
  availableProfiles: Array<{ email: string; name: string }>;
  allAccounts?: KeylessAccount[];
}>();

const emit = defineEmits<{
  (e: 'open-login'): void;
  (e: 'switch-account', email: string): void;
  (e: 'disconnect'): void;
  (e: 'open-inspector'): void;
}>();
</script>

<template>
  <header class="navbar">
    <div class="nav-container">
      <div class="nav-brand">
        <div class="brand-logo">
          <ShieldCheck :size="24" class="logo-icon" />
          <div class="logo-glow"></div>
        </div>
        <div class="brand-text">
          <span class="brand-name">SENA</span>
          <span class="brand-tag">KEYLESS L2</span>
        </div>
      </div>

      <div class="nav-network">
        <div class="network-badge" :class="{ 'is-live': chainInfo.isConnectedToLiveNode }">
          <span class="status-dot"></span>
          <span class="network-name">{{ chainInfo.chainId }}</span>
          <span class="l1-anchor">Aptos L1</span>
        </div>
        <div class="block-counter">
          <Cpu :size="13" class="block-icon" />
          <span>#{{ chainInfo.blockHeight }}</span>
        </div>
      </div>

      <!-- Dual Account Quick Switcher -->
      <div v-if="allAccounts && allAccounts.length >= 2" class="quick-switch-pills">
        <button 
          v-for="acc in allAccounts" 
          :key="acc.email"
          @click="emit('switch-account', acc.email)"
          class="switch-pill"
          :class="{ active: account?.email === acc.email }"
          :title="`Switch to ${acc.name} (${acc.email})`"
        >
          <img :src="acc.picture" class="pill-avatar" />
          <span class="pill-name">{{ acc.name.split(' ')[0] }}</span>
          <span class="pill-bal">${{ (acc.balances.usdc / 1_000_000).toFixed(2) }}</span>
        </button>
      </div>

      <div class="nav-actions">
        <button 
          v-if="account" 
          @click="emit('open-login')"
          class="user-profile-badge"
          title="Account Settings & ZK Attestation"
        >
          <img :src="account.picture" :alt="account.name" class="user-avatar" />
          <div class="user-meta">
            <span class="user-name">{{ account.name }}</span>
            <span class="user-addr">{{ formatAddress(account.address) }}</span>
          </div>
        </button>

        <button 
          v-if="account"
          @click="emit('disconnect')"
          class="btn-disconnect"
          title="Disconnect wallet to test new wallet creation"
        >
          <LogOut :size="15" />
          <span>Disconnect</span>
        </button>

        <button 
          v-else 
          @click="emit('open-login')" 
          class="btn-nav-login"
        >
          <svg class="google-icon" viewBox="0 0 24 24" width="16" height="16">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Sign In / Configure OAuth</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(7, 10, 18, 0.82);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  height: 72px;
  display: flex;
  align-items: center;
}

.nav-container {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  position: relative;
  width: 38px;
  height: 38px;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #070a12;
  box-shadow: 0 0 24px rgba(16, 185, 129, 0.4);
}

.logo-glow {
  position: absolute;
  inset: -2px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.5), rgba(6, 182, 212, 0.5));
  z-index: -1;
  filter: blur(6px);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-family: 'Outfit', sans-serif;
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: linear-gradient(90deg, #ffffff 0%, #a7f3d0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-tag {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #10b981;
}

.nav-network {
  display: flex;
  align-items: center;
  gap: 10px;
}

.network-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 6px 12px;
  border-radius: 9999px;
  font-size: 0.8rem;
  color: #34d399;
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 10px #10b981;
  animation: pulse 2s infinite;
}

.l1-anchor {
  font-size: 0.65rem;
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  color: #94a3b8;
}

.block-counter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: #64748b;
  background: rgba(255, 255, 255, 0.03);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.block-icon {
  color: #06b6d4;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-switch-account {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.3);
  color: #38bdf8;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-switch-account:hover {
  background: rgba(6, 182, 212, 0.2);
  border-color: #38bdf8;
  transform: translateY(-1px);
}

.user-profile-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 4px 12px 4px 6px;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.user-profile-badge:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(16, 185, 129, 0.4);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #10b981;
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.user-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #f1f5f9;
}

.user-addr {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem;
  color: #94a3b8;
}

.btn-nav-login {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #ffffff;
  color: #0f172a;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.btn-nav-login:hover {
  background: #f8fafc;
  transform: translateY(-1px);
}

.btn-disconnect {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
  font-weight: 600;
  font-size: 0.78rem;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-disconnect:hover {
  background: rgba(239, 68, 68, 0.22);
  border-color: #f87171;
  transform: translateY(-1px);
}

.quick-switch-pills {
  display: flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 3px;
  border-radius: 100px;
  gap: 4px;
}

.switch-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px 4px 5px;
  border-radius: 100px;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.switch-pill:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f1f5f9;
}

.switch-pill.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.45);
  color: #ffffff;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.25);
}

.pill-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}

.pill-name {
  font-weight: 600;
}

.pill-bal {
  font-family: monospace;
  font-size: 0.75rem;
  color: #38bdf8;
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 6px;
  border-radius: 6px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.9); }
}
</style>
