"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FocusBridgeServer = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ws_1 = require("ws");
/**
 * FocusBridgeServer
 * - Manages the WebSocket server lifecycle (start/stop/restart).
 * - Sends heartbeat/status messages to connected clients.
 * - Tracks "active" state (user activity) and supports inactivity timeout.
 * - Provides programmatic control via commands.
 */
class FocusBridgeServer {
    constructor(ctx) {
        this.ctx = ctx;
        this.server = null;
        this.clients = new Set();
        this.heartbeatTimer = null;
        this.inactivityTimer = null;
        this.isActive = false;
        this.disposables = [];
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.tooltip =
            "VS Code Focus Fortress — WebSocket server status";
        this.statusBarItem.show();
        this.config = vscode.workspace.getConfiguration("focusFortress");
        this.port = Number(this.config.get("port", 9876));
        this.heartbeatIntervalSec = Number(this.config.get("heartbeatIntervalSec", 10));
        this.inactivityTimeoutSec = Number(this.config.get("inactivityTimeoutSec", 120));
        this.secretToken = String(this.config.get("secretToken", "") || "");
        this.autoStart = Boolean(this.config.get("autoStart", true));
        // Listen for config changes
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("focusFortress")) {
                this.reloadConfig();
            }
        }));
        // Consider user activity events to keep server "active"
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.onUserActivity()), vscode.window.onDidChangeTextEditorSelection(() => this.onUserActivity()), vscode.workspace.onDidChangeTextDocument(() => this.onUserActivity()), vscode.window.onDidChangeWindowState((st) => {
            // window focus/unfocus = activity toggle
            if (st.focused)
                this.onUserActivity();
            else
                this.scheduleInactivityTimeout();
        }));
        this.updateStatusBar();
    }
    reloadConfig() {
        this.config = vscode.workspace.getConfiguration("focusFortress");
        this.port = Number(this.config.get("port", 9876));
        this.heartbeatIntervalSec = Number(this.config.get("heartbeatIntervalSec", 10));
        this.inactivityTimeoutSec = Number(this.config.get("inactivityTimeoutSec", 120));
        this.secretToken = String(this.config.get("secretToken", "") || "");
        const newAutoStart = Boolean(this.config.get("autoStart", true));
        // If autoStart preference changed
        if (newAutoStart !== this.autoStart) {
            this.autoStart = newAutoStart;
            if (this.autoStart && !this.server)
                this.start();
            if (!this.autoStart && this.server)
                this.stop();
        }
        // If server is running and port changed, restart automatically
        if (this.server &&
            this.port !== Number(this.config.get("port", 9876))) {
            this.restart();
        }
        this.updateStatusBar();
    }
    updateStatusBar() {
        if (this.server) {
            this.statusBarItem.text = `$(plug) Focus Fortress: running (${this.port})`;
            this.statusBarItem.color = undefined;
        }
        else {
            this.statusBarItem.text = `$(debug-disconnect) Focus Fortress: stopped`;
            this.statusBarItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
        }
    }
    onUserActivity() {
        // Reset inactivity timer and set active = true
        this.setActive(true);
        this.scheduleInactivityTimeout();
    }
    scheduleInactivityTimeout() {
        if (this.inactivityTimer)
            clearTimeout(this.inactivityTimer);
        if (this.inactivityTimeoutSec <= 0)
            return;
        this.inactivityTimer = setTimeout(() => {
            this.setActive(false);
        }, this.inactivityTimeoutSec * 1000);
    }
    setActive(val) {
        if (this.isActive === val)
            return;
        this.isActive = val;
        // Immediately broadcast new status to clients
        this.broadcast({ type: "status", active: this.isActive });
        // Update status bar
        this.updateStatusBar();
    }
    broadcast(payload) {
        const str = JSON.stringify(payload);
        for (const c of this.clients) {
            try {
                if (c.readyState === ws_1.WebSocket.OPEN)
                    c.send(str);
            }
            catch {
                // ignore
            }
        }
    }
    handleClientConnection(ws) {
        let authed = false;
        const tokenRequired = !!(this.secretToken && this.secretToken.length > 0);
        // First message could be an auth token
        const firstTimeout = setTimeout(() => {
            // if token required and client didn't auth — close
            if (tokenRequired && !authed) {
                try {
                    ws.close();
                }
                catch { }
            }
        }, 4000);
        ws.on("message", (raw) => {
            try {
                const data = JSON.parse(String(raw));
                if (!authed &&
                    tokenRequired &&
                    (data === null || data === void 0 ? void 0 : data.type) === "auth" &&
                    (data === null || data === void 0 ? void 0 : data.token) === this.secretToken) {
                    authed = true;
                    // send immediate status
                    try {
                        ws.send(JSON.stringify({ type: "status", active: this.isActive }));
                    }
                    catch { }
                }
                else if (!tokenRequired) {
                    // send status if not token required and first message is request
                    if ((data === null || data === void 0 ? void 0 : data.type) === "request_status") {
                        try {
                            ws.send(JSON.stringify({ type: "status", active: this.isActive }));
                        }
                        catch { }
                    }
                }
                else if (authed) {
                    // handle other messages as needed in future
                }
            }
            catch {
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
            }
            catch { }
        }
    }
    start() {
        var _a;
        if (this.server) {
            vscode.window.showInformationMessage("VS Code Focus Fortress server is already running.");
            return false;
        }
        try {
            this.server = new ws_1.WebSocketServer({ port: this.port });
            this.server.on("connection", (ws) => this.handleClientConnection(ws));
            this.server.on("listening", () => {
                this.updateStatusBar();
                vscode.window.showInformationMessage("VS Code Focus Fortress WebSocket server started");
            });
            this.server.on("error", (err) => {
                vscode.window.showErrorMessage(`VS Code Focus Fortress WebSocket error: ${err.message}`);
            });
            // start heartbeat timer
            if (this.heartbeatTimer)
                clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = setInterval(() => {
                this.broadcast({ type: "heartbeat", active: this.isActive });
            }, Math.max(1000, this.heartbeatIntervalSec * 1000));
            // initial active state detection
            this.onUserActivity();
            this.updateStatusBar();
            return true;
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to start VS Code Focus Fortress server: ${(_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : err}`);
            this.stop(); // ensure clean
            return false;
        }
    }
    stop() {
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
            }
            catch { }
        }
        this.clients.clear();
        // close server
        if (this.server) {
            try {
                this.server.close();
            }
            catch { }
            this.server = null;
        }
        this.setActive(false);
        this.updateStatusBar();
        vscode.window.showInformationMessage("VS Code Focus Fortress server stopped.");
    }
    restart() {
        this.stop();
        // small delay to let socket close
        setTimeout(() => {
            this.start();
        }, 250);
    }
    statusString() {
        return this.server ? `running (port ${this.port})` : "stopped";
    }
    dispose() {
        this.stop();
        this.disposables.forEach((d) => d.dispose());
        try {
            this.statusBarItem.dispose();
        }
        catch { }
    }
}
exports.FocusBridgeServer = FocusBridgeServer;
// ---------------- extension activation ----------------
let bridge = null;
function activate(context) {
    bridge = new FocusBridgeServer(context);
    // Register commands: start / stop / restart / status
    context.subscriptions.push(vscode.commands.registerCommand("focusFortress.start", () => {
        const ok = bridge === null || bridge === void 0 ? void 0 : bridge.start();
        if (ok)
            vscode.window.showInformationMessage("VS Code Focus Fortress started.");
    }), vscode.commands.registerCommand("focusFortress.stop", () => {
        bridge === null || bridge === void 0 ? void 0 : bridge.stop();
    }), vscode.commands.registerCommand("focusFortress.restart", () => {
        bridge === null || bridge === void 0 ? void 0 : bridge.restart();
        vscode.window.showInformationMessage("VS Code Focus Fortress restarted.");
    }), vscode.commands.registerCommand("focusFortress.status", () => {
        var _a;
        const s = (_a = bridge === null || bridge === void 0 ? void 0 : bridge.statusString()) !== null && _a !== void 0 ? _a : "unknown";
        vscode.window.showInformationMessage(`VS Code Focus Fortress status: ${s}`);
    }));
    // Auto-start if config says so
    const cfg = vscode.workspace.getConfiguration("focusFortress");
    const autoStart = Boolean(cfg.get("autoStart", true));
    if (autoStart) {
        // defer start slightly to allow other extensions to initialize
        setTimeout(() => {
            bridge === null || bridge === void 0 ? void 0 : bridge.start();
        }, 500);
    }
    context.subscriptions.push({
        dispose: () => {
            bridge === null || bridge === void 0 ? void 0 : bridge.dispose();
        },
    });
}
function deactivate() {
    if (bridge) {
        bridge.dispose();
        bridge = null;
    }
}
//# sourceMappingURL=extension.js.map