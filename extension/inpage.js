// window.sena: what a web page uses to ask the SENA extension for an address
// or a payment. Every request that matters opens a SENA window for the user.
//
//   const [address] = await window.sena.request({ method: 'sena_requestAccounts' });
//   const { hash } = await window.sena.request({
//     method: 'sena_sendTransfer',
//     params: { to: 'bob@gmail.com', asset: 1, amount: '2500000' },   // 2.50 USDC
//   });
(() => {
  if (window.sena) return;
  let next = 0;
  const waiting = new Map();
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.target !== 'sena-inpage') return;
    const w = waiting.get(event.data.id);
    if (!w) return;
    waiting.delete(event.data.id);
    if (event.data.error) w.reject(new Error(event.data.error));
    else w.resolve(event.data.result);
  });
  const request = ({ method, params } = {}) =>
    new Promise((resolve, reject) => {
      const id = `${Date.now()}-${next++}`;
      waiting.set(id, { resolve, reject });
      window.postMessage({ target: 'sena-content', id, method, params }, window.location.origin);
    });
  Object.defineProperty(window, 'sena', {
    value: Object.freeze({ isSena: true, version: 1, request }),
    writable: false,
  });
  window.dispatchEvent(new Event('sena#initialized'));
})();
