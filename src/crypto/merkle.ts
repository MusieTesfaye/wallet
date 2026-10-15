// Ultralight Mobile & Client Sparse Merkle Proof verification matching sena-light-client and sena-state

import { sha256, bytesToHex, hexToBytes } from './keyless';
import type { MerkleVerificationResult } from '../types';

/**
 * Computes node hash: SHA256(domain_tag || left || right)
 */
async function hashNode(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('sena.state.trie.internal.v1');
  const buffer = new Uint8Array(domain.length + 32 + 32);
  buffer.set(domain, 0);
  buffer.set(left, domain.length);
  buffer.set(right, domain.length + 32);
  return await sha256(buffer);
}

/**
 * Computes leaf hash: SHA256(domain_tag || key || value)
 */
async function hashLeaf(key: Uint8Array, value: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('sena.state.trie.leaf.v1');
  const buffer = new Uint8Array(domain.length + 32 + 32);
  buffer.set(domain, 0);
  buffer.set(key, domain.length);
  buffer.set(value, domain.length + 32);
  return await sha256(buffer);
}

/**
 * Verifies an account balance proof against a trusted state root in sub-millisecond time (<0.2 ms).
 */
export async function verifyAccountMerkleProof(
  addressHex: string,
  nonce: number,
  balanceMicroUsdc: number,
  stateRootHex: string,
  siblingsHexList: string[]
): Promise<MerkleVerificationResult> {
  const startTime = performance.now();

  const keyBytes = hexToBytes(addressHex);
  const accountValRaw = `acc:${nonce}:usdc:${balanceMicroUsdc}`;
  const valueHash = await sha256(new TextEncoder().encode(accountValRaw));

  // Compute leaf hash
  let currentHash = await hashLeaf(keyBytes, valueHash);

  // Traverse up the tree with sibling hashes
  for (let i = 0; i < siblingsHexList.length; i++) {
    const siblingBytes = hexToBytes(siblingsHexList[i]);
    // Determine tree branch direction based on bit in key
    const bitIndex = siblingsHexList.length - 1 - i;
    const byteIndex = Math.floor(bitIndex / 8);
    const bitPos = 7 - (bitIndex % 8);
    const isRightChild = ((keyBytes[byteIndex] || 0) >> bitPos) & 1;

    if (isRightChild) {
      currentHash = await hashNode(siblingBytes, currentHash);
    } else {
      currentHash = await hashNode(currentHash, siblingBytes);
    }
  }

  const recomputedRootHex = '0x' + bytesToHex(currentHash);
  const cleanTargetRoot = stateRootHex.startsWith('0x') ? stateRootHex : '0x' + stateRootHex;

  const durationMs = performance.now() - startTime;
  const executionTimeUs = Math.round(durationMs * 1000);

  const verified = recomputedRootHex.toLowerCase() === cleanTargetRoot.toLowerCase();

  return {
    verified,
    stateRoot: cleanTargetRoot,
    recomputedRoot: recomputedRootHex,
    address: addressHex,
    balanceUsdc: balanceMicroUsdc,
    nonce,
    siblingsCount: siblingsHexList.length,
    executionTimeUs,
    trustLevel: 'SoftConfirmed',
  };
}

/**
 * Computes the state root directly from leaf data and sibling hashes.
 */
export async function computeRootFromProof(
  addressHex: string,
  nonce: number,
  balanceMicroUsdc: number,
  siblingsHexList: string[]
): Promise<string> {
  const keyBytes = hexToBytes(addressHex);
  const accountValRaw = `acc:${nonce}:usdc:${balanceMicroUsdc}`;
  const valueHash = await sha256(new TextEncoder().encode(accountValRaw));

  let currentHash = await hashLeaf(keyBytes, valueHash);

  for (let i = 0; i < siblingsHexList.length; i++) {
    const siblingBytes = hexToBytes(siblingsHexList[i]);
    const bitIndex = siblingsHexList.length - 1 - i;
    const byteIndex = Math.floor(bitIndex / 8);
    const bitPos = 7 - (bitIndex % 8);
    const isRightChild = ((keyBytes[byteIndex] || 0) >> bitPos) & 1;

    if (isRightChild) {
      currentHash = await hashNode(siblingBytes, currentHash);
    } else {
      currentHash = await hashNode(currentHash, siblingBytes);
    }
  }

  return '0x' + bytesToHex(currentHash);
}

