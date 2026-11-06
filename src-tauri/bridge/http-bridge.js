import { fetch as nativeFetch } from "@tauri-apps/plugin-http";

(() => {
  let settingsPromise = null;

  function getInvoke() {
    return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  }

  function getSettings() {
    const invoke = getInvoke();
    if (!invoke) return Promise.resolve(null);
    settingsPromise ??= invoke("get_connection_settings");
    return settingsPromise;
  }

  function isApiRequest(input, serverUrl) {
    if (!input) return false;
    const urlStr = typeof input === "string" ? input : input.url || "";
    if (urlStr.startsWith("/api/") || urlStr === "/api" || urlStr.startsWith("api/")) {
      return true;
    }
    try {
      const parsed = new URL(urlStr, window.location.href);
      if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) {
        return true;
      }
      if (serverUrl) {
        const srv = new URL(serverUrl);
        if (parsed.origin === srv.origin && (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/"))) {
          return true;
        }
      }
    } catch {}
    return false;
  }

  function getApiUrl(input, serverUrl) {
    if (!serverUrl) return null;
    const urlStr = typeof input === "string" ? input : input.url || "";
    try {
      const parsed = new URL(urlStr, window.location.href);
      const target = new URL(serverUrl);
      target.pathname = parsed.pathname;
      target.search = parsed.search;
      target.hash = "";
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

  const browserFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const settings = await getSettings();
    const serverUrl = settings?.server_url || settings?.serverUrl;
    if (!isApiRequest(input, serverUrl)) return browserFetch(input, init);
    const targetUrl = serverUrl && getApiUrl(input, serverUrl);
    if (!targetUrl) return browserFetch(input, init);
    return nativeFetch(targetUrl, {
      ...init,
      ...getDangerOptions(settings),
    });
  };

  const BrowserXHR = window.XMLHttpRequest;
  const forwardedEvents = ["abort", "error", "load", "loadend", "loadstart", "progress", "timeout"];

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
      this._browserXhr.addEventListener("readystatechange", (event) => {
        if (!this._apiRequest) {
          this.dispatchEvent(new Event(event.type));
          this.onreadystatechange?.call(this, event);
        }
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
      this._apiRequest = typeof url === "string" && (url.startsWith("/api") || url.startsWith("api/"));
      if (!this._apiRequest) return this._browserXhr.open(method, url, async, user, password);
      this._state = 1;
      this._emitReadyStateChange();
    }

    setRequestHeader(name, value) {
      if (this._apiRequest) this._headers.set(name, value);
      else {
        this._headers.set(name, value);
        try { this._browserXhr.setRequestHeader(name, value); } catch {}
      }
    }

    getResponseHeader(name) {
      return this._apiRequest ? (this._responseHeaders?.get?.(name) ?? null) : this._browserXhr.getResponseHeader(name);
    }

    getAllResponseHeaders() {
      if (!this._apiRequest) return this._browserXhr.getAllResponseHeaders();
      let str = "";
      if (this._responseHeaders?.forEach) {
        this._responseHeaders.forEach((val, key) => {
          str += `${key}: ${val}\r\n`;
        });
      }
      return str;
    }

    abort() {
      if (!this._apiRequest) return this._browserXhr.abort();
      this._controller?.abort();
    }

    async send(body = null) {
      const settings = await getSettings();
      const serverUrl = settings?.server_url || settings?.serverUrl;
      if (isApiRequest(this._url, serverUrl)) {
        this._apiRequest = true;
        this._sendThroughTauri(body, settings, serverUrl);
      } else {
        this._apiRequest = false;
        return this._browserXhr.send(body);
      }
    }

    _emitReadyStateChange() {
      const event = new Event("readystatechange");
      this.dispatchEvent(event);
      this.onreadystatechange?.call(this, event);
    }

    async _sendThroughTauri(body, settings, serverUrl) {
      const targetUrl = serverUrl && getApiUrl(this._url, serverUrl);
      if (!targetUrl) return this._fail(new Error("Nenhum servidor Securo está configurado."));

      this._controller = new AbortController();
      if (this.timeout > 0) this._timer = setTimeout(() => this._controller.abort(), this.timeout);
      const requestOptions = {
        method: this._method,
        headers: this._headers,
        signal: this._controller.signal,
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
        this._emitReadyStateChange();
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
        this._emitReadyStateChange();
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
      this._emitReadyStateChange();
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
