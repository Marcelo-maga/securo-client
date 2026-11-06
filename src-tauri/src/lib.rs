mod commands;
mod errors;
mod state;

use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state::AppState::default())
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let has_server = app
                    .store("config.json")
                    .ok()
                    .and_then(|store| store.get("server_url"))
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .is_some();
                let target = if has_server { "main" } else { "config" };
                if let Some(window) = app.get_webview_window(target) {
                    window.show()?;
                }
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                let _ = app;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_connection_settings,
            commands::connect_server,
            commands::save_server_url,
            commands::clear_server_url,
            commands::activate_app_window
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("error while running tauri application: {error}"));
}
