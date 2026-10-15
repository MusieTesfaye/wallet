<script setup lang="ts">
import { ShieldCheck, Cpu, LogOut, UserPlus } from 'lucide-vue-next';
import type { ChainInfo } from '../services/rpc';
import type { KeylessAccount } from '../services/auth';
import { shortAddress } from '../services/wallet';

defineProps<{
  chain: ChainInfo | null;
  nodeError: string | null;
  accounts: KeylessAccount[];
  active: KeylessAccount | null;
}>();

const emit = defineEmits<{
  (e: 'switch', address: string): void;
  (e: 'add'): void;
  (e: 'sign-out', address: string): void;
}>();
</script>

<template>
  <header class="navbar">
    <div class="nav-container">
      <div class="nav-brand">
        <div class="brand-logo"><ShieldCheck :size="22" /></div>
        <div class="brand-text">
          <span class="brand-name">SENA</span>
          <span class="brand-tag">KEYLESS WALLET</span>
        </div>
      </div>

      <div class="nav-network" :title="nodeError ?? chain?.state_root">
        <span class="network-badge" :class="{ offline: !chain }">
          <span class="status-dot"></span>
          <span>{{ chain ? chain.chain_id : 'node offline' }}</span>
        </span>
        <span v-if="chain" class="block-counter mono"><Cpu :size="13" /> #{{ chain.height }}</span>
      </div>

      <div class="nav-actions">
        <div v-if="accounts.length > 1" class="switcher">
          <button
            v-for="a in accounts"
            :key="a.address"
            class="switch-pill"
            :class="{ on: active?.address === a.address }"
            :title="`${a.email}\n${a.address}`"
            @click="emit('switch', a.address)"
          >
            <img v-if="a.picture" :src="a.picture" referrerpolicy="no-referrer" alt="" />
            <span>{{ a.name.split(' ')[0] }}</span>
          </button>
        </div>
        <button class="btn" title="Sign in with another Google account" @click="emit('add')">
          <UserPlus :size="15" /><span class="hide-sm">Add account</span>
        </button>
        <button v-if="active" class="btn" :title="`Sign ${active.email} out of this browser`" @click="emit('sign-out', active.address)">
          <LogOut :size="15" /><span class="hide-sm">{{ shortAddress(active.address, 4, 4) }}</span>
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
  border-bottom: 1px solid var(--border-subtle);
}
.nav-container {
  max-width: 1240px;
  margin: 0 auto;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.nav-brand { display: flex; align-items: center; gap: 10px; }
.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--emerald-500), var(--cyan-500));
  color: #04110c;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 22px rgba(16, 185, 129, 0.4);
}
.brand-text { display: flex; flex-direction: column; line-height: 1.1; }
.brand-name { font-family: var(--font-display); font-weight: 800; font-size: 1.2rem; letter-spacing: 0.04em; }
.brand-tag { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; color: var(--emerald-500); }
.nav-network { display: flex; align-items: center; gap: 8px; }
.network-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--emerald-400);
}
.network-badge.offline { color: #fca5a5; background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.3); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; animation: pulse 2s infinite; }
.block-counter { display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; color: var(--text-muted); }
.nav-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.switcher { display: flex; gap: 6px; }
.switch-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  border-radius: 9999px;
  padding: 4px 10px 4px 4px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.switch-pill img { width: 22px; height: 22px; border-radius: 50%; }
.switch-pill.on { color: var(--text-primary); border-color: var(--border-focus); background: rgba(16, 185, 129, 0.12); }
@media (max-width: 640px) { .hide-sm { display: none; } }
</style>
