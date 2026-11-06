# Securo Mobile

<div align="center">

[![CI Pipeline](https://github.com/Marcelo-maga/securo-mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/Marcelo-maga/securo-mobile/actions/workflows/ci.yml)
[![Release Pipeline](https://github.com/Marcelo-maga/securo-mobile/actions/workflows/release.yml/badge.svg)](https://github.com/Marcelo-maga/securo-mobile/actions/workflows/release.yml)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-blue.svg?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2024%20Edition-orange.svg?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Desktop-green.svg?logo=android&logoColor=white)](https://android.com)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**Fast, private native client for self-hosted [Securo](https://github.com/securo-finance/securo) personal finance.**

*Unofficial client built with Tauri v2 and Rust.*

[Download APK](#installation) •
[Features](#why-securo-mobile) •
[Architecture](#architecture) •
[Development](#development) •
[Troubleshooting](#troubleshooting) •
[License](#license--attribution)

</div>

---

## Why Securo Mobile?

Running self-hosted web apps on mobile browsers or PWAs often creates friction: CORS blocks local IP addresses/VPNs, browsers reject self-signed homelab TLS certificates, and browser URL bars waste screen space.

**Securo Mobile eliminates these issues:**

- ⚡ **Native HTTP Bridge:** Proxies all `fetch` and `XMLHttpRequest` calls through native Rust sockets (`reqwest` + `rustls`), completely bypassing WebView CORS and mixed-content restrictions.
- 🛡️ **Homelab & Self-Signed TLS Support:** Connect securely to private LAN IPs (`192.168.x.x`), Tailscale/WireGuard domains, or servers with self-signed SSL certificates.
- 📱 **True Native Experience:** Edge-to-edge layout, safe-area inset handling (status/navigation bars and camera notches), zero browser chrome, and persistent local session state.
- 🔒 **100% Private & Direct:** Direct peer-to-peer connection to your server. No cloud relays, no tracking, no telemetry.

---

## Installation

### Pre-built APKs (Android)

1. Head to the **[Latest Release](https://github.com/Marcelo-maga/securo-mobile/releases/latest)**.
2. Download the APK for your device architecture:
   - **`arm64-v8a`** (Recommended — modern phones and tablets)
   - **`armeabi-v7a`** (Older 32-bit Android devices)
   - **`x86_64`** (Android emulators and Chromebooks)
3. Install the APK on your device.
4. Launch the app, enter your Securo server URL (e.g. `https://securo.homelab.local` or `http://192.168.1.100:8080`), and connect!

---

## Architecture

Securo Mobile embeds an optimized build of the official Securo web frontend inside a lightweight native shell:

```mermaid
flowchart TD
    subgraph MobileApp["📱 Securo Native Client (Tauri v2)"]
        subgraph WebView["Local WebView Sandbox"]
            UI["Securo React Frontend\n(HashRouter + Mobile Overrides)"]
            Bridge["securo-http-bridge.js\n(Patched window.fetch & XHR)"]
            UI -->|"HTTP /api/* calls"| Bridge
        end

        subgraph RustCore["Rust Core Runtime (Tauri IPC)"]
            PluginHttp["tauri-plugin-http\n(Reqwest + Rustls TLS)"]
            Store["tauri-plugin-store\n(Encrypted Local Configuration)"]
            Bridge -->|"IPC invoke"| PluginHttp
            Bridge -->|"Read config"| Store
        end
    end

    subgraph Homelab["🏠 Self-Hosted Infrastructure"]
        Server["Securo Server\n(Docker / Reverse Proxy)"]
    end

    PluginHttp -->|"Direct Native TCP/TLS\n(Bypasses WebView CORS)"| Server
```

> For deep architectural details, data flow specs, and IPC internals, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Development

### Prerequisites

| Tool | Version | Purpose |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.0.0` | Frontend toolchain & scripts |
| **Rust** | Stable (`>= 1.80`) | Compiles the Tauri native shell |
| **Java JDK** | `17` (Temurin) | Android Gradle build |
| **Android SDK/NDK** | API 35 / NDK `27.x` | Android compilation |

### Quick Start

```bash
# 1. Clone & install dependencies
git clone https://github.com/Marcelo-maga/securo-mobile.git
cd securo-mobile
npm install

# 2. Fetch, adapt and stage the Securo frontend
npm run frontend:prepare
npm run frontend:stage

# 3. Run on desktop (Linux / macOS / Windows)
npm run tauri -- dev
```

### Building for Android

```bash
# Initialize Android targets (first time only)
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
npm run tauri -- android init
npm run android:configure

# Build debug APK for arm64
npm run tauri -- android build --target aarch64 --debug --apk

# Package & generate SHA-256 checksums in artifacts/
npm run artifacts:package
```

---

## Troubleshooting

<details>
<summary><b>1. Connection failed: "SERVER_UNREACHABLE"</b></summary>

- Ensure your Securo server is running and reachable from your mobile network (same Wi-Fi or active VPN).
- If using an internal/self-signed SSL certificate, enable **"Allow self-signed certificate"** in the server setup screen.
- Verify the protocol and port (e.g. `http://192.168.1.50:8080`).
- Tap **Copy** in the error dialog to view exact probe details (`/api/health`, `/health`, `/`).
</details>

<details>
<summary><b>2. Blank / White screen on startup</b></summary>

- Re-run `npm run frontend:prepare` and `npm run frontend:stage`.
- Mobile WebViews require `HashRouter` routing; standard browser history routing fails inside sandboxed local file schemas.
</details>

<details>
<summary><b>3. Missing Android SDK / NDK during build</b></summary>

Set your environment variables:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin
```
</details>

---

## Contributing

Contributions are welcome! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for branch guidelines, commit conventions, and test commands (`npm test`).

---

## License & Attribution

- **Securo Mobile** is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
- This project incorporates and adapts frontend components from [Securo](https://github.com/securo-finance/securo), created by Tássio Noronha and licensed under AGPL-3.0.
- This is an independent, community-driven client and is not officially affiliated with or endorsed by the Securo upstream project.
