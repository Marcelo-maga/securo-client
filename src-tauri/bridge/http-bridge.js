import { fetch as nativeFetch } from "@tauri-apps/plugin-http";

function hasEncodedDotSegment(rawUrl) {
  return /%2e/i.test(rawUrl);
}

function normalizeRelativeApiPrefix(raw) {
  return raw === "api" || raw.startsWith("api/") || raw.startsWith("api?") || raw.startsWith("api#")
    ? `/${raw}`
    : raw;
}

export function isApiRequest(input, baseHref = "http://tauri.localhost/", serverUrl = null) {
  if (!input) return false;
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
  if (!serverUrl || !input) return null;
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

if (typeof window !== "undefined") {
  (() => {
    const isDevOverlayEnabled = typeof __SECURO_DEV__ !== "undefined" && __SECURO_DEV__ === true;
    if (isDevOverlayEnabled && window.document) {
      installRuntimeErrorOverlay(window, window.document);
    }

    let settingsPromise = null;

    function getInvoke() {
      const rawInvoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
      return rawInvoke ? (cmd, args = {}) => rawInvoke(cmd, args) : null;
    }

    function getSettings() {
      const invoke = getInvoke();
      if (!invoke) return Promise.resolve(null);
      if (!settingsPromise) {
        settingsPromise = invoke("get_connection_settings")
          .then((res) => {
            if (!res?.server_url && !res?.serverUrl) {
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

    const browserFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const baseHref = window.location.href;
      const settings = await getSettings().catch(() => null);
      const serverUrl = settings?.server_url || settings?.serverUrl || null;
      if (!isApiRequest(input, baseHref, serverUrl)) return browserFetch(input, init);
      const targetUrl = serverUrl && getApiUrl(input, serverUrl, baseHref);
      if (!targetUrl) return browserFetch(input, init);
      return nativeFetch(targetUrl, {
        maxRedirections: 5,
        ...init,
        ...getDangerOptions(settings),
      });
    };

    const BrowserXHR = window.XMLHttpRequest;
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
        this._headers = new Headers();
        this._state = 0;
        this._status = 0;
        this._statusText = "";
        this._response = null;
        this._responseText = "";
        this._responseHeaders = new Headers();
        this._controller = null;
        this._timer = null;
        this._responseType = "";
        this.timeout = 0;
        this.withCredentials = false;
        this.upload = new EventTarget();

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
      get responseURL() { return this._apiRequest ? this._url : this._browserXhr.responseURL; }
      get responseXML() { return null; }
      get responseType() { return this._responseType; }
      set responseType(value) { this._responseType = value; this._browserXhr.responseType = value; }

      open(method, url, async = true, user, password) {
        this._method = method;
        this._url = url;
        this._apiRequest = isApiRequest(url, window.location.href);
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
        const settings = await getSettings().catch(() => null);
        const serverUrl = settings?.server_url || settings?.serverUrl || null;
        if (isApiRequest(this._url, window.location.href, serverUrl)) {
          this._apiRequest = true;
          this._sendThroughTauri(body, settings, serverUrl);
        } else {
          this._apiRequest = false;
          return this._browserXhr.send(body);
        }
      }

      async _sendThroughTauri(body, settings, serverUrl) {
        const targetUrl = serverUrl && getApiUrl(this._url, serverUrl, window.location.href);
        if (!targetUrl) return this._fail(new Error("No Securo server is configured."));

        this._controller = new AbortController();
        if (this.timeout > 0) this._timer = setTimeout(() => this._controller.abort(), this.timeout);
        const requestOptions = {
          method: this._method,
          headers: this._headers,
          signal: this._controller.signal,
          maxRedirections: 5,
          ...getDangerOptions(settings),
        };
        if (body !== null && body !== undefined && this._method !== "GET" && this._method !== "HEAD") {
          requestOptions.body = body;
        }
        try {
          const response = await nativeFetch(targetUrl, requestOptions);
          this._status = response.status;
          this._statusText = response.statusText;
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
        this._state = 4;
        this._emit("readystatechange");
        this._emit(error?.name === "AbortError" ? "abort" : "error");
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

    window.XMLHttpRequest = SecuroXMLHttpRequest;
  })();
}
