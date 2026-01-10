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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ws_1 = require("ws");
const http = __importStar(require("http"));
let wss;
let clients = new Set();
let server;
let activeState = false;
let activityTimer;
let heartbeatTimer;
/**
 * Send JSON to all authenticated clients.
 */
function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const c of clients) {
        if (c.authenticated && c.socket.readyState === c.socket.OPEN) {
            try {
                c.socket.send(data);
            }
            catch (e) {
                /* ignore send errors */
            }
        }
    }
}
/**
 * Update active state and broadcast change.
 */
function setActiveState(next) {
    if (activeState === next)
        return;
    activeState = next;
    broadcast({ type: "status", active: activeState, ts: Date.now() });
}
/**
 * Reset inactivity timer (called on real editor activity).
 */
function resetInactivityTimeout(ctx) {
    const cfg = vscode.workspace.getConfiguration("focusBridge");
    const timeoutSec = cfg.get("inactivityTimeoutSec", 120);
    if (activityTimer)
        clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
        setActiveState(false);
    }, timeoutSec * 1000);
    // When there's activity, set active immediately
    setActiveState(true);
}
/**
 * Start heartbeat loop while editor is active; used to continuously tell clients we're active.
 */
function startHeartbeat(ctx) {
    stopHeartbeat();
    const cfg = vscode.workspace.getConfiguration("focusBridge");
    const interval = cfg.get("heartbeatIntervalSec", 10);
    heartbeatTimer = setInterval(() => {
        if (activeState) {
            broadcast({ type: "heartbeat", active: true, ts: Date.now() });
        }
    }, interval * 1000);
}
function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
    }
}
/**
 * Setup WebSocket server on configured port.
 */
async function startServer(ctx) {
    const cfg = vscode.workspace.getConfiguration("focusBridge");
    const port = cfg.get("port", 9876);
    const secretToken = cfg.get("secretToken", "") || "";
    // Prevent multiple starts
    if (wss)
        return;
    // Create HTTP server and upgrade to WebSocket (gives more control on same host)
    server = http.createServer();
    wss = new ws_1.WebSocketServer({ server });
    wss.on("connection", (socket) => {
        const client = { socket, authenticated: secretToken === "" };
        clients.add(client);
        // If no secret, mark authenticated immediately
        if (client.authenticated) {
            // immediate status push
            socket.send(JSON.stringify({ type: "status", active: activeState, ts: Date.now() }));
        }
        socket.on("message", (msg) => {
            try {
                const text = msg.toString();
                // If secret token is configured, first message must be { type: 'auth', token: '...' }
                if (!client.authenticated && secretToken) {
                    try {
                        const parsed = JSON.parse(text);
                        if ((parsed === null || parsed === void 0 ? void 0 : parsed.type) === "auth" && (parsed === null || parsed === void 0 ? void 0 : parsed.token) === secretToken) {
                            client.authenticated = true;
                            socket.send(JSON.stringify({ type: "auth_ok" }));
                            socket.send(JSON.stringify({
                                type: "status",
                                active: activeState,
                                ts: Date.now(),
                            }));
                        }
                        else {
                            socket.send(JSON.stringify({ type: "auth_failed" }));
                            socket.close();
                        }
                        return;
                    }
                    catch (e) {
                        socket.send(JSON.stringify({ type: "auth_failed" }));
                        socket.close();
                        return;
                    }
                }
                // Accept simple pings or requests
                const parsed = JSON.parse(text);
                if ((parsed === null || parsed === void 0 ? void 0 : parsed.type) === "ping") {
                    socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
                }
                else if ((parsed === null || parsed === void 0 ? void 0 : parsed.type) === "request_status") {
                    socket.send(JSON.stringify({
                        type: "status",
                        active: activeState,
                        ts: Date.now(),
                    }));
                }
            }
            catch (err) {
                // ignore invalid messages
            }
        });
        socket.on("close", () => {
            clients.delete(client);
        });
        socket.on("error", () => {
            clients.delete(client);
        });
    });
    server.on("error", (err) => {
        vscode.window.showErrorMessage(`Focus Bridge server error: ${err.message}`);
        stopServer();
    });
    server.listen(port, "127.0.0.1", () => {
        console.log(`Focus Bridge WebSocket server listening on ws://127.0.0.1:${port}`);
        vscode.window.showInformationMessage(`Focus Bridge server listening on port ${port}`);
    });
    // start heartbeat cron
    startHeartbeat(ctx);
}
/**
 * Stop server and clear timers.
 */
function stopServer() {
    if (wss) {
        try {
            wss.close();
        }
        catch (e) { }
        wss = undefined;
    }
    if (server) {
        try {
            server.close();
        }
        catch (e) { }
        server = undefined;
    }
    for (const c of clients) {
        try {
            c.socket.close();
        }
        catch (e) { }
    }
    clients.clear();
    stopHeartbeat();
    if (activityTimer) {
        clearTimeout(activityTimer);
        activityTimer = undefined;
    }
    activeState = false;
}
/**
 * Called when extension is activated.
 */
function activate(context) {
    console.log("Focus Bridge activating...");
    // Start server
    startServer(context).catch((err) => {
        vscode.window.showErrorMessage("Unable to start Focus Bridge server: " + String(err));
    });
    // Workspace/editor activity hooks
    const onWindowState = vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
            resetInactivityTimeout(context);
        }
        else {
            // window unfocused -> start inactivity countdown
            const cfg = vscode.workspace.getConfiguration("focusBridge");
            const timeoutSec = cfg.get("inactivityTimeoutSec", 120);
            if (activityTimer)
                clearTimeout(activityTimer);
            activityTimer = setTimeout(() => setActiveState(false), timeoutSec * 1000);
        }
    });
    const onEdit = vscode.workspace.onDidChangeTextDocument((e) => {
        resetInactivityTimeout(context);
    });
    const onEditorChange = vscode.window.onDidChangeActiveTextEditor((e) => {
        resetInactivityTimeout(context);
    });
    context.subscriptions.push(onWindowState, onEdit, onEditorChange);
    // When extension deactivates, do cleanup via deactivate()
}
/**
 * Called when extension deactivates.
 */
function deactivate() {
    stopServer();
}
//# sourceMappingURL=extension.js.map