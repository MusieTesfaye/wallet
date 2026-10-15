<script setup lang="ts">
import { onMounted, ref } from 'vue';
import QRCode from 'qrcode';
import { X, Copy, Check, QrCode } from 'lucide-vue-next';
import type { KeylessAccount } from '../services/auth';

const props = defineProps<{ account: KeylessAccount; symbols: string[] }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const qr = ref('');
const copied = ref(false);

onMounted(async () => {
  qr.value = await QRCode.toDataURL(props.account.address, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
});

function copy() {
  navigator.clipboard.writeText(props.account.address);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card">
      <button class="btn-close" @click="emit('close')"><X :size="20" /></button>
      <div class="modal-header">
        <span class="icon-circle"><QrCode :size="22" /></span>
        <h3>Receive</h3>
        <p>Any of {{ symbols.join(', ') }} sent to this address arrives in your wallet.</p>
      </div>
      <div class="qr"><img v-if="qr" :src="qr" alt="QR code of your SENA address" /></div>
      <div class="address mono">{{ account.address }}</div>
      <button class="btn btn-block" @click="copy">
        <Check v-if="copied" :size="16" /><Copy v-else :size="16" /> {{ copied ? 'Copied' : 'Copy address' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.qr { display: flex; justify-content: center; margin-bottom: 16px; }
.qr img { border-radius: 14px; background: #fff; }
.address {
  font-size: 0.78rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 14px;
  overflow-wrap: anywhere;
  text-align: center;
  color: var(--text-secondary);
}
</style>
