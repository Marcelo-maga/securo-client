import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateSemver,
  cleanSemver,
  updatePackageJson,
  updatePackageLockJson,
  updateCargoToml,
  updateCargoLock,
  updateTauriConf,
  bumpAllVersions,
} from '../scripts/bump-version.mjs';

describe('Version Bumper & Manifest Synchronization', () => {
  describe('SemVer Validation & Sanitization', () => {
    it('validates standard semver strings', () => {
      assert.equal(validateSemver('0.1.0'), true);
      assert.equal(validateSemver('1.0.0'), true);
      assert.equal(validateSemver('2.15.3'), true);
      assert.equal(validateSemver('v1.2.3'), true);
      assert.equal(validateSemver('1.0.0-rc.1'), true);
      assert.equal(validateSemver('1.0.0+build.123'), true);
    });

    it('rejects invalid versions', () => {
      assert.equal(validateSemver('invalid'), false);
      assert.equal(validateSemver('1.0'), false);
      assert.equal(validateSemver(''), false);
      assert.equal(validateSemver(null), false);
      assert.equal(validateSemver(undefined), false);
      assert.equal(validateSemver('01.1.0'), false);
    });

    it('strips leading v correctly', () => {
      assert.equal(cleanSemver('v1.2.3'), '1.2.3');
      assert.equal(cleanSemver('1.2.3'), '1.2.3');
      assert.equal(cleanSemver('  v2.0.0  '), '2.0.0');
    });
  });

  describe('Manifest File Transformations', () => {
    it('updates package.json version preserving structure', () => {
      const input = JSON.stringify({ name: 'securo-client', version: '0.1.0', private: true }, null, 2);
      const output = updatePackageJson(input, '0.2.0');
      const parsed = JSON.parse(output);
      assert.equal(parsed.version, '0.2.0');
      assert.equal(parsed.name, 'securo-client');
      assert.equal(parsed.private, true);
    });

    it('updates package-lock.json root and packages[""] version', () => {
      const input = JSON.stringify(
        {
          name: 'securo-client',
          version: '0.1.0',
          lockfileVersion: 3,
          packages: {
            '': { name: 'securo-client', version: '0.1.0' },
            'node_modules/esbuild': { version: '0.28.2' },
          },
        },
        null,
        2
      );
      const output = updatePackageLockJson(input, '0.2.0');
      const parsed = JSON.parse(output);
      assert.equal(parsed.version, '0.2.0');
      assert.equal(parsed.packages[''].version, '0.2.0');
      assert.equal(parsed.packages['node_modules/esbuild'].version, '0.28.2');
    });

    it('updates Cargo.toml package version without modifying dependency versions', () => {
      const input = `[package]
name = "securo-client"
version = "0.1.0"
edition = "2024"

[dependencies]
tauri = { version = "2.12", features = ["dynamic-acl"] }
tauri-plugin-store = "2"
serde = { version = "1.0", features = ["derive"] }
`;
      const output = updateCargoToml(input, '0.2.0');
      assert.match(output, /\[package\][\s\S]*version = "0.2.0"/);
      assert.match(output, /tauri = \{ version = "2\.12"/);
      assert.match(output, /serde = \{ version = "1\.0"/);
    });

    it('updates Cargo.lock securo-client entry correctly', () => {
      const input = `[[package]]
name = "other-pkg"
version = "1.0.0"

[[package]]
name = "securo-client"
version = "0.1.0"
dependencies = [
 "serde",
]

[[package]]
name = "serde"
version = "1.0.219"
`;
      const output = updateCargoLock(input, '0.2.0');
      assert.match(output, /name = "securo-client"\r?\nversion = "0.2.0"/);
      assert.match(output, /name = "other-pkg"\r?\nversion = "1.0.0"/);
      assert.match(output, /name = "serde"\r?\nversion = "1.0.219"/);
    });

    it('updates tauri.conf.json version preserving configuration fields', () => {
      const input = JSON.stringify(
        {
          $schema: 'https://schema.tauri.app/config/2',
          productName: 'Securo',
          version: '0.1.0',
          identifier: 'com.securo.client',
        },
        null,
        2
      );
      const output = updateTauriConf(input, '0.2.0');
      const parsed = JSON.parse(output);
      assert.equal(parsed.version, '0.2.0');
      assert.equal(parsed.productName, 'Securo');
      assert.equal(parsed.identifier, 'com.securo.client');
    });
  });

  describe('Atomic bumpAllVersions() Integration', () => {
    it('synchronizes all files in a workspace directory', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-test-'));
      try {
        const srcTauriDir = path.join(tmpDir, 'src-tauri');
        fs.mkdirSync(srcTauriDir, { recursive: true });

        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'securo-client', version: '0.1.0' }, null, 2));
        fs.writeFileSync(
          path.join(tmpDir, 'package-lock.json'),
          JSON.stringify({ name: 'securo-client', version: '0.1.0', packages: { '': { version: '0.1.0' } } }, null, 2)
        );
        fs.writeFileSync(
          path.join(srcTauriDir, 'Cargo.toml'),
          '[package]\nname = "securo-client"\nversion = "0.1.0"\n\n[dependencies]\ntauri = "2"\n'
        );
        fs.writeFileSync(
          path.join(srcTauriDir, 'Cargo.lock'),
          '[[package]]\nname = "securo-client"\nversion = "0.1.0"\n'
        );
        fs.writeFileSync(
          path.join(srcTauriDir, 'tauri.conf.json'),
          JSON.stringify({ productName: 'Securo', version: '0.1.0' }, null, 2)
        );

        const res = bumpAllVersions('0.3.5', tmpDir);
        assert.equal(res.version, '0.3.5');
        assert.equal(res.files.length, 5);

        const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
        assert.equal(pkg.version, '0.3.5');

        const lock = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package-lock.json'), 'utf8'));
        assert.equal(lock.version, '0.3.5');
        assert.equal(lock.packages[''].version, '0.3.5');

        const cargoToml = fs.readFileSync(path.join(srcTauriDir, 'Cargo.toml'), 'utf8');
        assert.match(cargoToml, /version = "0\.3\.5"/);

        const cargoLock = fs.readFileSync(path.join(srcTauriDir, 'Cargo.lock'), 'utf8');
        assert.match(cargoLock, /version = "0\.3\.5"/);

        const tauriConf = JSON.parse(fs.readFileSync(path.join(srcTauriDir, 'tauri.conf.json'), 'utf8'));
        assert.equal(tauriConf.version, '0.3.5');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('throws on invalid semver without corrupting files', () => {
      assert.throws(() => bumpAllVersions('invalid-version'), /Invalid semver/);
    });
  });
});
