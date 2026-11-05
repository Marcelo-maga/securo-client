mod commands;
mod errors;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_connection_settings,
            commands::connect_server,
            commands::clear_server_url
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("error while running tauri application: {error}"));
}
