import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Generating Application Icons for Android, Desktop, and iOS ---');

const ROOT_DIR = process.cwd();
const ASSETS_DIR = path.resolve(ROOT_DIR, 'assets');
const LOGO_SVG = path.join(ASSETS_DIR, 'logo.svg');
const ANDROID_FG_SVG = path.join(ASSETS_DIR, 'android-foreground.svg');
const MANIFEST_PATH = path.join(ASSETS_DIR, 'icon-manifest.json');

if (!fs.existsSync(LOGO_SVG)) {
  const fallbackSvg = path.resolve(ROOT_DIR, '../securo/docs/logo.svg');
  if (fs.existsSync(fallbackSvg)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    fs.copyFileSync(fallbackSvg, LOGO_SVG);
    console.log('Copied logo.svg from ../securo/docs/logo.svg');
  } else {
    console.error(`Error: Master icon not found at ${LOGO_SVG} or ${fallbackSvg}`);
    process.exit(1);
  }
}

// Generate scaled SVG for Android adaptive foreground (65% scale centered in 460x460 safe area)
const originalSvg = fs.readFileSync(LOGO_SVG, 'utf8');
const scaledSvg = originalSvg.replace(
  /translate\(0,\s*460\)\s*scale\(0\.10000000149011612,\s*-0\.10000000149011612\)\s*/,
  'translate(80.5, 379.5) scale(0.065, -0.065) '
);
fs.writeFileSync(ANDROID_FG_SVG, scaledSvg, 'utf8');
console.log('Generated safe-zone scaled android-foreground.svg');

// Create Tauri icon manifest
const manifest = {
  default: './logo.svg',
  android_fg: './android-foreground.svg',
  bg_color: '#0C0D12',
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// Run tauri icon CLI
console.log('Invoking tauri icon generator...');
execSync(`npx tauri icon "${MANIFEST_PATH}"`, { stdio: 'inherit', cwd: ROOT_DIR });

// Helper to ensure adaptive icon XML files are present
function ensureAdaptiveIconXmls(targetDir) {
  const valuesDir = path.join(targetDir, 'values');
  const anydpiDir = path.join(targetDir, 'mipmap-anydpi-v26');

  if (!fs.existsSync(valuesDir)) fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#0C0D12</color>\n</resources>\n',
    'utf8'
  );

  if (!fs.existsSync(anydpiDir)) fs.mkdirSync(anydpiDir, { recursive: true });
  const adaptiveXml =
    '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n  <background android:drawable="@color/ic_launcher_background"/>\n</adaptive-icon>\n';
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');
}

// Ensure pre-generated icons in src-tauri/icons/android have adaptive and round icon XMLs
const iconsAndroidDir = path.resolve(ROOT_DIR, 'src-tauri/icons/android');
if (fs.existsSync(iconsAndroidDir)) {
  ensureAdaptiveIconXmls(iconsAndroidDir);
}

// If Android native project exists in src-tauri/gen/android, sync all assets into its res directory
const resDir = path.resolve(ROOT_DIR, 'src-tauri/gen/android/app/src/main/res');
if (fs.existsSync(resDir)) {
  if (fs.existsSync(iconsAndroidDir)) {
    fs.cpSync(iconsAndroidDir, resDir, { recursive: true, force: true });
    console.log('Synchronized generated Android mipmaps from src-tauri/icons/android to gen/android res');
  }
  ensureAdaptiveIconXmls(resDir);
}

console.log('All icons generated successfully!');
