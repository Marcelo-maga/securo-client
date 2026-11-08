import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatMessage,
  getErrorMessage,
  isCertError,
  resolveAppTarget,
  resolveBootstrapTarget,
} from '../src/config/scripts/setup.js';

describe('Setup UI Business Logic & Error Formatting', () => {
  const rootDir = process.cwd();
  const enLocale = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'src/config/locales/en-US.json'), 'utf8')
  );
  const ptLocale = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'src/config/locales/pt-BR.json'), 'utf8')
  );

  describe('formatMessage()', () => {
    test('substitutes single placeholder correctly', () => {
      const template = 'O servidor respondeu com HTTP {status}.';
      const result = formatMessage(template, { status: 502 });
      assert.equal(result, 'O servidor respondeu com HTTP 502.');
    });

    test('substitutes multiple placeholders', () => {
      const template = 'Server {host} returned {code} after {timeout}s.';
      const result = formatMessage(template, { host: 'securo.local', code: 504, timeout: 10 });
      assert.equal(result, 'Server securo.local returned 504 after 10s.');
    });

    test('replaces unknown placeholders with empty string without crashing', () => {
      const template = 'Error code {code} at {missing}.';
      const result = formatMessage(template, { code: 'ERR_TIMEOUT' });
      assert.equal(result, 'Error code ERR_TIMEOUT at .');
    });

    test('returns original string when no placeholders present', () => {
      const template = 'Plain message without variables.';
      assert.equal(formatMessage(template, { status: 200 }), template);
    });
  });

  describe('getErrorMessage()', () => {
    test('resolves known error codes in en-US', () => {
      const err = { code: 'INVALID_URL' };
      assert.equal(getErrorMessage(err, enLocale), enLocale.errors.INVALID_URL);
    });

    test('resolves known error codes in pt-BR', () => {
      const err = { code: 'CONFIG_OPEN_FAILED' };
      assert.equal(getErrorMessage(err, ptLocale), ptLocale.errors.CONFIG_OPEN_FAILED);
    });

    test('interpolates status code in SERVER_HTTP_ERROR', () => {
      const err = { code: 'SERVER_HTTP_ERROR', status: 403 };
      const msgEn = getErrorMessage(err, enLocale);
      const msgPt = getErrorMessage(err, ptLocale);

      assert.equal(msgEn, 'The server returned HTTP 403.');
      assert.equal(msgPt, 'O servidor respondeu com HTTP 403.');
    });

    test('falls back gracefully to UNKNOWN for unrecognized error codes', () => {
      const err = { code: 'SOME_WEIRD_FUTURE_CODE' };
      assert.equal(getErrorMessage(err, enLocale), enLocale.errors.UNKNOWN);
      assert.equal(getErrorMessage(err, ptLocale), ptLocale.errors.UNKNOWN);
    });

    test('handles null or undefined error gracefully', () => {
      assert.equal(getErrorMessage(null, enLocale), enLocale.errors.UNKNOWN);
      assert.equal(getErrorMessage(undefined, ptLocale), ptLocale.errors.UNKNOWN);
      assert.equal(getErrorMessage({}, enLocale), enLocale.errors.UNKNOWN);
    });
  });

  describe('isCertError() TLS/SSL Heuristic', () => {
    test('detects self-signed or invalid cert errors across platforms', () => {
      const positiveCases = [
        'InvalidCertificate: certificate is not trusted',
        'SSL: CERTIFICATE_VERIFY_FAILED: self signed certificate in certificate chain',
        'TLS handshake failed: unknown issuer',
        'javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException',
        'PKIX path building failed: unable to find valid certification path',
        'handshake error: ConnectionReset',
        'CERT_UNTRUSTED from reqwest rustls engine',
      ];

      for (const errorStr of positiveCases) {
        assert.equal(
          isCertError(errorStr),
          true,
          `Should detect TLS/SSL error in: "${errorStr}"`
        );
      }
    });

    test('does not trigger on unrelated network or server errors', () => {
      const negativeCases = [
        'Connection refused (os error 111)',
        'HTTP 404 Not Found',
        'DNS resolution failed for hostname invalid.domain.xyz',
        'Timeout after 10000ms waiting for headers',
        'Invalid URL syntax',
        '',
        null,
        undefined,
      ];

      for (const nonCertStr of negativeCases) {
        assert.equal(
          isCertError(nonCertStr),
          false,
          `Should NOT falsely flag as cert error: "${nonCertStr}"`
        );
      }
    });
  });

  describe('resolveAppTarget() URL Navigation Path', () => {
    test('resolves relative path when loaded inside /config/ folder', () => {
      assert.equal(resolveAppTarget('/config/config.html'), '../app.html#/');
      assert.equal(resolveAppTarget('/app/config/index.html'), '../app.html#/');
    });

    test('resolves direct path when loaded from root setup.html', () => {
      assert.equal(resolveAppTarget('/setup.html'), 'app.html#/');
      assert.equal(resolveAppTarget('/index.html'), 'app.html#/');
    });
  });

  describe('resolveBootstrapTarget() Auto-Connect Routing', () => {
    test('routes directly to app when serverUrl is set and autoConnect is true', () => {
      assert.equal(resolveBootstrapTarget('https://securo.home.arpa', true), 'app.html#/');
      assert.equal(resolveBootstrapTarget('http://192.168.1.50:8080', true), 'app.html#/');
    });

    test('routes to config when serverUrl is present but autoConnect is false', () => {
      assert.equal(resolveBootstrapTarget('https://securo.home.arpa', false), 'config/config.html');
      assert.equal(resolveBootstrapTarget('https://securo.home.arpa', undefined), 'config/config.html');
      assert.equal(resolveBootstrapTarget('https://securo.home.arpa', null), 'config/config.html');
    });

    test('routes to config when serverUrl is missing even if autoConnect is true', () => {
      assert.equal(resolveBootstrapTarget('', true), 'config/config.html');
      assert.equal(resolveBootstrapTarget(null, true), 'config/config.html');
      assert.equal(resolveBootstrapTarget(undefined, true), 'config/config.html');
    });
  });
});
