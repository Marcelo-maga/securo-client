import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('.securo-frontend/dist');
const SRC_DIR = path.resolve('src');
const BRIDGE_DIR = path.resolve('src-tauri/bridge');
const BACKUP_CONFIG_DIR = path.resolve('.securo-config');

if (!fs.existsSync(DIST_DIR)) {
  console.error(`Error: ${DIST_DIR} not found. Run prepare-frontend first.`);
  process.exit(1);
}

console.log('--- Staging Frontend for Tauri ---');

// 1. Preserve local config UI if present
if (fs.existsSync(BACKUP_CONFIG_DIR)) {
  fs.rmSync(BACKUP_CONFIG_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BACKUP_CONFIG_DIR, { recursive: true });

const srcConfigDir = path.join(SRC_DIR, 'config');
if (fs.existsSync(srcConfigDir)) {
  fs.cpSync(srcConfigDir, BACKUP_CONFIG_DIR, { recursive: true });
} else {
  const setupHtml = path.join(SRC_DIR, 'setup.html');
  if (fs.existsSync(setupHtml)) {
    fs.copyFileSync(setupHtml, path.join(BACKUP_CONFIG_DIR, 'config.html'));
  }
  for (const folder of ['scripts', 'styles', 'locales']) {
    const srcFolder = path.join(SRC_DIR, folder);
    if (fs.existsSync(srcFolder)) {
      fs.cpSync(srcFolder, path.join(BACKUP_CONFIG_DIR, folder), { recursive: true });
    }
  }
}

// 2. Clear src and populate with frontend dist
fs.rmSync(SRC_DIR, { recursive: true, force: true });
fs.cpSync(DIST_DIR, SRC_DIR, { recursive: true });

// 3. Rename index.html to app.html
const originalIndexHtml = path.join(SRC_DIR, 'index.html');
const appHtml = path.join(SRC_DIR, 'app.html');
if (fs.existsSync(originalIndexHtml)) {
  fs.renameSync(originalIndexHtml, appHtml);
}

// 4. Restore config directory into src/config
const destConfigDir = path.join(SRC_DIR, 'config');
fs.mkdirSync(destConfigDir, { recursive: true });
fs.cpSync(BACKUP_CONFIG_DIR, destConfigDir, { recursive: true });

// 5. Copy bootstrap and mobile overrides
fs.copyFileSync(path.join(BRIDGE_DIR, 'bootstrap.html'), path.join(SRC_DIR, 'index.html'));
fs.copyFileSync(path.join(BRIDGE_DIR, 'mobile-overrides.css'), path.join(SRC_DIR, 'mobile-overrides.css'));

// 6. Bundle http-bridge.js using esbuild
const bridgeJsOut = path.join(SRC_DIR, 'securo-http-bridge.js');
console.log('Bundling HTTP bridge with esbuild...');
execSync(`npx esbuild "${path.join(BRIDGE_DIR, 'http-bridge.js')}" --bundle --format=iife --platform=browser --outfile="${bridgeJsOut}"`, {
  stdio: 'inherit',
});

// 7. Inject error boundary script, CSS override and HTTP bridge into app.html
if (fs.existsSync(appHtml)) {
  let html = fs.readFileSync(appHtml, 'utf8');

  const errorAndBridgeSnippet = `<script>
window.addEventListener("error", function(e) {
  var b = document.getElementById("securo-err");
  if (!b) {
    b = document.createElement("div");
    b.id = "securo-err";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#fff;padding:12px;font-family:monospace;font-size:12px;word-break:break-all;max-height:50vh;overflow:auto;";
    (document.body || document.documentElement).appendChild(b);
  }
  b.innerHTML += "<b>JS Error:</b> " + (e.message || e.error || e) + "<br/>";
});
window.addEventListener("unhandledrejection", function(e) {
  var b = document.getElementById("securo-err");
  if (!b) {
    b = document.createElement("div");
    b.id = "securo-err";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#fff;padding:12px;font-family:monospace;font-size:12px;word-break:break-all;max-height:50vh;overflow:auto;";
    (document.body || document.documentElement).appendChild(b);
  }
  b.innerHTML += "<b>Promise Error:</b> " + (e.reason?.message || e.reason || e) + "<br/>";
});
</script>
<link rel="stylesheet" href="./mobile-overrides.css">
<script src="./securo-http-bridge.js"></script>`;

  html = html.replace(/<head>/i, '<head>\n' + errorAndBridgeSnippet);

  if (!html.includes('viewport-fit=cover')) {
    html = html.replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  }

  fs.writeFileSync(appHtml, html, 'utf8');
}

// Clean up temporary config backup
fs.rmSync(BACKUP_CONFIG_DIR, { recursive: true, force: true });

console.log('Frontend staged successfully for Tauri bundle.');
