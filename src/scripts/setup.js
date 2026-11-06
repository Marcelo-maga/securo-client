const invoke = window.__TAURI__?.core?.invoke;
const isPortuguese = Boolean(navigator.language && navigator.language.toLowerCase().startsWith("pt"));
const locale = isPortuguese ? "pt-BR" : "en-US";
document.documentElement.lang = locale;

const LOCALES = {
  "pt-BR": {
    title: "Configuração do Servidor",
    subtitle: "Informe o endereço da API do Securo.",
    urlLabel: "Endereço do servidor",
    urlPlaceholder: "https://meu-securo.com",
    certLabel: "Permitir certificado autoassinado",
    connect: "Conectar",
    connecting: "Conectando...",
    forceConnect: "Continuar mesmo assim",
    useAnother: "Trocar servidor",
    loading: "Carregando...",
    checking: "Testando conexão...",
    success: "Conectado com sucesso.",
    errors: {
      INVALID_URL: "Informe uma URL válida, incluindo http:// ou https://.",
      INVALID_URL_SCHEME: "A URL deve usar http:// ou https:// e conter um host.",
      INVALID_URL_CREDENTIALS: "A URL não pode conter credenciais ou fragmento.",
      CONFIG_OPEN_FAILED: "Não foi possível abrir a configuração local.",
      HTTP_CLIENT_BUILD_FAILED: "Não foi possível preparar a conexão.",
      SERVER_UNREACHABLE: "Não foi possível alcançar o servidor.",
      SERVER_HTTP_ERROR: "O servidor respondeu com HTTP {status}.",
      CONFIG_SAVE_FAILED: "Não foi possível salvar a configuração local.",
      UNKNOWN: "Não foi possível conectar ao servidor."
    }
  },
  "en-US": {
    title: "Server Configuration",
    subtitle: "Enter the address of your Securo server.",
    urlLabel: "Server address",
    urlPlaceholder: "https://my-securo.com",
    certLabel: "Allow self-signed certificate",
    connect: "Connect",
    connecting: "Connecting...",
    forceConnect: "Continue anyway",
    useAnother: "Change server",
    loading: "Loading...",
    checking: "Testing connection...",
    success: "Connected successfully.",
    errors: {
      INVALID_URL: "Enter a valid URL, including http:// or https://.",
      INVALID_URL_SCHEME: "The URL must use http:// or https:// and include a host.",
      INVALID_URL_CREDENTIALS: "The URL cannot contain credentials or a fragment.",
      CONFIG_OPEN_FAILED: "We could not open the local configuration.",
      HTTP_CLIENT_BUILD_FAILED: "We could not prepare the connection.",
      SERVER_UNREACHABLE: "We could not reach this server.",
      SERVER_HTTP_ERROR: "The server returned HTTP {status}.",
      CONFIG_SAVE_FAILED: "We could not save the local configuration.",
      UNKNOWN: "We could not connect to this server."
    }
  }
};

const form = document.querySelector("#server-form");
const input = document.querySelector("#server-url");
const certificateCheckbox = document.querySelector("#allow-invalid-certs");
const button = document.querySelector("#connect-button");
const buttonLabel = document.querySelector("#connect-label");
const loadingIcon = document.querySelector("#loading-icon");
const forceConnectButton = document.querySelector("#force-connect-button");
const forceConnectLabel = document.querySelector("#force-connect-label");
const errorContainer = document.querySelector("#error-container");
const errorDetails = document.querySelector("#error-details");
const copyErrorButton = document.querySelector("#copy-error-button");
const clearButton = document.querySelector("#clear-button");
const status = document.querySelector("#status");
let copy = LOCALES[locale] || LOCALES["en-US"];

async function loadCopy() {
  try {
    const response = await fetch(new URL(`../locales/${locale}.json`, import.meta.url));
    if (response.ok) {
      const data = await response.json();
      copy = { ...copy, ...data, errors: { ...copy.errors, ...(data.errors || {}) } };
    }
  } catch {
    // Falls back to embedded copy gracefully
  }
  return copy;
}

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
  document.title = "Securo";
}

function formatMessage(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

function errorMessage(error) {
  const code = error?.code || "UNKNOWN";
  const template = copy.errors?.[code] || copy.errors?.UNKNOWN || "Erro de conexão";
  return formatMessage(template, error);
}

function setStatus(message = "", kind = "") {
  status.textContent = message;
  status.className = `status${kind ? ` ${kind}` : ""}`;
}

function setBusy(isBusy) {
  button.disabled = isBusy;
  input.disabled = isBusy;
  certificateCheckbox.disabled = isBusy;
  if (forceConnectButton) forceConnectButton.disabled = isBusy;
  buttonLabel.textContent = isBusy ? copy.connecting : copy.connect;
  loadingIcon.classList.toggle("hidden", !isBusy);
}

function setConnected(serverUrl) {
  input.value = serverUrl;
  input.disabled = true;
  certificateCheckbox.disabled = true;
  button.classList.add("hidden");
  if (forceConnectButton) forceConnectButton.classList.add("hidden");
  if (errorContainer) errorContainer.classList.add("hidden");
  clearButton.classList.remove("hidden");
  setStatus(copy.success, "success");
}

async function navigateToApp() {
  const appTarget = window.location.pathname.includes("/config/") ? "../app.html#/" : "app.html#/";
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

async function connect(event) {
  event.preventDefault();
  const rawUrl = input.value.trim();
  if (!rawUrl) {
    setStatus(copy.errors.INVALID_URL, "error");
    input.focus();
    return;
  }

  setBusy(true);
  setStatus(copy.checking);
  if (forceConnectButton) forceConnectButton.classList.add("hidden");
  if (errorContainer) errorContainer.classList.add("hidden");

  if (!invoke) {
    setStatus("Tauri API is not available.", "error");
    setBusy(false);
    return;
  }

  try {
    const serverUrl = await invoke("connect_server", {
      serverUrl: rawUrl,
      allowInvalidCerts: certificateCheckbox.checked,
      server_url: rawUrl,
      allow_invalid_certs: certificateCheckbox.checked,
    });
    setConnected(serverUrl);
    await navigateToApp();
  } catch (error) {
    const errMsg = errorMessage(error);
    const detailsStr = String(error?.details || "").toLowerCase();
    const isCertError =
      detailsStr.includes("cert") ||
      detailsStr.includes("ssl") ||
      detailsStr.includes("tls") ||
      detailsStr.includes("pkix") ||
      detailsStr.includes("handshake");
    if (isCertError && !certificateCheckbox.checked) {
      certificateCheckbox.checked = true;
      setStatus(
        isPortuguese
          ? `${errMsg} (Certificado autoassinado ativado)`
          : `${errMsg} (Self-signed certificate enabled)`,
        "error"
      );
    } else {
      setStatus(errMsg, "error");
    }

    const fullErr = error?.details || (typeof error === "string" ? error : JSON.stringify(error, null, 2));
    if (fullErr && errorDetails && errorContainer) {
      errorDetails.textContent = fullErr;
      errorContainer.classList.remove("hidden");
    }

    if (forceConnectButton) forceConnectButton.classList.remove("hidden");
    setBusy(false);
  }
}

async function forceConnect() {
  const rawUrl = input.value.trim();
  if (!rawUrl) return;

  setBusy(true);
  setStatus(copy.loading);
  if (errorContainer) errorContainer.classList.add("hidden");

  if (!invoke) {
    setStatus("Tauri API is not available.", "error");
    setBusy(false);
    return;
  }

  try {
    const serverUrl = await invoke("save_server_url", {
      serverUrl: rawUrl,
      allowInvalidCerts: certificateCheckbox.checked,
      server_url: rawUrl,
      allow_invalid_certs: certificateCheckbox.checked,
    });
    setConnected(serverUrl);
    await navigateToApp();
  } catch (error) {
    setStatus(errorMessage(error), "error");
    const fullErr = error?.details || (typeof error === "string" ? error : JSON.stringify(error, null, 2));
    if (fullErr && errorDetails && errorContainer) {
      errorDetails.textContent = fullErr;
      errorContainer.classList.remove("hidden");
    }
    setBusy(false);
  }
}

async function clearServer() {
  if (!invoke) return;
  try {
    await invoke("clear_server_url");
    setBusy(false);
    input.disabled = false;
    certificateCheckbox.disabled = false;
    button.classList.remove("hidden");
    if (forceConnectButton) forceConnectButton.classList.add("hidden");
    if (errorContainer) errorContainer.classList.add("hidden");
    clearButton.classList.add("hidden");
    setStatus();
    input.focus();
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
}

async function initialize() {
  renderCopy();
  form.addEventListener("submit", connect);
  input.addEventListener("input", () => {
    if (forceConnectButton) forceConnectButton.classList.add("hidden");
    if (errorContainer) errorContainer.classList.add("hidden");
  });
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
    const orig = copyErrorButton.textContent;
    copyErrorButton.textContent = isPortuguese ? "Copiado!" : "Copied!";
    setTimeout(() => { copyErrorButton.textContent = orig; }, 2000);
  });
  clearButton.addEventListener("click", clearServer);

  try {
    await loadCopy();
    renderCopy();
  } catch {
    // Keep embedded copy
  }

  if (!invoke) return;

  try {
    setStatus(copy.loading);
    const settings = await invoke("get_connection_settings");
    const serverUrl = settings?.server_url || settings?.serverUrl;
    const allowInvalidCerts = Boolean(settings?.allow_invalid_certs || settings?.allowInvalidCerts);
    certificateCheckbox.checked = allowInvalidCerts;
    if (serverUrl) {
      setConnected(serverUrl);
    } else {
      setStatus();
    }
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
}

initialize();
