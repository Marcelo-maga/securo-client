const isNode = typeof window === "undefined";
if (!isNode && window.top !== window.self) {
  throw new Error("Configuration view cannot be embedded inside a frame.");
}

const rawInvoke = !isNode
  ? window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke
  : undefined;
const invoke = rawInvoke ? (cmd, args = {}) => rawInvoke(cmd, args) : undefined;
const isPortuguese = Boolean(
  !isNode && navigator.language && navigator.language.toLowerCase().startsWith("pt")
);
export const defaultLocale = isPortuguese ? "pt-BR" : "en-US";
if (!isNode && typeof document !== "undefined") {
  document.documentElement.lang = defaultLocale;
}

export function formatMessage(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

export function getErrorMessage(error, copy) {
  const code = error?.code || "UNKNOWN";
  const template = copy?.errors?.[code] || copy?.errors?.UNKNOWN || copy?.connectionError || "Connection error";
  return formatMessage(template, error);
}

export function isCertError(detailsStr) {
  const str = String(detailsStr || "").toLowerCase();
  return (
    str.includes("cert") ||
    str.includes("ssl") ||
    str.includes("tls") ||
    str.includes("pkix") ||
    str.includes("unknown issuer") ||
    str.includes("self signed")
  );
}

export function isInsecureRemoteHttp(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed.toLowerCase().startsWith("http://")) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && host !== "::1";
  } catch {
    return false;
  }
}

export function resolveAppTarget(pathname) {
  return pathname.includes("/config/") ? "../app.html#/" : "app.html#/";
}

export function resolveBootstrapTarget(serverUrl, autoConnect) {
  const hasServer = Boolean(serverUrl && String(serverUrl).trim().length > 0);
  const shouldAutoConnect = Boolean(autoConnect);
  if (hasServer && shouldAutoConnect) {
    return "app.html#/";
  }
  return "config/config.html";
}

export async function loadLocaleData(localeName = defaultLocale) {
  const response = await fetch(new URL(`../locales/${localeName}.json`, import.meta.url));
  if (!response.ok) {
    throw new Error(`Failed to load locale data: ${response.status}`);
  }
  return response.json();
}

// UI bindings only when loaded in a browser DOM environment
if (typeof document !== "undefined" && document.querySelector("#server-form")) {
  (async () => {
    let copy = {};
    try {
      copy = await loadLocaleData(defaultLocale);
    } catch {
      try {
        copy = await loadLocaleData("en-US");
      } catch {
        copy = {};
      }
    }

    const form = document.querySelector("#server-form");
    const input = document.querySelector("#server-url");
    const certificateCheckbox = document.querySelector("#allow-invalid-certs");
    const autoConnectCheckbox = document.querySelector("#auto-connect");
    const button = document.querySelector("#connect-button");
    const buttonLabel = document.querySelector("#connect-label");
    const loadingIcon = document.querySelector("#loading-icon");
    const connectConfiguredButton = document.querySelector("#connect-configured-button");
    const connectConfiguredLabel = document.querySelector("#connect-configured-label");
    const loadingConfiguredIcon = document.querySelector("#loading-configured-icon");
    const forceConnectButton = document.querySelector("#force-connect-button");
    const forceConnectLabel = document.querySelector("#force-connect-label");
    const errorContainer = document.querySelector("#error-container");
    const errorDetails = document.querySelector("#error-details");
    const copyErrorButton = document.querySelector("#copy-error-button");
    const clearButton = document.querySelector("#clear-button");
    const status = document.querySelector("#status");

    function renderCopy() {
      document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.dataset.i18n;
        if (copy[key]) element.textContent = copy[key];
      });
      if (copy.urlPlaceholder) {
        input.placeholder = copy.urlPlaceholder;
      }
      if (forceConnectLabel && copy.forceConnect) {
        forceConnectLabel.textContent = copy.forceConnect;
      }
      if (connectConfiguredLabel && copy.connectConfigured) {
        connectConfiguredLabel.textContent = copy.connectConfigured;
      }
      document.title = "Securo";
    }

    function errorMessage(error) {
      return getErrorMessage(error, copy);
    }

    function setStatus(message = "", kind = "") {
      status.textContent = message;
      status.className = `status${kind ? ` ${kind}` : ""}`;
    }

    function setBusy(isBusy) {
      button.disabled = isBusy;
      if (connectConfiguredButton) connectConfiguredButton.disabled = isBusy;
      input.disabled = isBusy;
      certificateCheckbox.disabled = isBusy;
      if (autoConnectCheckbox) autoConnectCheckbox.disabled = isBusy;
      if (forceConnectButton) forceConnectButton.disabled = isBusy;
      if (clearButton) clearButton.disabled = isBusy;
      buttonLabel.textContent = isBusy ? (copy.connecting || "Connecting...") : (copy.connect || "Connect");
      loadingIcon.classList.toggle("hidden", !isBusy);
      if (loadingConfiguredIcon) loadingConfiguredIcon.classList.toggle("hidden", !isBusy);
    }

    function setConnected(serverUrl, autoConnect = false) {
      input.value = serverUrl;
      input.disabled = true;
      certificateCheckbox.disabled = true;
      if (autoConnectCheckbox) {
        autoConnectCheckbox.checked = Boolean(autoConnect);
        autoConnectCheckbox.disabled = false;
      }
      button.classList.add("hidden");
      if (connectConfiguredButton) connectConfiguredButton.classList.remove("hidden");
      if (forceConnectButton) forceConnectButton.classList.add("hidden");
      if (errorContainer) errorContainer.classList.add("hidden");
      clearButton.classList.remove("hidden");
      setStatus(copy.serverConfigured || copy.success || "Connected", "success");
    }

    async function navigateToApp() {
      const appTarget = resolveAppTarget(window.location.pathname);
      if (invoke) {
        try {
          await invoke("activate_app_window");
          return;
        } catch {
          // Fallback for mobile / single-webview navigation
        }
      }
      window.location.replace(appTarget);
    }

    function showErrorDetails(error) {
      const fullErr = error?.details || (typeof error === "string" ? error : JSON.stringify(error, null, 2));
      if (fullErr && errorDetails && errorContainer) {
        errorDetails.textContent = fullErr;
        errorContainer.classList.remove("hidden");
      }
    }

    async function connectConfigured() {
      setBusy(true);
      setStatus(copy.connecting || copy.loading || "Connecting...");
      if (invoke && autoConnectCheckbox) {
        try {
          await invoke("set_auto_connect", {
            autoConnect: autoConnectCheckbox.checked,
            auto_connect: autoConnectCheckbox.checked,
          });
        } catch {
          // Non-fatal
        }
      }
      await navigateToApp();
    }

    async function connect(event) {
      event.preventDefault();
      const rawUrl = input.value.trim();
      if (!rawUrl) {
        setStatus(copy.errors?.INVALID_URL || "Enter a valid URL", "error");
        input.focus();
        return;
      }

      setBusy(true);
      setStatus(copy.checking || "Testing connection...");
      if (forceConnectButton) forceConnectButton.classList.add("hidden");
      if (errorContainer) errorContainer.classList.add("hidden");

      if (!invoke) {
        setStatus(copy.tauriUnavailable || "Tauri API is not available.", "error");
        setBusy(false);
        return;
      }

      try {
        const isAutoConnect = Boolean(autoConnectCheckbox?.checked);
        const serverUrl = await invoke("connect_server", {
          serverUrl: rawUrl,
          allowInvalidCerts: certificateCheckbox.checked,
          autoConnect: isAutoConnect,
          server_url: rawUrl,
          allow_invalid_certs: certificateCheckbox.checked,
          auto_connect: isAutoConnect,
        });
        setConnected(serverUrl, isAutoConnect);
        await navigateToApp();
      } catch (error) {
        const errMsg = errorMessage(error);
        const detailsStr = String(error?.details || "");
        if (isCertError(detailsStr) && !certificateCheckbox.checked) {
          // Never auto-enable allow_invalid_certs: require deliberate manual opt-in to prevent MitM downgrade traps
          const certHint = copy.certUntrustedHint ? ` ${copy.certUntrustedHint}` : "";
          setStatus(`${errMsg}${certHint}`, "error");
        } else {
          setStatus(errMsg, "error");
        }

        showErrorDetails(error);

        if (forceConnectButton) forceConnectButton.classList.remove("hidden");
        setBusy(false);
      }
    }

    async function forceConnect() {
      const rawUrl = input.value.trim();
      if (!rawUrl) return;

      setBusy(true);
      setStatus(copy.loading || "Loading...");
      if (errorContainer) errorContainer.classList.add("hidden");

      if (!invoke) {
        setStatus(copy.tauriUnavailable || "Tauri API is not available.", "error");
        setBusy(false);
        return;
      }

      try {
        const isAutoConnect = Boolean(autoConnectCheckbox?.checked);
        const serverUrl = await invoke("save_server_url", {
          serverUrl: rawUrl,
          allowInvalidCerts: certificateCheckbox.checked,
          autoConnect: isAutoConnect,
          server_url: rawUrl,
          allow_invalid_certs: certificateCheckbox.checked,
          auto_connect: isAutoConnect,
        });
        setConnected(serverUrl, isAutoConnect);
        await navigateToApp();
      } catch (error) {
        setStatus(errorMessage(error), "error");
        showErrorDetails(error);
        setBusy(false);
      }
    }

    async function clearServer() {
      if (!invoke) return;
      try {
        await invoke("clear_server_url");
        setBusy(false);
        input.value = "";
        input.disabled = false;
        certificateCheckbox.disabled = false;
        if (autoConnectCheckbox) autoConnectCheckbox.disabled = false;
        button.classList.remove("hidden");
        if (connectConfiguredButton) connectConfiguredButton.classList.add("hidden");
        if (forceConnectButton) forceConnectButton.classList.add("hidden");
        if (errorContainer) errorContainer.classList.add("hidden");
        clearButton.classList.add("hidden");
        setStatus();
        input.focus();
      } catch (error) {
        setStatus(errorMessage(error), "error");
      }
    }

    async function handleAutoConnectChange() {
      if (!invoke || !autoConnectCheckbox) return;
      try {
        await invoke("set_auto_connect", {
          autoConnect: autoConnectCheckbox.checked,
          auto_connect: autoConnectCheckbox.checked,
        });
      } catch (error) {
        console.error("Failed to update auto_connect preference:", error);
      }
    }

    renderCopy();
    form.addEventListener("submit", connect);
    input.addEventListener("input", () => {
      if (forceConnectButton) forceConnectButton.classList.add("hidden");
      if (errorContainer) errorContainer.classList.add("hidden");
      if (isInsecureRemoteHttp(input.value)) {
        setStatus(
          copy.cleartextHttpNotice ||
            "Warning: http:// transmits financial data without encryption.",
          "error"
        );
      } else {
        setStatus();
      }
    });
    if (connectConfiguredButton) connectConfiguredButton.addEventListener("click", connectConfigured);
    if (autoConnectCheckbox) autoConnectCheckbox.addEventListener("change", handleAutoConnectChange);
    if (forceConnectButton) forceConnectButton.addEventListener("click", forceConnect);
    copyErrorButton?.addEventListener("click", async () => {
      const text = errorDetails?.textContent || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      copyErrorButton.textContent = copy.copied || "Copied!";
      setTimeout(() => {
        copyErrorButton.textContent = copy.copy || "Copy";
      }, 2000);
    });
    clearButton.addEventListener("click", clearServer);

    if (!invoke) return;

    try {
      setStatus(copy.loading || "Loading...");
      const settings = await invoke("get_connection_settings");
      const serverUrl = settings?.server_url || settings?.serverUrl;
      const allowInvalidCerts = Boolean(settings?.allow_invalid_certs || settings?.allowInvalidCerts);
      const autoConnect = Boolean(settings?.auto_connect ?? settings?.autoConnect);
      certificateCheckbox.checked = allowInvalidCerts;
      if (autoConnectCheckbox) autoConnectCheckbox.checked = autoConnect;
      if (serverUrl) {
        setConnected(serverUrl, autoConnect);
      } else {
        setStatus();
      }
    } catch (error) {
      setStatus(errorMessage(error), "error");
    }
  })();
}
