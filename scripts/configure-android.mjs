import fs from 'node:fs';
import path from 'node:path';

console.log('--- Configuring Android App Settings, Manifest & MainActivity ---');

// 1. Configure strings.xml (App name as displayed on phone launcher and recents)
const stringsPath = path.resolve('src-tauri/gen/android/app/src/main/res/values/strings.xml');
if (fs.existsSync(stringsPath)) {
  let stringsContent = fs.readFileSync(stringsPath, 'utf8');
  stringsContent = stringsContent.replace(
    /<string name="app_name">.*?<\/string>/,
    '<string name="app_name">Securo</string>'
  );
  stringsContent = stringsContent.replace(
    /<string name="main_activity_title">.*?<\/string>/,
    '<string name="main_activity_title">Securo</string>'
  );
  fs.writeFileSync(stringsPath, stringsContent, 'utf8');
  console.log('Configured strings.xml with app_name: Securo');
} else {
  console.warn(`Warning: strings.xml not found at ${stringsPath}`);
}

// 2. Configure AndroidManifest.xml (Permissions & Round Icon)
const manifestPath = path.resolve('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  let modified = false;

  if (!manifest.includes('android.permission.ACCESS_NETWORK_STATE')) {
    manifest = manifest.replace(
      /(<uses-permission\s+android:name="android\.permission\.INTERNET"\s*\/>)/,
      '$1\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
    );
    modified = true;
    console.log('Added ACCESS_NETWORK_STATE permission to AndroidManifest.xml');
  }

  // Ensure roundIcon is configured on <application>
  if (!manifest.includes('android:roundIcon=')) {
    manifest = manifest.replace(
      /(<application[\s\S]*?android:icon="@mipmap\/ic_launcher")/,
      '$1\n        android:roundIcon="@mipmap/ic_launcher_round"'
    );
    modified = true;
    console.log('Added android:roundIcon="@mipmap/ic_launcher_round" to AndroidManifest.xml');
  }

  if (modified) {
    fs.writeFileSync(manifestPath, manifest, 'utf8');
  } else {
    console.log('AndroidManifest.xml already properly configured.');
  }
} else {
  console.warn(`Warning: Manifest not found at ${manifestPath}`);
}

// 3. Configure Adaptive Icon XMLs, Background Color & Assets
const resDir = path.resolve('src-tauri/gen/android/app/src/main/res');
const valuesDir = path.join(resDir, 'values');
const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
const iconsAndroidDir = path.resolve('src-tauri/icons/android');

if (fs.existsSync(resDir)) {
  // Always synchronize application icons from pre-generated src-tauri/icons/android if available
  if (fs.existsSync(iconsAndroidDir)) {
    fs.cpSync(iconsAndroidDir, resDir, { recursive: true, force: true });
    console.log('Synchronized application icons from src-tauri/icons/android to Android res.');
  } else {
    // If icons are missing, run generate-icons.mjs to generate and deploy them
    const generateScript = path.resolve('scripts/generate-icons.mjs');
    if (fs.existsSync(generateScript)) {
      console.log('Pre-generated icons not found. Running generate-icons.mjs...');
      const { execSync } = await import('node:child_process');
      execSync(`node "${generateScript}"`, { stdio: 'inherit' });
    }
  }

  if (!fs.existsSync(valuesDir)) {
    fs.mkdirSync(valuesDir, { recursive: true });
  }
  const bgXmlPath = path.join(valuesDir, 'ic_launcher_background.xml');
  const bgContent = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#0C0D12</color>\n</resources>\n`;
  fs.writeFileSync(bgXmlPath, bgContent, 'utf8');

  if (!fs.existsSync(anydpiDir)) {
    fs.mkdirSync(anydpiDir, { recursive: true });
  }
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n  <background android:drawable="@color/ic_launcher_background"/>\n</adaptive-icon>\n`;
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');
  console.log('Configured adaptive icons (ic_launcher.xml and ic_launcher_round.xml).');
}

// 4. Update MainActivity.kt from bridge template
const mainActivityPath = path.resolve('src-tauri/gen/android/app/src/main/java/com/securo/mobile/MainActivity.kt');
const bridgeMainActivity = path.resolve('src-tauri/bridge/MainActivity.kt');

if (fs.existsSync(bridgeMainActivity) && fs.existsSync(path.dirname(mainActivityPath))) {
  fs.copyFileSync(bridgeMainActivity, mainActivityPath);
  console.log('MainActivity.kt updated from bridge template.');
} else {
  console.warn(`Warning: Could not copy MainActivity.kt (target directory or source missing)`);
}
