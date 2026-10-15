// Real-time WebSocket Streaming & Bun SQLite Data Client for SENA Keyless Wallet
import { ref } from 'vue';
import type { KeylessAccount, TransactionRecord, StreamEvent } from '../types';
import { logger } from './logger';

export class StreamService {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private pingStartTime = 0;
  private listeners: Map<string, Array<(event: StreamEvent) => void>> = new Map();

  public isConnected = ref(false);
  public latencyMs = ref(1);
  public lastEventTime = ref<number | null>(null);
  public streamFeed = ref<StreamEvent[]>([]);

  private apiUrl: string;
  private wsUrl: string;

  constructor() {
    this.apiUrl = import.meta.env.VITE_SQLITE_API_URL || 'http://127.0.0.1:3001';
    this.wsUrl = import.meta.env.VITE_WS_STREAM_URL || 'ws://127.0.0.1:3001/ws';
  }

  /**
   * Connect to native Bun WebSocket stream
   */
  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected.value = true;
        logger.info('STREAM', `Connected to real-time WebSocket stream: ${this.wsUrl}`);
        this.startPingHeartbeat();
      };

      this.ws.onmessage = (event) => {
        if (event.data === 'pong') {
          if (this.pingStartTime > 0) {
            this.latencyMs.value = Math.max(1, Math.round(performance.now() - this.pingStartTime));
          }
          return;
        }

        try {
          const packet: StreamEvent = JSON.parse(event.data);
          if (!packet.id) {
            packet.id = 'evt_' + Math.random().toString(36).substring(2, 9);
          }

          this.lastEventTime.value = packet.timestamp || Date.now();

          // Push to reactive stream activity feed (capped at 50 events)
          this.streamFeed.value.unshift(packet);
          if (this.streamFeed.value.length > 50) {
            this.streamFeed.value.pop();
          }

          logger.info('STREAM', `Received [${packet.type}] ${packet.hash ? packet.hash.slice(0, 10) + '...' : ''}`, packet);

          // Trigger registered callbacks
          this.dispatch(packet);
        } catch (e) {
          logger.warn('STREAM', 'Failed to parse incoming WebSocket message', event.data);
        }
      };

      this.ws.onclose = () => {
        this.isConnected.value = false;
        this.stopPingHeartbeat();
        logger.warn('STREAM', 'WebSocket disconnected. Reconnecting in 2.5s...');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        logger.error('STREAM', 'WebSocket stream error', err);
        this.ws?.close();
      };
    } catch (err) {
      logger.error('STREAM', 'Failed to initiate WebSocket connection', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 2500);
  }

  private startPingHeartbeat() {
    this.stopPingHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.pingStartTime = performance.now();
        this.ws.send('ping');
      }
    }, 3000);
  }

  private stopPingHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Subscribe to specific or all stream event types
   */
  public on(type: string, callback: (event: StreamEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(callback);
    return () => {
      const list = this.listeners.get(type);
      if (list) {
        this.listeners.set(type, list.filter(cb => cb !== callback));
      }
    };
  }

  private dispatch(event: StreamEvent) {
    const specific = this.listeners.get(event.type) || [];
    const wildcard = this.listeners.get('*') || [];
    for (const cb of [...specific, ...wildcard]) {
      try {
        cb(event);
      } catch (err) {
        console.error('Error in stream listener', err);
      }
    }
  }

  // =========================================================================
  // SQLite REST Client Functions
  // =========================================================================

  /**
   * Fetch all accounts persisted in SQLite
   */
  public async getAccountsFromDb(): Promise<KeylessAccount[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/accounts`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: any[] = await res.json();

      return rows.map((r) => ({
        address: r.address,
        email: r.email,
        name: r.name,
        picture: r.picture,
        sub: r.sub,
        aud: r.aud,
        pepperHex: '',
        ephemeralPublicKeyHex: r.ephemeral_public_key || '',
        ephemeralPrivateKeyHex: r.ephemeral_private_key || '',
        zkProofHex: r.zk_proof || '',
        nonce: r.nonce || 0,
        balances: {
          usdc: r.usdc_balance || 0,
          sena: r.sena_balance || 50_000_000,
        },
      }));
    } catch (err) {
      logger.warn('SQLITE', 'Failed to fetch accounts from SQLite backend, using local store', err);
      return [];
    }
  }

  /**
   * Save or update an account in SQLite
   */
  public async saveAccountToDb(account: KeylessAccount): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: account.address,
          email: account.email,
          name: account.name,
          picture: account.picture,
          sub: account.sub,
          aud: account.aud,
          ephemeralPublicKeyHex: account.ephemeralPublicKeyHex,
          ephemeralPrivateKeyHex: account.ephemeralPrivateKeyHex,
          zkProofHex: account.zkProofHex,
          nonce: account.nonce,
          balances: account.balances,
        }),
      });
      return res.ok;
    } catch (err) {
      logger.warn('SQLITE', 'Failed to upsert account in SQLite', err);
      return false;
    }
  }

  /**
   * Request faucet funds via SQLite & broadcast over WebSockets
   */
  public async claimFaucet(address: string, amount = 50_000_000): Promise<{ newBalance: number } | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, amount }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      logger.error('SQLITE', 'Faucet claim failed', err);
      return null;
    }
  }

  /**
   * Execute real-time streaming transfer via SQLite + WebSocket
   */
  public async executeStreamingTransfer(params: {
    sender: KeylessAccount;
    recipientAddress: string;
    amountMicroUsdc: number;
    feeMicroUsdc?: number;
    recipientEmail?: string;
  }): Promise<StreamEvent | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: params.sender.address,
          recipient: params.recipientAddress,
          amountUsdc: params.amountMicroUsdc,
          feeUsdc: params.feeMicroUsdc ?? 1000,
          epkSignatureHex: params.sender.ephemeralPublicKeyHex,
          zkProofHex: params.sender.zkProofHex,
          senderEmail: params.sender.email,
          recipientEmail: params.recipientEmail,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const streamPacket: StreamEvent = await res.json();
      return streamPacket;
    } catch (err: any) {
      logger.error('SQLITE', 'Streaming transfer failed', err);
      throw err;
    }
  }

  /**
   * Fetch transaction history from SQLite
   */
  public async getTransactionsFromDb(): Promise<TransactionRecord[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/transactions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: any[] = await res.json();

      return rows.map((r) => ({
        id: r.id,
        hash: r.hash,
        sender: r.sender,
        senderEmail: r.sender_email,
        recipient: r.recipient,
        recipientEmail: r.recipient_email,
        amountUsdc: r.amount_usdc,
        feeUsdc: r.fee_usdc,
        status: r.status as any,
        blockHeight: r.block_height,
        timestamp: r.timestamp,
        zkProofSize: 128,
        epkSignatureHex: r.epk_signature || '',
      }));
    } catch (err) {
      logger.warn('SQLITE', 'Failed to fetch transactions from SQLite', err);
      return [];
    }
  }
}

export const streamService = new StreamService();
