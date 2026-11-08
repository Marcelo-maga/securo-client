use reqwest::Client;
use serde::Serialize;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::Duration;
use tauri::Manager;
use tauri::ipc::CapabilityBuilder;
use tauri_plugin_store::StoreExt;

use crate::errors::{AppError, ErrorCode};

const STORE_FILE: &str = "config.json";
const SERVER_URL_KEY: &str = "server_url";
const ALLOW_INVALID_CERTS_KEY: &str = "allow_invalid_certs";
const AUTO_CONNECT_KEY: &str = "auto_connect";

#[derive(Serialize)]
pub struct ConnectionSettings {
    pub server_url: Option<String>,
    pub allow_invalid_certs: bool,
    pub auto_connect: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HttpScopeEntry {
    pub url: String,
}

pub fn build_api_scope_entries(normalized_server_url: &str) -> Vec<HttpScopeEntry> {
    let base = normalized_server_url.trim_end_matches('/');
    vec![
        HttpScopeEntry {
            url: format!("{base}/api"),
        },
        HttpScopeEntry {
            url: format!("{base}/api/*"),
        },
    ]
}

pub fn grant_server_http_scope(app: &tauri::AppHandle, server_url: &str) -> Result<(), AppError> {
    let normalized = normalize_url(server_url)?;
    let allowed = build_api_scope_entries(&normalized);
    let denied: Vec<HttpScopeEntry> = Vec::new();

    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    let cap_id = format!("securo-api-http-{:016x}", hasher.finish());

    app.add_capability(
        CapabilityBuilder::new(cap_id)
            .window("main")
            .permission_scoped("http:default", allowed, denied),
    )
    .map_err(|err| AppError::with_details(ErrorCode::HttpClientBuildFailed, err.to_string()))
}

fn ensure_config_context(webview: &tauri::WebviewWindow) -> Result<(), AppError> {
    if webview.label() == "config" {
        return Ok(());
    }
    if let Ok(current_url) = webview.url() {
        let path = current_url.path();
        if path.ends_with("/config/config.html") || path.ends_with("/config.html") {
            return Ok(());
        }
    }
    Err(AppError::with_details(
        ErrorCode::ProxyForbidden,
        "Server connection settings can only be modified from the configuration screen.",
    ))
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
    let mut out = format!("Attempt at: {endpoint}\nError: {err}\n");
    let mut source = std::error::Error::source(err);
    let mut depth = 1;
    while let Some(src) = source {
        out.push_str(&format!("  Cause {depth}: {src}\n"));
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
    auto_connect: Option<bool>,
) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    store.set(SERVER_URL_KEY, server_url);
    store.set(ALLOW_INVALID_CERTS_KEY, allow_invalid_certs);
    if let Some(auto_conn) = auto_connect {
        store.set(AUTO_CONNECT_KEY, auto_conn);
    }
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))
}

async fn probe_endpoint(
    client: &Client,
    url: &str,
    is_fallback_root: bool,
) -> Result<bool, String> {
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
                let snippet: String = body.chars().take(300).collect();
                Err(format!(
                    "Attempt at: {url}\nHTTP response {status}: {snippet}\n"
                ))
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
    let auto_connect = store
        .get(AUTO_CONNECT_KEY)
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    Ok(ConnectionSettings {
        server_url,
        allow_invalid_certs,
        auto_connect,
    })
}

#[tauri::command]
pub fn set_auto_connect(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
    auto_connect: bool,
) -> Result<bool, AppError> {
    ensure_config_context(&webview)?;
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    store.set(AUTO_CONNECT_KEY, auto_connect);
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))?;
    Ok(auto_connect)
}

#[tauri::command]
pub fn save_server_url(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
    server_url: String,
    allow_invalid_certs: bool,
    auto_connect: Option<bool>,
) -> Result<String, AppError> {
    ensure_config_context(&webview)?;
    let normalized_url = normalize_url(&server_url)?;
    grant_server_http_scope(&app, &normalized_url)?;
    save_config(&app, &normalized_url, allow_invalid_certs, auto_connect)?;
    Ok(normalized_url)
}

#[tauri::command]
pub async fn connect_server(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
    server_url: String,
    allow_invalid_certs: bool,
    auto_connect: Option<bool>,
) -> Result<String, AppError> {
    ensure_config_context(&webview)?;
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

    grant_server_http_scope(&app, &normalized_url)?;
    save_config(&app, &normalized_url, allow_invalid_certs, auto_connect)?;
    Ok(normalized_url)
}

#[tauri::command]
pub fn clear_server_url(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
) -> Result<(), AppError> {
    ensure_config_context(&webview)?;
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    store.delete(SERVER_URL_KEY);
    store.delete(ALLOW_INVALID_CERTS_KEY);
    store.delete(AUTO_CONNECT_KEY);
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))
}

#[tauri::command]
pub fn activate_app_window(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
) -> Result<(), String> {
    ensure_config_context(&webview).map_err(|err| format!("{:?}", err.code))?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window is not available".to_string())?;
        if let Ok(mut target_url) = main_window.url()
            && !target_url.path().ends_with("/app.html")
        {
            target_url.set_path("/app.html");
            target_url.set_query(None);
            target_url.set_fragment(Some("/"));
            let _ = main_window.navigate(target_url);
        }
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
        assert_eq!(
            normalize_url("http://localhost:8080").unwrap(),
            "http://localhost:8080"
        );
    }

    #[test]
    fn test_normalize_url_strips_trailing_slash() {
        assert_eq!(
            normalize_url("https://example.com/").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn test_normalize_url_strips_api_suffix() {
        assert_eq!(
            normalize_url("https://example.com/api").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_url("https://example.com/api/").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_url("https://example.com/sub/api/").unwrap(),
            "https://example.com/sub"
        );
    }

    #[test]
    fn test_normalize_url_rejects_empty_or_credentials() {
        assert!(normalize_url("").is_err());
        assert!(normalize_url("   ").is_err());
        assert!(normalize_url("https://user:pass@example.com").is_err());
    }

    #[test]
    fn test_normalize_url_ip_addresses_and_custom_ports() {
        assert_eq!(
            normalize_url("192.168.1.100").unwrap(),
            "https://192.168.1.100"
        );
        assert_eq!(
            normalize_url("http://192.168.1.50:8000").unwrap(),
            "http://192.168.1.50:8000"
        );
        assert_eq!(
            normalize_url("http://127.0.0.1:3000/api").unwrap(),
            "http://127.0.0.1:3000"
        );
        assert_eq!(
            normalize_url("10.0.0.5:8443/api/").unwrap(),
            "https://10.0.0.5:8443"
        );
    }

    #[test]
    fn test_normalize_url_tailscale_and_homelab_domains() {
        assert_eq!(
            normalize_url("securo.tailnet-xyz.ts.net").unwrap(),
            "https://securo.tailnet-xyz.ts.net"
        );
        assert_eq!(
            normalize_url("http://vault.internal.corp:8443/api/").unwrap(),
            "http://vault.internal.corp:8443"
        );
        assert_eq!(
            normalize_url("sub-domain.homelab.local").unwrap(),
            "https://sub-domain.homelab.local"
        );
    }

    #[test]
    fn test_normalize_url_nested_paths_with_api() {
        assert_eq!(
            normalize_url("https://my-domain.com/finance/api").unwrap(),
            "https://my-domain.com/finance"
        );
        assert_eq!(
            normalize_url("https://my-domain.com/finance/api/").unwrap(),
            "https://my-domain.com/finance"
        );
        assert_eq!(
            normalize_url("https://my-domain.com/instances/prod/sub/api").unwrap(),
            "https://my-domain.com/instances/prod/sub"
        );
    }

    #[test]
    fn test_normalize_url_strips_surrounding_whitespace() {
        assert_eq!(
            normalize_url("   https://example.com/api   ").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_url("\t\nhttp://localhost:3000\n\r").unwrap(),
            "http://localhost:3000"
        );
    }

    #[test]
    fn test_normalize_url_rejects_fragments_with_invalid_credentials_error() {
        let fragment_err = normalize_url("https://example.com/#dashboard").unwrap_err();
        assert_eq!(fragment_err.code, ErrorCode::InvalidUrlCredentials);

        let api_fragment_err = normalize_url("http://localhost:8080/api#info").unwrap_err();
        assert_eq!(api_fragment_err.code, ErrorCode::InvalidUrlCredentials);
    }

    #[test]
    fn test_normalize_url_rejects_userinfo_and_passwords() {
        let user_err = normalize_url("https://admin:secret@example.com").unwrap_err();
        assert_eq!(user_err.code, ErrorCode::InvalidUrlCredentials);

        let pass_err = normalize_url("http://guest:@localhost").unwrap_err();
        assert_eq!(pass_err.code, ErrorCode::InvalidUrlCredentials);
    }

    #[test]
    fn test_normalize_url_rejects_malformed_urls_with_invalid_url_error() {
        let err1 = normalize_url("http://").unwrap_err();
        assert_eq!(err1.code, ErrorCode::InvalidUrl);

        let err2 = normalize_url("https://").unwrap_err();
        assert_eq!(err2.code, ErrorCode::InvalidUrl);

        let err3 = normalize_url("   ").unwrap_err();
        assert_eq!(err3.code, ErrorCode::InvalidUrl);

        let err4 = normalize_url("").unwrap_err();
        assert_eq!(err4.code, ErrorCode::InvalidUrl);
    }

    #[test]
    fn test_build_api_scope_entries_restricts_to_server_api_paths() {
        assert_eq!(
            build_api_scope_entries("https://securo.homelab.lan:8443/"),
            vec![
                HttpScopeEntry {
                    url: "https://securo.homelab.lan:8443/api".to_string()
                },
                HttpScopeEntry {
                    url: "https://securo.homelab.lan:8443/api/*".to_string()
                },
            ]
        );
        assert_eq!(
            build_api_scope_entries("https://my-domain.com/finance"),
            vec![
                HttpScopeEntry {
                    url: "https://my-domain.com/finance/api".to_string()
                },
                HttpScopeEntry {
                    url: "https://my-domain.com/finance/api/*".to_string()
                },
            ]
        );
    }

    #[test]
    fn test_build_http_client_creation() {
        assert!(build_http_client(false).is_ok());
        assert!(build_http_client(true).is_ok());
    }

    #[tokio::test]
    async fn test_probe_endpoint_logic_with_local_mock() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let client = build_http_client(false).unwrap();
        let test_url = format!("http://127.0.0.1:{port}/api/health");
        let result = probe_endpoint(&client, &test_url, false).await;
        assert_eq!(result, Ok(true));
    }

    #[tokio::test]
    async fn test_probe_endpoint_fails_on_unreachable_port() {
        let client = build_http_client(false).unwrap();
        let unreachable_url = "http://127.0.0.1:59999/api/health";
        let result = probe_endpoint(&client, unreachable_url, false).await;
        assert!(result.is_err());
        let log = result.unwrap_err();
        assert!(log.contains("Attempt at: http://127.0.0.1:59999/api/health"));
    }
}
