<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import Navbar from './components/Navbar.vue';
import WalletCard from './components/WalletCard.vue';
import FastStreamPanel from './components/FastStreamPanel.vue';
import SendModal from './components/SendModal.vue';
import ReceiveModal from './components/ReceiveModal.vue';
import GoogleLoginModal from './components/GoogleLoginModal.vue';
import LightClientInspector from './components/LightClientInspector.vue';
import ProofVisualizer from './components/ProofVisualizer.vue';
import ActivityList from './components/ActivityList.vue';
import { Key } from 'lucide-vue-next';

import { PRESET_GOOGLE_USERS, createKeylessAccountFromOidc } from './services/oidc';
import { senaRpc } from './services/rpc';
import { streamService } from './services/stream';
import type { KeylessAccount, ChainInfo, TransactionRecord, StreamEvent } from './types';

// Accounts state
const accounts = ref<Map<string, KeylessAccount>>(new Map());
const currentEmail = ref<string | null>(null);

const activeAccount = computed(() => {
  if (!currentEmail.value) return null;
  return accounts.value.get(currentEmail.value) || null;
});

const allAccountsList = computed(() => {
  return Array.from(accounts.value.values());
});

const chainInfo = ref<ChainInfo>({
  chainId: 'sena-devnet-1',
  blockHeight: 1,
  finalizedHeight: 0,
  stateRoot: '0x605e5711d3a8e2260647eb3d4d028667a8b6748c554a51782349acfaef75cc2e',
  challengeWindowSecs: 86400,
  mempoolSize: 0,
  isConnectedToLiveNode: false,
  rpcEndpoint: 'http://127.0.0.1:8545',
});

const transactions = ref<TransactionRecord[]>([]);

// Modals
const isLoginModalOpen = ref(false);
const isSendModalOpen = ref(false);
const isReceiveModalOpen = ref(false);
const toastMessage = ref<string | null>(null);

function showToast(msg: string) {
  toastMessage.value = msg;
  setTimeout(() => {
    if (toastMessage.value === msg) {
      toastMessage.value = null;
    }
  }, 3800);
}

onMounted(async () => {
  // 1. Connect to WebSocket stream service
  streamService.connect();

  // 2. Fetch all accounts from SQLite database
  try {
    const dbAccounts = await streamService.getAccountsFromDb();
    if (dbAccounts.length > 0) {
      for (const acc of dbAccounts) {
        accounts.value.set(acc.email, acc);
        senaRpc.registerSocialIdentifier(`@${acc.name.toLowerCase().split(' ')[0]}`, acc.address);
      }
      currentEmail.value = dbAccounts[0].email;
    } else {
      // Fallback pre-initialization
      const bob = await createKeylessAccountFromOidc(PRESET_GOOGLE_USERS[1]);
      bob.balances.usdc = 5_000_000;
      accounts.value.set(bob.email, bob);
      await streamService.saveAccountToDb(bob);

      const alice = await createKeylessAccountFromOidc(PRESET_GOOGLE_USERS[0]);
      alice.balances.usdc = 10_000_000;
      accounts.value.set(alice.email, alice);
      await streamService.saveAccountToDb(alice);

      currentEmail.value = alice.email;
    }
  } catch (err) {
    console.error('Failed to initialize accounts from SQLite', err);
  }

  // 3. Fetch initial transactions from SQLite
  try {
    const dbTxs = await streamService.getTransactionsFromDb();
    if (dbTxs.length > 0) {
      transactions.value = dbTxs;
    }
  } catch (err) {
    console.warn('Failed to load initial transactions', err);
  }

  // 4. Register real-time WebSocket event listener
  streamService.on('*', (evt: StreamEvent) => {
    if (evt.type === 'TX_STREAM') {
      // Update sender & recipient balances in SQLite local state
      if (evt.sender && evt.senderBalance !== undefined) {
        for (const [_, acc] of accounts.value) {
          if (acc.address.toLowerCase() === evt.sender?.toLowerCase()) {
            acc.balances.usdc = evt.senderBalance;
            acc.nonce += 1;
            break;
          }
        }
      }

      if (evt.recipient && evt.recipientBalance !== undefined) {
        for (const [_, acc] of accounts.value) {
          if (acc.address.toLowerCase() === evt.recipient?.toLowerCase()) {
            acc.balances.usdc = evt.recipientBalance;
            break;
          }
        }
      }

      // Handle pending stream transaction
      if (evt.status === 'pending' && evt.hash) {
        const existingIdx = transactions.value.findIndex(t => t.hash === evt.hash);
        if (existingIdx === -1) {
          transactions.value.unshift({
            id: evt.id,
            hash: evt.hash,
            sender: evt.sender || '',
            senderEmail: '',
            recipient: evt.recipient || '',
            amountUsdc: evt.amountUsdc || 0,
            feeUsdc: evt.feeUsdc || 1000,
            timestamp: evt.timestamp,
            status: 'pending',
            zkProofSize: 128,
            epkSignatureHex: '',
          });
        }
        showToast(`⚡ [WS] Streamed $${((evt.amountUsdc || 0) / 1_000_000).toFixed(2)} USDC! Mempool broadcast.`);
      }

      // Handle soft-confirmed stream transaction
      if (evt.status === 'soft_confirmed' && evt.hash) {
        const tx = transactions.value.find(t => t.hash === evt.hash);
        if (tx) {
          tx.status = 'soft_confirmed';
          tx.blockHeight = evt.blockHeight;
        }
        if (evt.blockHeight) {
          chainInfo.value.blockHeight = evt.blockHeight;
        }
        showToast(`✅ [WS] Confirmed in block #${evt.blockHeight}! (SQLite WAL committed)`);
      }
    } else if (evt.type === 'FAUCET_CLAIMED') {
      if (evt.address && evt.newBalance !== undefined) {
        for (const [_, acc] of accounts.value) {
          if (acc.address.toLowerCase() === evt.address?.toLowerCase()) {
            acc.balances.usdc = evt.newBalance;
            break;
          }
        }
      }
    }
  });

  // Poll chain status
  refreshChainInfo();
  setInterval(refreshChainInfo, 3000);
});

async function refreshChainInfo() {
  const info = await senaRpc.getChainInfo();
  chainInfo.value = info;
}

async function handleAccountCreated(acc: KeylessAccount) {
  accounts.value.set(acc.email, acc);
  currentEmail.value = acc.email;
  await streamService.saveAccountToDb(acc);
  const handle = `@${acc.name.toLowerCase().split(' ')[0]}`;
  senaRpc.registerSocialIdentifier(handle, acc.address);
  showToast(`🎉 Welcome ${acc.name}! Account active & saved to SQLite.`);
}

async function handleFastLogin(profile: any) {
  try {
    const acc = await createKeylessAccountFromOidc(profile);
    await handleAccountCreated(acc);
  } catch (err) {
    console.error('Fast login error', err);
  }
}

function handleSwitchAccount(email: string) {
  currentEmail.value = email;
  const user = accounts.value.get(email);
  if (user) {
    showToast(`Switched account to ${user.name}`);
  }
}

function handleDisconnect() {
  currentEmail.value = null;
  showToast('Wallet disconnected.');
}

async function handleClaimAirdrop() {
  if (!activeAccount.value) return;
  const res = await streamService.claimFaucet(activeAccount.value.address, 50_000_000);
  if (res) {
    activeAccount.value.balances.usdc = res.newBalance;
  } else {
    activeAccount.value.balances.usdc += 50_000_000;
  }
  showToast(`🎉 Faucet: +$50.00 USDC credited in SQLite and streamed live!`);
}

async function handleTransactionSent(tx: TransactionRecord) {
  transactions.value.unshift(tx);
  if (activeAccount.value) {
    try {
      await streamService.executeStreamingTransfer({
        sender: activeAccount.value,
        recipientAddress: tx.recipient,
        amountMicroUsdc: tx.amountUsdc,
        feeMicroUsdc: tx.feeUsdc,
        recipientEmail: tx.recipientEmail,
      });
    } catch (err: any) {
      console.warn('SQLite stream error', err);
    }
  }
}
</script>

<template>
  <div class="app-root">
    <!-- Top Navigation Bar -->
    <Navbar 
      :account="activeAccount" 
      :chain-info="chainInfo"
      :available-profiles="PRESET_GOOGLE_USERS"
      :all-accounts="allAccountsList"
      @open-login="isLoginModalOpen = true"
      @switch-account="handleSwitchAccount"
      @disconnect="handleDisconnect"
    />

    <!-- Main Content -->
    <main class="main-container">
      <div v-if="activeAccount" class="dashboard-grid">
        <!-- Left / Primary Column -->
        <div class="primary-column">
          <!-- Fast WebSocket Streaming & Dual Account P2P Panel -->
          <FastStreamPanel 
            :accounts="allAccountsList"
            :active-account="activeAccount"
            @select-account="handleSwitchAccount"
          />

          <WalletCard 
            :account="activeAccount"
            @open-send="isSendModalOpen = true"
            @open-receive="isReceiveModalOpen = true"
            @airdrop="handleClaimAirdrop"
            @verify-client="() => {}"
          />

          <!-- Mobile Light Client Proof Verifier -->
          <LightClientInspector :account="activeAccount" />

          <!-- Deep-dive ZK Proof inspector -->
          <ProofVisualizer :account="activeAccount" />
        </div>

        <!-- Right / Activity Column -->
        <div class="secondary-column">
          <div class="info-banner-card">
            <div class="info-badge">How it works</div>
            <h5>No Seed Phrases • 100% Self-Custodial</h5>
            <p>
              SENA uses <b>Google OpenID Connect (OIDC)</b> and off-chain <b>BN254 Groth16 zero-knowledge proofs</b>. 
              Users authenticate with Google, sign transactions via ephemeral session keys, and verify state in &lt; 0.2ms.
            </p>
          </div>

          <ActivityList 
            :transactions="transactions" 
            :current-address="activeAccount.address"
          />
        </div>
      </div>

      <!-- Logged Out Welcome View -->
      <div v-else class="logged-out-hero">
        <div class="hero-content">
          <div class="hero-glow"></div>
          <span class="hero-pill">SENA Keyless Protocol</span>
          <h1>Web2 Simplicity.<br /><span>Zero-Knowledge Security.</span></h1>
          <p class="hero-desc">
            Sign in with Google. Generate a self-custodial Layer 2 address anchored to Aptos L1. 
            Test with your own Google Cloud OAuth <b>Client ID & Secret</b>, or pick a zero-setup test identity.
          </p>

          <div class="hero-buttons-row">
            <button @click="isLoginModalOpen = true" class="btn-hero-login">
              <svg class="google-icon" viewBox="0 0 24 24" width="20" height="20">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Create Wallet with Google</span>
            </button>

            <button @click="isLoginModalOpen = true" class="btn-hero-config">
              <Key :size="18" />
              <span>Configure Client & Secret</span>
            </button>
          </div>

          <!-- Quick Test Identities -->
          <div class="quick-identities-panel">
            <span class="quick-title">Or test instantly with preset test identities:</span>
            <div class="quick-cards-grid">
              <div class="quick-id-card" @click="handleFastLogin(PRESET_GOOGLE_USERS[0])">
                <img :src="PRESET_GOOGLE_USERS[0].picture" class="quick-id-img" />
                <div class="quick-id-meta">
                  <span class="quick-id-name">Alice Walker</span>
                  <span class="quick-id-sub">💰 10.00 USDC funded</span>
                </div>
              </div>

              <div class="quick-id-card" @click="handleFastLogin(PRESET_GOOGLE_USERS[1])">
                <img :src="PRESET_GOOGLE_USERS[1].picture" class="quick-id-img" />
                <div class="quick-id-meta">
                  <span class="quick-id-name">Bob Martinez</span>
                  <span class="quick-id-sub">💰 0.50 USDC funded</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Modals -->
    <GoogleLoginModal 
      :is-open="isLoginModalOpen"
      @close="isLoginModalOpen = false"
      @account-created="handleAccountCreated"
    />

    <SendModal 
      v-if="activeAccount"
      :is-open="isSendModalOpen"
      :account="activeAccount"
      @close="isSendModalOpen = false"
      @transaction-sent="handleTransactionSent"
    />

    <ReceiveModal 
      v-if="activeAccount"
      :is-open="isReceiveModalOpen"
      :account="activeAccount"
      @close="isReceiveModalOpen = false"
    />

    <!-- Toast Notification -->
    <div v-if="toastMessage" class="toast-alert">
      <span>{{ toastMessage }}</span>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
  background-color: #070a12;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
}

.main-container {
  flex: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 64px 24px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 28px;
  align-items: start;
}

.primary-column {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.secondary-column {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.info-banner-card {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 182, 212, 0.04) 100%);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 20px;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

.info-badge {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #10b981;
  background: rgba(16, 185, 129, 0.15);
  padding: 4px 10px;
  border-radius: 9999px;
  margin-bottom: 12px;
}

.info-banner-card h5 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #ffffff;
  margin: 0 0 8px 0;
}

.info-banner-card p {
  font-size: 0.85rem;
  line-height: 1.6;
  color: #94a3b8;
  margin: 0;
}

/* Logged Out Hero View */
.logged-out-hero {
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  position: relative;
  padding: 40px 20px;
}

.hero-content {
  max-width: 680px;
  position: relative;
  z-index: 1;
}

.hero-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(0, 0, 0, 0) 70%);
  pointer-events: none;
  z-index: -1;
}

.hero-pill {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 6px 16px;
  border-radius: 9999px;
  margin-bottom: 20px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.hero-content h1 {
  font-family: 'Outfit', sans-serif;
  font-size: 3.2rem;
  font-weight: 800;
  color: #ffffff;
  line-height: 1.15;
  margin: 0 0 16px 0;
  letter-spacing: -0.02em;
}

.hero-content h1 span {
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-desc {
  font-size: 1.05rem;
  line-height: 1.6;
  color: #94a3b8;
  margin: 0 0 32px 0;
}

.hero-buttons-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 36px;
}

.btn-hero-login {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  color: #070a12;
  font-family: 'Outfit', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  padding: 14px 28px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4), 0 0 40px rgba(16, 185, 129, 0.2);
  transition: all 0.2s ease;
}

.btn-hero-login:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 50px rgba(16, 185, 129, 0.35);
}

.btn-hero-config {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f1f5f9;
  font-family: 'Outfit', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  padding: 14px 24px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-hero-config:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: #10b981;
}

.quick-identities-panel {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
  padding: 18px 24px;
}

.quick-title {
  display: block;
  font-size: 0.78rem;
  color: #64748b;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.quick-cards-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.quick-id-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 10px 14px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.quick-id-card:hover {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.4);
  transform: translateY(-2px);
}

.quick-id-img {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #10b981;
}

.quick-id-meta {
  display: flex;
  flex-direction: column;
}

.quick-id-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #f1f5f9;
}

.quick-id-sub {
  font-size: 0.72rem;
  color: #34d399;
}

.toast-alert {
  position: fixed;
  bottom: 32px;
  right: 32px;
  z-index: 1000;
  background: #0f172a;
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #f1f5f9;
  padding: 14px 22px;
  border-radius: 14px;
  font-weight: 600;
  font-size: 0.9rem;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(16, 185, 129, 0.2);
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 960px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  .quick-cards-grid {
    grid-template-columns: 1fr;
  }
}
</style>
