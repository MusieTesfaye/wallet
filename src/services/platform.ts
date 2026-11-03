// Where the wallet is running: a web page, or the SENA browser extension.
//
// A web page signs in by redirecting to Google and back. An extension's popup
// cannot: it closes the moment another window takes focus. So in the
// extension, redirect flows (Google sign-in, linking an identity through an
// issuer) run in the background service worker through
// chrome.identity.launchWebAuthFlow, which ends at the extension's own
// https://<id>.chromiumapp.org/ address. The worker keeps the result in
// storage, so a popup that closed meanwhile picks it up when it reopens.

declare const chrome: any;

export const isExtension = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome.runtime?.id && location.protocol === 'chrome-extension:';

/** Where a redirect flow returns to. `path` distinguishes the flows. */
export function returnUrl(path = ''): string {
  if (isExtension()) return chrome.identity.getRedirectURL(path);
  return window.location.origin + '/';
}

export type FlowKind = 'google' | 'attestation';

export interface FlowResult {
  kind: FlowKind;
  /** The URL the flow ended at; its fragment carries the result. */
  url?: string;
  error?: string;
}

/** Runs a redirect flow in the extension's worker; resolves with where it ended. */
export async function runFlow(kind: FlowKind, url: string): Promise<FlowResult> {
  const r: FlowResult = await chrome.runtime.sendMessage({ type: 'sena:flow', kind, url });
  await chrome.storage.local.remove('sena.flowResult');
  return r;
}

/** A flow result the worker kept because the popup closed before it ended. */
export async function takeStoredFlow(): Promise<FlowResult | null> {
  if (!isExtension()) return null;
  const { ['sena.flowResult']: r } = await chrome.storage.local.get('sena.flowResult');
  if (r) await chrome.storage.local.remove('sena.flowResult');
  return r ?? null;
}

/** The fragment parameters of a URL. */
export const fragment = (url: string) => new URLSearchParams(new URL(url).hash.slice(1));
