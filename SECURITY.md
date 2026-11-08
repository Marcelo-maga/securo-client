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

- **Dynamic Per-Server HTTP ACL (`dynamic-acl`):** Static capabilities (`src-tauri/capabilities/default.json`) contain zero wildcard `http://*` or `https://*` permissions. Runtime HTTP access via `@tauri-apps/plugin-http` is dynamically scoped exclusively to `{server_url}/api` and `{server_url}/api/*` using `tauri::ipc::CapabilityBuilder`.
- **Configuration Context Isolation:** Commands that modify connection settings (`connect_server`, `save_server_url`, `clear_server_url`, `set_auto_connect`) verify that the caller is the `/config/config.html` setup view, preventing scripts in the main application view from altering the allowed server origin.
- **OS Trust Store Support (`rustls-tls-native-roots`):** Private CAs installed in the operating system trust store (e.g., `mkcert`, Caddy Internal CA, enterprise CAs) are trusted natively without disabling certificate verification. Opt-in self-signed bypass (`allow_invalid_certs`) remains disabled by default and should only be enabled over trusted networks or encrypted VPNs (Tailscale/WireGuard).
- **Strict Content Security Policy (CSP):** Inline scripts, `unsafe-eval`, and external browser `connect-src` origins are blocked via `tauri.conf.json`.

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
