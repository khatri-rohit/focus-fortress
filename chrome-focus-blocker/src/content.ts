// content.ts
import browser from "./lib/api";

if ((window as any).__FOCUS_BLOCKER_INIT__) {
  // already initialized
} else {
  (window as any).__FOCUS_BLOCKER_INIT__ = true;

  const MODAL_ID = "__focus_blocker_modal__";

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
      color: "#fff",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      pointerEvents: "auto",
      userSelect: "none",
    } as Partial<CSSStyleDeclaration>);

    const card = document.createElement("div");
    card.style.maxWidth = "760px";
    card.style.padding = "28px";
    card.style.borderRadius = "12px";
    card.style.backdropFilter = "blur(4px)";
    card.style.boxShadow = "0 10px 40px rgba(0,0,0,0.6)";
    card.style.fontFamily =
      "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial";
    card.innerHTML = `
      <div style="font-weight:700; font-size:28px; margin-bottom:8px;">You're currently working</div>
      <div style="opacity:0.95; font-size:16px;">Don't get distracted — focus on your coding session in VS Code.</div>
    `;

    overlay.appendChild(card);

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

    try {
      document.documentElement.appendChild(overlay);
      (overlay as HTMLElement).tabIndex = -1;
      (overlay as HTMLElement).focus();
    } catch (e) {
      // ignore
    }
  }

  function removeModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }

  browser.runtime.onMessage.addListener((msg: any) => {
    if (msg?.focus === true) createModal();
    else if (msg?.focus === false) removeModal();
    else if (msg?.cmd === "requestStatus") {
      return Promise.resolve({ active: !!document.getElementById(MODAL_ID) });
    }
    return null;
  });

  // ask initial status for this tab
  try {
    browser.runtime
      .sendMessage({ cmd: "requestStatus" })
      .then((resp: any) => {
        if (resp && resp.focus) createModal();
      })
      .catch(() => {});
  } catch (e) {}
}
