# Contributing to Securo Client

Thank you for your interest in contributing to **Securo Client**! Open source thrives when people like you collaborate to improve performance, fix bugs, and add new features.

This guide provides instructions for setting up your development environment, submitting bug reports, and submitting pull requests.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please be respectful, considerate, and collaborative in all interactions.

---

## How Can I Contribute?

- 🐛 **Report Bugs:** Open an issue describing the bug, including steps to reproduce, device specifications, and log output.
- 💡 **Suggest Features:** Share ideas for mobile/desktop optimizations, UI polish, or homelab enhancements.
- 🌐 **Translations:** Improve or add language files in `src/config/locales/`.
- 💻 **Code Contributions:** Implement bug fixes, enhance bridge capabilities, or streamline the CI/CD pipeline.

---

## Development Setup

### 1. Prerequisites

Make sure you have the following installed on your machine:
- **Node.js** `>= 22.0.0` and **npm** `>= 10.0.0`
- **Rust** Stable (`>= 1.80`)
- **Java Development Kit (JDK)** `17` (Eclipse Temurin recommended)
- **Android SDK & NDK:**
  - Android API Level `35`
  - Build Tools `35.0.0`
  - NDK `27.0.12077973`
- **Tauri Prerequisites:**
  - Follow the official [Tauri v2 Prerequisites Guide](https://v2.tauri.app/start/prerequisites/) for your operating system.

### 2. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/securo-client.git
cd securo-client
npm install
```

### 3. Add Android Rust Targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
```

---

## Local Development Workflow

### Frontend Preparation

To prepare the frontend assets from upstream:

```bash
# Pulls upstream web frontend, applies HashRouter, and compiles
npm run frontend:prepare

# Bundles http-bridge.js and stages files in src/
npm run frontend:stage
```

### Desktop Development

For rapid UI and bridge testing without an emulator:

```bash
npm run tauri -- dev
```

### Android Development

Initialize the Android project directory (first time only):

```bash
npm run tauri -- android init
npm run android:configure
```

Compile a debug APK:

```bash
npm run tauri -- android build --target aarch64 --debug --apk
```

Package artifacts with SHA-256 checksums:

```bash
npm run artifacts:package
```

---

## Coding Standards

### Commit Message Conventions

We adhere to the [Conventional Commits](https://www.conventionalcommits.org/) standard. Please structure commit messages as follows:

```text
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

#### Common Types:
- `feat`: A new user-facing feature.
- `fix`: A bug fix.
- `docs`: Documentation updates.
- `refactor`: Code reorganization without behavior change.
- `ci`: CI/CD pipeline or workflow changes.
- `chore`: Maintenance tasks, dependency updates, or internal scripts.

*Examples:*
- `fix(client): patch undefined array find calls in financial baseline`
- `ci: optimize rust build caching and modernize release pipeline`
- `feat(bridge): add support for multipart form data streaming`

### Rust Code Guidelines
- Ensure code is formatted using `cargo fmt`.
- Address all warnings produced by `cargo clippy`:
  ```bash
  cd src-tauri
  cargo fmt --check
  cargo clippy -- -D warnings
  ```

### JavaScript / Node Scripts
- Use modern ES Modules (`import`/`export`).
- Validate scripts syntax:
  ```bash
  node --check scripts/prepare-frontend.mjs
  node --check scripts/stage-frontend.mjs
  node --check scripts/configure-android.mjs
  node --check scripts/package-artifacts.mjs
  ```

---

## Submitting a Pull Request

1. **Create a branch:**
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. **Make your changes:** Keep changes focused and atomic.
3. **Test locally:** Ensure test suites and frontend staging pass:
   ```bash
   npm test
   npm run test:rust
   npm run frontend:prepare
   npm run frontend:stage
   ```
4. **Push to GitHub and open a Pull Request:**
   - Provide a clear title and description of your changes.
   - Mention any related issue numbers (e.g., `Closes #12`).
   - Confirm that GitHub Actions CI builds pass cleanly.

Thank you for helping build a better native experience for Securo!
