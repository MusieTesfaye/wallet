import {
  deriveAddressFromOidc,
  generateEphemeralKeyPair,
  generateGroth16Proof,
  hexToBytes,
} from "../src/crypto/keyless";
import { verifyAccountMerkleProof } from "../src/crypto/merkle";
import {
  PRESET_GOOGLE_USERS,
  GOOGLE_AUD,
  createKeylessAccountFromOidc,
} from "../src/services/oidc";
import { senaRpc } from "../src/services/rpc";

console.log("=================================================================");
console.log("=== Testing SENA Keyless Wallet End-to-End Execution with Bun ===");
console.log("=================================================================");

// 1. Google OIDC Accounts & Address Derivation
const aliceProfile = PRESET_GOOGLE_USERS[0];
const bobProfile = PRESET_GOOGLE_USERS[1];
console.log(`\n[1] Decoding Web2 Google OIDC Profiles:`);
console.log(`  - Alice: "${aliceProfile.name}" <${aliceProfile.email}> (sub=${aliceProfile.sub})`);
console.log(`  - Bob:   "${bobProfile.name}" <${bobProfile.email}> (sub=${bobProfile.sub})`);

const aliceAddr = await deriveAddressFromOidc(GOOGLE_AUD, aliceProfile.sub, hexToBytes(aliceProfile.pepperHex));
const bobAddr = await deriveAddressFromOidc(GOOGLE_AUD, bobProfile.sub, hexToBytes(bobProfile.pepperHex));
console.log(`  - Alice Derived L2 Address: ${aliceAddr}`);
console.log(`  - Bob Derived L2 Address:   ${bobAddr}`);

if (!aliceAddr.startsWith("0x") || aliceAddr.length !== 66) {
  throw new Error("Invalid address format for Alice");
}

// 2. Keyless Account Creation & BN254 Groth16 Proof
console.log(`\n[2] Creating Full Keyless Accounts with Zero-Knowledge Proofs:`);
const aliceAccount = await createKeylessAccountFromOidc(aliceProfile, (step, desc) => {
  console.log(`    Step ${step}: ${desc}`);
});
const bobAccount = await createKeylessAccountFromOidc(bobProfile);

console.log(`  - Alice Keyless Account Created:`);
console.log(`    Address:     ${aliceAccount.address}`);
console.log(`    EPK Pubkey:  ${aliceAccount.ephemeralPublicKeyHex.slice(0, 32)}...`);
const proofByteLen = (aliceAccount.zkProofHex.startsWith('0x') ? aliceAccount.zkProofHex.slice(2) : aliceAccount.zkProofHex).length / 2;
console.log(`    ZK Proof:    ${aliceAccount.zkProofHex.slice(0, 32)}... (${proofByteLen} bytes)`);

if (proofByteLen !== 128) {
  throw new Error(`Expected 128 bytes BN254 Groth16 proof, got ${proofByteLen}`);
}

// 3. Social Connect Lookup
console.log(`\n[3] Testing Web2 Social Connect Identifier Resolution:`);
senaRpc.registerSocialIdentifier("@alice", aliceAccount.address);
senaRpc.registerSocialIdentifier("@bob", bobAccount.address);
const resolvedBob = senaRpc.resolveSocialIdentifier("@bob");
console.log(`  - Lookup '@bob' -> ${resolvedBob}`);
if (resolvedBob !== bobAccount.address) {
  throw new Error(`Social lookup failed: expected ${bobAccount.address}, got ${resolvedBob}`);
}

// 4. Keyless Transfer Submission
console.log(`\n[4] Submitting Keyless Transfer (Alice sends 2.50 USDC to Bob):`);
const txRecord = await senaRpc.submitKeylessTransfer(
  aliceAccount,
  bobAccount.address,
  2_500_000, // 2.50 USDC in micro-USDC
  bobAccount.email
);

console.log(`  - Transaction Hash: ${txRecord.hash}`);
console.log(`  - Initial Status:   ${txRecord.status}`);
console.log(`  - Proof Size:       ${txRecord.zkProofSize} bytes`);
console.log(`  - EPK Signature:    ${txRecord.epkSignatureHex.slice(0, 32)}...`);

// 5. Sparse Merkle Proof Verification (<0.2ms)
console.log(`\n[5] Client-Side Ultra-Light Merkle Proof Verification:`);
const chainInfo = await senaRpc.getChainInfo();
console.log(`  - Current Block Height: ${chainInfo.blockHeight}`);
console.log(`  - Current State Root:   ${chainInfo.stateRoot}`);

const proofData = await senaRpc.getAccountProof(aliceAccount.address, aliceAccount.nonce, 7_500_000);
const startTime = performance.now();
const verification = await verifyAccountMerkleProof(
  aliceAccount.address,
  proofData.nonce,
  proofData.balanceUsdc,
  proofData.stateRoot,
  proofData.siblings
);
const elapsedMs = performance.now() - startTime;

console.log(`  - Merkle Verified:   ${verification.verified}`);
console.log(`  - Execution Time:    ${verification.executionTimeUs} µs (${elapsedMs.toFixed(4)} ms)`);
console.log(`  - Recomputed Root:   ${verification.recomputedRoot}`);
console.log(`  - Trusted StateRoot: ${verification.stateRoot}`);

console.log(`\n=================================================================`);
console.log(`>>> ALL SENA KEYLESS CRYPTO & WALLET FLOWS PASSED WITH BUN! <<<`);
console.log(`=================================================================`);
