import fs from 'node:fs';
import path from 'node:path';

export function configureStringsXml(xmlContent) {
  let content = xmlContent;
  content = content.replace(
    /<string name="app_name">.*?<\/string>/,
    '<string name="app_name">Securo</string>'
  );
  content = content.replace(
    /<string name="main_activity_title">.*?<\/string>/,
    '<string name="main_activity_title">Securo</string>'
  );
  return content;
}

export function configureAndroidManifest(xmlContent) {
  let manifest = xmlContent;
  if (!manifest.includes('android.permission.ACCESS_NETWORK_STATE')) {
    manifest = manifest.replace(
      /(<uses-permission\s+android:name="android\.permission\.INTERNET"\s*\/>)/,
      '$1\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
    );
  }

  // Ensure roundIcon is configured on <application>
  if (!manifest.includes('android:roundIcon=')) {
    manifest = manifest.replace(
      /(<application[\s\S]*?android:icon="@mipmap\/ic_launcher")/,
      '$1\n        android:roundIcon="@mipmap/ic_launcher_round"'
    );
  }
  return manifest;
}

export async function configureAndroid() {
  console.log('--- Configuring Android App Settings, Manifest & MainActivity ---');

  // 1. Configure strings.xml (App name as displayed on phone launcher and recents)
  const stringsPath = path.resolve('src-tauri/gen/android/app/src/main/res/values/strings.xml');
  if (fs.existsSync(stringsPath)) {
    const stringsContent = fs.readFileSync(stringsPath, 'utf8');
    const updated = configureStringsXml(stringsContent);
    fs.writeFileSync(stringsPath, updated, 'utf8');
    console.log('Configured strings.xml with app_name: Securo');
  } else {
    console.warn(`Warning: strings.xml not found at ${stringsPath}`);
  }

  // 2. Configure AndroidManifest.xml (Permissions & Round Icon)
  const manifestPath = path.resolve('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    const updated = configureAndroidManifest(manifest);
    if (updated !== manifest) {
      fs.writeFileSync(manifestPath, updated, 'utf8');
      console.log('Updated AndroidManifest.xml');
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
    if (fs.existsSync(iconsAndroidDir)) {
      fs.cpSync(iconsAndroidDir, resDir, { recursive: true, force: true });
      console.log('Synchronized application icons from src-tauri/icons/android to Android res.');
    } else {
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
  const mainActivityPath = path.resolve('src-tauri/gen/android/app/src/main/java/com/securo/client/MainActivity.kt');
  const bridgeMainActivity = path.resolve('src-tauri/bridge/MainActivity.kt');

  if (fs.existsSync(bridgeMainActivity) && fs.existsSync(path.dirname(mainActivityPath))) {
    fs.copyFileSync(bridgeMainActivity, mainActivityPath);
    console.log('MainActivity.kt updated from bridge template.');
  } else {
    console.warn(`Warning: Could not copy MainActivity.kt (target directory or source missing)`);
  }
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isDirectExecution) {
  configureAndroid();
}
