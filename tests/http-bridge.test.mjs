import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isApiRequest,
  getApiUrl,
  getDangerOptions,
} from '../src-tauri/bridge/http-bridge.js';

describe('Native HTTP Bridge (securo-http-bridge) & Security Policy', () => {
  describe('isApiRequest() Interception Criteria', () => {
    test('identifies relative /api and api/ paths', () => {
      assert.equal(isApiRequest('/api/accounts', 'http://localhost:1420/'), true);
      assert.equal(isApiRequest('/api/transactions/123', 'http://localhost:1420/'), true);
      assert.equal(isApiRequest('/api', 'http://localhost:1420/'), true);
      assert.equal(isApiRequest('api/health', 'http://localhost:1420/'), true);
      assert.equal(isApiRequest('/api/budget?month=2026-11', 'http://localhost:1420/'), true);
    });

    test('identifies absolute URLs matching current origin or configured serverUrl', () => {
      assert.equal(isApiRequest('http://localhost:1420/api/reports', 'http://localhost:1420/'), true);
      assert.equal(
        isApiRequest('https://securo.internal/api/v1/auth', 'http://localhost:1420/', 'https://securo.internal'),
        true
      );
      assert.equal(
        isApiRequest('http://127.0.0.1:8080/api', 'http://localhost:1420/', 'http://127.0.0.1:8080'),
        true
      );
    });

    test('rejects cross-origin third-party /api URLs that do not match serverUrl', () => {
      assert.equal(
        isApiRequest('https://attacker.example/api/v1/exfil', 'http://localhost:1420/', 'https://securo.internal'),
        false
      );
      assert.equal(
        isApiRequest('https://thirdparty.cdn.org/api/status', 'http://tauri.localhost/'),
        false
      );
    });

    test('rejects path-traversal dot segments (/api/../ and %2e%2e)', () => {
      assert.equal(isApiRequest('/api/../admin/debug', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/api/..', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/api/%2e%2e/admin', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/api/%2E%2E%2Fmetrics', 'http://localhost:1420/'), false);
    });

    test('identifies Request objects with API url property', () => {
      assert.equal(isApiRequest({ url: '/api/categories' }, 'http://localhost:1420/'), true);
      assert.equal(isApiRequest({ url: 'http://localhost:1420/api/insights' }, 'http://localhost:1420/'), true);
    });

    test('rejects lookalike prefixes, static assets, and non-API paths', () => {
      assert.equal(isApiRequest('/api-evil/steal', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/apifake', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/assets/main.css', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/config/config.html', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/favicon.ico', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('https://fonts.googleapis.com/css2', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/other/finance-api', 'http://localhost:1420/'), false);
      assert.equal(isApiRequest('/static/js/bundle.js', 'http://localhost:1420/'), false);
    });

    test('handles empty, null, undefined or malformed inputs without throwing', () => {
      assert.equal(isApiRequest(''), false);
      assert.equal(isApiRequest(null), false);
      assert.equal(isApiRequest(undefined), false);
      assert.equal(isApiRequest({}), false);
      assert.equal(isApiRequest(':::invalid-url:::'), false);
    });
  });

  describe('getApiUrl() Rewriting & Canonicalization', () => {
    const server = 'https://securo.homelab.lan:8443';

    test('rewrites relative API endpoint to server base URL', () => {
      assert.equal(getApiUrl('/api/accounts', server), 'https://securo.homelab.lan:8443/api/accounts');
      assert.equal(getApiUrl('api/health', server), 'https://securo.homelab.lan:8443/api/health');
    });

    test('preserves complex query parameters', () => {
      const input = '/api/transactions?account_id=acc_1&status=cleared&page=2&limit=50';
      assert.equal(
        getApiUrl(input, server),
        'https://securo.homelab.lan:8443/api/transactions?account_id=acc_1&status=cleared&page=2&limit=50'
      );
    });

    test('strips URL fragment hashes (#)', () => {
      const input = '/api/goals?category=savings#target-progress';
      assert.equal(getApiUrl(input, server), 'https://securo.homelab.lan:8443/api/goals?category=savings');
    });

    test('preserves server subpath when rewriting endpoints', () => {
      const subpathServer = 'https://my-domain.com/finance';
      assert.equal(getApiUrl('/api/accounts', subpathServer), 'https://my-domain.com/finance/api/accounts');
      assert.equal(getApiUrl('/finance/api/accounts', subpathServer), 'https://my-domain.com/finance/api/accounts');
    });

    test('blocks traversal attempts and foreign origins from being rewritten to serverUrl', () => {
      assert.equal(getApiUrl('/api/../admin/export', server), null);
      assert.equal(getApiUrl('/api/%2e%2e/admin/export', server), null);
      assert.equal(getApiUrl('https://evil.example/api/accounts', server), null);
      const subpathServer = 'https://my-domain.com/finance';
      assert.equal(getApiUrl('/api/../../admin', subpathServer), null);
    });

    test('works with IP addresses and standard HTTP ports', () => {
      const ipServer = 'http://192.168.1.150:8000';
      assert.equal(getApiUrl('/api/health', ipServer), 'http://192.168.1.150:8000/api/health');
    });

    test('returns null when serverUrl is missing or invalid', () => {
      assert.equal(getApiUrl('/api/accounts', null), null);
      assert.equal(getApiUrl('/api/accounts', ''), null);
      assert.equal(getApiUrl('/api/accounts', undefined), null);
      assert.equal(getApiUrl('/api/accounts', 'not-a-valid-url'), null);
    });
  });

  describe('getDangerOptions() TLS Certificate Flags', () => {
    test('enables dangerous certificate settings only when explicitly configured', () => {
      assert.deepEqual(getDangerOptions({ allow_invalid_certs: true }), {
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
      });
      assert.deepEqual(getDangerOptions({ allowInvalidCerts: true }), {
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
      });
      assert.deepEqual(getDangerOptions({ allow_invalid_certs: false }), {});
      assert.deepEqual(getDangerOptions(null), {});
    });
  });

  describe('Tauri Security Configuration Invariants (CSP, Capabilities & Hardening)', () => {
    const rootDir = process.cwd();

    test('capabilities/default.json enforces least privilege without wildcard windows or core:default', () => {
      const cap = JSON.parse(
        fs.readFileSync(path.resolve(rootDir, 'src-tauri/capabilities/default.json'), 'utf8')
      );
      const serialized = JSON.stringify(cap);
      assert.ok(!serialized.includes('http://*'), 'wildcard http://* must not exist in static capabilities');
      assert.ok(!serialized.includes('https://*'), 'wildcard https://* must not exist in static capabilities');
      assert.ok(!cap.windows.includes('*'), 'capabilities must not target wildcard "*" windows');
      assert.deepEqual(cap.windows, ['main', 'config']);
      assert.ok(!cap.permissions.includes('core:default'), 'overly broad core:default must not be granted');
      assert.ok(cap.permissions.includes('core:resources:default'), 'core:resources:default is required for HTTP body streams');
    });

    test('tauri.conf.json enforces hardened CSP, withGlobalTauri=false, scopeRedirects=true, and non-fallback build', () => {
      const conf = JSON.parse(
        fs.readFileSync(path.resolve(rootDir, 'src-tauri/tauri.conf.json'), 'utf8')
      );
      assert.equal(conf?.app?.withGlobalTauri, false, 'withGlobalTauri must be disabled');
      assert.equal(conf?.plugins?.http?.scopeRedirects, true, 'plugins.http.scopeRedirects must be true');
      assert.ok(
        !String(conf?.build?.beforeBuildCommand || '').includes('--allow-fallback'),
        'production beforeBuildCommand must not pass --allow-fallback'
      );

      const csp = conf?.app?.security?.csp;
      assert.equal(typeof csp, 'string', 'CSP must be explicitly configured');
      assert.ok(csp.includes("default-src 'self'"), 'CSP must restrict default-src');
      assert.ok(csp.includes("script-src 'self'"), 'CSP must restrict script-src without unsafe-inline');
      assert.ok(csp.includes("form-action 'self'"), 'CSP must restrict form-action');
      assert.ok(csp.includes("frame-src 'none'"), 'CSP must forbid child frames');
      assert.ok(!csp.includes("'unsafe-eval'"), 'CSP must not allow unsafe-eval');
      assert.ok(csp.includes('connect-src'), 'CSP must define connect-src');
    });

    test('Cargo.toml does not enable production devtools or duplicate reqwest crates', () => {
      const cargoToml = fs.readFileSync(path.resolve(rootDir, 'src-tauri/Cargo.toml'), 'utf8');
      assert.ok(!cargoToml.includes('"devtools"'), 'production Tauri devtools feature must not be enabled');
      assert.ok(!/^reqwest\s*=/m.test(cargoToml), 'standalone reqwest crate must not duplicate tauri-plugin-http reqwest');
    });

    test('HTML entrypoints contain no inline executable <script> blocks', () => {
      const htmlFiles = [
        'src/index.html',
        'src/app.html',
        'src/config/config.html',
      ];
      for (const relPath of htmlFiles) {
        const html = fs.readFileSync(path.resolve(rootDir, relPath), 'utf8');
        const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
          ([, attrs, body]) => !/\bsrc\s*=/i.test(attrs) && body.trim().length > 0
        );
        assert.equal(
          inlineScripts.length,
          0,
          `${relPath} must not contain inline <script> blocks (violates script-src 'self')`
        );
      }
    });
  });
});
