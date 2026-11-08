import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveAbi,
  resolveBuildType,
  computeSha256,
  formatArtifactName,
  resolveDesktopArtifactName,
  findApks,
  findDesktopBundles,
  packageArtifacts,
} from '../scripts/package-artifacts.mjs';

describe('Package Artifacts Pipeline & Checksum Calculation', () => {
  describe('ABI Resolution', () => {
    test('correctly identifies all Android ABI variants', () => {
      assert.equal(resolveAbi('app-arm64-v8a-release.apk', ''), 'arm64-v8a');
      assert.equal(resolveAbi('app-armeabi-v7a-debug.apk', ''), 'armeabi-v7a');
      assert.equal(resolveAbi('app-x86_64-release-unsigned.apk', ''), 'x86_64');
      assert.equal(resolveAbi('app-x86-debug.apk', ''), 'x86');
      assert.equal(resolveAbi('app-universal-release.apk', ''), 'universal');
    });

    test('maps single-target Tauri builds on universal flavor filenames using targetHint', () => {
      assert.equal(resolveAbi('app-universal-release.apk', 'aarch64'), 'arm64-v8a');
      assert.equal(resolveAbi('app-universal-release.apk', 'armv7'), 'armeabi-v7a');
      assert.equal(resolveAbi('app-universal-debug.apk', 'x86_64'), 'x86_64');
    });

    test('defaults to arm64-v8a when no known ABI is present in filename', () => {
      assert.equal(resolveAbi('app-release.apk', ''), 'arm64-v8a');
      assert.equal(resolveAbi('securo-client.apk', ''), 'arm64-v8a');
    });
  });

  describe('Build Type Resolution', () => {
    test('identifies release builds', () => {
      assert.equal(resolveBuildType('app-arm64-v8a-release.apk'), 'release');
      assert.equal(resolveBuildType('/build/outputs/apk/release/app.apk'), 'release');
    });

    test('identifies debug builds', () => {
      assert.equal(resolveBuildType('app-arm64-v8a-debug.apk'), 'debug');
      assert.equal(resolveBuildType('app-snapshot.apk'), 'debug');
    });
  });

  describe('Artifact Formatting & Checksums', () => {
    test('formats canonical artifact filename according to release specifications', () => {
      const formatted = formatArtifactName('v0.1.0', 'arm64-v8a', 'release');
      assert.equal(formatted, 'securo-v0.1.0-arm64-v8a-release.apk');
    });

    test('generates valid SHA-256 standard checksum lines', () => {
      const sampleContent = Buffer.from('Securo APK Binary Test Payload', 'utf8');
      const hash = computeSha256(sampleContent);
      const filename = 'securo-v0.1.0-universal-release.apk';
      const checksumLine = `${hash}  ${filename}`;

      // Standard 64-character hex SHA-256 format followed by two spaces and filename
      assert.match(checksumLine, /^[a-f0-9]{64}\s\s[a-zA-Z0-9._-]+$/);
      assert.equal(hash.length, 64);
    });

    test('recursively scans directory tree for .apk files', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'securo-apk-test-'));
      try {
        const subDir1 = path.join(tempDir, 'nested/release');
        const subDir2 = path.join(tempDir, 'nested/debug');
        fs.mkdirSync(subDir1, { recursive: true });
        fs.mkdirSync(subDir2, { recursive: true });

        fs.writeFileSync(path.join(subDir1, 'app-universal-release.apk'), 'dummy1');
        fs.writeFileSync(path.join(subDir2, 'app-arm64-v8a-debug.apk'), 'dummy2');
        fs.writeFileSync(path.join(subDir1, 'output.json'), 'not an apk');

        const found = findApks(tempDir);
        assert.equal(found.length, 2);
        assert.ok(found.some((p) => p.endsWith('app-universal-release.apk')));
        assert.ok(found.some((p) => p.endsWith('app-arm64-v8a-debug.apk')));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Desktop Bundle Resolution & Multi-Platform Extensibility', () => {
    test('resolves Windows NSIS setup executable artifact name', () => {
      const res = resolveDesktopArtifactName('C:/target/bundle/nsis/Securo_0.1.0_x64-setup.exe', 'v0.1.0');
      assert.equal(res, 'securo-v0.1.0-windows-x64-setup.exe');
    });

    test('resolves Windows MSI installer artifact name', () => {
      const res = resolveDesktopArtifactName('C:/target/bundle/msi/Securo_0.1.0_x64_en-US.msi', 'v0.1.0');
      assert.equal(res, 'securo-v0.1.0-windows-x64.msi');
    });

    test('resolves future Linux DEB and AppImage artifact names', () => {
      const deb = resolveDesktopArtifactName('/target/bundle/deb/securo_0.1.0_amd64.deb', 'v0.1.0');
      assert.equal(deb, 'securo-v0.1.0-linux-amd64.deb');

      const appImage = resolveDesktopArtifactName('/target/bundle/appimage/securo_0.1.0_amd64.AppImage', 'v0.1.0');
      assert.equal(appImage, 'securo-v0.1.0-linux-x86_64.AppImage');
    });

    test('resolves future macOS DMG artifact name', () => {
      const dmg = resolveDesktopArtifactName('/target/bundle/dmg/Securo_0.1.0_universal.dmg', 'v0.1.0');
      assert.equal(dmg, 'securo-v0.1.0-macos-universal.dmg');

      const dmgArm = resolveDesktopArtifactName('/target/bundle/dmg/Securo_0.1.0_aarch64.dmg', 'v0.1.0');
      assert.equal(dmgArm, 'securo-v0.1.0-macos-arm64.dmg');
    });

    test('recursively locates desktop bundles with supported extensions', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'securo-desktop-bundle-test-'));
      try {
        const nsisDir = path.join(tempDir, 'nsis');
        const msiDir = path.join(tempDir, 'msi');
        fs.mkdirSync(nsisDir, { recursive: true });
        fs.mkdirSync(msiDir, { recursive: true });

        fs.writeFileSync(path.join(nsisDir, 'Securo_0.1.0_x64-setup.exe'), 'dummy exe');
        fs.writeFileSync(path.join(msiDir, 'Securo_0.1.0_x64_en-US.msi'), 'dummy msi');
        fs.writeFileSync(path.join(tempDir, 'ignore.txt'), 'ignore me');

        const found = findDesktopBundles([tempDir]);
        assert.equal(found.length, 2);
        assert.ok(found.some((p) => p.endsWith('.exe')));
        assert.ok(found.some((p) => p.endsWith('.msi')));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('packages desktop bundles and writes SHA256SUMS correctly', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'securo-pkg-test-'));
      const bundleDir = path.join(tempDir, 'bundle');
      const outDir = path.join(tempDir, 'out');
      try {
        fs.mkdirSync(bundleDir, { recursive: true });
        const exePath = path.join(bundleDir, 'Securo_0.1.0_x64-setup.exe');
        fs.writeFileSync(exePath, 'Dummy Windows Installer Content');

        const result = packageArtifacts({
          apkSearchDir: path.join(tempDir, 'nonexistent-apk'),
          bundleSearchDirs: [bundleDir],
          outDir,
          versionOverride: '0.1.0',
        });

        assert.equal(result.packagedFiles.length, 1);
        assert.ok(fs.existsSync(path.join(outDir, 'securo-v0.1.0-windows-x64-setup.exe')));
        assert.ok(fs.existsSync(path.join(outDir, 'SHA256SUMS.txt')));

        const sums = fs.readFileSync(path.join(outDir, 'SHA256SUMS.txt'), 'utf8');
        assert.ok(sums.includes('securo-v0.1.0-windows-x64-setup.exe'));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
