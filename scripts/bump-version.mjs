#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Validates whether a version string matches standard SemVer.
 * Strips optional leading 'v'.
 */
export function validateSemver(version) {
  if (typeof version !== 'string') return false;
  const clean = version.startsWith('v') ? version.slice(1) : version;
  return SEMVER_REGEX.test(clean.trim());
}

/**
 * Normalizes semver by stripping optional leading 'v'.
 */
export function cleanSemver(version) {
  if (typeof version !== 'string') return '';
  const trimmed = version.trim();
  return trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
}

/**
 * Updates version in package.json content.
 */
export function updatePackageJson(content, newVersion) {
  const pkg = JSON.parse(content);
  pkg.version = newVersion;
  return JSON.stringify(pkg, null, 2) + '\n';
}

/**
 * Updates version in package-lock.json content.
 */
export function updatePackageLockJson(content, newVersion) {
  const lock = JSON.parse(content);
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  return JSON.stringify(lock, null, 2) + '\n';
}

/**
 * Updates version inside the [package] section of Cargo.toml.
 */
export function updateCargoToml(content, newVersion) {
  const packageBlockMatch = content.match(/(\[package\][\s\S]*?)(?=\r?\n\[|$)/);
  if (!packageBlockMatch) {
    throw new Error('Could not find [package] section in Cargo.toml');
  }

  const originalBlock = packageBlockMatch[1];
  const versionRegex = /^(\s*version\s*=\s*")[^"]*(")/m;
  if (!versionRegex.test(originalBlock)) {
    throw new Error('Could not find version entry in [package] section of Cargo.toml');
  }

  const updatedBlock = originalBlock.replace(versionRegex, `$1${newVersion}$2`);
  return content.replace(originalBlock, updatedBlock);
}

/**
 * Updates version inside Cargo.lock for securo-client.
 */
export function updateCargoLock(content, newVersion) {
  const securoLockRegex = /(name\s*=\s*"securo-client"\s*[\r\n]+\s*version\s*=\s*")[^"]*(")/;
  if (!securoLockRegex.test(content)) {
    return content;
  }
  return content.replace(securoLockRegex, `$1${newVersion}$2`);
}

/**
 * Updates version in Tauri v2 config (tauri.conf.json).
 */
export function updateTauriConf(content, newVersion) {
  const conf = JSON.parse(content);
  conf.version = newVersion;
  return JSON.stringify(conf, null, 2) + '\n';
}

/**
 * Atomically updates version across all workspace manifest files:
 * - package.json
 * - package-lock.json (if present)
 * - src-tauri/Cargo.toml
 * - src-tauri/Cargo.lock (if present)
 * - src-tauri/tauri.conf.json
 */
export function bumpAllVersions(newVersion, projectRoot = DEFAULT_ROOT) {
  const clean = cleanSemver(newVersion);
  if (!validateSemver(clean)) {
    throw new Error(`Invalid semver version: "${newVersion}"`);
  }

  const updatedFiles = [];

  // 1. package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const original = fs.readFileSync(pkgPath, 'utf8');
    const updated = updatePackageJson(original, clean);
    fs.writeFileSync(pkgPath, updated, 'utf8');
    updatedFiles.push(pkgPath);
  }

  // 2. package-lock.json
  const lockPath = path.join(projectRoot, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const original = fs.readFileSync(lockPath, 'utf8');
    const updated = updatePackageLockJson(original, clean);
    fs.writeFileSync(lockPath, updated, 'utf8');
    updatedFiles.push(lockPath);
  }

  // 3. src-tauri/Cargo.toml
  const cargoTomlPath = path.join(projectRoot, 'src-tauri', 'Cargo.toml');
  if (fs.existsSync(cargoTomlPath)) {
    const original = fs.readFileSync(cargoTomlPath, 'utf8');
    const updated = updateCargoToml(original, clean);
    fs.writeFileSync(cargoTomlPath, updated, 'utf8');
    updatedFiles.push(cargoTomlPath);
  }

  // 4. src-tauri/Cargo.lock
  const cargoLockPath = path.join(projectRoot, 'src-tauri', 'Cargo.lock');
  if (fs.existsSync(cargoLockPath)) {
    const original = fs.readFileSync(cargoLockPath, 'utf8');
    const updated = updateCargoLock(original, clean);
    fs.writeFileSync(cargoLockPath, updated, 'utf8');
    updatedFiles.push(cargoLockPath);
  }

  // 5. src-tauri/tauri.conf.json
  const tauriConfPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  if (fs.existsSync(tauriConfPath)) {
    const original = fs.readFileSync(tauriConfPath, 'utf8');
    const updated = updateTauriConf(original, clean);
    fs.writeFileSync(tauriConfPath, updated, 'utf8');
    updatedFiles.push(tauriConfPath);
  }

  return {
    version: clean,
    files: updatedFiles,
  };
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const targetVersion = process.argv[2];
  if (!targetVersion) {
    console.error('Usage: node scripts/bump-version.mjs <new-version>');
    process.exit(1);
  }

  try {
    const result = bumpAllVersions(targetVersion);
    console.log(`Successfully bumped project version to ${result.version}`);
    for (const f of result.files) {
      console.log(` - Updated: ${path.relative(DEFAULT_ROOT, f)}`);
    }
  } catch (err) {
    console.error(`Error bumping version: ${err.message}`);
    process.exit(1);
  }
}
