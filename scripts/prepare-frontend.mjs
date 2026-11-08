import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolvePinnedRef(projectRoot = path.resolve(__dirname, '..')) {
  if (process.env.SECURO_REF && process.env.SECURO_REF.trim() !== '') {
    return process.env.SECURO_REF.trim();
  }
  const pinPath = path.join(projectRoot, '.upstream-version');
  if (fs.existsSync(pinPath)) {
    try {
      const pin = fs.readFileSync(pinPath, 'utf8').trim();
      if (pin) return pin;
    } catch {
      // Fall back if file unreadable
    }
  }
  return '';
}

export const REPO = (process.env.SECURO_REPOSITORY || 'securo-finance/securo').trim();
export const REF = resolvePinnedRef();
export const FRONTEND_PATH = (process.env.SECURO_FRONTEND_PATH || 'frontend').trim();
export const FORCE_CLEAN = process.argv.includes('--clean') || process.env.SECURO_CLEAN === '1';
export const TARGET_DIR = path.resolve('.securo-frontend');

const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_GIT_REF_RE = /^[A-Za-z0-9._/-]+$/;
const SAFE_SUBPATH_RE = /^[A-Za-z0-9._/-]+$/;

export function validateFrontendSourceConfig({
  repo = REPO,
  ref = REF,
  frontendPath = FRONTEND_PATH,
} = {}) {
  if (!repo || !REPO_SLUG_RE.test(repo) || repo.includes('..')) {
    throw new Error(`Invalid SECURO_REPOSITORY "${repo}". Expected "owner/repo" format.`);
  }

  if (ref) {
    if (ref.startsWith('-') || ref.includes('..') || !SAFE_GIT_REF_RE.test(ref)) {
      throw new Error(`Invalid SECURO_REF "${ref}". Ref contains unsafe characters or option flags.`);
    }
  }

  if (
    !frontendPath ||
    frontendPath.startsWith('-') ||
    frontendPath.startsWith('/') ||
    path.isAbsolute(frontendPath) ||
    !SAFE_SUBPATH_RE.test(frontendPath) ||
    frontendPath.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`Invalid SECURO_FRONTEND_PATH "${frontendPath}". Must be a safe relative subdirectory.`);
  }

  return { repo, ref, frontendPath };
}

export function runGit(args, cwd = process.cwd()) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

export function runPackageScript(command, cwd = process.cwd()) {
  execSync(command, { cwd, stdio: 'inherit' });
}

export function patchRouter(appTsxContent) {
  if (appTsxContent.includes('BrowserRouter')) {
    return appTsxContent.replaceAll('BrowserRouter', 'HashRouter');
  }
  return appTsxContent;
}

export function patchViteConfig(viteConfigContent) {
  if (!viteConfigContent.includes('base: "./"')) {
    return viteConfigContent.replace(/define:\s*\{/, 'base: "./",\n    define: {');
  }
  return viteConfigContent;
}

function patchOptionalChainingSegment(segment) {
  let content = segment;
  content = content.replace(/(\.[a-zA-Z0-9_]+)\.find\(/g, '$1?.find(');
  content = content.replace(/([a-zA-Z0-9_]+)\.current\.find\(/g, '$1.current?.find(');
  content = content.replace(/([a-zA-Z0-9_]+)\.baseline\.find\(/g, '$1.baseline?.find(');
  content = content.replace(/([a-zA-Z0-9_]+)\.days\.find\(/g, '$1.days?.find(');
  content = content.replace(/([a-zA-Z0-9_]+)\.installments\.find\(/g, '$1.installments?.find(');
  content = content.replace(/([a-zA-Z0-9_]+)\.assets\.find\(/g, '$1.assets?.find(');
  content = content.replace(/([a-zA-Z0-9_]+)\.actions\.find\(/g, '$1.actions?.find(');
  return content;
}

export function patchOptionalChaining(code) {
  // Tokenize string literals and comments so only executable TS/TSX code segments are patched
  const nonCodePattern = /(\"(?:\\.|[^"\\])*\"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  let result = '';
  let lastIndex = 0;

  for (const match of code.matchAll(nonCodePattern)) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      result += patchOptionalChainingSegment(code.slice(lastIndex, matchStart));
    }
    result += match[0];
    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < code.length) {
    result += patchOptionalChainingSegment(code.slice(lastIndex));
  }

  return result;
}

export function patchFindCalls(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchFindCalls(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const patched = patchOptionalChaining(content);
      if (patched !== content) {
        fs.writeFileSync(fullPath, patched, 'utf8');
      }
    }
  }
}

export function prepareFrontend() {
  const { repo, ref, frontendPath } = validateFrontendSourceConfig();

  if (FORCE_CLEAN && fs.existsSync(TARGET_DIR)) {
    console.log('Cleaning existing .securo-frontend directory (--clean)...');
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }

  console.log('--- 1. Fetching Securo Frontend ---');
  if (!fs.existsSync(TARGET_DIR)) {
    const tempRepo = path.resolve('.securo-frontend-repository');
    if (fs.existsSync(tempRepo)) {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    }

    const repoUrl = `https://github.com/${repo}.git`;
    console.log(`Cloning sparse repository: ${repo}${ref ? ` (ref: ${ref})` : ''}...`);
    if (ref) {
      runGit(['clone', '--no-checkout', '--depth', '1', '--filter=blob:none', '--sparse', '--', repoUrl, tempRepo]);
      runGit(['-C', tempRepo, 'sparse-checkout', 'set', '--', frontendPath]);
      runGit(['-C', tempRepo, 'fetch', '--depth', '1', 'origin', ref]);
      runGit(['-C', tempRepo, 'checkout', 'FETCH_HEAD']);
    } else {
      runGit(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--', repoUrl, tempRepo]);
      runGit(['-C', tempRepo, 'sparse-checkout', 'set', '--', frontendPath]);
    }

    const extracted = path.resolve(tempRepo, frontendPath);
    if (!extracted.startsWith(tempRepo + path.sep)) {
      throw new Error(`Resolved frontend path "${extracted}" escapes temporary repository root`);
    }
    if (!fs.existsSync(extracted)) {
      throw new Error(`Frontend directory "${frontendPath}" not found in repository`);
    }

    fs.renameSync(extracted, TARGET_DIR);
    fs.rmSync(tempRepo, { recursive: true, force: true });
    console.log('Frontend source ready in .securo-frontend');
  } else {
    console.log('.securo-frontend directory already present, skipping clone (pass --clean to re-fetch).');
  }

  console.log('--- 2. Applying Adaptations ---');
  const srcDir = path.join(TARGET_DIR, 'src');

  // Convert BrowserRouter to HashRouter in App.tsx
  const appTsxPath = path.join(srcDir, 'App.tsx');
  if (fs.existsSync(appTsxPath)) {
    const appContent = fs.readFileSync(appTsxPath, 'utf8');
    const patchedApp = patchRouter(appContent);
    if (patchedApp !== appContent) {
      fs.writeFileSync(appTsxPath, patchedApp, 'utf8');
    }
  }

  // Update vite.config.ts for relative base path
  const viteConfigPath = path.join(TARGET_DIR, 'vite.config.ts');
  if (fs.existsSync(viteConfigPath)) {
    const viteContent = fs.readFileSync(viteConfigPath, 'utf8');
    const patchedVite = patchViteConfig(viteContent);
    if (patchedVite !== viteContent) {
      fs.writeFileSync(viteConfigPath, patchedVite, 'utf8');
    }
  }

  // Patch optional chaining for .find calls to prevent undefined runtime errors
  patchFindCalls(srcDir);
  console.log('Frontend code adapted for mobile webview.');

  console.log('--- 3. Installing dependencies & building frontend ---');
  const hasNodeModules = fs.existsSync(path.join(TARGET_DIR, 'node_modules'));
  if (!hasNodeModules || FORCE_CLEAN) {
    if (fs.existsSync(path.join(TARGET_DIR, 'package-lock.json'))) {
      runPackageScript('npm ci', TARGET_DIR);
    } else if (fs.existsSync(path.join(TARGET_DIR, 'pnpm-lock.yaml'))) {
      runPackageScript('corepack enable && pnpm install --frozen-lockfile', TARGET_DIR);
    } else if (fs.existsSync(path.join(TARGET_DIR, 'yarn.lock'))) {
      runPackageScript('corepack enable && yarn install --immutable', TARGET_DIR);
    } else {
      runPackageScript('npm install', TARGET_DIR);
    }
  } else {
    console.log('Existing .securo-frontend/node_modules detected, skipping package install.');
  }

  runPackageScript('npm run build', TARGET_DIR);
  console.log('Securo frontend built successfully!');
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isDirectExecution) {
  prepareFrontend();
}
