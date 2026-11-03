/* tslint:disable */
/* eslint-disable */
/**
 * A new ephemeral session expiring at `exp_date_secs`, from 63 random bytes
 * (32 for the key, 31 for the blinder). Returns its JSON, which the wallet
 * stores; `nonce` goes in the OAuth request.
 */
export function newSession(exp_date_secs: bigint, random: Uint8Array): string;
/**
 * The JWT's header and claims as JSON: `{header: {...}, claims: {...}}`.
 */
export function decodeJwt(jwt: string): string;
/**
 * The body to POST to the pepper service's `/v0/fetch`.
 */
export function pepperRequest(jwt: string, session: string): string;
/**
 * The pepper, as hex, from the pepper service's response JSON.
 */
export function parsePepper(response: string): string;
/**
 * Signs a transaction with a keyless session and signature, raising its gas
 * limit by what keyless verification costs. Returns the signed JSON.
 */
export function signKeyless(tx: string, session: string, signature: string): string;
/**
 * Signs a transaction with an Ed25519 secret key. Returns the signed JSON.
 */
export function signEd25519(tx: string, secret: string): string;
/**
 * The address an Ed25519 secret key controls.
 */
export function ed25519Address(secret: string): string;
/**
 * Signs `message` (hex) with a session's ephemeral key: proof, to an issuer,
 * that the caller holds the key a Google sign-in committed to.
 */
export function signWithSession(session: string, message_hex: string): string;
/**
 * Whether `signature` (hex) is `public_key`'s strict Ed25519 signature on
 * `message` (hex), as the chain checks signatures.
 */
export function verifyEd25519(public_key: string, signature: string, message_hex: string): boolean;
/**
 * The OAuth nonce for an ephemeral public key, expiry and blinder, so a
 * service can check a JWT was issued for the session it is shown.
 */
export function oauthNonce(public_key: string, exp_date_secs: bigint, blinder: string): string;
/**
 * A transaction's hash, as the node reports it.
 */
export function transactionHash(tx: string): string;
/**
 * The `sena_submitTransaction` request body for a signed transaction.
 */
export function submitRequest(tx: string): string;
/**
 * The keyless address a sign-in controls.
 */
export function keylessAddress(jwt: string, pepper: string): string;
/**
 * The body to POST to the proving service's `/v0/prove`. `extra_field` is a
 * JWT field to reveal, as `"name":"value",`, or empty for none.
 */
export function proverRequest(jwt: string, session: string, pepper: string, exp_horizon_secs: bigint, extra_field: string): string;
/**
 * The keyless signature, as JSON, for a sign-in and the proving service's
 * response. `jwk_n` is the modulus of the JWK whose `kid` the JWT header
 * names, and `extra_field` as for [`prover_request`]. Refuses a proof for
 * other public inputs than this sign-in's.
 */
export function assembleSignature(jwt: string, session: string, pepper: string, exp_horizon_secs: bigint, jwk_n: string, extra_field: string, prover_response: string): string;
/**
 * The address a keyless signature's account has.
 */
export function signatureAddress(signature: string): string;
/**
 * An unsigned transfer on the chain `chain_id` (the node's
 * `transaction_chain_id`), as JSON, metered to exactly the gas it uses.
 * Amounts and prices are decimal strings; `max_fee_per_gas` and `tip` are in
 * `PRICE_SCALE`ths of the fee asset's smallest unit.
 */
export function buildTransfer(chain_id: bigint, sender: string, nonce: bigint, to: string, asset: number, amount_units: string, fee_asset: number, fee_rate: string, fee_intrinsic_gas: bigint, max_fee_per_gas: string, tip: string): string;
/**
 * An unsigned transaction carrying any payload, given as the node's JSON for
 * it (`{"kind":"register_attestation",...}`); otherwise as
 * [`build_transfer`].
 */
export function buildTransaction(chain_id: bigint, sender: string, nonce: bigint, payload: string, fee_asset: number, fee_rate: string, fee_intrinsic_gas: bigint, max_fee_per_gas: string, tip: string): string;
/**
 * The hashed identifier for `raw` of type `identifier_type` — a Celo prefix
 * such as `tel`, `mailto`, `twit` or `github`, or any other an issuer uses —
 * under the network salt (the node's `network_salt`, hex). The plain text is
 * normalised first and never leaves the caller.
 */
export function hashIdentifier(identifier_type: string, raw: string, salt_hex: string): string;
/**
 * An issuer's signature, hex, attesting that `identifier` belongs to
 * `account` on the chain `chain_id`.
 */
export function signAttestation(issuer_secret: string, chain_id: bigint, identifier_hex: string, account: string, issued_on: bigint): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly assembleSignature: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number, number];
  readonly buildTransaction: (a: bigint, b: number, c: number, d: bigint, e: number, f: number, g: number, h: number, i: number, j: bigint, k: number, l: number, m: number, n: number) => [number, number, number, number];
  readonly buildTransfer: (a: bigint, b: number, c: number, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: bigint, n: number, o: number, p: number, q: number) => [number, number, number, number];
  readonly decodeJwt: (a: number, b: number) => [number, number, number, number];
  readonly ed25519Address: (a: number, b: number) => [number, number, number, number];
  readonly hashIdentifier: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly keylessAddress: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly newSession: (a: bigint, b: number, c: number) => [number, number, number, number];
  readonly oauthNonce: (a: number, b: number, c: bigint, d: number, e: number) => [number, number, number, number];
  readonly parsePepper: (a: number, b: number) => [number, number, number, number];
  readonly pepperRequest: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly proverRequest: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint, h: number, i: number) => [number, number, number, number];
  readonly signAttestation: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number, h: bigint) => [number, number, number, number];
  readonly signEd25519: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly signKeyless: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly signWithSession: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly signatureAddress: (a: number, b: number) => [number, number, number, number];
  readonly submitRequest: (a: number, b: number) => [number, number, number, number];
  readonly transactionHash: (a: number, b: number) => [number, number, number, number];
  readonly verifyEd25519: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
