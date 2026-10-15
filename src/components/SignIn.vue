<script setup lang="ts">
import { config } from '../config';

defineProps<{
  /** The step a sign-in in progress is at. */
  step: string | null;
  error: string | null;
  /** Whether accounts already exist (this is "add another"). */
  adding: boolean;
}>();

const emit = defineEmits<{ (e: 'begin'): void; (e: 'cancel'): void }>();
const origin = window.location.origin;
</script>

<template>
  <section class="hero">
    <div class="hero-glow"></div>
    <span class="hero-pill">SENA keyless accounts</span>
    <h1>Sign in with Google.<br /><span>Hold stablecoins on SENA.</span></h1>
    <p class="hero-desc">
      No seed phrase. Your address comes from your Google identity and a pepper
      from Aptos's keyless service; a zero-knowledge proof from Aptos's prover
      lets a short-lived key in this browser sign for it.
    </p>

    <div v-if="!config.googleClientId" class="alert alert-info setup">
      <b>One setting is missing.</b> Create an OAuth 2.0 client of type
      <i>Web application</i> in Google Cloud Console (APIs &amp; Services →
      Credentials). Add <code>{{ origin }}</code> under both <i>Authorised
      JavaScript origins</i> and <i>Authorised redirect URIs</i>, put its client
      id in <code>.env</code> as <code>VITE_GOOGLE_CLIENT_ID</code>, and restart
      <code>bun run dev</code>.
    </div>

    <div v-else-if="step" class="progress card">
      <div class="steps">
        <div class="step done"><span class="dot"></span>Signed in with Google</div>
        <div class="step active"><span class="dot"></span>{{ step }}</div>
      </div>
    </div>

    <template v-else>
      <button class="btn-google" @click="emit('begin')">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        <span>{{ adding ? 'Add another Google account' : 'Continue with Google' }}</span>
      </button>
      <button v-if="adding" class="btn cancel" @click="emit('cancel')">Back to my wallet</button>
    </template>

    <div v-if="error" class="alert alert-error err">{{ error }}</div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  max-width: 660px;
  margin: 8vh auto 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
.hero-glow {
  position: absolute;
  inset: -120px 0 auto;
  height: 420px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.14) 0%, transparent 70%);
  pointer-events: none;
  z-index: -1;
}
.hero-pill {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--emerald-500);
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 6px 16px;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
h1 { font-family: var(--font-display); font-size: clamp(2rem, 6vw, 3rem); font-weight: 800; line-height: 1.15; letter-spacing: -0.02em; }
h1 span { background: linear-gradient(135deg, var(--emerald-500), var(--cyan-500)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.hero-desc { color: var(--text-secondary); line-height: 1.6; font-size: 1rem; }
.btn-google {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  color: #070a12;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 700;
  padding: 14px 28px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4), 0 0 40px rgba(16, 185, 129, 0.2);
}
.btn-google:hover { transform: translateY(-2px); }
.setup { text-align: left; }
.setup code { font-family: var(--font-mono); font-size: 0.8rem; color: #e0f2fe; }
.progress { width: 100%; text-align: left; }
.err { width: 100%; text-align: left; }
</style>
