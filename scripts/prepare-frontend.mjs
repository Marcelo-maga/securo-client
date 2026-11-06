import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.SECURO_REPOSITORY || 'securo-finance/securo';
const FRONTEND_PATH = process.env.SECURO_FRONTEND_PATH || 'frontend';
const TARGET_DIR = path.resolve('.securo-frontend');
const BRIDGE_DIR = path.resolve('src-tauri/bridge');

function run(command, cwd = process.cwd()) {
  execSync(command, { cwd, stdio: 'inherit' });
}

console.log('--- 1. Fetching Securo Frontend ---');
if (!fs.existsSync(TARGET_DIR)) {
  const tempRepo = path.resolve('.securo-frontend-repository');
  if (fs.existsSync(tempRepo)) {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }

  console.log(`Cloning sparse repository: ${REPO}...`);
  run(`git clone --depth 1 --filter=blob:none --sparse "https://github.com/${REPO}.git" "${tempRepo}"`);
  run(`git -C "${tempRepo}" sparse-checkout set "${FRONTEND_PATH}"`);

  const extracted = path.join(tempRepo, FRONTEND_PATH);
  if (!fs.existsSync(extracted)) {
    throw new Error(`Frontend directory "${FRONTEND_PATH}" not found in repository`);
  }

  fs.renameSync(extracted, TARGET_DIR);
  fs.rmSync(tempRepo, { recursive: true, force: true });
  console.log('Frontend source ready in .securo-frontend');
} else {
  console.log('.securo-frontend directory already present, skipping clone.');
}

console.log('--- 2. Applying Mobile Adaptations ---');
const srcDir = path.join(TARGET_DIR, 'src');

// Copy mobile-overrides.css
const mobileOverridesSrc = path.join(BRIDGE_DIR, 'mobile-overrides.css');
const mobileOverridesDest = path.join(srcDir, 'mobile-overrides.css');
fs.copyFileSync(mobileOverridesSrc, mobileOverridesDest);

// Import mobile-overrides.css in main.tsx
const mainTsxPath = path.join(srcDir, 'main.tsx');
if (fs.existsSync(mainTsxPath)) {
  let mainContent = fs.readFileSync(mainTsxPath, 'utf8');
  if (!mainContent.includes('mobile-overrides.css')) {
    mainContent += '\nimport "./mobile-overrides.css";\n';
    fs.writeFileSync(mainTsxPath, mainContent, 'utf8');
  }
}

// Convert BrowserRouter to HashRouter in App.tsx
const appTsxPath = path.join(srcDir, 'App.tsx');
if (fs.existsSync(appTsxPath)) {
  let appContent = fs.readFileSync(appTsxPath, 'utf8');
  if (appContent.includes('BrowserRouter')) {
    appContent = appContent.replaceAll('BrowserRouter', 'HashRouter');
    fs.writeFileSync(appTsxPath, appContent, 'utf8');
  }
}

// Update vite.config.ts for relative base path
const viteConfigPath = path.join(TARGET_DIR, 'vite.config.ts');
if (fs.existsSync(viteConfigPath)) {
  let viteContent = fs.readFileSync(viteConfigPath, 'utf8');
  if (!viteContent.includes('base: "./"')) {
    viteContent = viteContent.replace(/define:\s*\{/, 'base: "./",\n    define: {');
    fs.writeFileSync(viteConfigPath, viteContent, 'utf8');
  }
}

// Patch optional chaining for .find calls to prevent undefined runtime errors
function patchFindCalls(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchFindCalls(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const original = content;

      content = content.replace(/(\.[a-zA-Z0-9_]+)\.find\(/g, '$1?.find(');
      content = content.replace(/([a-zA-Z0-9_]+)\.current\.find\(/g, '$1.current?.find(');
      content = content.replace(/([a-zA-Z0-9_]+)\.baseline\.find\(/g, '$1.baseline?.find(');
      content = content.replace(/([a-zA-Z0-9_]+)\.days\.find\(/g, '$1.days?.find(');
      content = content.replace(/([a-zA-Z0-9_]+)\.installments\.find\(/g, '$1.installments?.find(');
      content = content.replace(/([a-zA-Z0-9_]+)\.assets\.find\(/g, '$1.assets?.find(');
      content = content.replace(/([a-zA-Z0-9_]+)\.actions\.find\(/g, '$1.actions?.find(');

      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

patchFindCalls(srcDir);
console.log('Frontend code adapted for mobile webview.');

console.log('--- 3. Installing dependencies & building frontend ---');
if (fs.existsSync(path.join(TARGET_DIR, 'package-lock.json'))) {
  run('npm ci', TARGET_DIR);
} else if (fs.existsSync(path.join(TARGET_DIR, 'pnpm-lock.yaml'))) {
  run('corepack enable && pnpm install --frozen-lockfile', TARGET_DIR);
} else if (fs.existsSync(path.join(TARGET_DIR, 'yarn.lock'))) {
  run('corepack enable && yarn install --immutable', TARGET_DIR);
} else {
  run('npm install', TARGET_DIR);
}

run('npm run build', TARGET_DIR);
console.log('Securo frontend built successfully!');
