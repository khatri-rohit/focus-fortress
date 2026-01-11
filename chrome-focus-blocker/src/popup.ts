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
    // console.log(res);
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

    try {
      // Query active tabs in all windows to find pages matching this host
      const allTabs = await browser.tabs.query({});
      const matching = allTabs.filter((t) => {
        try {
          if (!t.url) return false;
          const u = new URL(t.url);
          // match exact host or subdomain -> same logic as background's isUrlBlocked
          return u.hostname === res.host || u.hostname.endsWith("." + res.host);
        } catch {
          return false;
        }
      });

      if (matching.length > 0) {
        const promptText =
          matching.length === 1
            ? `You have 1 open tab for this site. Reload it now to apply the block immediately?`
            : `You have ${matching.length} open tabs for this site. Reload them now to apply the block immediately?`;

        if (confirm(promptText)) {
          await Promise.all(
            matching.map((t) => {
              try {
                return browser.tabs.reload(t.id as number);
              } catch {
                return Promise.resolve();
              }
            })
          );
          showMsg(
            `Reloaded ${matching.length} tab${matching.length > 1 ? "s" : ""}`
          );
        } else {
          showMsg(`Added. Reload tabs later to apply changes.`);
        }
      } else {
        showMsg("Added. No open tabs for that host.");
      }
    } catch (err) {
      showMsg("Added. (Could not check open tabs)");
    }

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
