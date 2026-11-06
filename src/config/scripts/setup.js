const invoke = window.__TAURI__?.core?.invoke;
const isPortuguese = Boolean(navigator.language && navigator.language.toLowerCase().startsWith("pt"));
const locale = isPortuguese ? "pt-BR" : "en-US";
document.documentElement.lang = locale;

const LOCALES = {
  "pt-BR": {
    brand: "Securo / finanças sob seu controle",
    eyebrow: "Configure em menos de um minuto",
    titleLineOne: "Seu dinheiro.",
    titleLineTwo: "Do seu jeito.",
    description: "Informe o endereço do seu servidor Securo. Vamos testar a conexão antes de guardar a configuração.",
    securityNote: "O endereço fica salvo somente neste dispositivo.",
    step: "Configuração inicial",
    heading: "Onde está seu servidor?",
    private: "No dispositivo",
    urlLabel: "Endereço do servidor",
    urlPlaceholder: "https://meu-securo.com",
    certLabel: "Permitir certificado autoassinado",
    certHint: "Ative somente se você controla o servidor ou está em uma rede confiável.",
    connect: "Testar e continuar",
    connecting: "Testando servidor...",
    useAnother: "Usar outro servidor",
    localStorage: "Armazenado localmente neste dispositivo",
    loading: "Carregando configuração...",
    checking: "Consultando a saúde do servidor...",
    success: "Servidor verificado e conectado.",
    errors: {
      INVALID_URL: "Informe uma URL válida, incluindo http:// ou https://.",
      INVALID_URL_SCHEME: "A URL deve usar http:// ou https:// e conter um host.",
      INVALID_URL_CREDENTIALS: "A URL não pode conter credenciais ou fragmento.",
      CONFIG_OPEN_FAILED: "Não foi possível abrir a configuração local.",
      HTTP_CLIENT_BUILD_FAILED: "Não foi possível preparar a conexão.",
      SERVER_UNREACHABLE: "Não foi possível alcançar o servidor. Verifique a URL e tente novamente.",
      SERVER_HTTP_ERROR: "O servidor respondeu com HTTP {status}.",
      CONFIG_SAVE_FAILED: "Não foi possível salvar a configuração local.",
      UNKNOWN: "Não foi possível conectar ao servidor. Verifique a URL e tente novamente."
    }
  },
  "en-US": {
    brand: "Securo / finance under your control",
    eyebrow: "Set up in under a minute",
    titleLineOne: "Your money.",
    titleLineTwo: "Your way.",
    description: "Enter the address of your Securo server. We will test the connection before saving the setting.",
    securityNote: "The address is saved only on this device.",
    step: "Initial setup",
    heading: "Where is your server?",
    private: "On this device",
    urlLabel: "Server address",
    urlPlaceholder: "https://my-securo.com",
    certLabel: "Allow a self-signed certificate",
    certHint: "Enable only when you control the server or trust the network.",
    connect: "Test and continue",
    connecting: "Testing server...",
    useAnother: "Use another server",
    localStorage: "Stored locally on this device",
    loading: "Loading configuration...",
    checking: "Checking server health...",
    success: "Server verified and connected.",
    errors: {
      INVALID_URL: "Enter a valid URL, including http:// or https://.",
      INVALID_URL_SCHEME: "The URL must use http:// or https:// and include a host.",
      INVALID_URL_CREDENTIALS: "The URL cannot contain credentials or a fragment.",
      CONFIG_OPEN_FAILED: "We could not open the local configuration.",
      HTTP_CLIENT_BUILD_FAILED: "We could not prepare the connection.",
      SERVER_UNREACHABLE: "We could not reach this server. Check the URL and try again.",
      SERVER_HTTP_ERROR: "The server returned HTTP {status}.",
      CONFIG_SAVE_FAILED: "We could not save the local configuration.",
      UNKNOWN: "We could not connect to this server. Check the URL and try again."
    }
  }
};

const form = document.querySelector("#server-form");
const input = document.querySelector("#server-url");
const certificateCheckbox = document.querySelector("#allow-invalid-certs");
const button = document.querySelector("#connect-button");
const buttonLabel = document.querySelector("#connect-label");
const buttonIcon = document.querySelector("#button-icon");
const loadingIcon = document.querySelector("#loading-icon");
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
  document.title = `Securo | ${copy.heading || "Setup"}`;
}

function formatMessage(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

function errorMessage(error) {
  const code = error?.code || "UNKNOWN";
  const template = copy.errors?.[code] || copy.errors?.UNKNOWN || "Connection error";
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
  buttonLabel.textContent = isBusy ? copy.connecting : copy.connect;
  buttonIcon.classList.toggle("hidden", isBusy);
  loadingIcon.classList.toggle("hidden", !isBusy);
}

function setConnected(serverUrl) {
  input.value = serverUrl;
  input.disabled = true;
  certificateCheckbox.disabled = true;
  button.hidden = true;
  clearButton.classList.remove("hidden");
  setStatus(copy.success, "success");
}

async function navigateToApp() {
  if (invoke) {
    try {
      await invoke("activate_app_window");
      return;
    } catch {
      // Fallback if multi-window is not used (e.g. mobile single webview)
    }
  }
  if (window.location.pathname.includes("/config/")) {
    window.location.replace("../app.html");
  } else if (window.location.pathname.endsWith("setup.html")) {
    window.location.replace("app.html");
  }
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

  if (!invoke) {
    setStatus("Tauri API is not available.", "error");
    setBusy(false);
    return;
  }

  try {
    const serverUrl = await invoke("connect_server", {
      server_url: rawUrl,
      allow_invalid_certs: certificateCheckbox.checked,
    });
    setConnected(serverUrl);
    await navigateToApp();
  } catch (error) {
    setStatus(errorMessage(error), "error");
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
    button.hidden = false;
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
    certificateCheckbox.checked = Boolean(settings.allow_invalid_certs);
    if (settings.server_url) {
      setConnected(settings.server_url);
    } else {
      setStatus();
    }
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
}

initialize();
