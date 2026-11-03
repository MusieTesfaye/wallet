// Relays window.sena requests from the page (inpage.js) to the extension, and
// the answers back. Runs in the extension's isolated world.
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.target !== 'sena-content') return;
  const { id, method, params } = event.data;
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'sena:dapp', method, params });
  } catch (e) {
    reply = { error: e?.message ?? String(e) };
  }
  window.postMessage({ target: 'sena-inpage', id, ...(reply ?? { error: 'no answer from SENA' }) }, window.location.origin);
});
