import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Pure bridge logic extracted directly from src-tauri/bridge/http-bridge.js
function isApiRequest(input, baseHref = 'http://localhost:1420/') {
  if (!input) return false;
  const urlStr = typeof input === 'string' ? input : input.url || '';
  if (urlStr.startsWith('/api') || urlStr.startsWith('api/')) return true;
  try {
    const { pathname } = new URL(urlStr, baseHref);
    return pathname === '/api' || pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function getApiUrl(input, serverUrl, baseHref = 'http://localhost:1420/') {
  if (!serverUrl) return null;
  const urlStr = typeof input === 'string' ? input : input.url || '';
  try {
    const parsed = new URL(urlStr, baseHref);
    const target = new URL(serverUrl);
    const rawPath = target.pathname;
    const basePath = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
    if (basePath && !parsed.pathname.startsWith(basePath + '/')) {
      target.pathname = basePath + parsed.pathname;
    } else {
      target.pathname = parsed.pathname;
    }
    target.search = parsed.search;
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

function getDangerOptions(settings) {
  if (!settings?.allow_invalid_certs && !settings?.allowInvalidCerts) return {};
  return {
    danger: {
      acceptInvalidCerts: true,
      acceptInvalidHostnames: true,
    },
  };
}

describe('Native HTTP Bridge (securo-http-bridge)', () => {
  describe('isApiRequest() Interception Criteria', () => {
    test('identifies relative /api and api/ paths', () => {
      assert.equal(isApiRequest('/api/accounts'), true);
      assert.equal(isApiRequest('/api/transactions/123'), true);
      assert.equal(isApiRequest('/api'), true);
      assert.equal(isApiRequest('api/health'), true);
      assert.equal(isApiRequest('/api/budget?month=2026-11'), true);
    });

    test('identifies absolute URLs targeting /api endpoints', () => {
      assert.equal(isApiRequest('http://localhost:1420/api/reports'), true);
      assert.equal(isApiRequest('https://securo.internal/api/v1/auth'), true);
      assert.equal(isApiRequest('http://127.0.0.1:8080/api'), true);
    });

    test('identifies Request objects with API url property', () => {
      assert.equal(isApiRequest({ url: '/api/categories' }), true);
      assert.equal(isApiRequest({ url: 'http://localhost:1420/api/insights' }), true);
    });

    test('characterizes /api prefix matching in implementation', () => {
      // Due to urlStr.startsWith("/api"), any route starting with /api is intercepted
      assert.equal(isApiRequest('/api'), true);
      assert.equal(isApiRequest('/api/users'), true);
    });

    test('rejects static assets and non-API paths', () => {
      assert.equal(isApiRequest('/assets/main.css'), false);
      assert.equal(isApiRequest('/config/config.html'), false);
      assert.equal(isApiRequest('/favicon.ico'), false);
      assert.equal(isApiRequest('https://fonts.googleapis.com/css2'), false);
      assert.equal(isApiRequest('/other/finance-api'), false);
      assert.equal(isApiRequest('/static/js/bundle.js'), false);
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
      const rewritten = getApiUrl('/api/accounts', server);
      assert.equal(rewritten, 'https://securo.homelab.lan:8443/api/accounts');
    });

    test('preserves complex query parameters', () => {
      const input = '/api/transactions?account_id=acc_1&status=cleared&page=2&limit=50';
      const rewritten = getApiUrl(input, server);
      assert.equal(
        rewritten,
        'https://securo.homelab.lan:8443/api/transactions?account_id=acc_1&status=cleared&page=2&limit=50'
      );
    });

    test('strips URL fragment hashes (#)', () => {
      const input = '/api/goals?category=savings#target-progress';
      const rewritten = getApiUrl(input, server);
      assert.equal(rewritten, 'https://securo.homelab.lan:8443/api/goals?category=savings');
    });

    test('preserves server subpath when rewriting endpoints', () => {
      const subpathServer = 'https://my-domain.com/finance';
      assert.equal(
        getApiUrl('/api/accounts', subpathServer),
        'https://my-domain.com/finance/api/accounts'
      );
      assert.equal(
        getApiUrl('/finance/api/accounts', subpathServer),
        'https://my-domain.com/finance/api/accounts'
      );
    });

    test('works with IP addresses and standard HTTP ports', () => {
      const ipServer = 'http://192.168.1.150:8000';
      const rewritten = getApiUrl('/api/health', ipServer);
      assert.equal(rewritten, 'http://192.168.1.150:8000/api/health');
    });

    test('returns null when serverUrl is missing or empty', () => {
      assert.equal(getApiUrl('/api/accounts', null), null);
      assert.equal(getApiUrl('/api/accounts', ''), null);
      assert.equal(getApiUrl('/api/accounts', undefined), null);
    });

    test('returns null when serverUrl is invalid', () => {
      assert.equal(getApiUrl('/api/accounts', 'not-a-valid-url'), null);
    });
  });

  describe('getDangerOptions() TLS Certificate Flags', () => {
    test('enables dangerous certificate settings when allow_invalid_certs is snake_case true', () => {
      const options = getDangerOptions({ allow_invalid_certs: true });
      assert.deepEqual(options, {
        danger: {
          acceptInvalidCerts: true,
          acceptInvalidHostnames: true,
        },
      });
    });

    test('enables dangerous certificate settings when allowInvalidCerts is camelCase true', () => {
      const options = getDangerOptions({ allowInvalidCerts: true });
      assert.deepEqual(options, {
        danger: {
          acceptInvalidCerts: true,
          acceptInvalidHostnames: true,
        },
      });
    });

    test('returns empty object when certificate validation is strict (false)', () => {
      assert.deepEqual(getDangerOptions({ allow_invalid_certs: false }), {});
      assert.deepEqual(getDangerOptions({ allowInvalidCerts: false }), {});
    });

    test('returns empty object when settings is null or empty', () => {
      assert.deepEqual(getDangerOptions(null), {});
      assert.deepEqual(getDangerOptions({}), {});
      assert.deepEqual(getDangerOptions(undefined), {});
    });
  });

  describe('SecuroXMLHttpRequest Mock Lifecycle & State Transitions', () => {
    class MockEventTarget {
      constructor() {
        this.listeners = {};
      }
      addEventListener(type, cb) {
        (this.listeners[type] ??= []).push(cb);
      }
      dispatchEvent(event) {
        (this.listeners[event.type] || []).forEach((cb) => cb(event));
      }
    }

    class MockSecuroXHR extends MockEventTarget {
      constructor(mockNativeFetch) {
        super();
        this.nativeFetch = mockNativeFetch;
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.response = null;
        this.responseText = '';
        this.responseType = '';
        this.headers = new Map();
        this.responseHeaders = new Map();
        this.timeout = 0;
      }

      open(method, url) {
        this.method = method;
        this.url = url;
        this.readyState = 1; // OPENED
        this._emit('readystatechange');
      }

      setRequestHeader(name, value) {
        this.headers.set(name.toLowerCase(), value);
      }

      getResponseHeader(name) {
        return this.responseHeaders.get(name.toLowerCase()) ?? null;
      }

      getAllResponseHeaders() {
        let str = '';
        this.responseHeaders.forEach((val, key) => {
          str += `${key}: ${val}\r\n`;
        });
        return str;
      }

      async send(body = null) {
        try {
          const resp = await this.nativeFetch(this.url, {
            method: this.method,
            headers: this.headers,
            body,
          });
          this.status = resp.status;
          this.statusText = resp.statusText;
          this.responseHeaders = resp.headers;
          this.readyState = 2; // HEADERS_RECEIVED
          this._emit('readystatechange');

          const text = await resp.text();
          this.responseText = text;
          if (this.responseType === 'json') {
            try {
              this.response = JSON.parse(text);
            } catch {
              this.response = null;
            }
          } else {
            this.response = text;
          }

          this.readyState = 4; // DONE
          this._emit('readystatechange');
          this._emit('load');
          this._emit('loadend');
        } catch (err) {
          this.readyState = 4;
          this._emit('readystatechange');
          this._emit(err?.name === 'AbortError' ? 'abort' : 'error');
          this._emit('loadend');
        }
      }

      _emit(type) {
        const event = { type, target: this };
        this.dispatchEvent(event);
        if (typeof this[`on${type}`] === 'function') {
          this[`on${type}`](event);
        }
      }
    }

    test('transitions through readyState 0 -> 1 -> 2 -> 4 on successful request', async () => {
      const states = [];
      const mockFetch = async () => ({
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ success: true, count: 5 }),
      });

      const xhr = new MockSecuroXHR(mockFetch);
      assert.equal(xhr.readyState, 0);

      xhr.onreadystatechange = () => states.push(xhr.readyState);
      xhr.responseType = 'json';
      xhr.open('GET', 'https://securo.test/api/accounts');
      xhr.setRequestHeader('X-Securo-Client', 'mobile');

      await xhr.send();

      assert.deepEqual(states, [1, 2, 4]);
      assert.equal(xhr.status, 200);
      assert.deepEqual(xhr.response, { success: true, count: 5 });
      assert.equal(xhr.getResponseHeader('Content-Type'), 'application/json');
    });

    test('handles network failure by firing error and loadend events', async () => {
      const events = [];
      const failingFetch = async () => {
        throw new Error('Network connection dropped');
      };

      const xhr = new MockSecuroXHR(failingFetch);
      xhr.addEventListener('error', () => events.push('error'));
      xhr.addEventListener('loadend', () => events.push('loadend'));

      xhr.open('POST', 'https://securo.test/api/transactions');
      await xhr.send(JSON.stringify({ amount: 100 }));

      assert.equal(xhr.readyState, 4);
      assert.ok(events.includes('error'));
      assert.ok(events.includes('loadend'));
    });

    test('handles aborted requests by firing abort event', async () => {
      const events = [];
      const abortedFetch = async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      const xhr = new MockSecuroXHR(abortedFetch);
      xhr.addEventListener('abort', () => events.push('abort'));
      xhr.addEventListener('loadend', () => events.push('loadend'));

      xhr.open('GET', 'https://securo.test/api/slow-sync');
      await xhr.send();

      assert.equal(xhr.readyState, 4);
      assert.ok(events.includes('abort'));
      assert.ok(events.includes('loadend'));
    });
  });
});
