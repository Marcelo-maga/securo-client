use reqwest::Client;
use serde::Serialize;
use tauri::{Manager, State};
use tokio::sync::Mutex;

const STORE_FILE: &str = "config.json";
const SERVER_URL_KEY: &str = "server_url";
const ALLOW_INVALID_CERTS_KEY: &str = "allow_invalid_certs";

struct AppState(Mutex<()>);

#[derive(Serialize)]
struct ConnectionSettings {
    server_url: Option<String>,
    allow_invalid_certs: bool,
}

fn normalize_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "Informe uma URL válida, incluindo http:// ou https://.".to_string())?;

    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err("A URL deve usar http:// ou https:// e conter um host.".to_string());
    }
    if parsed.username() != "" || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("A URL não pode conter credenciais ou fragmento.".to_string());
    }

    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

#[tauri::command]
fn get_connection_settings(app: tauri::AppHandle) -> Result<ConnectionSettings, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|error| format!("Não foi possível abrir a configuração: {error}"))?;

    let server_url = store
        .get(SERVER_URL_KEY)
        .and_then(|value| value.as_str().map(ToOwned::to_owned));
    let allow_invalid_certs = store
        .get(ALLOW_INVALID_CERTS_KEY)
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    Ok(ConnectionSettings {
        server_url,
        allow_invalid_certs,
    })
}

#[tauri::command]
async fn connect_server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    allow_invalid_certs: bool,
) -> Result<String, String> {
    let normalized_url = normalize_url(&server_url)?;
    let health_url = format!("{normalized_url}/api/health");
    let mut client_builder = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(8));
    if allow_invalid_certs {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }
    let client = client_builder
        .build()
        .map_err(|error| format!("Não foi possível preparar a conexão: {error}"))?;
    let response = client
        .get(health_url)
        .send()
        .await
        .map_err(|error| format!("Não foi possível alcançar o servidor: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "O servidor respondeu com HTTP {}.",
            response.status()
        ));
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|error| format!("Não foi possível abrir a configuração: {error}"))?;
    let _guard = state.0.lock().await;
    store.set(SERVER_URL_KEY, normalized_url.clone());
    store.set(ALLOW_INVALID_CERTS_KEY, allow_invalid_certs);
    store
        .save()
        .map_err(|error| format!("Não foi possível salvar a configuração: {error}"))?;

    Ok(normalized_url)
}

#[tauri::command]
fn clear_server_url(app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|error| format!("Não foi possível abrir a configuração: {error}"))?;
    store.delete(SERVER_URL_KEY);
    store.delete(ALLOW_INVALID_CERTS_KEY);
    store
        .save()
        .map_err(|error| format!("Não foi possível salvar a configuração: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            get_connection_settings,
            connect_server,
            clear_server_url
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("error while running tauri application: {error}"));
}
