use std::time::Duration;
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

pub fn normalize_url(value: &str) -> Result<String, AppError> {
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

fn build_http_client(allow_invalid_certs: bool) -> Result<Client, AppError> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .tcp_nodelay(true)
        .user_agent("Mozilla/5.0 (Linux; Android 14; Mobile) Securo/1.0")
        .redirect(reqwest::redirect::Policy::limited(10));

    if allow_invalid_certs {
        builder = builder
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }

    builder
        .build()
        .map_err(|err| AppError::with_details(ErrorCode::HttpClientBuildFailed, err.to_string()))
}

fn format_error_chain(err: &reqwest::Error) -> String {
    let mut full = err.to_string();
    let mut source = std::error::Error::source(err);
    while let Some(src) = source {
        full.push_str(" -> ");
        full.push_str(&src.to_string());
        source = src.source();
    }
    full
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
pub async fn save_server_url(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    allow_invalid_certs: bool,
) -> Result<String, AppError> {
    let normalized_url = normalize_url(&server_url)?;
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
pub async fn connect_server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    allow_invalid_certs: bool,
) -> Result<String, AppError> {
    let normalized_url = normalize_url(&server_url)?;
    let client = build_http_client(allow_invalid_certs)?;

    // Endpoints to probe in priority order
    let candidate_endpoints = [
        format!("{normalized_url}/api/health"),
        format!("{normalized_url}/api/info"),
        format!("{normalized_url}/health"),
    ];

    let mut last_error: Option<String> = None;
    let mut last_status: Option<u16> = None;
    let mut probe_succeeded = false;

    for endpoint in &candidate_endpoints {
        match client.get(endpoint).send().await {
            Ok(resp) if resp.status().is_success() => {
                probe_succeeded = true;
                break;
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                last_status = Some(status);
                if status == 404 || status == 405 {
                    continue;
                }
                // Any other status code (e.g. 401, 403) confirms server reachability and valid TLS
                probe_succeeded = true;
                break;
            }
            Err(err) => {
                let chain = format_error_chain(&err);
                eprintln!("Probe failed for {endpoint}: {chain}");
                last_error = Some(chain);
            }
        }
    }

    if !probe_succeeded {
        // Fallback root probe: if server responds with any status < 500, TLS and connectivity are valid
        if let Ok(resp) = client.get(&normalized_url).send().await {
            if resp.status().as_u16() < 500 {
                probe_succeeded = true;
            } else {
                last_status = Some(resp.status().as_u16());
            }
        }
    }

    if !probe_succeeded {
        if let Some(status) = last_status {
            return Err(AppError::server_http_error(status));
        }
        let details = last_error.unwrap_or_else(|| "Connection timed out or network is unreachable".to_string());
        return Err(AppError::with_details(ErrorCode::ServerUnreachable, details));
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

#[tauri::command]
pub fn activate_app_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window is not available".to_string())?;
        main_window.show().map_err(|error| error.to_string())?;
        if let Some(config_window) = app.get_webview_window("config") {
            config_window.close().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        Err("mobile uses single webview navigation".to_string())
    }
}
