import { buildSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('.securo-frontend/dist');
const OUT_DIR = path.resolve('dist');
const SRC_DIR = path.resolve('src');
const BRIDGE_JS = path.resolve('src-tauri/bridge/http-bridge.js');

export function findInlineScripts(htmlContent) {
  const html = String(htmlContent || '');
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    ([, attrs, body]) => !/\bsrc\s*=/i.test(attrs) && body.trim().length > 0
  );
}

export function hasValidStagedDist(outDir = OUT_DIR) {
  const requiredFiles = [
    path.join(outDir, 'index.html'),
    path.join(outDir, 'bootstrap.js'),
    path.join(outDir, 'app.html'),
    path.join(outDir, 'securo-http-bridge.js'),
    path.join(outDir, 'config', 'config.html'),
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      return false;
    }
  }

  const appHtml = fs.readFileSync(path.join(outDir, 'app.html'), 'utf8');
  if (!appHtml.includes('securo-http-bridge.js')) {
    return false;
  }

  return findInlineScripts(appHtml).length === 0;
}

export function stageFrontend(options = {}) {
  const distDir = options.distDir ?? DIST_DIR;
  const outDir = options.outDir ?? OUT_DIR;
  const srcDir = options.srcDir ?? SRC_DIR;
  const bridgeJs = options.bridgeJs ?? BRIDGE_JS;
  const allowFallback =
    options.allowFallback ??
    (process.argv.includes('--allow-fallback') || process.env.SECURO_ALLOW_FALLBACK === '1');
  const skipIfStaged =
    options.skipIfStaged ?? process.argv.includes('--skip-if-staged');

  console.log('--- Staging Frontend into dist/ for Tauri ---');

  const hasUpstreamDist = fs.existsSync(distDir);
  if (!hasUpstreamDist) {
    if (skipIfStaged) {
      if (hasValidStagedDist(outDir)) {
        console.log('Verified pre-staged dist/ bundle (--skip-if-staged); preserving existing artifacts.');
        return;
      }
      throw new Error(
        `Neither upstream build (${distDir}) nor a valid pre-staged bundle (${outDir}) was found. ` +
          'Run "npm run frontend:prepare && npm run frontend:stage" before building.'
      );
    }

    if (allowFallback) {
      console.log('Notice: .securo-frontend/dist not found. Staging fallback bundle for local development...');
    } else {
      throw new Error(
        `${distDir} not found. Run "npm run frontend:prepare" first or pass --allow-fallback for local dev.`
      );
    }
  }

  const isFallback = !hasUpstreamDist;

  // 1. Clean and initialize dist directory
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // 2. Populate main application
  if (hasUpstreamDist) {
    fs.cpSync(distDir, outDir, { recursive: true });
    // Rename index.html to app.html (so index.html is our bootstrap entry)
    const originalIndexHtml = path.join(outDir, 'index.html');
    const appHtml = path.join(outDir, 'app.html');
    if (fs.existsSync(originalIndexHtml)) {
      fs.renameSync(originalIndexHtml, appHtml);
    }
  } else {
    // Staging lightweight development fallback
    const fallbackAppHtml = path.join(srcDir, 'app.html');
    const fallbackAppJs = path.join(srcDir, 'app-fallback.js');
    if (fs.existsSync(fallbackAppHtml)) {
      fs.copyFileSync(fallbackAppHtml, path.join(outDir, 'app.html'));
    }
    if (fs.existsSync(fallbackAppJs)) {
      fs.copyFileSync(fallbackAppJs, path.join(outDir, 'app-fallback.js'));
    }
  }

  // 3. Copy Bootstrap Entry (index.html + bootstrap.js) from src/
  fs.copyFileSync(path.join(srcDir, 'index.html'), path.join(outDir, 'index.html'));
  fs.copyFileSync(path.join(srcDir, 'bootstrap.js'), path.join(outDir, 'bootstrap.js'));

  // 4. Copy Mobile CSS Overrides
  fs.copyFileSync(path.join(srcDir, 'mobile-overrides.css'), path.join(outDir, 'mobile-overrides.css'));

  // 5. Copy Favicon
  const faviconSrc = path.join(srcDir, 'favicon.ico');
  if (fs.existsSync(faviconSrc)) {
    fs.copyFileSync(faviconSrc, path.join(outDir, 'favicon.ico'));
  }

  // 6. Copy Configuration UI into dist/config
  const srcConfigDir = path.join(srcDir, 'config');
  const outConfigDir = path.join(outDir, 'config');
  if (fs.existsSync(srcConfigDir)) {
    fs.cpSync(srcConfigDir, outConfigDir, { recursive: true });
  }

  // 7. Bundle HTTP bridge using esbuild JS API (no shell invocation) into dist/securo-http-bridge.js
  const bridgeJsOut = path.join(outDir, 'securo-http-bridge.js');
  console.log('Bundling HTTP bridge with esbuild...');
  buildSync({
    entryPoints: [bridgeJs],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    define: {
      __SECURO_DEV__: isFallback ? 'true' : 'false',
    },
    outfile: bridgeJsOut,
  });

  // 8. Inject HTTP Bridge & Mobile Overrides into app.html (if upstream dist exists)
  const appHtmlPath = path.join(outDir, 'app.html');
  if (fs.existsSync(appHtmlPath) && hasUpstreamDist) {
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
      html = html.replace(
        'width=device-width, initial-scale=1.0',
        'width=device-width, initial-scale=1.0, viewport-fit=cover'
      );
    }

    fs.writeFileSync(appHtmlPath, html, 'utf8');
  }

  // 9. Enforce CSP invariant: staged app.html must not contain inline executable <script> tags
  if (fs.existsSync(appHtmlPath)) {
    const finalAppHtml = fs.readFileSync(appHtmlPath, 'utf8');
    const inlineScripts = findInlineScripts(finalAppHtml);
    if (inlineScripts.length > 0) {
      throw new Error(
        `Staged app.html contains ${inlineScripts.length} inline <script> block(s), which violates CSP script-src 'self'.`
      );
    }
  }

  console.log('Frontend staged successfully into dist/ for Tauri bundle.');
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isDirectExecution) {
  try {
    stageFrontend();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
