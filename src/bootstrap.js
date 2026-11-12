(function () {
  const rawInvoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  const invoke = rawInvoke ? (cmd, args = {}) => rawInvoke(cmd, args) : null;
  const openConfig = () => window.location.replace("config/config.html");

  if (!invoke) {
    openConfig();
    return;
  }

  invoke("get_connection_settings")
    .then((settings) => {
      const serverUrl = settings?.server_url || settings?.serverUrl;
      const autoConnect = Boolean(settings?.auto_connect ?? settings?.autoConnect);
      if (serverUrl && autoConnect) {
        window.location.replace("app.html#/");
      } else {
        openConfig();
      }
    })
    .catch(openConfig);
})();
