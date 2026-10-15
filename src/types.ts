export interface JwtClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string;
  picture: string;
  exp: number;
  iat: number;
  nonce: string;
}

export interface KeylessAccount {
  address: string;
  email: string;
  name: string;
  picture: string;
  sub: string;
  aud: string;
  pepperHex: string;
  ephemeralPublicKeyHex: string;
  ephemeralPrivateKeyHex: string;
  zkProofHex: string;
  nonce: number;
  balances: {
    usdc: number; // in micro-USDC (6 decimals)
    sena: number; // in micro-SENA (6 decimals)
  };
}

export interface TransactionRecord {
  id: string;
  hash: string;
  sender: string;
  senderEmail: string;
  recipient: string;
  recipientEmail?: string;
  amountUsdc: number;
  feeUsdc: number;
  timestamp: number;
  status: 'pending' | 'soft_confirmed' | 'finalized';
  blockHeight?: number;
  zkProofSize: number;
  epkSignatureHex: string;
}

export interface MerkleVerificationResult {
  verified: boolean;
  stateRoot: string;
  recomputedRoot: string;
  address: string;
  balanceUsdc: number;
  nonce: number;
  siblingsCount: number;
  executionTimeUs: number;
  trustLevel: 'SoftConfirmed' | 'Finalized';
}

export interface ChainInfo {
  chainId: string;
  blockHeight: number;
  finalizedHeight: number;
  stateRoot: string;
  challengeWindowSecs: number;
  mempoolSize: number;
  isConnectedToLiveNode: boolean;
  rpcEndpoint: string;
}

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret?: string;
}

export interface StreamEvent {
  id: string;
  type: 'TX_STREAM' | 'FAUCET_CLAIMED' | 'ACCOUNT_UPSERTED' | 'CONNECTED';
  status?: 'pending' | 'soft_confirmed';
  hash?: string;
  sender?: string;
  recipient?: string;
  amountUsdc?: number;
  feeUsdc?: number;
  senderBalance?: number;
  recipientBalance?: number;
  blockHeight?: number;
  address?: string;
  amountAdded?: number;
  newBalance?: number;
  message?: string;
  timestamp: number;
}
