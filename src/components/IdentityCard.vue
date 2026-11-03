<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { AtSign, Link2, ShieldCheck } from 'lucide-vue-next';
import type { KeylessAccount } from '../services/auth';
import * as identity from '../services/identity';
import type { IssuerInfo, IssuerProvider } from '../services/identity';

const props = defineProps<{ account: KeylessAccount; busy: boolean }>();
const emit = defineEmits<{ (e: 'attested', a: identity.SignedAttestation): void }>();

const info = ref<IssuerInfo | null>(null);
const loaded = ref(false);
const linked = computed(() => identity.linkedIdentities(props.account.address));
// Code flows (SMS): which provider is open, the number and the code.
const codeFor = ref<IssuerProvider | null>(null);
const to = ref('');
const code = ref('');
const sent = ref(false);
const error = ref<string | null>(null);
const working = ref(false);

onMounted(async () => {
  info.value = await identity.issuerInfo();
  loaded.value = true;
});

function link(p: IssuerProvider) {
  error.value = null;
  if (p.flow === 'redirect') identity.beginLink(p, props.account.address);
  else {
    codeFor.value = p;
    sent.value = false;
    code.value = '';
  }
}

async function send() {
  if (!codeFor.value) return;
  error.value = null;
  working.value = true;
  try {
    await identity.sendCode(codeFor.value, to.value);
    sent.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
  }
}

async function verify() {
  if (!codeFor.value) return;
  error.value = null;
  working.value = true;
  try {
    const a = await identity.checkCode(codeFor.value, to.value, code.value, props.account.address);
    codeFor.value = null;
    emit('attested', a);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
  }
}

const shown = (prefix: string, plaintext: string) =>
  prefix === 'mailto' || prefix === 'tel' ? plaintext : `${prefix}:${plaintext}`;
</script>

<template>
  <div class="card">
    <div class="card-title"><AtSign :size="18" /> Find me by</div>
    <p class="secondary lead">
      Link an email, phone number or username so people can pay you by it. An issuer checks that it is yours and
      signs that it belongs to this account; you submit that on chain, and wallets that trust the issuer can find you.
    </p>

    <ul v-if="linked.length" class="linked">
      <li v-for="l in linked" :key="l.prefix + l.plaintext">
        <ShieldCheck :size="14" class="ok" /> <span class="mono">{{ shown(l.prefix, l.plaintext) }}</span>
      </li>
    </ul>

    <div v-if="!loaded" class="muted small">Looking for an issuer…</div>
    <div v-else-if="!info" class="alert alert-info small">
      No attestation issuer is running. Copy <code>issuer.config.example.json</code> to
      <code>issuer.config.json</code>, keep the providers you have credentials for, and restart
      <code>bun run devnet</code>.
    </div>
    <template v-else>
      <div class="providers">
        <button v-for="p in info.providers" :key="p.id" class="btn mini" :disabled="busy || working" @click="link(p)">
          <Link2 :size="13" /> {{ p.label }}
        </button>
      </div>
      <div class="muted small issuer">Issuer <span class="mono">{{ info.issuer.slice(0, 10) }}…</span></div>
    </template>

    <div v-if="codeFor" class="code">
      <div class="field">
        <label>{{ codeFor.label }}</label>
        <input v-model="to" class="input mono" placeholder="+15551234567" :disabled="sent" />
      </div>
      <button v-if="!sent" class="btn btn-block" :disabled="working || !to" @click="send">Send code</button>
      <template v-else>
        <div class="field">
          <label>Code</label>
          <input v-model="code" class="input mono" inputmode="numeric" placeholder="123456" />
        </div>
        <button class="btn btn-primary btn-block" :disabled="working || !code" @click="verify">Verify and link</button>
      </template>
    </div>

    <div v-if="error" class="alert alert-error small">{{ error }}</div>
  </div>
</template>

<style scoped>
.card-title { display: flex; align-items: center; gap: 8px; }
.lead { font-size: 0.84rem; line-height: 1.55; margin-bottom: 14px; }
.linked { list-style: none; display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.linked li { display: flex; align-items: center; gap: 8px; font-size: 0.86rem; }
.ok { color: var(--emerald-400); }
.providers { display: flex; flex-wrap: wrap; gap: 8px; }
.mini { padding: 7px 12px; font-size: 0.8rem; }
.small { font-size: 0.78rem; }
.issuer { margin-top: 10px; }
.code { margin-top: 16px; }
.alert { margin-top: 12px; }
code { font-family: var(--font-mono); font-size: 0.75rem; }
</style>
