import { fetch as nativeFetch } from "@tauri-apps/plugin-http";

(() => {
  const invoke = window.__TAURI__?.core?.invoke;

  if (!invoke) return;

  let settingsPromise;

  function getSettings() {
    settingsPromise ??= invoke("get_connection_settings");
    return settingsPromise;
  }

  function getRelativeApiUrl(input) {
    try {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, window.location.href);
      if (requestUrl.origin !== window.location.origin ||
        !(requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/"))) {
        return null;
      }
    } catch {
      return null;
    }
    return null;
  }

  function getApiUrl(input, serverUrl) {
    const requestUrl = getRelativeApiUrl(input);
    if (!requestUrl) return null;

    const targetUrl = new URL(serverUrl);
    targetUrl.pathname = requestUrl.pathname;
    targetUrl.search = requestUrl.search;
    targetUrl.hash = "";
    return targetUrl.toString();
  }

  const browserFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (!getRelativeApiUrl(input)) return browserFetch(input, init);
    const settings = await getSettings();
    const targetUrl = settings.server_url && getApiUrl(input, settings.server_url);
    if (!targetUrl) return browserFetch(input, init);
    return nativeFetch(targetUrl, init);
  };

  const BrowserXHR = window.XMLHttpRequest;
  const forwardedEvents = ["abort", "error", "load", "loadend", "loadstart", "progress", "timeout"];

  class SecuroXMLHttpRequest extends EventTarget {
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
      this._apiRequest = Boolean(getRelativeApiUrl(url));
      if (!this._apiRequest) return this._browserXhr.open(method, url, async, user, password);
      this._state = 1;
      this._emitReadyStateChange();
    }

    setRequestHeader(name, value) {
      if (this._apiRequest) this._headers.set(name, value);
      else this._browserXhr.setRequestHeader(name, value);
    }

    getResponseHeader(name) {
      return this._apiRequest ? this._responseHeaders.get(name) : this._browserXhr.getResponseHeader(name);
    }

    getAllResponseHeaders() {
      if (!this._apiRequest) return this._browserXhr.getAllResponseHeaders();
      return [...this._responseHeaders].map(([name, value]) => `${name}: ${value}\r\n`).join("");
    }

    abort() {
      if (!this._apiRequest) return this._browserXhr.abort();
      this._controller?.abort();
    }

    send(body = null) {
      if (!this._apiRequest) return this._browserXhr.send(body);
      this._sendThroughTauri(body);
    }

    _emitReadyStateChange() {
      const event = new Event("readystatechange");
      this.dispatchEvent(event);
      this.onreadystatechange?.call(this, event);
    }

    async _sendThroughTauri(body) {
      const settings = await getSettings();
      const targetUrl = settings.server_url && getApiUrl(this._url, settings.server_url);
      if (!targetUrl) return this._fail(new Error("Nenhum servidor Securo está configurado."));

      this._controller = new AbortController();
      if (this.timeout > 0) this._timer = setTimeout(() => this._controller.abort(), this.timeout);
      try {
        const response = await nativeFetch(targetUrl, {
          method: this._method,
          headers: this._headers,
          body,
          signal: this._controller.signal,
        });
        this._status = response.status;
        this._statusText = response.statusText;
        this._responseHeaders = response.headers;
        this._state = 2;
        this._emitReadyStateChange();
        const buffer = await response.arrayBuffer();
        const text = new TextDecoder().decode(buffer);
        this._responseText = text;
        this._response = this._responseType === "arraybuffer" ? buffer
          : this._responseType === "blob" ? new Blob([buffer], { type: response.headers.get("content-type") || "" })
            : this._responseType === "json" ? JSON.parse(text || "null") : text;
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

  window.XMLHttpRequest = SecuroXMLHttpRequest;
})();
