(function () {
  const rawInvoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  const invoke = rawInvoke ? (cmd, args = {}) => rawInvoke(cmd, args) : null;
  const configBtn = document.querySelector("#config-btn");

  async function openConfig(event) {
    if (event) event.preventDefault();
    if (invoke) {
      try {
        await invoke("open_config_window");
        return;
      } catch {
        // Fallback for mobile single-webview navigation
      }
    }
    window.location.replace("config/config.html");
  }

  if (configBtn) {
    configBtn.addEventListener("click", openConfig);
  }

  if (!invoke) return;

  invoke("get_connection_settings")
    .then((settings) => {
      const serverUrl = settings?.server_url || settings?.serverUrl;
      if (serverUrl) {
        const el = document.querySelector("#server-url");
        if (el) el.textContent = serverUrl;
      } else {
        openConfig();
      }
    })
    .catch(() => {});
})();
