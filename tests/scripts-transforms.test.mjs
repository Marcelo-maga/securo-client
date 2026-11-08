import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  patchRouter,
  patchViteConfig,
  patchOptionalChaining,
} from '../scripts/prepare-frontend.mjs';
import {
  configureStringsXml,
  configureAndroidManifest,
} from '../scripts/configure-android.mjs';

describe('Frontend & Android Pipeline Code Transformations', () => {
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

    test('leaves existing optional chains safe without duplicating syntax (?..find)', () => {
      const sample = `const x = list?.find((item) => item.active);`;
      const patched = patchOptionalChaining(sample);
      assert.ok(!patched.includes('?..find'));
      assert.ok(!patched.includes('???'));
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

    test('injects ACCESS_NETWORK_STATE after INTERNET permission in AndroidManifest.xml', () => {
      const inputXml = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher">
    </application>
</manifest>
`;
      const outputXml = configureAndroidManifest(inputXml);
      assert.ok(outputXml.includes('android.permission.ACCESS_NETWORK_STATE'));
      assert.ok(outputXml.includes('android:roundIcon="@mipmap/ic_launcher_round"'));
    });

    test('is idempotent when permissions and roundIcon are already injected', () => {
      const alreadyConfigured = `
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round">
    </application>
`;
      const reprocessed = configureAndroidManifest(alreadyConfigured);
      const occurrences = (reprocessed.match(/ACCESS_NETWORK_STATE/g) || []).length;
      assert.equal(occurrences, 1);
    });
  });
});
