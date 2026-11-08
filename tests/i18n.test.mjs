import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Internationalization (i18n) Consistency', () => {
  const rootDir = process.cwd();

  const configEnPath = path.resolve(rootDir, 'src/config/locales/en-US.json');
  const configPtPath = path.resolve(rootDir, 'src/config/locales/pt-BR.json');
  const configHtmlPath = path.resolve(rootDir, 'src/config/config.html');
  const configSetupJsPath = path.resolve(rootDir, 'src/config/scripts/setup.js');

  test('all canonical locale files exist in src/config/locales/', () => {
    assert.ok(fs.existsSync(configEnPath), 'src/config/locales/en-US.json must exist as single source of truth');
    assert.ok(fs.existsSync(configPtPath), 'src/config/locales/pt-BR.json must exist as single source of truth');
  });

  test('config locales have identical top-level keys', () => {
    const en = JSON.parse(fs.readFileSync(configEnPath, 'utf8'));
    const pt = JSON.parse(fs.readFileSync(configPtPath, 'utf8'));

    const enKeys = Object.keys(en).sort();
    const ptKeys = Object.keys(pt).sort();

    assert.deepEqual(enKeys, ptKeys, 'en-US and pt-BR must have the exact same top-level keys');
  });

  test('config locales include essential UI control keys', () => {
    const en = JSON.parse(fs.readFileSync(configEnPath, 'utf8'));
    const pt = JSON.parse(fs.readFileSync(configPtPath, 'utf8'));

    const requiredKeys = [
      'errorDetailsTitle',
      'copy',
      'copied',
      'certSelfSignedEnabled',
      'tauriUnavailable',
      'connectionError',
      'autoConnectLabel',
      'connectConfigured',
      'serverConfigured',
    ];

    for (const key of requiredKeys) {
      assert.ok(en[key] && typeof en[key] === 'string', `en-US must define "${key}"`);
      assert.ok(pt[key] && typeof pt[key] === 'string', `pt-BR must define "${key}"`);
    }
  });

  test('config locales have identical error keys', () => {
    const en = JSON.parse(fs.readFileSync(configEnPath, 'utf8'));
    const pt = JSON.parse(fs.readFileSync(configPtPath, 'utf8'));

    const enErrorKeys = Object.keys(en.errors || {}).sort();
    const ptErrorKeys = Object.keys(pt.errors || {}).sort();

    assert.deepEqual(enErrorKeys, ptErrorKeys, 'en-US and pt-BR must have the exact same error keys');
  });

  test('required ErrorCodes from Rust are covered in config locales', () => {
    const en = JSON.parse(fs.readFileSync(configEnPath, 'utf8'));
    const expectedErrorCodes = [
      'INVALID_URL',
      'INVALID_URL_SCHEME',
      'INVALID_URL_CREDENTIALS',
      'CONFIG_OPEN_FAILED',
      'HTTP_CLIENT_BUILD_FAILED',
      'SERVER_UNREACHABLE',
      'SERVER_HTTP_ERROR',
      'CONFIG_SAVE_FAILED',
      'PROXY_FORBIDDEN',
      'UNKNOWN',
    ];

    for (const code of expectedErrorCodes) {
      assert.ok(
        en.errors && typeof en.errors[code] === 'string' && en.errors[code].length > 0,
        `ErrorCode ${code} must be defined in en-US locales`
      );
    }
  });

  test('placeholders match between en-US and pt-BR', () => {
    const en = JSON.parse(fs.readFileSync(configEnPath, 'utf8'));
    const pt = JSON.parse(fs.readFileSync(configPtPath, 'utf8'));

    function findPlaceholders(str) {
      const matches = str.match(/\{(\w+)\}/g) || [];
      return matches.sort();
    }

    for (const [key, value] of Object.entries(en.errors)) {
      const ptValue = pt.errors[key];
      assert.deepEqual(
        findPlaceholders(value),
        findPlaceholders(ptValue),
        `Placeholders for error key "${key}" must match between en-US and pt-BR`
      );
    }
  });

  test('config.html defines data-i18n attributes on error header and copy button', () => {
    const html = fs.readFileSync(configHtmlPath, 'utf8');
    assert.ok(html.includes('data-i18n="errorDetailsTitle"'), 'error-title must have data-i18n="errorDetailsTitle"');
    assert.ok(html.includes('data-i18n="copy"'), 'copy-error-button must have data-i18n="copy"');
    assert.ok(html.includes('data-i18n="autoConnectLabel"'), 'auto-connect row must have data-i18n="autoConnectLabel"');
    assert.ok(html.includes('data-i18n="connectConfigured"'), 'connect-configured-button must have data-i18n="connectConfigured"');
  });

  test('setup.js embedded fallback locales match JSON locales', () => {
    const jsContent = fs.readFileSync(configSetupJsPath, 'utf8');
    const en = JSON.parse(fs.readFileSync(configEnPath, 'utf8'));
    const pt = JSON.parse(fs.readFileSync(configPtPath, 'utf8'));

    assert.ok(
      jsContent.includes(en.errors.SERVER_UNREACHABLE),
      'setup.js embedded fallback must contain the full en-US SERVER_UNREACHABLE message'
    );
    assert.ok(
      jsContent.includes(pt.errors.SERVER_UNREACHABLE),
      'setup.js embedded fallback must contain the full pt-BR SERVER_UNREACHABLE message'
    );
  });
});
