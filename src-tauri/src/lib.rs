mod commands;
mod errors;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state::AppState::default())
        .setup(|app| {
            let has_server = app
                .store("config.json")
                .ok()
                .and_then(|store| store.get("server_url"))
                .and_then(|value| value.as_str().map(str::to_owned))
                .is_some();
            let target = if has_server { "main" } else { "config" };
            app.get_webview_window(target)
                .ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        format!("window not found: {target}"),
                    )
                })?
                .show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_connection_settings,
            commands::connect_server,
            commands::clear_server_url,
            commands::activate_app_window
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("error while running tauri application: {error}"));
}
