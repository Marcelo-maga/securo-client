# Security Policy

## Supported Versions

We provide security updates and patches for the following versions of Securo Client:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

---

## Security Architecture Highlights

Securo Client enforces defense-in-depth protections using official Tauri v2 security primitives:

- **Dynamic Per-Server HTTP ACL (`dynamic-acl`) & Redirect Enforcement:** Static capabilities (`src-tauri/capabilities/default.json`) are restricted to explicit windows (`["main", "config"]`), minimal resource lifecycle permissions (`core:resources:default`), and zero wildcard `http://*` or `https://*` permissions. Runtime HTTP access via `@tauri-apps/plugin-http` is dynamically scoped exclusively to `{server_url}/api` and `{server_url}/api/*` using `tauri::ipc::CapabilityBuilder`, with `scopeRedirects: true` enforced across every `3xx` redirect hop and unsafe non-HTTP ports rejected.
- **Navigation-Verified Configuration Context Isolation:** Mutating connection commands (`connect_server`, `save_server_url`, `clear_server_url`, `set_auto_connect`) require both real top-level WebView document load verification via Tauri's `.on_page_load()` hook (`SecurityState`) and live `/config/config.html` origin checks. On desktop, mutating setup commands are additionally restricted exclusively to the dedicated `"config"` window, preventing client-side `history.pushState` spoofing or main-view scripts from altering the allowed server origin.
- **Session & Browsing Data Isolation:** Switching servers or clearing the configured server automatically purges main WebView browsing storage (`clear_all_browsing_data`) so authentication tokens, cookies, and cached financial state never bleed across server instances.
- **OS Trust Store Support (`rustls-tls-native-roots`):** Private CAs installed in the operating system trust store (e.g., `mkcert`, Caddy Internal CA, enterprise CAs) are trusted natively without disabling certificate verification. Opt-in self-signed bypass (`allow_invalid_certs`) remains disabled by default, requires explicit manual user consent, and warns against unencrypted remote `http://` connections.
- **Strict Content Security Policy (CSP) & Mobile Backup Hardening:** `withGlobalTauri` is disabled, inline scripts and `unsafe-eval` are banned, `form-action 'self'` and `frame-src 'none'` are enforced, external browser `connect-src` origins are blocked via `tauri.conf.json`, and Android builds enforce `android:allowBackup="false"` and mandatory release keystore signing.

---

## Reporting a Vulnerability

The Securo Client maintainers take security seriously. If you discover a security vulnerability in this project, please report it responsibly:

### How to Report

1. **GitHub Private Vulnerability Report (Recommended):**
   - Navigate to the [Security Advisories](https://github.com/Marcelo-maga/securo-client/security/advisories) tab of this repository.
   - Click **"Report a vulnerability"** to submit a private report.
   
2. **Via GitHub Issues:**
   - If private vulnerability reporting is unavailable, you can open an issue on [GitHub Issues](https://github.com/Marcelo-maga/securo-client/issues).
   - Please label it appropriately and avoid posting sensitive reproduction material (e.g. real credentials, private server IPs, or authorization tokens) publicly in the issue description.

### What to Include in Your Report

To help us investigate and triage effectively, please include:
- A clear description of the vulnerability.
- Steps to reproduce the issue (proof-of-concept code, requests, or screenshots).
- The platform affected (Windows/Linux/macOS version, Android architecture, etc.).
- The potential security impact on the user or the self-hosted Securo server.

### What to Expect

- **Acknowledgment:** We aim to acknowledge receipt of your report within 48 hours.
- **Triage & Remediation:** We will assess the severity, keep you updated on progress, and prepare a patch before releasing security advisories.
- **Credit:** We gladly credit reporters in release notes once the patch is published.
