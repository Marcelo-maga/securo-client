mod commands;
mod errors;

use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::SecurityState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_page_load(|webview, payload| {
            if let Some(state) = webview.try_state::<commands::SecurityState>() {
                state.record_page_load(webview.label(), payload.url().path());
            }
        })
        .setup(|app| {


            let store = app.store("config.json").ok();
            let saved_server_url = store
                .as_ref()
                .and_then(|s| s.get("server_url"))
                .and_then(|value| value.as_str().map(str::to_owned));

            if let Some(ref server_url) = saved_server_url {
                let _ = commands::grant_server_http_scope(app.handle(), server_url);
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let auto_connect = store
                    .as_ref()
                    .and_then(|s| s.get("auto_connect"))
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let target = if saved_server_url.is_some() && auto_connect {
                    "main"
                } else {
                    "config"
                };
                if let Some(window) = app.get_webview_window(target) {
                    window.show()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_connection_settings,
            commands::connect_server,
            commands::save_server_url,
            commands::clear_server_url,
            commands::activate_app_window,
            commands::open_config_window,
            commands::set_auto_connect
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("error while running tauri application: {error}"));
}
