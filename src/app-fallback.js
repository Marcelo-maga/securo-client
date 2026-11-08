(function () {
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return;

  invoke("get_connection_settings")
    .then((settings) => {
      const serverUrl = settings?.server_url || settings?.serverUrl;
      if (serverUrl) {
        const el = document.querySelector("#server-url");
        if (el) el.textContent = serverUrl;
      } else {
        window.location.replace("config/config.html");
      }
    })
    .catch(() => {});
})();
