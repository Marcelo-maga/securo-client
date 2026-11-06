import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APK_SEARCH_DIR = path.resolve('src-tauri/gen/android/app/build/outputs/apk');
const OUT_DIR = path.resolve('artifacts');

if (!fs.existsSync(APK_SEARCH_DIR)) {
  console.error(`Error: APK directory ${APK_SEARCH_DIR} not found.`);
  process.exit(1);
}

// Read app version from package.json or tauri.conf.json
let version = '0.1.0';
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (pkg.version) version = pkg.version;
} catch {}

const gitTag = process.env.GITHUB_REF_NAME || '';
const releaseVersion = gitTag.startsWith('v') ? gitTag : `v${version}`;

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

function findApks(dir) {
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

const apks = findApks(APK_SEARCH_DIR);
if (apks.length === 0) {
  console.error('Error: No APK files found in output directory.');
  process.exit(1);
}

console.log(`Found ${apks.length} APK(s). Packaging and hashing...`);

const checksumLines = [];

const KNOWN_ABIS = ['armeabi-v7a', 'x86_64', 'x86', 'universal', 'arm64-v8a'];

for (const apkPath of apks) {
  const fileName = path.basename(apkPath);
  const abi = KNOWN_ABIS.find((candidate) => apkPath.includes(candidate)) || 'arm64-v8a';
  const buildType = apkPath.includes('release') ? 'release' : 'debug';

  const newFileName = `securo-${releaseVersion}-${abi}-${buildType}.apk`;
  const destPath = path.join(OUT_DIR, newFileName);

  fs.copyFileSync(apkPath, destPath);
  console.log(`Copied: ${fileName} -> ${newFileName}`);

  // Compute SHA-256
  const fileBuffer = fs.readFileSync(destPath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  checksumLines.push(`${hash}  ${newFileName}`);
}

const checksumFile = path.join(OUT_DIR, 'SHA256SUMS.txt');
fs.writeFileSync(checksumFile, checksumLines.join('\n') + '\n', 'utf8');
console.log(`Checksums generated at ${checksumFile}:`);
console.log(checksumLines.join('\n'));
