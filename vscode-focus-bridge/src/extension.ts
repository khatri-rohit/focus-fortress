import * as vscode from "vscode";
import { WebSocketServer, WebSocket } from "ws";

/**
 * FocusBridgeServer
 * - Manages the WebSocket server lifecycle (start/stop/restart).
 * - Sends heartbeat/status messages to connected clients.
 * - Tracks "active" state (user activity) and supports inactivity timeout.
 * - Provides programmatic control via commands.
 */
export class FocusBridgeServer {
  private server: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private isActive = false;
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private config: vscode.WorkspaceConfiguration;
  private port: number;
  private heartbeatIntervalSec: number;
  private inactivityTimeoutSec: number;
  private secretToken: string;
  private autoStart: boolean;

  constructor(private ctx: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.tooltip =
      "VS Code Focus Fortress — WebSocket server status";
    this.statusBarItem.show();

    this.config = vscode.workspace.getConfiguration("focusFortress");
    this.port = Number(this.config.get<number>("port", 9876));
    this.heartbeatIntervalSec = Number(
      this.config.get<number>("heartbeatIntervalSec", 10)
    );
    this.inactivityTimeoutSec = Number(
      this.config.get<number>("inactivityTimeoutSec", 120)
    );
    this.secretToken = String(this.config.get<string>("secretToken", "") || "");
    this.autoStart = Boolean(this.config.get<boolean>("autoStart", true));

    // Listen for config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("focusFortress")) {
          this.reloadConfig();
        }
      })
    );

    // Consider user activity events to keep server "active"
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.onUserActivity()),
      vscode.window.onDidChangeTextEditorSelection(() => this.onUserActivity()),
      vscode.workspace.onDidChangeTextDocument(() => this.onUserActivity()),
      vscode.window.onDidChangeWindowState((st) => {
        // window focus/unfocus = activity toggle
        if (st.focused) this.onUserActivity();
        else this.scheduleInactivityTimeout();
      })
    );

    this.updateStatusBar();
  }

  private reloadConfig() {
    this.config = vscode.workspace.getConfiguration("focusFortress");
    this.port = Number(this.config.get<number>("port", 9876));
    this.heartbeatIntervalSec = Number(
      this.config.get<number>("heartbeatIntervalSec", 10)
    );
    this.inactivityTimeoutSec = Number(
      this.config.get<number>("inactivityTimeoutSec", 120)
    );
    this.secretToken = String(this.config.get<string>("secretToken", "") || "");
    const newAutoStart = Boolean(this.config.get<boolean>("autoStart", true));
    // If autoStart preference changed
    if (newAutoStart !== this.autoStart) {
      this.autoStart = newAutoStart;
      if (this.autoStart && !this.server) this.start();
      if (!this.autoStart && this.server) this.stop();
    }
    // If server is running and port changed, restart automatically
    if (
      this.server &&
      this.port !== Number(this.config.get<number>("port", 9876))
    ) {
      this.restart();
    }
    this.updateStatusBar();
  }

  private updateStatusBar() {
    if (this.server) {
      this.statusBarItem.text = `$(plug) Focus Fortress: running (${this.port})`;
      this.statusBarItem.color = undefined;
    } else {
      this.statusBarItem.text = `$(debug-disconnect) Focus Fortress: stopped`;
      this.statusBarItem.color = new vscode.ThemeColor(
        "statusBarItem.warningForeground"
      );
    }
  }

  private onUserActivity() {
    // Reset inactivity timer and set active = true
    this.setActive(true);
    this.scheduleInactivityTimeout();
  }

  private scheduleInactivityTimeout() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.inactivityTimeoutSec <= 0) return;
    this.inactivityTimer = setTimeout(() => {
      this.setActive(false);
    }, this.inactivityTimeoutSec * 1000);
  }

  private setActive(val: boolean) {
    if (this.isActive === val) return;
    this.isActive = val;
    // Immediately broadcast new status to clients
    this.broadcast({ type: "status", active: this.isActive });
    // Update status bar
    this.updateStatusBar();
  }

  private broadcast(payload: any) {
    const str = JSON.stringify(payload);
    for (const c of this.clients) {
      try {
        if (c.readyState === WebSocket.OPEN) c.send(str);
      } catch {
        // ignore
      }
    }
  }

  private handleClientConnection(ws: WebSocket) {
    let authed = false;
    const tokenRequired = !!(this.secretToken && this.secretToken.length > 0);
    // First message could be an auth token
    const firstTimeout = setTimeout(() => {
      // if token required and client didn't auth — close
      if (tokenRequired && !authed) {
        try {
          ws.close();
        } catch {}
      }
    }, 4000);

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (
          !authed &&
          tokenRequired &&
          data?.type === "auth" &&
          data?.token === this.secretToken
        ) {
          authed = true;
          // send immediate status
          try {
            ws.send(JSON.stringify({ type: "status", active: this.isActive }));
          } catch {}
        } else if (!tokenRequired) {
          // send status if not token required and first message is request
          if (data?.type === "request_status") {
            try {
              ws.send(
                JSON.stringify({ type: "status", active: this.isActive })
              );
            } catch {}
          }
        } else if (authed) {
          // handle other messages as needed in future
        }
      } catch {
        // ignore malformed
      }
    });

    ws.on("close", () => {
      clearTimeout(firstTimeout);
      this.clients.delete(ws);
    });

    ws.on("error", () => {
      clearTimeout(firstTimeout);
      this.clients.delete(ws);
    });

    // Add to clients
    this.clients.add(ws);

    // Immediately send a status message (if allowed)
    if (!tokenRequired) {
      try {
        ws.send(JSON.stringify({ type: "status", active: this.isActive }));
      } catch {}
    }
  }

  public start(): boolean {
    if (this.server) {
      vscode.window.showInformationMessage(
        "VS Code Focus Fortress server is already running."
      );
      return false;
    }

    try {
      this.server = new WebSocketServer({ port: this.port });
      this.server.on("connection", (ws) => this.handleClientConnection(ws));
      this.server.on("listening", () => {
        this.updateStatusBar();
        vscode.window.showInformationMessage(
          "VS Code Focus Fortress WebSocket server started"
        );
      });
      this.server.on("error", (err) => {
        vscode.window.showErrorMessage(
          `VS Code Focus Fortress WebSocket error: ${err.message}`
        );
      });

      // start heartbeat timer
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.broadcast({ type: "heartbeat", active: this.isActive });
      }, Math.max(1000, this.heartbeatIntervalSec * 1000));

      // initial active state detection
      this.onUserActivity();
      this.updateStatusBar();
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to start VS Code Focus Fortress server: ${err?.message ?? err}`
      );
      this.stop(); // ensure clean
      return false;
    }
  }

  public stop() {
    // clear timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }

    // close clients
    for (const c of this.clients) {
      try {
        c.close();
      } catch {}
    }
    this.clients.clear();

    // close server
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }

    this.setActive(false);
    this.updateStatusBar();
    vscode.window.showInformationMessage(
      "VS Code Focus Fortress server stopped."
    );
  }

  public restart() {
    this.stop();
    // small delay to let socket close
    setTimeout(() => {
      this.start();
    }, 250);
  }

  public statusString(): string {
    return this.server ? `running (port ${this.port})` : "stopped";
  }

  public dispose() {
    this.stop();
    this.disposables.forEach((d) => d.dispose());
    try {
      this.statusBarItem.dispose();
    } catch {}
  }
}

// ---------------- extension activation ----------------

let bridge: FocusBridgeServer | null = null;

export function activate(context: vscode.ExtensionContext) {
  bridge = new FocusBridgeServer(context);

  // Register commands: start / stop / restart / status
  context.subscriptions.push(
    vscode.commands.registerCommand("focusFortress.start", () => {
      const ok = bridge?.start();
      if (ok)
        vscode.window.showInformationMessage("VS Code Focus Fortress started.");
    }),

    vscode.commands.registerCommand("focusFortress.stop", () => {
      bridge?.stop();
    }),

    vscode.commands.registerCommand("focusFortress.restart", () => {
      bridge?.restart();
      vscode.window.showInformationMessage("VS Code Focus Fortress restarted.");
    }),

    vscode.commands.registerCommand("focusFortress.status", () => {
      const s = bridge?.statusString() ?? "unknown";
      vscode.window.showInformationMessage(
        `VS Code Focus Fortress status: ${s}`
      );
    })
  );

  // Auto-start if config says so
  const cfg = vscode.workspace.getConfiguration("focusFortress");
  const autoStart = Boolean(cfg.get<boolean>("autoStart", true));
  if (autoStart) {
    // defer start slightly to allow other extensions to initialize
    setTimeout(() => {
      bridge?.start();
    }, 500);
  }

  context.subscriptions.push({
    dispose: () => {
      bridge?.dispose();
    },
  });
}

export function deactivate() {
  if (bridge) {
    bridge.dispose();
    bridge = null;
  }
}
