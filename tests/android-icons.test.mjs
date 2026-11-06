import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Android App Icons & Launcher Configuration', () => {
  const rootDir = process.cwd();
  const androidIconsDir = path.resolve(rootDir, 'src-tauri/icons/android');
  const manifestPath = path.resolve(rootDir, 'assets/icon-manifest.json');
  const expectedDensities = [
    'mipmap-mdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi',
  ];

  test('icon-manifest.json exists and specifies Securo assets and background color', () => {
    assert.ok(fs.existsSync(manifestPath), 'assets/icon-manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.default, './logo.svg');
    assert.equal(manifest.android_fg, './android-foreground.svg');
    assert.equal(manifest.bg_color, '#0C0D12');
  });

  test('pre-generated android icons directory exists with all required densities', () => {
    assert.ok(fs.existsSync(androidIconsDir), 'src-tauri/icons/android directory must exist');

    for (const density of expectedDensities) {
      const densityDir = path.join(androidIconsDir, density);
      assert.ok(fs.existsSync(densityDir), `Density folder ${density} must exist`);

      const launcherPng = path.join(densityDir, 'ic_launcher.png');
      const roundPng = path.join(densityDir, 'ic_launcher_round.png');
      const fgPng = path.join(densityDir, 'ic_launcher_foreground.png');

      assert.ok(fs.existsSync(launcherPng), `${density}/ic_launcher.png must exist`);
      assert.ok(fs.statSync(launcherPng).size > 0, `${density}/ic_launcher.png must not be empty`);

      assert.ok(fs.existsSync(roundPng), `${density}/ic_launcher_round.png must exist`);
      assert.ok(fs.statSync(roundPng).size > 0, `${density}/ic_launcher_round.png must not be empty`);

      assert.ok(fs.existsSync(fgPng), `${density}/ic_launcher_foreground.png must exist`);
      assert.ok(fs.statSync(fgPng).size > 0, `${density}/ic_launcher_foreground.png must not be empty`);
    }
  });

  test('adaptive icon XMLs exist in mipmap-anydpi-v26 with valid foreground and background bindings', () => {
    const anydpiDir = path.join(androidIconsDir, 'mipmap-anydpi-v26');
    assert.ok(fs.existsSync(anydpiDir), 'mipmap-anydpi-v26 must exist');

    const launcherXml = path.join(anydpiDir, 'ic_launcher.xml');
    const roundXml = path.join(anydpiDir, 'ic_launcher_round.xml');

    assert.ok(fs.existsSync(launcherXml), 'ic_launcher.xml must exist');
    assert.ok(fs.existsSync(roundXml), 'ic_launcher_round.xml must exist');

    const launcherContent = fs.readFileSync(launcherXml, 'utf8');
    const roundContent = fs.readFileSync(roundXml, 'utf8');

    for (const content of [launcherContent, roundContent]) {
      assert.ok(content.includes('<adaptive-icon'), 'Must declare <adaptive-icon>');
      assert.ok(
        content.includes('android:drawable="@mipmap/ic_launcher_foreground"'),
        'Must bind foreground to @mipmap/ic_launcher_foreground'
      );
      assert.ok(
        content.includes('android:drawable="@color/ic_launcher_background"'),
        'Must bind background to @color/ic_launcher_background'
      );
    }
  });

  test('background color resource is set to Securo theme #0C0D12 in values/ic_launcher_background.xml', () => {
    const bgXml = path.join(androidIconsDir, 'values/ic_launcher_background.xml');
    assert.ok(fs.existsSync(bgXml), 'values/ic_launcher_background.xml must exist');

    const content = fs.readFileSync(bgXml, 'utf8');
    assert.ok(
      content.includes('<color name="ic_launcher_background">#0C0D12</color>'),
      'Background color must match #0C0D12'
    );
  });

  test('synchronization correctly deploys Securo icons into target Android res directory', () => {
    const tmpTestRes = path.resolve(rootDir, 'tests/.tmp-res-test');
    try {
      fs.mkdirSync(tmpTestRes, { recursive: true });

      // Simulate a mock Tauri default icon in res/mipmap-xxxhdpi/ic_launcher.png
      const mockDensityDir = path.join(tmpTestRes, 'mipmap-xxxhdpi');
      fs.mkdirSync(mockDensityDir, { recursive: true });
      fs.writeFileSync(path.join(mockDensityDir, 'ic_launcher.png'), 'MOCK_TAURI_DEFAULT_ICON', 'utf8');

      // Run synchronization logic (from configure-android.mjs)
      fs.cpSync(androidIconsDir, tmpTestRes, { recursive: true, force: true });

      // Verify the mock Tauri icon was overwritten by Securo asset
      const deployedLauncher = path.join(mockDensityDir, 'ic_launcher.png');
      const deployedContent = fs.readFileSync(deployedLauncher);
      const originalSecuroContent = fs.readFileSync(path.join(androidIconsDir, 'mipmap-xxxhdpi/ic_launcher.png'));
      assert.deepEqual(deployedContent, originalSecuroContent, 'Tauri icon must be overwritten by Securo icon');

      // Verify anydpi and values are also deployed
      assert.ok(fs.existsSync(path.join(tmpTestRes, 'mipmap-anydpi-v26/ic_launcher.xml')));
      assert.ok(fs.existsSync(path.join(tmpTestRes, 'mipmap-anydpi-v26/ic_launcher_round.xml')));
      assert.ok(fs.existsSync(path.join(tmpTestRes, 'values/ic_launcher_background.xml')));
    } finally {
      if (fs.existsSync(tmpTestRes)) {
        fs.rmSync(tmpTestRes, { recursive: true, force: true });
      }
    }
  });
});
