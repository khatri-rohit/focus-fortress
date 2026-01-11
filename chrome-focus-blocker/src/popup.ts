// popup.ts
import browser from "./lib/api";

const siteInput = document.getElementById("siteInput") as HTMLInputElement;
const addBtn = document.getElementById("addBtn") as HTMLButtonElement;
const addCurrentBtn = document.getElementById(
  "addCurrentBtn"
) as HTMLButtonElement;
const wsStatusEl = document.getElementById("wsStatus")!;
const focusStatusEl = document.getElementById("focusStatus")!;
const blockedListEl = document.getElementById("blockedList")!;

function showMsg(text: string, ms = 2500) {
  const el = document.getElementById("popupMsg")!;
  el.textContent = text;
  setTimeout(() => (el.textContent = ""), ms);
}

async function loadAndRender() {
  try {
    const res: any = await browser.runtime.sendMessage({
      cmd: "popupRequestStatus",
    });
    wsStatusEl.textContent = res.wsConnected ? "Connected" : "Disconnected";
    focusStatusEl.textContent = res.focusMode ? "ON" : "OFF";
    renderBlockedList(res.blockedSites || []);
  } catch {
    wsStatusEl.textContent = "Error";
    focusStatusEl.textContent = "—";
  }
}

function renderBlockedList(sites: string[]) {
  blockedListEl.innerHTML = "";
  if (!sites || sites.length === 0) {
    blockedListEl.textContent = "No blocked sites.";
    return;
  }
  sites.forEach((host: string) => {
    const item = document.createElement("div");
    item.className = "list-item";
    const name = document.createElement("div");
    name.className = "site-name";
    name.textContent = host;
    const del = document.createElement("button");
    del.className = "del-btn";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      const res: any = await browser.runtime.sendMessage({
        cmd: "removeBlockedSite",
        host,
      });
      if (res?.ok) {
        showMsg("Removed " + host);
        loadAndRender();
      } else showMsg("Could not remove");
    });
    item.appendChild(name);
    item.appendChild(del);
    blockedListEl.appendChild(item);
  });
}

addBtn.addEventListener("click", async () => {
  const val = (siteInput.value || "").trim();
  if (!val) {
    showMsg("Enter a hostname or URL");
    return;
  }
  const host = normalizeHost(val);
  if (!host) {
    showMsg("Invalid host");
    return;
  }

  // request permission for host before adding
  const origin = `https://${host}/*`;
  try {
    const granted = await browser.permissions.request({ origins: [origin] });
    if (!granted) {
      showMsg("Permission denied");
      return;
    }
  } catch {
    // fallback: proceed, user may have already granted
  }

  const res: any = await browser.runtime.sendMessage({
    cmd: "addBlockedSite",
    site: host,
  });
  if (res?.ok) {
    siteInput.value = "";
    showMsg("Added " + res.host);
    loadAndRender();
  } else if (res?.reason === "exists") showMsg("Already blocked");
  else showMsg("Failed to add");
});

addCurrentBtn.addEventListener("click", async () => {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tabs || !tabs[0] || !tabs[0].url) {
      showMsg("No active tab");
      return;
    }
    try {
      const u = new URL(tabs[0].url);
      siteInput.value = u.hostname;
    } catch {
      siteInput.value = tabs[0].url || "";
    }
  } catch {
    showMsg("Error getting tab");
  }
});

function normalizeHost(input: string) {
  try {
    const u = input.includes("://")
      ? new URL(input)
      : new URL("http://" + input);
    return u.hostname;
  } catch {
    if (/^[\w.-]+$/.test(input)) return input;
    return null;
  }
}

// initialize
document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
});
