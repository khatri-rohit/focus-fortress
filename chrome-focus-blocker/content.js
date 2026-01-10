// content.js — idempotent content script that shows/removes a strict overlay
(function () {
  if (window.__FOCUS_BLOCKER_INIT__) return;
  window.__FOCUS_BLOCKER_INIT__ = true;

  if (!window.__FOCUS_BLOCKER_MODAL_ID) {
    window.__FOCUS_BLOCKER_MODAL_ID = "__focus_blocker_modal__";
  }
  const MODAL_ID = window.__FOCUS_BLOCKER_MODAL_ID;

  function createModal() {
    if (document.getElementById(MODAL_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0,0,0,0.92)",
      color: "#ffffff",
      zIndex: 2147483647,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      pointerEvents: "auto",
      userSelect: "none",
    });

    const card = document.createElement("div");
    card.style.maxWidth = "760px";
    card.style.padding = "28px";
    card.style.borderRadius = "12px";
    card.style.backdropFilter = "blur(4px)";
    card.style.boxShadow = "0 10px 40px rgba(0,0,0,0.6)";
    card.style.fontFamily =
      "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial";
    card.innerHTML = `
      <div style="font-weight:700; font-size:28px; margin-bottom:8px;">You're currently working</div>
      <div style="opacity:0.95; font-size:16px;">Don't get distracted — focus on your coding session in VS Code.</div>
    `;

    overlay.appendChild(card);

    // Prevent pointer events from reaching the page and stop keyboard propagation
    ["click", "mousedown", "mouseup", "touchstart"].forEach((ev) =>
      overlay.addEventListener(ev, (e) => e.stopPropagation(), true)
    );
    ["keydown", "keypress", "keyup"].forEach((ev) =>
      overlay.addEventListener(
        ev,
        (e) => {
          e.stopPropagation();
          e.preventDefault();
        },
        true
      )
    );

    // Add to DOM
    try {
      document.documentElement.appendChild(overlay);
      overlay.tabIndex = -1;
      overlay.focus({ preventScroll: true });
    } catch (err) {
      // DOM insertion may fail on some pages — ignore.
      console.warn("FocusBlocker: failed to inject overlay", err);
    }
  }

  function removeModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.focus === true) {
      createModal();
    } else if (msg?.focus === false) {
      removeModal();
    } else if (msg?.cmd === "requestStatus") {
      sendResponse({ active: !!document.getElementById(MODAL_ID) });
    }
    // no async response
  });

  // Ask background for initial status and create modal if needed.
  try {
    chrome.runtime.sendMessage({ cmd: "requestStatus" }, (resp) => {
      if (resp && resp.focus) createModal();
    });
  } catch (e) {
    // Ignore
  }
})();
