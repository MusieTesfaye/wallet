<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Navbar from './components/Navbar.vue';
import SignIn from './components/SignIn.vue';
import WalletCard from './components/WalletCard.vue';
import SendModal from './components/SendModal.vue';
import ReceiveModal from './components/ReceiveModal.vue';
import ActivityList from './components/ActivityList.vue';

import * as auth from './services/auth';
import type { KeylessAccount } from './services/auth';
import * as rpc from './services/rpc';
import type { ChainInfo, FeeAsset, HistoryEntry } from './services/rpc';
import { loadSena } from './services/sena';
import { faucetAddress, requestCoins } from './services/faucet';
import { formatAmount } from './services/wallet';

const accounts = ref<KeylessAccount[]>(auth.savedAccounts());
const activeAddr = ref<string | null>(auth.activeAddress() ?? accounts.value[0]?.address ?? null);
const active = computed(() => accounts.value.find((a) => a.address === activeAddr.value) ?? null);

const chain = ref<ChainInfo | null>(null);
const nodeError = ref<string | null>(null);
const assets = ref<FeeAsset[]>([]);
const balances = ref(new Map<number, bigint>());
const entries = ref<HistoryEntry[]>([]);
const faucet = ref<string | null>(null);

const signInStep = ref<string | null>(null);
const signInError = ref<string | null>(null);
const addingAccount = ref(false);
const sendAsset = ref<number | null>(null);
const receiving = ref(false);
const faucetBusy = ref<number | null>(null);
const toast = ref<{ text: string; error?: boolean } | null>(null);

function say(text: string, error = false) {
  toast.value = { text, error };
  setTimeout(() => {
    if (toast.value?.text === text) toast.value = null;
  }, 5000);
}

function select(address: string | null) {
  activeAddr.value = address;
  auth.setActive(address);
  balances.value = new Map();
  entries.value = [];
  refresh();
}

async function refresh() {
  try {
    chain.value = await rpc.chainInfo();
    nodeError.value = null;
    if (assets.value.length === 0) assets.value = await rpc.feeAssets();
    const a = active.value;
    if (a) {
      const [acct, hist] = await Promise.all([rpc.account(a.address), rpc.history(a.address)]);
      if (activeAddr.value === a.address) {
        balances.value = acct.balances;
        entries.value = hist;
      }
    }
  } catch (e) {
    chain.value = null;
    nodeError.value = (e as Error).message;
  }
}

async function finishRedirect() {
  const { jwt, error } = auth.takeRedirectToken();
  if (error) signInError.value = `Google sign-in did not complete: ${error}`;
  if (!jwt) return;
  try {
    signInStep.value = 'Checking the token';
    const account = await auth.completeSignIn(jwt, (s) => (signInStep.value = s));
    accounts.value = auth.savedAccounts();
    select(account.address);
    addingAccount.value = false;
    say(`Signed in as ${account.email}`);
  } catch (e) {
    signInError.value = (e as Error).message;
  } finally {
    signInStep.value = null;
  }
}

function begin() {
  signInError.value = null;
  try {
    auth.beginGoogleSignIn();
  } catch (e) {
    signInError.value = (e as Error).message;
  }
}

function signOut(address: string) {
  auth.forgetAccount(address);
  accounts.value = auth.savedAccounts();
  select(auth.activeAddress());
}

async function drip(asset: number) {
  if (!active.value) return;
  faucetBusy.value = asset;
  try {
    const r = await requestCoins(active.value.address, asset);
    const sym = assets.value.find((a) => a.asset === asset)?.symbol;
    say(`Faucet sent ${formatAmount(BigInt(r.amount))} ${sym}; it lands in the next block.`);
    setTimeout(refresh, 1500);
  } catch (e) {
    say((e as Error).message, true);
  } finally {
    faucetBusy.value = null;
  }
}

const expired = computed(() => !!active.value && auth.isExpired(active.value));
const showSignIn = computed(() => !active.value || addingAccount.value || signInStep.value !== null);

let timer: number | undefined;
onMounted(async () => {
  await loadSena();
  await finishRedirect();
  faucet.value = await faucetAddress();
  await refresh();
  timer = window.setInterval(refresh, 2000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="app-root">
    <Navbar
      :chain="chain"
      :node-error="nodeError"
      :accounts="accounts"
      :active="active"
      @switch="select"
      @add="addingAccount = true"
      @sign-out="signOut"
    />

    <main class="main">
      <div v-if="nodeError" class="alert alert-error banner">
        {{ nodeError }}. Start it with <code>scripts/wallet-devnet.py</code> in the SENA repo.
      </div>

      <SignIn
        v-if="showSignIn"
        :step="signInStep"
        :error="signInError"
        :adding="!!active"
        @begin="begin"
        @cancel="addingAccount = false"
      />

      <div v-else-if="active" class="grid">
        <div class="col">
          <div v-if="expired" class="alert alert-error">
            This browser's key for {{ active.email }} has expired. Sign in again to send; balances still show.
            <button class="btn mini-btn" @click="begin">Sign in again</button>
          </div>
          <WalletCard
            :account="active"
            :assets="assets"
            :balances="balances"
            :faucet-busy="faucetBusy"
            @send="(a) => (sendAsset = a)"
            @receive="receiving = true"
            @faucet="drip"
          />
          <div class="card about">
            <div class="card-title">How this works</div>
            <p class="secondary">
              Your address is derived from your Google identity and a pepper from Aptos's keyless
              service. Aptos's prover proved, in zero knowledge, that Google signed you in and
              committed to a key that lives only in this browser; that key signs your transfers,
              and SENA verifies the proof on every one. Every coin pays its fee in itself.
            </p>
          </div>
        </div>
        <div class="col">
          <ActivityList
            :entries="entries"
            :address="active.address"
            :assets="assets"
            :contacts="accounts"
            :faucet="faucet"
          />
        </div>
      </div>
    </main>

    <SendModal
      v-if="active && sendAsset !== null"
      :account="active"
      :assets="assets"
      :balances="balances"
      :contacts="accounts"
      :initial-asset="sendAsset"
      @close="sendAsset = null"
      @sent="refresh"
    />
    <ReceiveModal v-if="active && receiving" :account="active" :symbols="assets.map((a) => a.symbol)" @close="receiving = false" />

    <div v-if="toast" class="toast" :class="{ error: toast.error }">{{ toast.text }}</div>
  </div>
</template>

<style scoped>
.app-root { min-height: 100vh; display: flex; flex-direction: column; }
.main { flex: 1; width: 100%; max-width: 1240px; margin: 0 auto; padding: 24px 16px 64px; }
.banner { margin-bottom: 20px; }
.banner code { font-family: var(--font-mono); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 24px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.about p { font-size: 0.86rem; line-height: 1.6; }
.mini-btn { margin-top: 8px; padding: 6px 12px; font-size: 0.8rem; }
.toast {
  position: fixed;
  bottom: 24px;
  right: 16px;
  left: 16px;
  margin-left: auto;
  max-width: 420px;
  z-index: 200;
  background: var(--bg-elevated);
  border: 1px solid rgba(16, 185, 129, 0.4);
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 0.88rem;
  font-weight: 600;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.toast.error { border-color: rgba(239, 68, 68, 0.5); color: #fca5a5; }
@media (max-width: 960px) { .grid { grid-template-columns: 1fr; } }
</style>
