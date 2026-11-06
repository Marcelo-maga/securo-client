use std::time::Duration;
use reqwest::Client;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::errors::{AppError, ErrorCode};

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

    let mut parsed = reqwest::Url::parse(&candidate)
        .map_err(|err| AppError::with_details(ErrorCode::InvalidUrl, err.to_string()))?;

    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err(AppError::new(ErrorCode::InvalidUrlScheme));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err(AppError::new(ErrorCode::InvalidUrlCredentials));
    }

    // If user provided a path ending in /api or /api/, strip it so the base server URL is clean
    let clean_path = parsed.path().trim_end_matches('/');
    if let Some(base_path) = clean_path.strip_suffix("/api") {
        let base_owned = if base_path.is_empty() { "/" } else { base_path }.to_string();
        parsed.set_path(&base_owned);
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

fn save_config(
    app: &tauri::AppHandle,
    server_url: &str,
    allow_invalid_certs: bool,
) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    store.set(SERVER_URL_KEY, server_url);
    store.set(ALLOW_INVALID_CERTS_KEY, allow_invalid_certs);
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))
}

async fn probe_endpoint(client: &Client, url: &str, is_fallback_root: bool) -> Result<bool, String> {
    match client.get(url).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let reachable = if is_fallback_root {
                status < 500
            } else {
                resp.status().is_success() || (status != 404 && status != 405)
            };

            if reachable {
                Ok(true)
            } else {
                let body = resp.text().await.unwrap_or_default();
                let snippet = if body.len() > 300 { &body[..300] } else { &body };
                Err(format!("Tentativa em: {url}\nResposta HTTP {status}: {snippet}\n"))
            }
        }
        Err(err) => {
            let detail = detailed_reqwest_error(url, &err);
            eprintln!("{detail}");
            Err(detail)
        }
    }
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
pub fn save_server_url(
    app: tauri::AppHandle,
    server_url: String,
    allow_invalid_certs: bool,
) -> Result<String, AppError> {
    let normalized_url = normalize_url(&server_url)?;
    save_config(&app, &normalized_url, allow_invalid_certs)?;
    Ok(normalized_url)
}

#[tauri::command]
pub async fn connect_server(
    app: tauri::AppHandle,
    server_url: String,
    allow_invalid_certs: bool,
) -> Result<String, AppError> {
    let normalized_url = normalize_url(&server_url)?;
    let client = build_http_client(allow_invalid_certs)?;

    let candidates = [
        (format!("{normalized_url}/api/health"), false),
        (format!("{normalized_url}/api/info"), false),
        (format!("{normalized_url}/health"), false),
        (normalized_url.clone(), true),
    ];

    let mut probe_logs = Vec::new();
    let mut probe_succeeded = false;

    for (endpoint, is_fallback_root) in &candidates {
        match probe_endpoint(&client, endpoint, *is_fallback_root).await {
            Ok(true) => {
                probe_succeeded = true;
                break;
            }
            Ok(false) => {}
            Err(log) => probe_logs.push(log),
        }
    }

    if !probe_succeeded {
        return Err(AppError::with_details(
            ErrorCode::ServerUnreachable,
            probe_logs.join("\n---\n"),
        ));
    }

    save_config(&app, &normalized_url, allow_invalid_certs)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url_adds_https() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com");
    }

    #[test]
    fn test_normalize_url_preserves_scheme_and_port() {
        assert_eq!(normalize_url("http://localhost:8080").unwrap(), "http://localhost:8080");
    }

    #[test]
    fn test_normalize_url_strips_trailing_slash() {
        assert_eq!(normalize_url("https://example.com/").unwrap(), "https://example.com");
    }

    #[test]
    fn test_normalize_url_strips_api_suffix() {
        assert_eq!(normalize_url("https://example.com/api").unwrap(), "https://example.com");
        assert_eq!(normalize_url("https://example.com/api/").unwrap(), "https://example.com");
        assert_eq!(normalize_url("https://example.com/sub/api/").unwrap(), "https://example.com/sub");
    }

    #[test]
    fn test_normalize_url_rejects_empty_or_credentials() {
        assert!(normalize_url("").is_err());
        assert!(normalize_url("   ").is_err());
        assert!(normalize_url("https://user:pass@example.com").is_err());
    }
}
