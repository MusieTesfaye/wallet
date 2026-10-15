// Real-time Event Logging System for SENA Keyless Protocol

export type LogCategory = 'OIDC' | 'ZK_PROVER' | 'SEQUENCER' | 'LIGHT_CLIENT' | 'WALLET' | 'SYSTEM' | 'STREAM' | 'SQLITE' | 'PEPPER_STORAGE';

export interface LogEntry {
  id: string;
  timestamp: number;
  timeStr: string;
  category: LogCategory;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  details?: any;
}

const STORAGE_KEY_LOGS = 'sena_protocol_logs';
const MAX_LOGS = 100;

class ProtocolLogger {
  private listeners: Array<(entry: LogEntry) => void> = [];
  private logs: LogEntry[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LOGS);
      if (raw) {
        this.logs = JSON.parse(raw);
      }
    } catch {
      this.logs = [];
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(this.logs.slice(-MAX_LOGS)));
    } catch {
      // Storage quota or private browsing
    }
  }

  public subscribe(cb: (entry: LogEntry) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear() {
    this.logs = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_LOGS);
    }
  }

  public log(
    category: LogCategory, 
    message: string, 
    level: 'info' | 'success' | 'warn' | 'error' = 'info',
    details?: Record<string, any>
  ): LogEntry {
    const now = new Date();
    const timeStr = `${now.toTimeString().split(' ')[0]}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      timeStr,
      category,
      level,
      message,
      details,
    };

    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs.pop();
    }

    this.saveToStorage();
    this.listeners.forEach(cb => cb(entry));

    // Also output to Browser DevTools Console with colors
    const colors: Record<LogCategory, string> = {
      OIDC: '#3b82f6',
      ZK_PROVER: '#8b5cf6',
      SEQUENCER: '#10b981',
      LIGHT_CLIENT: '#06b6d4',
      WALLET: '#f59e0b',
      SYSTEM: '#64748b',
      STREAM: '#0284c7',
      SQLITE: '#0ea5e9',
      PEPPER_STORAGE: '#ec4899',
    };
    const color = colors[category] || '#10b981';

    console.log(
      `%c[SENA:${category}] %c${timeStr} %c${message}`,
      `color: #ffffff; background: ${color}; font-weight: bold; padding: 2px 6px; border-radius: 4px;`,
      'color: #94a3b8; font-weight: normal;',
      'color: #f1f5f9; font-weight: 500;',
      details || ''
    );

    return entry;
  }

  public info(category: LogCategory, message: string, details?: any) {
    return this.log(category, message, 'info', details);
  }

  public success(category: LogCategory, message: string, details?: any) {
    return this.log(category, message, 'success', details);
  }

  public warn(category: LogCategory, message: string, details?: any) {
    return this.log(category, message, 'warn', details);
  }

  public error(category: LogCategory, message: string, details?: any) {
    return this.log(category, message, 'error', details);
  }
}

export const logger = new ProtocolLogger();
