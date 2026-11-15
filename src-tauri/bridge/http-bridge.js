import { fetch as nativeFetch } from "@tauri-apps/plugin-http";

function hasEncodedDotSegment(rawUrl) {
  return /%2e/i.test(rawUrl);
}

function normalizeRelativeApiPrefix(raw) {
  return raw === "api" || raw.startsWith("api/") || raw.startsWith("api?") || raw.startsWith("api#")
    ? `/${raw}`
    : raw;
}

export function isInternalIpcUrl(input) {
  if (!input) return false;
  let raw = "";
  if (typeof input === "string") {
    raw = input;
  } else if (typeof input === "object") {
    if (typeof input.url === "string") {
      raw = input.url;
    } else if (typeof input.href === "string") {
      raw = input.href;
    } else if (typeof input.toString === "function") {
      try {
        raw = input.toString();
      } catch {
        raw = "";
      }
    }
  }
  if (!raw) return false;
  return (
    raw.startsWith("ipc:") ||
    raw.startsWith("http://ipc.localhost") ||
    raw.startsWith("https://ipc.localhost")
  );
}

export function isApiRequest(input, baseHref = "http://tauri.localhost/", serverUrl = null) {
  if (!input || isInternalIpcUrl(input)) return false;
  const urlStr = typeof input === "string" ? input : input.url || "";
  if (!urlStr || hasEncodedDotSegment(urlStr) || urlStr.includes('\\') || urlStr.includes('\r') || urlStr.includes('\n')) return false;

  const normalized = normalizeRelativeApiPrefix(urlStr);

  try {
    const base = new URL(baseHref);
    const parsed = new URL(normalized, base);

    let allowedServerOrigin = null;
    let serverBasePath = "";
    if (serverUrl) {
      try {
        const parsedServer = new URL(serverUrl);
        allowedServerOrigin = parsedServer.origin;
        serverBasePath = parsedServer.pathname.endsWith("/")
          ? parsedServer.pathname.slice(0, -1)
          : parsedServer.pathname;
      } catch {
        allowedServerOrigin = null;
      }
    }

    if (parsed.origin !== base.origin && parsed.origin !== allowedServerOrigin) {
      return false;
    }

    const { pathname } = parsed;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return true;
    }
    if (serverBasePath && (pathname === `${serverBasePath}/api` || pathname.startsWith(`${serverBasePath}/api/`))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getApiUrl(input, serverUrl, baseHref = "http://tauri.localhost/") {
  if (!serverUrl || !input || isInternalIpcUrl(input)) return null;
  const raw = typeof input === "string" ? input : input.url || "";
  if (!raw || hasEncodedDotSegment(raw) || raw.includes('\\') || raw.includes('\r') || raw.includes('\n')) return null;

  const normalized = normalizeRelativeApiPrefix(raw);

  try {
    const base = new URL(baseHref);
    const parsed = new URL(normalized, base);
    const target = new URL(serverUrl);

    if (parsed.origin !== base.origin && parsed.origin !== target.origin) {
      return null;
    }

    const rawPath = target.pathname;
    const basePath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
    if (basePath && !parsed.pathname.startsWith(basePath + "/") && parsed.pathname !== basePath) {
      target.pathname = basePath + parsed.pathname;
    } else {
      target.pathname = parsed.pathname;
    }

    const expectedApiPrefix = `${basePath}/api`;
    if (target.pathname !== expectedApiPrefix && !target.pathname.startsWith(`${expectedApiPrefix}/`)) {
      return null;
    }

    target.search = parsed.search;
    target.hash = "";
    return target.toString();
  } catch {
    return null;
  }
}

export function getDangerOptions(settings) {
  if (!settings?.allow_invalid_certs && !settings?.allowInvalidCerts) return {};
  return {
    danger: {
      acceptInvalidCerts: true,
      acceptInvalidHostnames: true,
    },
  };
}

export function applyOriginAndRefererHeaders(headers, serverUrl) {
  if (!serverUrl || !headers) return;
  try {
    const serverOrigin = new URL(serverUrl).origin;
    if (serverOrigin && serverOrigin !== "null") {
      headers.set("Origin", serverOrigin);
      headers.set("Referer", `${serverOrigin}/`);
    }
  } catch {}
}

export async function serializeRequestPayload(body, headers) {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    return Array.from(new TextEncoder().encode(body));
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    if (headers && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    return Array.from(new TextEncoder().encode(body.toString()));
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(body));
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)) {
    return Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  if (
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof FormData !== "undefined" && body instanceof FormData)
  ) {
    const tempReq = new Request("http://tauri.localhost/", { method: "POST", body });
    const generatedContentType = tempReq.headers.get("Content-Type");
    if (headers && generatedContentType && !headers.has("Content-Type")) {
      headers.set("Content-Type", generatedContentType);
    }
    const buf = await tempReq.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }
  if (typeof body === "object") {
    if (headers && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return Array.from(new TextEncoder().encode(JSON.stringify(body)));
  }
  return Array.from(new TextEncoder().encode(String(body)));
}

async function sendViaTauriProxy(targetUrl, options, settings, invoke) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const serverUrl = settings?.server_url || settings?.serverUrl || null;
  applyOriginAndRefererHeaders(headers, serverUrl);

  let bodyBytes = null;
  if (options.body !== undefined && options.body !== null && method !== "GET" && method !== "HEAD") {
    bodyBytes = await serializeRequestPayload(options.body, headers);
  }

  const headerEntries = [];
  headers.forEach((value, key) => {
    headerEntries.push([key, value]);
  });

  if (invoke) {
    const proxyRes = await invoke("proxy_api_request", {
      url: targetUrl,
      method,
      headers: headerEntries,
      body: bodyBytes,
    });
    if (proxyRes && typeof proxyRes.status === "number") {
      const uint8 = new Uint8Array(proxyRes.body || []);
      const isNullBodyStatus =
        proxyRes.status === 101 ||
        proxyRes.status === 204 ||
        proxyRes.status === 205 ||
        proxyRes.status === 304;
      return {
        status: proxyRes.status,
        statusText: proxyRes.statusText || "",
        url: proxyRes.url || targetUrl,
        headers: new Headers(proxyRes.headers || []),
        arrayBuffer: async () =>
          uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength),
        toFetchResponse: () =>
          new Response(isNullBodyStatus ? null : uint8, {
            status: proxyRes.status,
            statusText: proxyRes.statusText || "",
            headers: proxyRes.headers || [],
          }),
      };
    }
  }

  let fallbackBody = options.body;
  if (typeof URLSearchParams !== "undefined" && fallbackBody instanceof URLSearchParams) {
    fallbackBody = fallbackBody.toString();
  }
  const nativeRes = await nativeFetch(targetUrl, {
    maxRedirections: 5,
    ...options,
    method,
    headers,
    ...(fallbackBody !== undefined && fallbackBody !== null && method !== "GET" && method !== "HEAD"
      ? { body: fallbackBody }
      : {}),
    ...getDangerOptions(settings),
  });
  return {
    status: nativeRes.status,
    statusText: nativeRes.statusText || "",
    url: nativeRes.url || targetUrl,
    headers: nativeRes.headers,
    arrayBuffer: () => nativeRes.arrayBuffer(),
    toFetchResponse: () => nativeRes,
  };
}

function installRuntimeErrorOverlay(win, doc) {
  function reportRuntimeError(label, detail) {
    let b = doc.getElementById("securo-err");
    if (!b) {
      b = doc.createElement("div");
      b.id = "securo-err";
      b.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#fff;padding:12px 36px 12px 12px;font-family:monospace;font-size:12px;word-break:break-all;max-height:50vh;overflow:auto;";
      const closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "\u00d7";
      closeBtn.setAttribute("aria-label", "Dismiss error");
      closeBtn.style.cssText =
        "position:absolute;top:6px;right:8px;background:transparent;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:4px;";
      closeBtn.onclick = () => b.remove();
      b.appendChild(closeBtn);
      (doc.body || doc.documentElement).appendChild(b);
    }
    const row = doc.createElement("div");
    const strong = doc.createElement("b");
    strong.textContent = `${label}: `;
    row.appendChild(strong);
    row.appendChild(doc.createTextNode(String(detail)));
    b.appendChild(row);
  }

  win.addEventListener("error", (e) => {
    reportRuntimeError("JS Error", e.message || e.error || e);
  });
  win.addEventListener("unhandledrejection", (e) => {
    reportRuntimeError("Promise Error", e.reason?.message || e.reason || e);
  });
}

export function installHttpBridge(win = typeof window !== "undefined" ? window : null) {
  if (!win) return;

  const isDevOverlayEnabled = typeof __SECURO_DEV__ !== "undefined" && __SECURO_DEV__ === true;
  if (isDevOverlayEnabled && win.document) {
    installRuntimeErrorOverlay(win, win.document);
  }

  let cachedSettings = null;
  let settingsPromise = null;

  function getInvoke() {
    const rawInvoke = win.__TAURI__?.core?.invoke || win.__TAURI_INTERNALS__?.invoke;
    return rawInvoke ? (cmd, args = {}) => rawInvoke(cmd, args) : null;
  }

  function getSettings() {
    if (cachedSettings) return Promise.resolve(cachedSettings);
    const invoke = getInvoke();
    if (!invoke) return Promise.resolve(null);
    if (!settingsPromise) {
      settingsPromise = invoke("get_connection_settings")
        .then((res) => {
          if (res?.server_url || res?.serverUrl) {
            cachedSettings = res;
          } else {
            settingsPromise = null;
          }
          return res;
        })
        .catch((error) => {
          settingsPromise = null;
          throw error;
        });
    }
    return settingsPromise;
  }

  // Proactively pre-cache connection settings so initial frontend requests don't block
  try {
    getSettings().catch(() => {});
  } catch {}

  const browserFetch = win.fetch.bind(win);
  win.fetch = (input, init) => {
    // 1. Synchronously bypass internal Tauri IPC requests to avoid deadlock & recursion
    if (isInternalIpcUrl(input)) {
      return browserFetch(input, init);
    }

    // 2. Synchronously bypass non-API requests (static frontend bundles, fonts, locales)
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    if (rawUrl && !rawUrl.includes("api")) {
      return browserFetch(input, init);
    }

    return (async () => {
      const baseHref = win.location.href;
      const settings = cachedSettings || (await getSettings().catch(() => null));
      const serverUrl = settings?.server_url || settings?.serverUrl || null;
      if (!isApiRequest(input, baseHref, serverUrl)) return browserFetch(input, init);
      const invoke = getInvoke();
      const targetUrl = serverUrl
        ? getApiUrl(input, serverUrl, baseHref)
        : invoke
          ? typeof input === "string"
            ? input
            : input?.url || null
          : null;
      if (!targetUrl) return browserFetch(input, init);
      try {
        const res = await sendViaTauriProxy(targetUrl, init || {}, settings, invoke);
        return res.toFetchResponse();
      } catch (error) {
        console.error("[SecuroBridge] Native fetch error:", targetUrl, error);
        throw error;
      }
    })();
  };

  const BrowserXHR = win.XMLHttpRequest;
  const forwardedEvents = [
    "abort",
    "error",
    "load",
    "loadend",
    "loadstart",
    "progress",
    "timeout",
    "readystatechange",
  ];

  class SecuroXMLHttpRequest extends EventTarget {
    static UNSENT = 0;
    static OPENED = 1;
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;

    UNSENT = 0;
    OPENED = 1;
    HEADERS_RECEIVED = 2;
    LOADING = 3;
    DONE = 4;

    constructor() {
      super();
      this._browserXhr = new BrowserXHR();
      this._apiRequest = false;
      this._method = "GET";
      this._url = "";
      this._responseUrl = "";
      this._headers = new Headers();
      this._state = 0;
      this._status = 0;
      this._statusText = "";
      this._response = null;
      this._responseText = "";
      this._responseHeaders = new Headers();
      this._controller = null;
      this._timer = null;
      this._timedOut = false;
      this._responseType = "";
      this.timeout = 0;
      this.withCredentials = false;

      // Explicitly initialize standard XHR event properties so libraries like Axios
      // detect `'onloadend' in request === true`
      this.onloadstart = null;
      this.onprogress = null;
      this.onabort = null;
      this.onerror = null;
      this.onload = null;
      this.ontimeout = null;
      this.onloadend = null;
      this.onreadystatechange = null;

      const uploadTarget = new EventTarget();
      uploadTarget.onloadstart = null;
      uploadTarget.onprogress = null;
      uploadTarget.onabort = null;
      uploadTarget.onerror = null;
      uploadTarget.onload = null;
      uploadTarget.ontimeout = null;
      uploadTarget.onloadend = null;
      this.upload = uploadTarget;

      forwardedEvents.forEach((eventName) => {
        this._browserXhr.addEventListener(eventName, (event) => {
          if (!this._apiRequest) {
            this.dispatchEvent(new Event(event.type));
            this[`on${event.type}`]?.call(this, event);
          }
        });
      });
    }

    get readyState() { return this._apiRequest ? this._state : this._browserXhr.readyState; }
    get status() { return this._apiRequest ? this._status : this._browserXhr.status; }
    get statusText() { return this._apiRequest ? this._statusText : this._browserXhr.statusText; }
    get response() { return this._apiRequest ? this._response : this._browserXhr.response; }
    get responseText() { return this._apiRequest ? this._responseText : this._browserXhr.responseText; }
    get responseURL() { return this._apiRequest ? (this._responseUrl || this._url) : this._browserXhr.responseURL; }
    get responseXML() { return null; }
    get responseType() { return this._responseType; }
    set responseType(value) { this._responseType = value; this._browserXhr.responseType = value; }

    open(method, url, async = true, user, password) {
      this._method = method;
      this._url = url;
      this._responseUrl = "";
      this._headers = new Headers();
      this._status = 0;
      this._statusText = "";
      this._response = null;
      this._responseText = "";
      this._timedOut = false;
      if (isInternalIpcUrl(url)) {
        this._apiRequest = false;
        return this._browserXhr.open(method, url, async, user, password);
      }
      const rawUrl = typeof url === "string" ? url : "";
      if (rawUrl && !rawUrl.includes("api")) {
        this._apiRequest = false;
        return this._browserXhr.open(method, url, async, user, password);
      }
      this._apiRequest = isApiRequest(url, win.location.href, cachedSettings?.server_url || cachedSettings?.serverUrl || null);
      if (!this._apiRequest) return this._browserXhr.open(method, url, async, user, password);
      this._state = 1;
      this._emit("readystatechange");
    }

    setRequestHeader(name, value) {
      this._headers.set(name, value);
      if (!this._apiRequest) {
        try { this._browserXhr.setRequestHeader(name, value); } catch {}
      }
    }

    getResponseHeader(name) {
      return this._apiRequest
        ? (this._responseHeaders?.get?.(name) ?? null)
        : this._browserXhr.getResponseHeader(name);
    }

    getAllResponseHeaders() {
      if (!this._apiRequest) return this._browserXhr.getAllResponseHeaders();
      let str = "";
      this._responseHeaders?.forEach?.((val, key) => {
        str += `${key}: ${val}\r\n`;
      });
      return str;
    }

    abort() {
      if (!this._apiRequest) return this._browserXhr.abort();
      this._controller?.abort();
    }

    async send(body = null) {
      if (isInternalIpcUrl(this._url)) {
        this._apiRequest = false;
        return this._browserXhr.send(body);
      }
      const rawUrl = typeof this._url === "string" ? this._url : "";
      if (rawUrl && !rawUrl.includes("api")) {
        this._apiRequest = false;
        return this._browserXhr.send(body);
      }
      const settings = cachedSettings || (await getSettings().catch(() => null));
      const serverUrl = settings?.server_url || settings?.serverUrl || null;
      if (isApiRequest(this._url, win.location.href, serverUrl)) {
        this._apiRequest = true;
        this._sendThroughTauri(body, settings, serverUrl);
      } else {
        this._apiRequest = false;
        return this._browserXhr.send(body);
      }
    }

    async _sendThroughTauri(body, settings, serverUrl) {
      const invoke = getInvoke();
      const targetUrl = serverUrl
        ? getApiUrl(this._url, serverUrl, win.location.href)
        : invoke
          ? this._url
          : null;
      if (!targetUrl) return this._fail(new Error("No Securo server is configured."));

      this._controller = new AbortController();
      if (this.timeout > 0) {
        this._timer = setTimeout(() => {
          this._timedOut = true;
          this._controller.abort();
        }, this.timeout);
      }

      const requestOptions = {
        method: this._method,
        headers: this._headers,
        signal: this._controller.signal,
      };
      if (body !== null && body !== undefined && this._method !== "GET" && this._method !== "HEAD") {
        requestOptions.body = body;
      }

      try {
        const response = await sendViaTauriProxy(targetUrl, requestOptions, settings, invoke);
        if (this._controller.signal.aborted) {
          const abortErr = new Error(this._timedOut ? "Request timed out" : "Request aborted");
          abortErr.name = this._timedOut ? "TimeoutError" : "AbortError";
          throw abortErr;
        }
        this._status = response.status;
        this._statusText = response.statusText;
        this._responseUrl = response.url || targetUrl;
        this._responseHeaders = response.headers;
        this._state = 2;
        this._emit("readystatechange");

        const buffer = await response.arrayBuffer();
        const text = new TextDecoder().decode(buffer);
        this._responseText = text;
        if (this._responseType === "arraybuffer") {
          this._response = buffer;
        } else if (this._responseType === "blob") {
          this._response = new Blob([buffer], { type: response.headers.get("content-type") || "" });
        } else if (this._responseType === "json") {
          try {
            this._response = text ? JSON.parse(text) : null;
          } catch {
            this._response = null;
          }
        } else {
          this._response = text;
        }
        this._state = 4;
        this._emit("readystatechange");
        this._emit("load");
        this._emit("loadend");
      } catch (error) {
        this._fail(error);
      } finally {
        clearTimeout(this._timer);
      }
    }

    _fail(error) {
      console.error("[SecuroBridge] XHR error:", this._url, error);
      this._state = 4;
      this._emit("readystatechange");
      const eventType =
        this._timedOut || error?.name === "TimeoutError"
          ? "timeout"
          : error?.name === "AbortError"
            ? "abort"
            : "error";
      this._emit(eventType);
      this._emit("loadend");
    }

    _emit(name) {
      const event = new Event(name);
      this.dispatchEvent(event);
      this[`on${name}`]?.call(this, event);
    }
  }

  try {
    Object.getOwnPropertyNames(BrowserXHR).forEach((prop) => {
      if (!(prop in SecuroXMLHttpRequest)) {
        try {
          SecuroXMLHttpRequest[prop] = BrowserXHR[prop];
        } catch {}
      }
    });
  } catch {}

  win.XMLHttpRequest = SecuroXMLHttpRequest;
}

if (typeof window !== "undefined") {
  installHttpBridge(window);
}
