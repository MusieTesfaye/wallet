// Signs a transaction with whatever holds the account's key: this browser's
// keyless session, or MetaMask through the SENA Snap.

import type { Account } from './auth';
import { isSnap } from './auth';
import * as sena from './sena';
import * as snap from './snap';

export async function sign(account: Account, unsigned: string): Promise<string> {
  if (isSnap(account)) return snap.signTransaction(unsigned);
  return sena.signKeyless(unsigned, account.session, account.signature);
}
