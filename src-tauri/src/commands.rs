use reqwest::Client;
use serde::Serialize;
use tauri::{Manager, State};
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
    let raw = value.trim();
    if raw.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidUrl));
    }

    let candidate = if !raw.starts_with("http://") && !raw.starts_with("https://") {
        format!("https://{raw}")
    } else {
        raw.to_string()
    };

    let mut parsed = reqwest::Url::parse(&candidate).map_err(|err| {
        AppError::with_details(ErrorCode::InvalidUrl, err.to_string())
    })?;

    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err(AppError::new(ErrorCode::InvalidUrlScheme));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err(AppError::new(ErrorCode::InvalidUrlCredentials));
    }

    // If user provided a path ending in /api or /api/, strip it so the base server URL is clean
    let mut path = parsed.path().trim_end_matches('/').to_string();
    if path.ends_with("/api") {
        path = path.trim_end_matches("/api").trim_end_matches('/').to_string();
        let path_to_set = if path.is_empty() { "/" } else { &path };
        parsed.set_path(path_to_set);
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
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10));

    if allow_invalid_certs {
        client_builder = client_builder
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }

    let client = client_builder
        .build()
        .map_err(|err| AppError::with_details(ErrorCode::HttpClientBuildFailed, err.to_string()))?;

    let _ = match client.get(&health_url).send().await {
        Ok(resp) if resp.status().is_success() => resp,
        Ok(resp) if resp.status().as_u16() == 404 => {
            // Fallback attempt to {normalized_url}/health in case backend mounts health directly at root
            let fallback_url = format!("{normalized_url}/health");
            if let Ok(fallback_resp) = client.get(&fallback_url).send().await {
                if fallback_resp.status().is_success() {
                    fallback_resp
                } else {
                    return Err(AppError::server_http_error(resp.status().as_u16()));
                }
            } else {
                return Err(AppError::server_http_error(resp.status().as_u16()));
            }
        }
        Ok(resp) => return Err(AppError::server_http_error(resp.status().as_u16())),
        Err(err) => {
            eprintln!("Error connecting to {health_url}: {err:?}");
            return Err(AppError::with_details(ErrorCode::ServerUnreachable, err.to_string()));
        }
    };

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

#[tauri::command]
pub fn activate_app_window(app: tauri::AppHandle) -> Result<(), String> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;
    main_window.show().map_err(|error| error.to_string())?;
    if let Some(config_window) = app.get_webview_window("config") {
        config_window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}
