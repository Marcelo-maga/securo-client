const { invoke } = window.__TAURI__.core;
const locale = navigator.language.toLowerCase().startsWith("pt-br") ? "pt-BR" : "en-US";
document.documentElement.lang = locale;

const form = document.querySelector("#server-form");
const input = document.querySelector("#server-url");
const certificateCheckbox = document.querySelector("#allow-invalid-certs");
const button = document.querySelector("#connect-button");
const buttonLabel = document.querySelector("#connect-label");
const buttonIcon = document.querySelector("#button-icon");
const loadingIcon = document.querySelector("#loading-icon");
const clearButton = document.querySelector("#clear-button");
const status = document.querySelector("#status");
let copy;

async function loadCopy() {
  const response = await fetch(new URL(`../locales/${locale}.json`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load locale: ${response.status}`);
  return response.json();
}

function renderCopy() {
  document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = copy[element.dataset.i18n]; });
  input.placeholder = copy.urlPlaceholder;
  document.title = `Securo | ${copy.heading}`;
}

function formatMessage(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

function errorMessage(error) {
  const code = error?.code || "UNKNOWN";
  return formatMessage(copy.errors[code] || copy.errors.UNKNOWN, error);
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

async function connect(event) {
  event.preventDefault();
  if (!input.value.trim()) {
    setStatus(copy.errors.INVALID_URL, "error");
    input.focus();
    return;
  }
  setBusy(true);
  setStatus(copy.checking);
  try {
    const serverUrl = await invoke("connect_server", { server_url: input.value, allow_invalid_certs: certificateCheckbox.checked });
    setConnected(serverUrl);
    if (window.location.pathname.endsWith("/config.html")) window.location.replace("../app.html");
  } catch (error) {
    setStatus(errorMessage(error), "error");
    setBusy(false);
  }
}

async function clearServer() {
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
  try {
    copy = await loadCopy();
    renderCopy();
    form.addEventListener("submit", connect);
    clearButton.addEventListener("click", clearServer);
    setStatus(copy.loading);
    const settings = await invoke("get_connection_settings");
    certificateCheckbox.checked = settings.allow_invalid_certs;
    if (settings.server_url) setConnected(settings.server_url); else setStatus();
  } catch (error) {
    setStatus(copy ? errorMessage(error) : "Unable to load Securo.", "error");
  }
}

initialize();
