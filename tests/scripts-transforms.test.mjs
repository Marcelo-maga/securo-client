import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  patchRouter,
  patchViteConfig,
  patchOptionalChaining,
  validateFrontendSourceConfig,
} from '../scripts/prepare-frontend.mjs';
import {
  configureStringsXml,
  configureAndroidManifest,
} from '../scripts/configure-android.mjs';
import {
  findInlineScripts,
  hasValidStagedDist,
  stageFrontend,
} from '../scripts/stage-frontend.mjs';

describe('Frontend & Android Pipeline Code Transformations', () => {
  describe('Frontend Source Input Sanitization (validateFrontendSourceConfig)', () => {
    test('accepts valid owner/repo slugs, git tags/SHAs, and safe relative subpaths', () => {
      const cfg = validateFrontendSourceConfig({
        repo: 'securo-finance/securo',
        ref: 'v0.4.2',
        frontendPath: 'frontend',
      });
      assert.deepEqual(cfg, {
        repo: 'securo-finance/securo',
        ref: 'v0.4.2',
        frontendPath: 'frontend',
      });
    });

    test('rejects command injection, git flag injection, and path traversal inputs', () => {
      assert.throws(() =>
        validateFrontendSourceConfig({
          repo: 'securo-finance/securo"; touch pwned #',
          ref: '',
          frontendPath: 'frontend',
        })
      );
      assert.throws(() =>
        validateFrontendSourceConfig({
          repo: 'securo-finance/securo',
          ref: '--upload-pack=evil',
          frontendPath: 'frontend',
        })
      );
      assert.throws(() =>
        validateFrontendSourceConfig({
          repo: 'securo-finance/securo',
          ref: 'main',
          frontendPath: '../outside',
        })
      );
    });
  });

  describe('Router Adaptation (BrowserRouter -> HashRouter)', () => {
    test('replaces BrowserRouter import and JSX tags', () => {
      const input = `
import { BrowserRouter, Routes, Route } from "react-router-dom";
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
`;
      const output = patchRouter(input);
      assert.ok(!output.includes('BrowserRouter'), 'Should not contain BrowserRouter');
      assert.ok(output.includes('import { HashRouter, Routes, Route }'));
      assert.ok(output.includes('<HashRouter>'));
      assert.ok(output.includes('</HashRouter>'));
    });

    test('is idempotent when BrowserRouter is not present', () => {
      const input = `<HashRouter><Routes /></HashRouter>`;
      assert.equal(patchRouter(input), input);
    });
  });

  describe('Vite Base Path Configuration', () => {
    test('injects relative base: "./" before define block', () => {
      const input = `
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify("1.0.0"),
  },
});
`;
      const output = patchViteConfig(input);
      assert.ok(output.includes('base: "./"'));
      assert.ok(output.includes('base: "./",\n    define: {'));
    });

    test('is idempotent if base is already defined', () => {
      const input = `base: "./", define: {}`;
      assert.equal(patchViteConfig(input), input);
    });
  });

  describe('Optional Chaining Regex Replacements', () => {
    test('patches potential undefined financial state array finds', () => {
      const sample = `
const active = data.accounts.find((a) => a.id === targetId);
const baseline = state.baseline.find((b) => b.year === 2026);
const action = user.actions.find((act) => act.key === "APPROVE");
const day = calendar.days.find((d) => d.date === today);
const plan = loan.installments.find((i) => i.number === 1);
const asset = portfolio.assets.find((ast) => ast.symbol === "BTC");
`;
      const patched = patchOptionalChaining(sample);
      assert.ok(patched.includes('data.accounts?.find('));
      assert.ok(patched.includes('state.baseline?.find('));
      assert.ok(patched.includes('user.actions?.find('));
      assert.ok(patched.includes('calendar.days?.find('));
      assert.ok(patched.includes('loan.installments?.find('));
      assert.ok(patched.includes('portfolio.assets?.find('));
    });

    test('leaves existing optional chains, string literals, and comments untouched', () => {
      const sample = `
const x = list?.find((item) => item.active);
const doc = "data.accounts.find(x)";
// comment: state.baseline.find(y)
`;
      const patched = patchOptionalChaining(sample);
      assert.ok(!patched.includes('?..find'));
      assert.ok(!patched.includes('???'));
      assert.ok(patched.includes('"data.accounts.find(x)"'));
      assert.ok(patched.includes('// comment: state.baseline.find(y)'));
    });
  });

  describe('Staging Guardrails (--skip-if-staged & CSP Inline Script Verification)', () => {
    test('detects inline executable <script> blocks while allowing external src scripts', () => {
      assert.equal(findInlineScripts('<script src="./securo-http-bridge.js"></script>').length, 0);
      assert.equal(findInlineScripts('<script>window.evil = 1;</script>').length, 1);
    });

    test('preserves valid pre-staged dist when --skip-if-staged is active and rejects missing dist', () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'securo-stage-test-'));
      try {
        const missingUpstream = path.join(tmpRoot, 'no-upstream');
        const outDir = path.join(tmpRoot, 'dist');

        assert.throws(() =>
          stageFrontend({
            distDir: missingUpstream,
            outDir,
            skipIfStaged: true,
            allowFallback: false,
          })
        );

        fs.mkdirSync(path.join(outDir, 'config'), { recursive: true });
        fs.writeFileSync(path.join(outDir, 'index.html'), '<!doctype html><script src="./bootstrap.js"></script>');
        fs.writeFileSync(path.join(outDir, 'bootstrap.js'), '// bootstrap');
        fs.writeFileSync(
          path.join(outDir, 'app.html'),
          '<!doctype html><head><script src="./securo-http-bridge.js"></script></head><body>CUSTOM_PROD_MARKER</body>'
        );
        fs.writeFileSync(path.join(outDir, 'securo-http-bridge.js'), '// bridge');
        fs.writeFileSync(path.join(outDir, 'config', 'config.html'), '<!doctype html>');

        assert.equal(hasValidStagedDist(outDir), true);

        stageFrontend({
          distDir: missingUpstream,
          outDir,
          skipIfStaged: true,
          allowFallback: false,
        });

        assert.ok(
          fs.readFileSync(path.join(outDir, 'app.html'), 'utf8').includes('CUSTOM_PROD_MARKER'),
          'Pre-staged production app.html must not be overwritten by fallback when --skip-if-staged is used'
        );
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });

  describe('Android Configuration (Manifest & strings.xml)', () => {
    test('configures strings.xml with canonical app title and activity name', () => {
      const inputXml = `
<resources>
  <string name="app_name">Default Template Name</string>
  <string name="main_activity_title">Tauri App</string>
</resources>
`;
      const outputXml = configureStringsXml(inputXml);
      assert.ok(outputXml.includes('<string name="app_name">Securo</string>'));
      assert.ok(outputXml.includes('<string name="main_activity_title">Securo</string>'));
    });

    test('injects ACCESS_NETWORK_STATE, roundIcon, usesCleartextTraffic, and enforces android:allowBackup="false"', () => {
      const inputXml = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher">
    </application>
</manifest>
`;
      const outputXml = configureAndroidManifest(inputXml);
      assert.ok(outputXml.includes('android.permission.ACCESS_NETWORK_STATE'));
      assert.ok(outputXml.includes('android:roundIcon="@mipmap/ic_launcher_round"'));
      assert.ok(outputXml.includes('android:allowBackup="false"'));
      assert.ok(!outputXml.includes('android:allowBackup="true"'));
      assert.ok(outputXml.includes('android:usesCleartextTraffic="true"'));
    });

    test('is idempotent when permissions, roundIcon, usesCleartextTraffic, and allowBackup="false" are already configured', () => {
      const alreadyConfigured = `
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:allowBackup="false"
        android:usesCleartextTraffic="true"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round">
    </application>
`;
      const reprocessed = configureAndroidManifest(alreadyConfigured);
      const occurrences = (reprocessed.match(/ACCESS_NETWORK_STATE/g) || []).length;
      const backupAttrs = (reprocessed.match(/android:allowBackup="false"/g) || []).length;
      const cleartextAttrs = (reprocessed.match(/android:usesCleartextTraffic="true"/g) || []).length;
      assert.equal(occurrences, 1);
      assert.equal(backupAttrs, 1);
      assert.equal(cleartextAttrs, 1);
    });
  });
});
