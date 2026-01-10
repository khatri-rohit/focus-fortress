// popup.js — manages UI, queries background/storage, and sends add/remove messages

const siteInput = document.getElementById("siteInput");
const addBtn = document.getElementById("addBtn");
const addCurrentBtn = document.getElementById("addCurrentBtn");
const addMsg = document.getElementById("addMsg");
const wsStatusEl = document.getElementById("wsStatus");
const focusStatusEl = document.getElementById("focusStatus");
const blockedListEl = document.getElementById("blockedList");

let restoreTimer = null; // for messages

// Utility: render blocked sites list
function renderBlockedList(sites) {
  blockedListEl.innerHTML = "";
  if (!sites || sites.length === 0) {
    blockedListEl.textContent = "No blocked sites.";
    return;
  }
  sites.forEach((host) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const name = document.createElement("div");
    name.className = "site-name";
    name.textContent = host;

    const del = document.createElement("button");
    del.className = "del-btn";
    del.textContent = "Remove";
    del.addEventListener("click", () => {
      chrome.runtime.sendMessage({ cmd: "removeBlockedSite", host }, (res) => {
        if (res?.ok) {
          loadAndRender();
          showMessage("Removed " + host, 2000);
        } else {
          showMessage("Could not remove", 2000);
        }
      });
    });

    item.appendChild(name);
    item.appendChild(del);
    blockedListEl.appendChild(item);
  });
}

// Load data from background (or storage) and update UI
function loadAndRender() {
  chrome.runtime.sendMessage({ cmd: "popupRequestStatus" }, (res) => {
    if (!res) return;
    wsStatusEl.textContent = res.wsConnected ? "Connected" : "Disconnected";
    focusStatusEl.textContent = res.focusMode ? "ON" : "OFF";
    renderBlockedList(res.blockedSites || []);
  });
}

// Show temporary message under input
function showMessage(text, ms = 2500) {
  addMsg.textContent = text;
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    addMsg.textContent = "";
  }, ms);
}

// Add handler
addBtn.addEventListener("click", () => {
  const val = siteInput.value.trim();
  if (!val) {
    showMessage("Enter a hostname or URL (e.g. facebook.com).");
    return;
  }
  chrome.runtime.sendMessage({ cmd: "addBlockedSite", site: val }, (res) => {
    if (!res) {
      showMessage("Failed to talk to extension.");
      return;
    }
    if (res.ok) {
      showMessage(`Added ${res.host}`, 2000);
      siteInput.value = "";
      loadAndRender();
    } else if (res.reason === "exists") {
      showMessage("Already blocked.");
    } else {
      showMessage("Invalid site.");
    }
  });
});

// "Add Current" fills input with active tab URL and adds it.
addCurrentBtn.addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0] || !tabs[0].url) {
      showMessage("No active tab URL available.");
      return;
    }
    const url = tabs[0].url;
    siteInput.value = url;
    // optional: auto click add
    addBtn.click();
  } catch (e) {
    showMessage("Error reading tab.");
  }
});

// initialize: prefill input with current tab hostname if possible, and render list
(async function init() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].url) {
      // try to set hostname only to keep input tidy
      try {
        const u = new URL(tabs[0].url);
        siteInput.value = u.hostname;
      } catch (_) {
        siteInput.value = tabs[0].url;
      }
    }
  } catch (err) {
    // ignore
  }
  loadAndRender();
})();
