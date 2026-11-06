import fs from 'node:fs';
import path from 'node:path';

console.log('--- Configuring Android Manifest & MainActivity ---');

const manifestPath = path.resolve('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('android.permission.ACCESS_NETWORK_STATE')) {
    manifest = manifest.replace(
      /(<uses-permission\s+android:name="android\.permission\.INTERNET"\s*\/>)/,
      '$1\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
    );
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    console.log('Added ACCESS_NETWORK_STATE permission to AndroidManifest.xml');
  } else {
    console.log('ACCESS_NETWORK_STATE permission already present.');
  }
} else {
  console.warn(`Warning: Manifest not found at ${manifestPath}`);
}

const mainActivityPath = path.resolve('src-tauri/gen/android/app/src/main/java/com/securo/mobile/MainActivity.kt');
const bridgeMainActivity = path.resolve('src-tauri/bridge/MainActivity.kt');

if (fs.existsSync(bridgeMainActivity) && fs.existsSync(path.dirname(mainActivityPath))) {
  fs.copyFileSync(bridgeMainActivity, mainActivityPath);
  console.log('MainActivity.kt updated from bridge template.');
} else {
  console.warn(`Warning: Could not copy MainActivity.kt (target directory or source missing)`);
}
