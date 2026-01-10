// background.js (Manifest V3 service worker)
// Production-grade background handling:
// - persistent blockedSites in chrome.storage.local
// - WebSocket connection to VS Code local server
// - manual override support (from popup)
// - safe updateAllTabs with runtime.lastError handling
// - storage.onChanged sync

let focusMode = false;
let ws = null;
let wsConnected = false;
let manualOverride = null; // boolean or null
let blockedSites = []; // array of host strings, e.g. "facebook.com"

// ---------- Utility: normalize a user-provided URL or hostname ----------
function normalizeToHostname(input) {
  if (!input || typeof input !== "string") return null;
  input = input.trim();
  // allow "facebook.com" or "https://facebook.com/path"
  try {
    // If input doesn't contain protocol, URL will throw, so add http://
    const u = input.includes("://")
      ? new URL(input)
      : new URL("http://" + input);
    return u.hostname.toLowerCase();
  } catch (e) {
    // fallback: return the raw input if it looks like a domain (no spaces)
    if (/^[\w.-]+$/.test(input)) return input.toLowerCase();
    return null;
  }
}

// ---------- Storage helpers ----------
function loadBlockedSitesFromStorage() {
  chrome.storage.local.get({ blockedSites: [] }, (res) => {
    blockedSites = Array.isArray(res.blockedSites) ? res.blockedSites : [];
  });
}

function persistBlockedSites() {
  chrome.storage.local.set({ blockedSites });
}

// Add a site (normalized). Returns { ok: boolean, reason? }
function addBlockedSiteRaw(site) {
  const host = normalizeToHostname(site);
  if (!host) return { ok: false, reason: "invalid" };
  if (blockedSites.includes(host)) return { ok: false, reason: "exists" };
  blockedSites.push(host);
  persistBlockedSites();
  updateAllTabs();
  return { ok: true, host };
}

function removeBlockedSiteRaw(host) {
  const idx = blockedSites.indexOf(host);
  if (idx === -1) return { ok: false, reason: "notfound" };
  blockedSites.splice(idx, 1);
  persistBlockedSites();
  updateAllTabs();
  return { ok: true, host };
}

// ---------- Matching ----------
function isUrlBlocked(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    return blockedSites.some((blocked) => {
      // if blocked is an exact host pattern e.g. "facebook.com"
      // match subdomains: "m.facebook.com", "www.facebook.com"
      return (
        hostname === blocked ||
        hostname.endsWith("." + blocked) ||
        hostname.endsWith(blocked)
      );
    });
  } catch (e) {
    // not a valid URL (chrome internal pages), treat as not blocked
    return false;
  }
}

// ---------- WebSocket connection to VS Code server ----------
function connectWebSocket() {
  // avoid multiple connections
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  )
    return;

  try {
    ws = new WebSocket("ws://127.0.0.1:9876");
  } catch (err) {
    // Possibly in environments that block ws constructor calls
    wsConnected = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    console.log("[FocusBlocker] WS connected");
    try {
      ws.send(JSON.stringify({ type: "request_status" }));
    } catch (e) {}
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "status") {
        if (manualOverride === null) {
          focusMode = !!data.active;
          updateAllTabs();
        }
      } else if (data.type === "heartbeat") {
        // optional keepalive; could be used to mark wsConnected
      }
    } catch (err) {
      console.warn("[FocusBlocker] WS parse error", err);
    }
  };

  ws.onclose = () => {
    wsConnected = false;
    console.warn("[FocusBlocker] WS disconnected");
    if (manualOverride === null) {
      focusMode = false;
      updateAllTabs();
    }
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.warn("[FocusBlocker] WS error", err);
    try {
      ws.close();
    } catch (e) {}
  };

  function scheduleReconnect() {
    // backoff logic could be improved; use 3s for now
    setTimeout(connectWebSocket, 3000);
  }
}

// start WS on service worker start
connectWebSocket();

// ---------- Update tabs: send message to content scripts ----------
function updateAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      const shouldBlock = isUrlBlocked(tab.url) && focusMode;
      chrome.tabs.sendMessage(tab.id, { focus: shouldBlock }, (response) => {
        if (chrome.runtime.lastError) {
          // Likely reasons:
          // - content script nondeterministically not injected for this host (permission)
          // - page is a Chrome internal page (chrome://), or extension can't access it
          // We silently ignore; you can log during development.
          // console.debug("sendMessage error:", chrome.runtime.lastError.message, "tabId:", tab.id, "url:", tab.url);
        } else {
          // optional: handle response
        }
      });
    }
  });
}

// ---------- Storage change listener (in case popup updates storage directly) ----------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blockedSites) {
    blockedSites = Array.isArray(changes.blockedSites.newValue)
      ? changes.blockedSites.newValue
      : [];
    updateAllTabs();
  }
});

// ---------- Message listener API for popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.cmd === "popupRequestStatus") {
    sendResponse({ wsConnected, focusMode, blockedSites });
    return; // synchronous response
  }

  if (msg?.cmd === "addBlockedSite") {
    const result = addBlockedSiteRaw(msg.site);
    sendResponse(result);
    return;
  }

  if (msg?.cmd === "removeBlockedSite") {
    const result = removeBlockedSiteRaw(msg.host);
    sendResponse(result);
    return;
  }

  if (msg?.cmd === "overrideFocus") {
    manualOverride = msg.focus;
    focusMode = !!msg.focus;
    updateAllTabs();
    sendResponse({ ok: true });
    return;
  }

  if (msg?.cmd === "clearOverride") {
    manualOverride = null;
    sendResponse({ ok: true });
    return;
  }

  if (msg?.cmd === "requestStatus") {
    sendResponse({ focus: focusMode });
    return;
  }
});

// ---------- Initialization ----------
loadBlockedSitesFromStorage();
// ensure update of tabs after a small delay once service worker started and blockedSites loaded
setTimeout(updateAllTabs, 1000);
