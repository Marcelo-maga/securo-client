use reqwest::Client;
use serde::Serialize;
use tauri::State;
use tauri_plugin_store::StoreExt;

use crate::errors::{AppError, ErrorCode};
use crate::state::AppState;

const STORE_FILE: &str = "config.json";
const SERVER_URL_KEY: &str = "server_url";
const ALLOW_INVALID_CERTS_KEY: &str = "allow_invalid_certs";

#[derive(Serialize)]
pub struct ConnectionSettings {
    server_url: Option<String>,
    allow_invalid_certs: bool,
}

fn normalize_url(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| AppError::new(ErrorCode::InvalidUrl))?;

    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err(AppError::new(ErrorCode::InvalidUrlScheme));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err(AppError::new(ErrorCode::InvalidUrlCredentials));
    }

    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

#[tauri::command]
pub fn get_connection_settings(app: tauri::AppHandle) -> Result<ConnectionSettings, AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;

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
pub async fn connect_server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    allow_invalid_certs: bool,
) -> Result<String, AppError> {
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
        .map_err(|_| AppError::new(ErrorCode::HttpClientBuildFailed))?;
    let response = client
        .get(health_url)
        .send()
        .await
        .map_err(|_| AppError::new(ErrorCode::ServerUnreachable))?;

    if !response.status().is_success() {
        return Err(AppError::server_http_error(response.status().as_u16()));
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    let _guard = state.0.lock().await;
    store.set(SERVER_URL_KEY, normalized_url.clone());
    store.set(ALLOW_INVALID_CERTS_KEY, allow_invalid_certs);
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))?;

    Ok(normalized_url)
}

#[tauri::command]
pub fn clear_server_url(app: tauri::AppHandle) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    store.delete(SERVER_URL_KEY);
    store.delete(ALLOW_INVALID_CERTS_KEY);
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))
}
