// The SENA extension's service worker.
//
//  * Redirect flows (Google sign-in, linking an identity through an issuer)
//    run here, in chrome.identity.launchWebAuthFlow: the popup that starts
//    one closes as soon as the sign-in window takes focus. The result is kept
//    in storage for the popup to pick up when it reopens.
//  * Websites talk to the wallet through window.sena (inpage.js), relayed by
//    content.js. Connecting, and every payment, opens an approval window; a
//    site sees an address only once its user has approved it.

const CONNECTED = 'sena.connected'; // origin -> address
const approvals = new Map(); // id -> { request, resolve, windowId }

async function flow({ kind, url }) {
  let result;
  try {
    result = { kind, url: await chrome.identity.launchWebAuthFlow({ url, interactive: true }) };
  } catch (e) {
    result = { kind, error: e?.message ?? String(e) };
  }
  await chrome.storage.local.set({ 'sena.flowResult': result });
  return result;
}

async function connected() {
  return (await chrome.storage.local.get(CONNECTED))[CONNECTED] ?? {};
}

/** Opens an approval window and resolves with what the user decides there. */
function approve(request) {
  return new Promise(async (resolve, reject) => {
    const id = crypto.randomUUID();
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(`index.html#/approve?id=${id}`),
      type: 'popup',
      width: 400,
      height: 640,
      focused: true,
    });
    approvals.set(id, { request, resolve, reject, windowId: win.id });
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, a] of approvals) {
    if (a.windowId === windowId) {
      approvals.delete(id);
      a.reject(new Error('The user closed the SENA window without approving.'));
    }
  }
});

async function dapp({ method, params }, origin) {
  if (!origin || !/^https?:\/\//.test(origin)) throw new Error('SENA answers web pages only');
  const sites = await connected();
  switch (method) {
    case 'sena_accounts':
      return sites[origin] ? [sites[origin]] : [];
    case 'sena_requestAccounts': {
      if (sites[origin]) return [sites[origin]];
      const { address } = await approve({ type: 'connect', origin });
      await chrome.storage.local.set({ [CONNECTED]: { ...(await connected()), [origin]: address } });
      return [address];
    }
    case 'sena_disconnect': {
      const rest = await connected();
      delete rest[origin];
      await chrome.storage.local.set({ [CONNECTED]: rest });
      return true;
    }
    case 'sena_sendTransfer': {
      if (!sites[origin]) throw new Error('Connect first: call sena_requestAccounts');
      const { to, asset, amount } = params ?? {};
      if (typeof to !== 'string' || !Number.isInteger(asset) || !/^\d+$/.test(String(amount))) {
        throw new Error('sena_sendTransfer needs { to: address or identifier, asset: number, amount: "units" }');
      }
      return approve({ type: 'transfer', origin, from: sites[origin], to, asset, amount: String(amount) });
    }
    default:
      throw new Error(`unknown method ${method}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only the extension's own pages may run flows or settle approvals.
  const own = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (msg?.type === 'sena:flow' && own) {
    flow(msg).then(reply);
    return true;
  }
  if (msg?.type === 'sena:approval:get' && own) {
    reply(approvals.get(msg.id)?.request ?? null);
    return false;
  }
  if (msg?.type === 'sena:approval:settle' && own) {
    const a = approvals.get(msg.id);
    if (a) {
      approvals.delete(msg.id);
      msg.error ? a.reject(new Error(msg.error)) : a.resolve(msg.result);
      chrome.windows.remove(a.windowId).catch(() => {});
    }
    reply(true);
    return false;
  }
  if (msg?.type === 'sena:dapp' && sender.tab) {
    dapp(msg, sender.origin).then(
      (result) => reply({ result }),
      (e) => reply({ error: e?.message ?? String(e) }),
    );
    return true;
  }
  return false;
});
