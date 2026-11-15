import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isApiRequest,
  getApiUrl,
  getDangerOptions,
  isInternalIpcUrl,
  applyOriginAndRefererHeaders,
  serializeRequestPayload,
  installHttpBridge,
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

  describe('Tauri Internal IPC Bypass and Fast-Path Routing', () => {
    test('isInternalIpcUrl correctly detects IPC schemes and hostnames', () => {
      assert.equal(isInternalIpcUrl('http://ipc.localhost/get_connection_settings'), true);
      assert.equal(isInternalIpcUrl('https://ipc.localhost/test'), true);
      assert.equal(isInternalIpcUrl('ipc://localhost/invoke'), true);
      assert.equal(isInternalIpcUrl('ipc:test'), true);
      assert.equal(isInternalIpcUrl(new URL('http://ipc.localhost/test')), true);
      assert.equal(isInternalIpcUrl({ url: 'http://ipc.localhost/test' }), true);
      assert.equal(isInternalIpcUrl('/api/accounts'), false);
      assert.equal(isInternalIpcUrl('https://securo.homelab.lan:8443/api/accounts'), false);
      assert.equal(isInternalIpcUrl(null), false);
      assert.equal(isInternalIpcUrl(undefined), false);
    });

    test('isApiRequest strictly ignores internal Tauri IPC schemes and domains', () => {
      assert.equal(isApiRequest('http://ipc.localhost/get_connection_settings'), false);
      assert.equal(isApiRequest('https://ipc.localhost/test'), false);
      assert.equal(isApiRequest('ipc://localhost/invoke'), false);
      assert.equal(isApiRequest('ipc:test'), false);
    });

    test('isApiRequest blocks backslash traversal and carriage returns', () => {
      assert.equal(isApiRequest('/api\\..\\admin'), false);
      assert.equal(isApiRequest('/api\\test'), false);
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

  describe('applyOriginAndRefererHeaders() CORS & Reverse Proxy Alignment', () => {
    test('sets Origin and Referer matching serverUrl origin', () => {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      applyOriginAndRefererHeaders(headers, 'https://securo.domain.com/api');
      assert.equal(headers.get('Origin'), 'https://securo.domain.com');
      assert.equal(headers.get('Referer'), 'https://securo.domain.com/');
      assert.equal(headers.get('Content-Type'), 'application/json');
    });

    test('handles standard HTTP ports and IP domains', () => {
      const headers = new Headers();
      applyOriginAndRefererHeaders(headers, 'http://192.168.1.50:8000');
      assert.equal(headers.get('Origin'), 'http://192.168.1.50:8000');
      assert.equal(headers.get('Referer'), 'http://192.168.1.50:8000/');
    });

    test('does not throw or mutate on empty or invalid inputs', () => {
      const headers = new Headers({ Authorization: 'Bearer token' });
      applyOriginAndRefererHeaders(headers, null);
      assert.equal(headers.get('Authorization'), 'Bearer token');
      assert.equal(headers.get('Origin'), null);

      applyOriginAndRefererHeaders(headers, 'invalid-url');
      assert.equal(headers.get('Origin'), null);

      applyOriginAndRefererHeaders(null, 'https://securo.domain.com');
    });
  });

  describe('serializeRequestPayload() & SecuroXMLHttpRequest Proxy Routing', () => {
    test('serializes URLSearchParams and sets application/x-www-form-urlencoded header', async () => {
      const headers = new Headers();
      const params = new URLSearchParams();
      params.append('username', 'user@example.com');
      params.append('password', 'securo123');

      const bytes = await serializeRequestPayload(params, headers);
      assert.equal(headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8');
      assert.equal(new TextDecoder().decode(new Uint8Array(bytes)), 'username=user%40example.com&password=securo123');
    });

    test('SecuroXMLHttpRequest exposes onloadend and routes POST /api/auth/login via proxy_api_request', async () => {
      const recordedCalls = [];
      class MockBrowserXHR extends EventTarget {
        open() {}
        send() {}
        setRequestHeader() {}
      }

      const mockWin = {
        location: { href: 'http://tauri.localhost/app.html#/' },
        fetch: async () => new Response('browser'),
        XMLHttpRequest: MockBrowserXHR,
        __TAURI_INTERNALS__: {
          invoke: async (cmd, args) => {
            recordedCalls.push({ cmd, args });
            if (cmd === 'get_connection_settings') {
              return { server_url: 'https://securo.domain.com', allow_invalid_certs: false };
            }
            if (cmd === 'proxy_api_request') {
              const bodyBytes = Array.from(
                new TextEncoder().encode(JSON.stringify({ access_token: 'jwt_abc', token_type: 'bearer' }))
              );
              return {
                status: 200,
                statusText: 'OK',
                url: args.url,
                headers: [['content-type', 'application/json']],
                body: bodyBytes,
              };
            }
            return null;
          },
        },
      };

      installHttpBridge(mockWin);

      const xhr = new mockWin.XMLHttpRequest();
      assert.equal('onloadend' in xhr, true, 'Axios requires `onloadend in request` to be true');
      assert.equal('onload' in xhr, true);
      assert.equal('onerror' in xhr, true);
      assert.equal('onreadystatechange' in xhr, true);

      await new Promise((resolve, reject) => {
        xhr.onloadend = () => resolve();
        xhr.onerror = (err) => reject(err);
        xhr.open('POST', '/api/auth/login', true);
        xhr.send(new URLSearchParams({ username: 'user@example.com', password: 'secret' }));
      });

      assert.equal(xhr.status, 200);
      assert.equal(JSON.parse(xhr.responseText).access_token, 'jwt_abc');
      const proxyCall = recordedCalls.find((c) => c.cmd === 'proxy_api_request');
      assert.ok(proxyCall, 'must invoke proxy_api_request');
      assert.equal(proxyCall.args.url, 'https://securo.domain.com/api/auth/login');
      assert.equal(proxyCall.args.method, 'POST');
    });

    test('window.fetch handles 204 No Content responses via proxy_api_request without throwing', async () => {
      class MockBrowserXHR extends EventTarget {}
      const mockWin = {
        location: { href: 'http://tauri.localhost/app.html#/' },
        fetch: async () => new Response('browser'),
        XMLHttpRequest: MockBrowserXHR,
        __TAURI_INTERNALS__: {
          invoke: async (cmd, args) => {
            if (cmd === 'get_connection_settings') {
              return { server_url: 'https://securo.domain.com', allow_invalid_certs: false };
            }
            if (cmd === 'proxy_api_request') {
              return {
                status: 204,
                statusText: 'No Content',
                url: args.url,
                headers: [],
                body: [],
              };
            }
            return null;
          },
        },
      };

      installHttpBridge(mockWin);
      const res = await mockWin.fetch('/api/transactions/123', { method: 'DELETE' });
      assert.equal(res.status, 204);
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
