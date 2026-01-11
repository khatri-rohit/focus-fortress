import browser from "./lib/api";

const WS_URL = "ws://127.0.0.1:9876";
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
const UPDATE_DEBOUNCE_MS = 200;

let ws: WebSocket | null = null;
let wsConnected = false;
let focusMode = false;
let manualOverride: boolean | null = null;
let blockedSites: string[] = [];

let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer: number | null = null;
let updateDebounceTimer: number | null = null;

// ---------------- helpers ----------------
function normalizeHost(input: string | undefined | null): string | null {
  if (!input) return null;
  const s = input.trim();
  try {
    const u = s.includes("://") ? new URL(s) : new URL("http://" + s);
    return u.hostname.toLowerCase();
  } catch {
    if (/^[\w.-]+$/.test(s)) return s.toLowerCase();
    return null;
  }
}

async function loadBlockedSites() {
  const res = await browser.storage.local.get({ blockedSites: [] });
  blockedSites = Array.isArray(res.blockedSites) ? res.blockedSites : [];
}

async function persistBlockedSites() {
  await browser.storage.local.set({ blockedSites });
}

function isUrlBlocked(url: string | undefined | null) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return blockedSites.some(
      (b) => hostname === b || hostname.endsWith("." + b)
    );
  } catch {
    return false;
  }
}

// ---------------- messaging -> content ----------------
function triggerUpdateAllTabs() {
  if (updateDebounceTimer !== null) clearTimeout(updateDebounceTimer);
  updateDebounceTimer = setTimeout(
    updateAllTabs,
    UPDATE_DEBOUNCE_MS
  ) as unknown as number;
}

async function updateAllTabs() {
  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs.map(async (tab: any) => {
        if (!tab.id || !tab.url) return;
        const shouldBlock = isUrlBlocked(tab.url) && focusMode;
        try {
          await browser.tabs.sendMessage(tab.id, { focus: shouldBlock });
        } catch {
          // ignore: content script absent or permission denied
        }
      })
    );
  } catch {
    // ignore
  }
}

// ---------------- WebSocket ----------------
function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    connectWebSocket();
  }, reconnectDelay) as unknown as number;
}

function connectWebSocket() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  )
    return;

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    wsConnected = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    reconnectDelay = RECONNECT_BASE_MS;
    try {
      ws!.send(JSON.stringify({ type: "request_status" }));
    } catch {}
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as any;
      if (
        data.type === "status" ||
        data.type === "focus" ||
        data.type === "state"
      ) {
        if (manualOverride === null) {
          focusMode = !!data.active;
          triggerUpdateAllTabs();
        }
      }
    } catch {
      // ignore bad payload
    }
  };

  ws.onclose = () => {
    wsConnected = false;
    if (manualOverride === null) {
      focusMode = false;
      triggerUpdateAllTabs();
    }
    scheduleReconnect();
  };

  ws.onerror = () => {
    try {
      ws!.close();
    } catch {}
  };
}

// ---------------- message API ----------------
browser.runtime.onMessage.addListener((msg: any, sender: any) => {
  if (msg?.cmd === "popupRequestStatus") {
    return Promise.resolve({ wsConnected, focusMode, blockedSites });
  }

  if (msg?.cmd === "addBlockedSite") {
    const host = normalizeHost(msg.site);
    if (!host) return Promise.resolve({ ok: false, reason: "invalid" });
    if (!blockedSites.includes(host)) {
      blockedSites.push(host);
      persistBlockedSites();
      triggerUpdateAllTabs();
      return Promise.resolve({ ok: true, host });
    }
    return Promise.resolve({ ok: false, reason: "exists" });
  }

  if (msg?.cmd === "removeBlockedSite") {
    const idx = blockedSites.indexOf(msg.host);
    if (idx >= 0) {
      blockedSites.splice(idx, 1);
      persistBlockedSites();
      triggerUpdateAllTabs();
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: false, reason: "notfound" });
  }

  if (msg?.cmd === "overrideFocus") {
    manualOverride = !!msg.focus;
    focusMode = !!msg.focus;
    triggerUpdateAllTabs();
    return Promise.resolve({ ok: true });
  }

  if (msg?.cmd === "clearOverride") {
    manualOverride = null;
    return Promise.resolve({ ok: true });
  }

  if (msg?.cmd === "requestStatus") {
    const tabUrl = sender?.tab?.url || null;
    const shouldBlock = !!(tabUrl && isUrlBlocked(tabUrl) && focusMode);
    return Promise.resolve({ focus: shouldBlock });
  }

  return false;
});

// ---------------- storage syncing ----------------
browser.storage.onChanged.addListener((changes: any, area: any) => {
  if (area !== "local") return;
  if (changes.blockedSites) {
    blockedSites = Array.isArray(changes.blockedSites.newValue)
      ? changes.blockedSites.newValue
      : [];
    triggerUpdateAllTabs();
  }
  if (changes.focusMode) {
    focusMode = !!changes.focusMode.newValue;
    triggerUpdateAllTabs();
  }
});

// ---------------- init ----------------
(async function init() {
  await loadBlockedSites();
  triggerUpdateAllTabs();
  connectWebSocket();
})();
