# VS Code Focus Fortress

A VS Code extension that runs a local WebSocket server to broadcast your coding activity status. Designed to work with the companion Chrome extension to block distracting websites when you're actively coding.

## Features

- 🚀 **Local WebSocket Server**: Runs on `localhost:9876` (configurable)
- 👁️ **Activity Monitoring**: Tracks text editor changes, selections, and window focus
- ⏱️ **Inactivity Timeout**: Automatically deactivates after configurable idle time
- 🔐 **Optional Authentication**: Secure connections with secret token
- 📊 **Status Bar Integration**: Real-time server status in VS Code
- ⚙️ **Configurable**: Extensive settings for customization
- 🔄 **Auto-start**: Automatically starts server when VS Code launches

## Installation

### From VS Code Marketplace

[![Install from Marketplace](https://img.shields.io/badge/VS%20Code-Install-blue)](https://marketplace.visualstudio.com/items?itemName=RohitKhatri.vscode-focus-bridge)

### Manual Installation

1. Download the `.vsix` file from [GitHub Releases](https://github.com/khatri-rohit/focus-fortress/blob/main/vscode-focus-bridge/vscode-focus-bridge-0.0.3.vsix)
2. In VS Code: `Extensions` → `...` → `Install from VSIX...`
3. Select the downloaded file

### Build from Source

```bash
git clone https://github.com/khatri-rohit/focus-fortress.git
cd focus-fortress/vscode-focus-bridge
npm install
npm run compile
code --install-extension vscode-focus-bridge-*.vsix
```

## Usage

### Automatic Operation

The extension starts automatically when VS Code launches (if `autoStart` is enabled). You'll see the status in the status bar:

- `$(plug) FocusBridge: running (9876)` - Server is active
- `$(debug-disconnect) FocusBridge: stopped` - Server is stopped

### Manual Control

Use the Command Palette (`Ctrl+Shift+P`) to control the server:

- `Focus Fortress: Start server` - Start the WebSocket server
- `Focus Fortress: Stop server` - Stop the WebSocket server
- `Focus Fortress: Restart server` - Restart the server
- `Focus Fortress: Show status` - Display current server status

### Activity Detection

The extension monitors these user activities:

- Opening/closing text editors
- Text changes in documents
- Text selection changes
- Window focus/unfocus events

When activity is detected, the server broadcasts `{"type": "status", "active": true}` to connected clients.

## Configuration

Access settings via `File` → `Preferences` → `Settings` → search for "focusFortress"

| Setting                              | Default | Description                                  |
| ------------------------------------ | ------- | -------------------------------------------- |
| `focusFortress.port`                 | `9876`  | Local WebSocket server port                  |
| `focusFortress.heartbeatIntervalSec` | `10`    | Seconds between heartbeat messages           |
| `focusFortress.inactivityTimeoutSec` | `120`   | Seconds of inactivity before deactivating    |
| `focusFortress.secretToken`          | `""`    | Optional auth token for client connections   |
| `focusFortress.autoStart`            | `true`  | Start server automatically on VS Code launch |

### Example Configuration

```json
{
  "focusFortress.port": 8080,
  "focusFortress.inactivityTimeoutSec": 300,
  "focusFortress.secretToken": "my-secret-token",
  "focusFortress.autoStart": false
}
```

## Protocol

### WebSocket Messages

The server sends JSON messages to connected clients:

#### Status Message

```json
{
  "type": "status",
  "active": true
}
```

#### Heartbeat Message

```json
{
  "type": "heartbeat",
  "active": true
}
```

### Client Authentication

If `secretToken` is configured, clients must send an auth message first:

```json
{
  "type": "auth",
  "token": "your-secret-token"
}
```

Otherwise, clients can request status directly:

```json
{
  "type": "request_status"
}
```

## Companion Extension

This VS Code extension works with the [Focus Fortress Chrome Extension](https://github.com/khatri-rohit/focus-fortress/tree/main/chrome-focus-blocker) to automatically block distracting websites when you're coding.

## Development

### Prerequisites

- Node.js 16+
- VS Code 1.70+

### Setup

```bash
npm install
npm run compile
npm run watch  # for development
```

### Testing

Use the included test client:

```bash
node out/text-client.js
```

This connects to `ws://127.0.0.1:9876` and logs received messages.

### Packaging

```bash
npm run package
```

Generates a `.vsix` file for installation.

## Troubleshooting

### Server Won't Start

- Check if port 9876 is already in use
- Try changing the port in settings
- Restart VS Code

### Not Detecting Activity

- Ensure you're editing text files
- Check inactivity timeout setting
- Try manual restart

### Connection Issues

- Verify firewall allows localhost connections
- Check VS Code status bar for server status
- Use `Focus Fortress: Show status` command

## Privacy

- No external network connections
- No data collection or telemetry
- All communication is local only
- Open source and auditable

## Requirements

- VS Code 1.70.0 or higher
- Node.js (for development only)

## License

MIT © [Rohit Khatri](https://github.com/khatri-rohit)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Related

- [Focus Fortress Chrome Extension](https://github.com/khatri-rohit/focus-fortress/tree/main/chrome-focus-blocker)
- [WebSocket Protocol RFC](https://tools.ietf.org/html/rfc6455)
