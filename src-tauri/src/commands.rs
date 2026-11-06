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

fn detailed_reqwest_error(endpoint: &str, err: &reqwest::Error) -> String {
    let mut out = format!("Tentativa em: {endpoint}\nErro: {err}\n");
    let mut source = std::error::Error::source(err);
    let mut depth = 1;
    while let Some(src) = source {
        out.push_str(&format!("  Causa {depth}: {src}\n"));
        source = src.source();
        depth += 1;
    }
    out.push_str(&format!("Debug: {err:#?}\n"));
    out
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

    let candidate_endpoints = [
        format!("{normalized_url}/api/health"),
        format!("{normalized_url}/api/info"),
        format!("{normalized_url}/health"),
    ];

    let mut probe_logs = Vec::new();
    let mut probe_succeeded = false;

    for endpoint in &candidate_endpoints {
        match client.get(endpoint).send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if resp.status().is_success() {
                    probe_succeeded = true;
                    break;
                }
                let body_text = resp.text().await.unwrap_or_default();
                let snippet = if body_text.len() > 300 { &body_text[..300] } else { &body_text };
                probe_logs.push(format!("Tentativa em: {endpoint}\nResposta HTTP {status}: {snippet}\n"));
                if status != 404 && status != 405 {
                    probe_succeeded = true;
                    break;
                }
            }
            Err(err) => {
                let detail = detailed_reqwest_error(endpoint, &err);
                eprintln!("{detail}");
                probe_logs.push(detail);
            }
        }
    }

    if !probe_succeeded {
        // Fallback root probe
        match client.get(&normalized_url).send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status < 500 {
                    probe_succeeded = true;
                } else {
                    let body = resp.text().await.unwrap_or_default();
                    let snippet = if body.len() > 300 { &body[..300] } else { &body };
                    probe_logs.push(format!("Tentativa em: {normalized_url}\nResposta HTTP {status}: {snippet}\n"));
                }
            }
            Err(err) => {
                probe_logs.push(detailed_reqwest_error(&normalized_url, &err));
            }
        }
    }

    if !probe_succeeded {
        let full_error_report = probe_logs.join("\n---\n");
        return Err(AppError::with_details(
            ErrorCode::ServerUnreachable,
            full_error_report,
        ));
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
