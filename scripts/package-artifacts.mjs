import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KNOWN_ABIS = ['armeabi-v7a', 'x86_64', 'x86', 'universal', 'arm64-v8a'];

export function resolveAbi(filename) {
  return KNOWN_ABIS.find((candidate) => filename.includes(candidate)) || 'arm64-v8a';
}

export function resolveBuildType(filename) {
  return filename.includes('release') ? 'release' : 'debug';
}

export function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function formatArtifactName(releaseVersion, abi, buildType) {
  return `securo-${releaseVersion}-${abi}-${buildType}.apk`;
}

export function resolveDesktopArtifactName(filePath, releaseVersion) {
  const fileName = path.basename(filePath);
  const lower = fileName.toLowerCase();

  // Architecture detection
  let arch = 'x64';
  if (lower.includes('aarch64') || lower.includes('arm64')) {
    arch = 'arm64';
  } else if (lower.includes('universal')) {
    arch = 'universal';
  } else if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('amd64')) {
    arch = 'x64';
  }

  // Windows NSIS Setup (.exe)
  if (lower.endsWith('.exe')) {
    return `securo-${releaseVersion}-windows-${arch}-setup.exe`;
  }

  // Windows MSI Installer (.msi)
  if (lower.endsWith('.msi')) {
    return `securo-${releaseVersion}-windows-${arch}.msi`;
  }

  // Linux DEB (.deb)
  if (lower.endsWith('.deb')) {
    const debArch = arch === 'x64' ? 'amd64' : arch;
    return `securo-${releaseVersion}-linux-${debArch}.deb`;
  }

  // Linux AppImage (.AppImage)
  if (lower.endsWith('.appimage')) {
    const appImageArch = arch === 'x64' ? 'x86_64' : arch;
    return `securo-${releaseVersion}-linux-${appImageArch}.AppImage`;
  }

  // macOS DMG (.dmg)
  if (lower.endsWith('.dmg')) {
    return `securo-${releaseVersion}-macos-${arch}.dmg`;
  }

  // Generic fallback
  return `securo-${releaseVersion}-${fileName}`;
}

export function findApks(dir) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(findApks(full));
    } else if (item.isFile() && item.name.endsWith('.apk')) {
      results.push(full);
    }
  }
  return results;
}

export function findDesktopBundles(baseDirs) {
  const candidates = Array.isArray(baseDirs) ? baseDirs : [baseDirs];
  const results = [];
  const supportedExtensions = ['.exe', '.msi', '.deb', '.appimage', '.dmg'];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile()) {
        const lower = item.name.toLowerCase();
        if (supportedExtensions.some((ext) => lower.endsWith(ext))) {
          results.push(full);
        }
      }
    }
  }

  for (const dir of candidates) {
    walk(dir);
  }
  return results;
}

export function packageArtifacts({
  apkSearchDir = path.resolve('src-tauri/gen/android/app/build/outputs/apk'),
  bundleSearchDirs = [
    path.resolve('src-tauri/target/release/bundle'),
    path.resolve('src-tauri/target/debug/bundle'),
  ],
  outDir = path.resolve('artifacts'),
  versionOverride = null,
} = {}) {
  // Read app version
  let version = versionOverride || '0.1.0';
  if (!versionOverride) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.version) version = pkg.version;
    } catch {}
  }

  const gitTag = process.env.GITHUB_REF_NAME || '';
  const releaseVersion = gitTag.startsWith('v') ? gitTag : `v${version}`;

  const apks = findApks(apkSearchDir);
  const desktopBundles = findDesktopBundles(bundleSearchDirs);

  if (apks.length === 0 && desktopBundles.length === 0) {
    console.error(`Error: No APK files found in ${apkSearchDir} and no desktop bundles found in ${bundleSearchDirs.join(', ')}.`);
    process.exit(1);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const checksumLines = [];
  const packagedFiles = [];

  // 1. Process Android APKs
  if (apks.length > 0) {
    console.log(`Found ${apks.length} Android APK(s). Packaging and hashing...`);
    for (const apkPath of apks) {
      const fileName = path.basename(apkPath);
      const abi = resolveAbi(apkPath);
      const buildType = resolveBuildType(apkPath);
      const newFileName = formatArtifactName(releaseVersion, abi, buildType);
      const destPath = path.join(outDir, newFileName);

      fs.copyFileSync(apkPath, destPath);
      console.log(`Copied APK: ${fileName} -> ${newFileName}`);

      const hash = computeSha256(fs.readFileSync(destPath));
      checksumLines.push(`${hash}  ${newFileName}`);
      packagedFiles.push(destPath);
    }
  }

  // 2. Process Desktop Bundles (Windows NSIS/MSI, Linux deb/AppImage, macOS dmg)
  if (desktopBundles.length > 0) {
    console.log(`Found ${desktopBundles.length} desktop bundle(s). Packaging and hashing...`);
    for (const bundlePath of desktopBundles) {
      const fileName = path.basename(bundlePath);
      const newFileName = resolveDesktopArtifactName(bundlePath, releaseVersion);
      const destPath = path.join(outDir, newFileName);

      fs.copyFileSync(bundlePath, destPath);
      console.log(`Copied Desktop Bundle: ${fileName} -> ${newFileName}`);

      const hash = computeSha256(fs.readFileSync(destPath));
      checksumLines.push(`${hash}  ${newFileName}`);
      packagedFiles.push(destPath);
    }
  }

  // 3. Write SHA256SUMS.txt
  const checksumFile = path.join(outDir, 'SHA256SUMS.txt');
  fs.writeFileSync(checksumFile, checksumLines.join('\n') + '\n', 'utf8');
  console.log(`Checksums generated at ${checksumFile}:`);
  console.log(checksumLines.join('\n'));

  return { packagedFiles, checksumLines, checksumFile };
}

// Execute CLI when run directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  packageArtifacts();
}
