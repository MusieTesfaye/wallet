<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { 
  X, 
  ShieldCheck, 
  Sparkles, 
  CheckCircle2, 
  Loader2, 
  ChevronRight, 
  Key,
  Globe,
  Eye,
  EyeOff,
  Code
} from 'lucide-vue-next';
import { 
  PRESET_GOOGLE_USERS, 
  createKeylessAccountFromOidc, 
  createKeylessAccountFromJwt,
  generateCustomGoogleProfile,
  getStoredGoogleConfig,
  saveStoredGoogleConfig,
  DEFAULT_GOOGLE_AUD
} from '../services/oidc';
import type { KeylessAccount } from '../types';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'account-created', account: KeylessAccount): void;
}>();

// Navigation Tabs: 'oauth' | 'presets' | 'jwt'
const currentTab = ref<'oauth' | 'presets' | 'jwt'>('oauth');

// OAuth credentials
const clientId = ref('');
const clientSecret = ref('');
const showSecret = ref(false);
const testEmail = ref('developer@gmail.com');
const testName = ref('Google Developer');
const rawJwtInput = ref('');

const isProcessing = ref(false);
const activeStep = ref(0);
const stepTitle = ref('');
const errorMessage = ref('');

onMounted(() => {
  const cfg = getStoredGoogleConfig();
  clientId.value = cfg.clientId;
  clientSecret.value = cfg.clientSecret || '';
});

function handleSaveConfig() {
  saveStoredGoogleConfig({
    clientId: clientId.value,
    clientSecret: clientSecret.value,
  });
}

async function executeCreationFlow(createFn: (onProgress: (step: number, title: string) => void) => Promise<KeylessAccount>) {
  isProcessing.value = true;
  activeStep.value = 1;
  errorMessage.value = '';

  try {
    const account = await createFn((step, title) => {
      activeStep.value = step;
      stepTitle.value = title;
    });

    await new Promise(r => setTimeout(r, 400));
    isProcessing.value = false;
    emit('account-created', account);
    emit('close');
  } catch (err: any) {
    console.error('Keyless account initialization failed', err);
    errorMessage.value = err?.message || 'Keyless derivation failed';
    isProcessing.value = false;
  }
}

// 1. Live Google OAuth / Client ID derivation
function handleLaunchGoogleOAuth() {
  handleSaveConfig();
  if (!clientId.value.trim()) {
    errorMessage.value = 'Please provide your Google Client ID.';
    return;
  }

  // Real Google OAuth 2.0 Web Popup
  const redirectUri = window.location.origin;
  const nonce = Math.random().toString(36).substring(2);
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId.value.trim()
  )}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=token%20id_token&scope=openid%20email%20profile&nonce=${nonce}`;

  const popup = window.open(authUrl, 'google_login', 'width=520,height=640');
  
  if (!popup) {
    errorMessage.value = 'Popup was blocked by your browser. Please allow popups or use "Simulate with Client ID".';
    return;
  }

  // Poll popup for redirect hash
  const interval = setInterval(() => {
    try {
      if (popup.closed) {
        clearInterval(interval);
        return;
      }
      if (popup.location.href.includes(redirectUri) && popup.location.hash) {
        const hash = popup.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const idToken = params.get('id_token');
        popup.close();
        clearInterval(interval);

        if (idToken) {
          executeCreationFlow(onProgress => 
            createKeylessAccountFromJwt(idToken, clientId.value.trim(), onProgress)
          );
        }
      }
    } catch {
      // Cross-origin until redirect
    }
  }, 500);
}

// 2. Simulate derivation using configured Client ID as canonical aud
function handleSimulateWithClientId() {
  handleSaveConfig();
  const aud = clientId.value.trim() || DEFAULT_GOOGLE_AUD;
  const email = testEmail.value.trim() || 'developer@gmail.com';
  const name = testName.value.trim() || 'Google Developer';

  const profile = generateCustomGoogleProfile(email, name);
  executeCreationFlow(onProgress => 
    createKeylessAccountFromOidc(profile, aud, onProgress)
  );
}

// 3. Paste raw JWT
function handleImportJwt() {
  handleSaveConfig();
  if (!rawJwtInput.value.trim()) {
    errorMessage.value = 'Please paste a valid Google JWT / ID Token.';
    return;
  }
  executeCreationFlow(onProgress => 
    createKeylessAccountFromJwt(rawJwtInput.value.trim(), clientId.value.trim(), onProgress)
  );
}

// 4. Quick preset selection
function handleSelectPreset(profile: any) {
  handleSaveConfig();
  const aud = clientId.value.trim() || DEFAULT_GOOGLE_AUD;
  executeCreationFlow(onProgress => 
    createKeylessAccountFromOidc(profile, aud, onProgress)
  );
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card">
      <button class="btn-close" @click="emit('close')">
        <X :size="20" />
      </button>

      <!-- Processing State / ZK Pipeline -->
      <div v-if="isProcessing" class="zk-pipeline-view">
        <div class="zk-header">
          <div class="zk-icon-halo">
            <Sparkles :size="28" class="halo-icon" />
          </div>
          <h3>Generating Keyless Account</h3>
          <p class="zk-subtitle">Off-Chain Zero-Knowledge BN254 Groth16 Attestation</p>
        </div>

        <div class="steps-progress">
          <div class="step-item" :class="{ 'is-active': activeStep === 1, 'is-done': activeStep > 1 }">
            <div class="step-num">
              <CheckCircle2 v-if="activeStep > 1" :size="16" />
              <Loader2 v-else-if="activeStep === 1" :size="16" class="spin-icon" />
              <span v-else>1</span>
            </div>
            <div class="step-info">
              <span class="step-label">Decode Google OIDC Token</span>
              <span class="step-desc">Verify aud (Client ID), sub, and unforgeable nonce</span>
            </div>
          </div>

          <div class="step-item" :class="{ 'is-active': activeStep === 2, 'is-done': activeStep > 2 }">
            <div class="step-num">
              <CheckCircle2 v-if="activeStep > 2" :size="16" />
              <Loader2 v-else-if="activeStep === 2" :size="16" class="spin-icon" />
              <span v-else>2</span>
            </div>
            <div class="step-info">
              <span class="step-label">Derive Self-Custodial L2 Address</span>
              <span class="step-desc">SHA-256(CanonicalDomain || aud || sub || device_pepper)</span>
            </div>
          </div>

          <div class="step-item" :class="{ 'is-active': activeStep === 3, 'is-done': activeStep > 3 }">
            <div class="step-num">
              <CheckCircle2 v-if="activeStep > 3" :size="16" />
              <Loader2 v-else-if="activeStep === 3" :size="16" class="spin-icon" />
              <span v-else>3</span>
            </div>
            <div class="step-info">
              <span class="step-label">Generate Ephemeral Key Pair (EPK)</span>
              <span class="step-desc">Short-lived in-memory session key</span>
            </div>
          </div>

          <div class="step-item" :class="{ 'is-active': activeStep === 4, 'is-done': activeStep > 4 }">
            <div class="step-num">
              <CheckCircle2 v-if="activeStep > 4" :size="16" />
              <Loader2 v-else-if="activeStep === 4" :size="16" class="spin-icon" />
              <span v-else>4</span>
            </div>
            <div class="step-info">
              <span class="step-label">Compute BN254 Groth16 ZK Proof</span>
              <span class="step-desc">128-byte proof binding EPK to identity without revealing JWT</span>
            </div>
          </div>
        </div>

        <div class="pipeline-status">
          <Loader2 :size="16" class="spin-icon" />
          <span>{{ stepTitle }}</span>
        </div>
      </div>

      <!-- Main Login Configuration View -->
      <div v-else class="login-view">
        <div class="login-header">
          <div class="google-badge-hero">
            <svg class="google-logo" viewBox="0 0 24 24" width="28" height="28">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
          </div>
          <h2>Google Keyless Setup</h2>
          <p class="login-sub">Create a self-custodial Web3 wallet secured by Google OIDC & BN254 Groth16 ZK Proofs.</p>
        </div>

        <!-- Mode Navigation Tabs -->
        <div class="tabs-nav">
          <button 
            :class="{ active: currentTab === 'oauth' }" 
            @click="currentTab = 'oauth'"
            class="tab-btn"
          >
            <Key :size="15" />
            <span>Client & Secret</span>
          </button>
          <button 
            :class="{ active: currentTab === 'presets' }" 
            @click="currentTab = 'presets'"
            class="tab-btn"
          >
            <Globe :size="15" />
            <span>Test Profiles</span>
          </button>
          <button 
            :class="{ active: currentTab === 'jwt' }" 
            @click="currentTab = 'jwt'"
            class="tab-btn"
          >
            <Code :size="15" />
            <span>Raw JWT</span>
          </button>
        </div>

        <div v-if="errorMessage" class="error-banner">
          {{ errorMessage }}
        </div>

        <!-- TAB 1: OAuth Client ID & Secret -->
        <div v-if="currentTab === 'oauth'" class="tab-content">
          <div class="input-group">
            <div class="label-row">
              <label>Google OAuth Client ID</label>
              <span class="hint">from Google Cloud Console</span>
            </div>
            <div class="input-wrapper">
              <input 
                v-model="clientId" 
                @input="handleSaveConfig"
                type="text" 
                placeholder="e.g. 123456789-xyz.apps.googleusercontent.com" 
              />
            </div>
          </div>

          <div class="input-group">
            <div class="label-row">
              <label>Client Secret (Optional)</label>
              <span class="hint">for server token exchange</span>
            </div>
            <div class="input-wrapper password-box">
              <input 
                v-model="clientSecret" 
                @input="handleSaveConfig"
                :type="showSecret ? 'text' : 'password'" 
                placeholder="GOCSPX-xxxxxxxxxxxxxxxx" 
              />
              <button type="button" @click="showSecret = !showSecret" class="btn-toggle-eye">
                <EyeOff v-if="showSecret" :size="15" />
                <Eye v-else :size="15" />
              </button>
            </div>
          </div>

          <div class="divider-text">
            <span>Choose Action</span>
          </div>

          <div class="action-buttons-stack">
            <!-- Launch Real Google Popup -->
            <button @click="handleLaunchGoogleOAuth" class="btn-google-action">
              <svg class="btn-google-icon" viewBox="0 0 24 24" width="18" height="18">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Sign in via Google OAuth Popup</span>
            </button>

            <!-- Test / Simulate with Client ID without needing localhost Google Cloud approval -->
            <div class="simulation-box">
              <span class="sim-title">Or test wallet derivation with this Client ID:</span>
              <div class="sim-fields">
                <input v-model="testEmail" type="email" placeholder="test@gmail.com" class="sim-input" />
                <input v-model="testName" type="text" placeholder="Your Name" class="sim-input" />
              </div>
              <button @click="handleSimulateWithClientId" class="btn-simulate">
                <Sparkles :size="15" />
                <span>Create Wallet Bound to Client ID</span>
              </button>
            </div>
          </div>
        </div>

        <!-- TAB 2: Quick Test Profiles -->
        <div v-else-if="currentTab === 'presets'" class="tab-content">
          <div class="list-title">Instant test accounts:</div>
          <div class="profiles-list">
            <div 
              v-for="profile in PRESET_GOOGLE_USERS" 
              :key="profile.email"
              @click="handleSelectPreset(profile)"
              class="profile-card"
            >
              <img :src="profile.picture" :alt="profile.name" class="profile-img" />
              <div class="profile-details">
                <span class="profile-name">{{ profile.name }}</span>
                <span class="profile-email">{{ profile.email }}</span>
                <span class="profile-funding" v-if="profile.email === 'alice@gmail.com'">
                  💰 10.00 USDC funded
                </span>
                <span class="profile-funding" v-else>
                  💰 0.00 USDC (Claim via Faucet)
                </span>
              </div>
              <ChevronRight :size="18" class="card-arrow" />
            </div>
          </div>
        </div>

        <!-- TAB 3: Raw JWT Input -->
        <div v-else class="tab-content">
          <div class="input-group">
            <div class="label-row">
              <label>Paste Google ID Token (JWT)</label>
              <span class="hint">from OAuth playground</span>
            </div>
            <textarea 
              v-model="rawJwtInput" 
              rows="4" 
              placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI..." 
              class="jwt-textarea"
            ></textarea>
          </div>
          <button @click="handleImportJwt" class="btn-primary-full">
            <span>Parse Token & Derive Keyless Wallet</span>
          </button>
        </div>

        <div class="security-guarantee">
          <ShieldCheck :size="16" class="guarantee-icon" />
          <span>Credentials & device pepper are never uploaded to the blockchain.</span>
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
  max-width: 520px;
  background: #0d1222;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 26px;
  padding: 32px 30px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 40px rgba(16, 185, 129, 0.1);
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

.login-header {
  text-align: center;
  margin-bottom: 20px;
}

.google-badge-hero {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  background: #ffffff;
  border-radius: 16px;
  margin-bottom: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.login-header h2 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.55rem;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 6px 0;
}

.login-sub {
  font-size: 0.84rem;
  line-height: 1.5;
  color: #94a3b8;
  margin: 0;
}

.tabs-nav {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 20px;
  gap: 4px;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 8px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: 9px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: rgba(16, 185, 129, 0.18);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.error-banner {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.82rem;
  margin-bottom: 16px;
}

.input-group {
  margin-bottom: 14px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.label-row label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #e2e8f0;
}

.label-row .hint {
  font-size: 0.72rem;
  color: #64748b;
}

.input-wrapper input {
  width: 100%;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 10px 14px;
  color: #f8fafc;
  font-size: 0.85rem;
  font-family: 'JetBrains Mono', monospace;
  outline: none;
  transition: border-color 0.2s;
}

.input-wrapper input:focus {
  border-color: #10b981;
}

.password-box {
  position: relative;
}

.btn-toggle-eye {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
}

.divider-text {
  text-align: center;
  position: relative;
  margin: 16px 0 12px 0;
}

.divider-text::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.divider-text span {
  position: relative;
  background: #0d1222;
  padding: 0 12px;
  font-size: 0.72rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.action-buttons-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-google-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  background: #ffffff;
  color: #0f172a;
  border: none;
  border-radius: 14px;
  padding: 12px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-google-action:hover {
  background: #f1f5f9;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(255, 255, 255, 0.15);
}

.simulation-box {
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sim-title {
  font-size: 0.76rem;
  color: #94a3b8;
  font-weight: 500;
}

.sim-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.sim-input {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 8px 10px;
  color: #f1f5f9;
  font-size: 0.8rem;
  outline: none;
}

.btn-simulate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
  border-radius: 10px;
  padding: 9px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-simulate:hover {
  background: rgba(16, 185, 129, 0.25);
  border-color: #34d399;
}

.jwt-textarea {
  width: 100%;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 10px;
  color: #f8fafc;
  font-size: 0.78rem;
  font-family: 'JetBrains Mono', monospace;
  outline: none;
  resize: vertical;
}

.btn-primary-full {
  width: 100%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  padding: 12px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary-full:hover {
  opacity: 0.92;
}

.list-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.profiles-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.profile-card:hover {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.4);
  transform: translateY(-2px);
}

.profile-img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #10b981;
}

.profile-details {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.profile-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: #f1f5f9;
}

.profile-email {
  font-size: 0.76rem;
  color: #94a3b8;
}

.profile-funding {
  font-size: 0.72rem;
  font-weight: 600;
  color: #34d399;
  margin-top: 2px;
}

.card-arrow {
  color: #64748b;
}

.security-guarantee {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.74rem;
  color: #64748b;
  margin-top: 18px;
  text-align: center;
}

.guarantee-icon {
  color: #10b981;
}

/* ZK Pipeline View Styles */
.zk-pipeline-view {
  padding: 10px 0;
}

.zk-header {
  text-align: center;
  margin-bottom: 24px;
}

.zk-icon-halo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 50%;
  margin-bottom: 12px;
}

.halo-icon {
  color: #10b981;
  animation: pulse 2s infinite ease-in-out;
}

.zk-header h3 {
  font-size: 1.3rem;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 6px 0;
}

.zk-subtitle {
  font-size: 0.8rem;
  color: #94a3b8;
  margin: 0;
}

.steps-progress {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px 14px;
  transition: all 0.3s;
}

.step-item.is-active {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.4);
}

.step-item.is-done {
  border-color: rgba(16, 185, 129, 0.2);
}

.step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  color: #64748b;
  font-size: 0.8rem;
  font-weight: 700;
}

.step-item.is-active .step-num {
  background: #10b981;
  color: #ffffff;
}

.step-item.is-done .step-num {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.step-info {
  display: flex;
  flex-direction: column;
}

.step-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #f1f5f9;
}

.step-desc {
  font-size: 0.74rem;
  color: #64748b;
}

.pipeline-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #34d399;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.1); opacity: 1; }
}
</style>
