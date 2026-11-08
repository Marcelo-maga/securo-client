import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('.securo-frontend/dist');
const OUT_DIR = path.resolve('dist');
const SRC_DIR = path.resolve('src');
const BRIDGE_JS = path.resolve('src-tauri/bridge/http-bridge.js');
const ALLOW_FALLBACK = process.argv.includes('--allow-fallback') || process.env.SECURO_ALLOW_FALLBACK === '1';

export function stageFrontend() {
  console.log('--- Staging Frontend into dist/ for Tauri ---');

  if (!fs.existsSync(DIST_DIR)) {
    if (ALLOW_FALLBACK) {
      console.log('Notice: .securo-frontend/dist not found. Staging fallback bundle for local development...');
    } else {
      console.error(`Error: ${DIST_DIR} not found. Run "npm run frontend:prepare" first or pass --allow-fallback.`);
      process.exit(1);
    }
  }

  // 1. Clean and initialize dist directory
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 2. Populate main application
  if (fs.existsSync(DIST_DIR)) {
    fs.cpSync(DIST_DIR, OUT_DIR, { recursive: true });
    // Rename index.html to app.html (so index.html is our bootstrap entry)
    const originalIndexHtml = path.join(OUT_DIR, 'index.html');
    const appHtml = path.join(OUT_DIR, 'app.html');
    if (fs.existsSync(originalIndexHtml)) {
      fs.renameSync(originalIndexHtml, appHtml);
    }
  } else {
    // Staging lightweight development fallback
    const fallbackAppHtml = path.join(SRC_DIR, 'app.html');
    const fallbackAppJs = path.join(SRC_DIR, 'app-fallback.js');
    if (fs.existsSync(fallbackAppHtml)) {
      fs.copyFileSync(fallbackAppHtml, path.join(OUT_DIR, 'app.html'));
    }
    if (fs.existsSync(fallbackAppJs)) {
      fs.copyFileSync(fallbackAppJs, path.join(OUT_DIR, 'app-fallback.js'));
    }
  }

  // 3. Copy Bootstrap Entry (index.html + bootstrap.js) from src/
  fs.copyFileSync(path.join(SRC_DIR, 'index.html'), path.join(OUT_DIR, 'index.html'));
  fs.copyFileSync(path.join(SRC_DIR, 'bootstrap.js'), path.join(OUT_DIR, 'bootstrap.js'));

  // 4. Copy Mobile CSS Overrides
  fs.copyFileSync(path.join(SRC_DIR, 'mobile-overrides.css'), path.join(OUT_DIR, 'mobile-overrides.css'));

  // 5. Copy Favicon
  const faviconSrc = path.join(SRC_DIR, 'favicon.ico');
  if (fs.existsSync(faviconSrc)) {
    fs.copyFileSync(faviconSrc, path.join(OUT_DIR, 'favicon.ico'));
  }

  // 6. Copy Configuration UI into dist/config
  const srcConfigDir = path.join(SRC_DIR, 'config');
  const outConfigDir = path.join(OUT_DIR, 'config');
  if (fs.existsSync(srcConfigDir)) {
    fs.cpSync(srcConfigDir, outConfigDir, { recursive: true });
  }

  // 7. Bundle HTTP bridge using esbuild into dist/securo-http-bridge.js
  const bridgeJsOut = path.join(OUT_DIR, 'securo-http-bridge.js');
  console.log('Bundling HTTP bridge with esbuild...');
  execSync(`npx esbuild "${BRIDGE_JS}" --bundle --format=iife --platform=browser --outfile="${bridgeJsOut}"`, {
    stdio: 'inherit',
  });

  // 8. Inject HTTP Bridge & Mobile Overrides into app.html (if upstream dist exists)
  const appHtmlPath = path.join(OUT_DIR, 'app.html');
  if (fs.existsSync(appHtmlPath) && fs.existsSync(DIST_DIR)) {
    let html = fs.readFileSync(appHtmlPath, 'utf8');

    // Bridge in head, CSS before closing head
    const bridgeScriptTag = '<script src="./securo-http-bridge.js"></script>';
    const cssLinkTag = '<link rel="stylesheet" href="./mobile-overrides.css">';

    if (!html.includes('securo-http-bridge.js')) {
      html = html.replace(/<head>/i, `<head>\n${bridgeScriptTag}`);
    }
    if (!html.includes('mobile-overrides.css')) {
      html = html.replace(/<\/head>/i, `  ${cssLinkTag}\n</head>`);
    }
    if (!html.includes('viewport-fit=cover')) {
      html = html.replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    }

    fs.writeFileSync(appHtmlPath, html, 'utf8');
  }

  console.log('Frontend staged successfully into dist/ for Tauri bundle.');
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isDirectExecution) {
  stageFrontend();
}
