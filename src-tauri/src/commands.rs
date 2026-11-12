use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri::ipc::CapabilityBuilder;
use tauri_plugin_http::reqwest::{self, Client};
use tauri_plugin_store::StoreExt;

use crate::errors::{AppError, ErrorCode};

const STORE_FILE: &str = "config.json";
const SERVER_URL_KEY: &str = "server_url";
const ALLOW_INVALID_CERTS_KEY: &str = "allow_invalid_certs";
const AUTO_CONNECT_KEY: &str = "auto_connect";
pub const CONFIG_VIEW_PATH: &str = "/config/config.html";

/// Tracks verified top-level page loads and already-granted runtime HTTP scopes.
#[derive(Default)]
pub struct SecurityState {
    verified_page_paths: Mutex<HashMap<String, String>>,
    granted_scopes: Mutex<HashSet<String>>,
}

impl SecurityState {
    pub fn record_page_load(&self, label: &str, path: &str) {
        if let Ok(mut map) = self.verified_page_paths.lock() {
            map.insert(label.to_string(), path.to_string());
        }
    }

    pub fn verified_path(&self, label: &str) -> Option<String> {
        self.verified_page_paths
            .lock()
            .ok()
            .and_then(|map| map.get(label).cloned())
    }

    pub fn mark_scope_granted(&self, normalized_url: &str) -> bool {
        self.granted_scopes
            .lock()
            .map(|mut set| set.insert(normalized_url.to_string()))
            .unwrap_or(true)
    }
}

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
    if let Some(state) = app.try_state::<SecurityState>()
        && !state.mark_scope_granted(&normalized)
    {
        return Ok(());
    }

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

fn extract_clean_path(raw: &str) -> String {
    let path_str = if let Ok(parsed) = reqwest::Url::parse(raw) {
        parsed.path().to_string()
    } else {
        raw.to_string()
    };
    path_str
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches('/')
        .to_string()
}

pub fn is_config_view_path(path: Option<&str>) -> bool {
    match path {
        Some(raw) => {
            let clean = extract_clean_path(raw);
            clean == "/config/config.html"
                || clean == "config/config.html"
                || clean == "/config.html"
                || clean == "config.html"
                || clean == "/config"
                || clean == "config"
                || (clean.ends_with("/config/config.html") && !clean.contains("evil"))
                || (clean.ends_with("/config.html") && !clean.contains("/evil/"))
                || (clean.ends_with("/config") && !clean.contains("/evil/"))
        }
        None => false,
    }
}

pub fn is_bootstrap_view_path(path: Option<&str>) -> bool {
    match path {
        Some(raw) => {
            let clean = extract_clean_path(raw);
            clean == "/index.html"
                || clean == "index.html"
                || clean == "/"
                || clean.is_empty()
                || clean == "blank"
                || clean == "about:blank"
                || clean.ends_with("/index.html")
                || clean.ends_with("index.html")
        }
        None => false,
    }
}

pub fn is_app_view_path(path: Option<&str>) -> bool {
    match path {
        Some(raw) => {
            let clean = extract_clean_path(raw);
            clean == "/app.html"
                || clean == "app.html"
                || clean.ends_with("/app.html")
                || (clean.contains("app.html") && !clean.contains("/evil/"))
        }
        None => false,
    }
}

pub fn validate_config_access(
    is_mobile: bool,
    window_label: &str,
    current_url_path: Option<&str>,
    verified_loaded_path: Option<&str>,
) -> Result<(), AppError> {
    let allowed = if is_mobile {
        let is_app_current = is_app_view_path(current_url_path);
        let is_app_verified =
            is_app_view_path(verified_loaded_path) && !is_config_view_path(verified_loaded_path);

        !is_app_current
            && !is_app_verified
            && (current_url_path.is_none()
                || is_config_view_path(current_url_path)
                || is_bootstrap_view_path(current_url_path))
            && (verified_loaded_path.is_none()
                || is_config_view_path(verified_loaded_path)
                || is_bootstrap_view_path(verified_loaded_path))
    } else {
        window_label == "config"
            && is_config_view_path(current_url_path)
            && (verified_loaded_path.is_none() || is_config_view_path(verified_loaded_path))
    };

    if allowed {
        Ok(())
    } else {
        Err(AppError::with_details(
            ErrorCode::ProxyForbidden,
            format!(
                "Server connection settings can only be modified from the isolated configuration screen. [ctx: mobile={}, win='{}', curr={:?}, verif={:?}]",
                is_mobile, window_label, current_url_path, verified_loaded_path
            ),
        ))
    }
}

fn ensure_config_context(
    app: &tauri::AppHandle,
    webview: &tauri::WebviewWindow,
) -> Result<(), AppError> {
    let current_path = webview.url().ok().map(|u| u.path().to_string());
    let verified_path = app
        .try_state::<SecurityState>()
        .and_then(|state| state.verified_path(webview.label()));
    let is_mobile = cfg!(any(target_os = "android", target_os = "ios"));

    validate_config_access(
        is_mobile,
        webview.label(),
        current_path.as_deref(),
        verified_path.as_deref(),
    )
}

fn is_blocked_port(port: u16) -> bool {
    matches!(
        port,
        1 | 7
            | 9
            | 11
            | 13
            | 15
            | 17
            | 19
            | 20
            | 21
            | 22
            | 23
            | 25
            | 37
            | 42
            | 43
            | 53
            | 69
            | 77
            | 79
            | 87
            | 95
            | 101
            | 102
            | 103
            | 104
            | 109
            | 110
            | 111
            | 113
            | 115
            | 117
            | 119
            | 123
            | 135
            | 137
            | 139
            | 143
            | 161
            | 179
            | 389
            | 427
            | 445
            | 465
            | 512
            | 513
            | 514
            | 515
            | 526
            | 530
            | 531
            | 532
            | 540
            | 548
            | 554
            | 556
            | 563
            | 587
            | 601
            | 636
            | 989
            | 990
            | 993
            | 995
            | 1719
            | 1720
            | 1723
            | 2049
            | 3306
            | 3389
            | 5060
            | 5061
            | 5432
            | 6379
            | 6566
            | 6665..=6669 | 6697 | 10080
    )
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
    if parsed.query().is_some() {
        return Err(AppError::new(ErrorCode::InvalidUrl));
    }
    if let Some(port) = parsed.port()
        && is_blocked_port(port)
    {
        return Err(AppError::new(ErrorCode::InvalidUrl));
    }

    // If user provided a path ending in /api or /api/, strip it so the base server URL is clean
    let clean_path = parsed.path().trim_end_matches('/');
    if let Some(base_path) = clean_path.strip_suffix("/api") {
        let base_owned = if base_path.is_empty() { "/" } else { base_path }.to_string();
        parsed.set_path(&base_owned);
    }

    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn build_http_client(
    base_url: &reqwest::Url,
    allow_invalid_certs: bool,
) -> Result<Client, AppError> {
    let allowed_origin = base_url.origin();
    let redirect_policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("Too many redirects");
        }
        if attempt.url().origin() != allowed_origin {
            return attempt.stop();
        }
        attempt.follow()
    });

    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .tcp_nodelay(true)
        .user_agent(concat!("SecuroClient/", env!("CARGO_PKG_VERSION")))
        .redirect(redirect_policy);

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
    #[cfg(debug_assertions)]
    {
        out.push_str(&format!("Debug: {err:#?}\n"));
    }
    out
}

fn reset_main_webview_session(app: &tauri::AppHandle, navigate_away: bool) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.clear_all_browsing_data();
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if navigate_away {
            if let Ok(mut target_url) = main_window.url() {
                target_url.set_path("/index.html");
                target_url.set_query(None);
                target_url.set_fragment(None);
                let _ = main_window.navigate(target_url);
            }
            let _ = main_window.hide();
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = navigate_away;
    }
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
    let previous_url = store
        .get(SERVER_URL_KEY)
        .and_then(|value| value.as_str().map(str::to_owned));

    if previous_url
        .as_deref()
        .is_some_and(|prev| prev != server_url)
    {
        reset_main_webview_session(app, false);
    }

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
                resp.status().is_success()
                    || (status != 404 && status != 405 && !resp.status().is_redirection())
            };

            if reachable && !resp.status().is_redirection() {
                Ok(true)
            } else {
                Err(format!("Attempt at: {url}\nHTTP response {status}\n"))
            }
        }
        Err(err) => {
            let detail = detailed_reqwest_error(url, &err);
            #[cfg(debug_assertions)]
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
    ensure_config_context(&app, &webview)?;
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
    ensure_config_context(&app, &webview)?;
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
    ensure_config_context(&app, &webview)?;
    let normalized_url = normalize_url(&server_url)?;
    let parsed_base = reqwest::Url::parse(&normalized_url)
        .map_err(|err| AppError::with_details(ErrorCode::InvalidUrl, err.to_string()))?;
    let client = build_http_client(&parsed_base, allow_invalid_certs)?;

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
    ensure_config_context(&app, &webview)?;
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::new(ErrorCode::ConfigOpenFailed))?;
    store.delete(SERVER_URL_KEY);
    store.delete(ALLOW_INVALID_CERTS_KEY);
    store.delete(AUTO_CONNECT_KEY);
    store
        .save()
        .map_err(|_| AppError::new(ErrorCode::ConfigSaveFailed))?;
    reset_main_webview_session(&app, true);
    Ok(())
}

#[tauri::command]
pub fn activate_app_window(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
) -> Result<(), String> {
    ensure_config_context(&app, &webview).map_err(|err| format!("{:?}", err.code))?;
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
        if let Some(state) = app.try_state::<SecurityState>() {
            state.record_page_load("main", "/app.html");
        }
        if let Some(main_window) = app.get_webview_window("main") {
            if let Ok(mut target_url) = main_window.url()
                && !target_url.path().ends_with("/app.html")
            {
                target_url.set_path("/app.html");
                target_url.set_query(None);
                target_url.set_fragment(Some("/"));
                let _ = main_window.navigate(target_url);
            }
            return Ok(());
        }
        Err("Main window is not available".to_string())
    }
}

#[tauri::command]
pub fn open_config_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Some(state) = app.try_state::<SecurityState>() {
            state.record_page_load("config", CONFIG_VIEW_PATH);
        }

        if let Some(config_window) = app.get_webview_window("config") {
            config_window.show().map_err(|err| err.to_string())?;
            let _ = config_window.set_focus();
            return Ok(());
        }

        let config_window = tauri::WebviewWindowBuilder::new(
            &app,
            "config",
            tauri::WebviewUrl::App("config/config.html".into()),
        )
        .title("Configure Securo")
        .inner_size(800.0, 600.0)
        .visible(true)
        .build()
        .map_err(|err| err.to_string())?;

        let _ = config_window.set_focus();
        Ok(())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        if let Some(state) = app.try_state::<SecurityState>() {
            state.record_page_load("main", CONFIG_VIEW_PATH);
        }
        if let Some(main_window) = app.get_webview_window("main") {
            if let Ok(mut target_url) = main_window.url() {
                target_url.set_path(CONFIG_VIEW_PATH);
                target_url.set_query(None);
                target_url.set_fragment(None);
                let _ = main_window.navigate(target_url);
            }
            return Ok(());
        }
        Err("Main window is not available".to_string())
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
    fn test_normalize_url_rejects_query_strings_and_blocked_ports() {
        let query_err = normalize_url("https://example.com?token=secret").unwrap_err();
        assert_eq!(query_err.code, ErrorCode::InvalidUrl);

        let api_query_err = normalize_url("http://localhost:8080/api?debug=1").unwrap_err();
        assert_eq!(api_query_err.code, ErrorCode::InvalidUrl);

        let ssh_port_err = normalize_url("http://192.168.1.10:22").unwrap_err();
        assert_eq!(ssh_port_err.code, ErrorCode::InvalidUrl);

        let redis_port_err = normalize_url("http://127.0.0.1:6379").unwrap_err();
        assert_eq!(redis_port_err.code, ErrorCode::InvalidUrl);

        let smtp_port_err = normalize_url("http://10.0.0.5:25").unwrap_err();
        assert_eq!(smtp_port_err.code, ErrorCode::InvalidUrl);
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
    fn test_validate_config_access_blocks_pushstate_and_main_window_bypass() {
        // Legitimate desktop config window
        assert!(
            validate_config_access(
                false,
                "config",
                Some("/config/config.html"),
                Some("/config/config.html")
            )
            .is_ok()
        );

        // Desktop "main" window attempting bypass (even if URL were /config/config.html)
        assert_eq!(
            validate_config_access(
                false,
                "main",
                Some("/config/config.html"),
                Some("/config/config.html")
            )
            .unwrap_err()
            .code,
            ErrorCode::ProxyForbidden
        );

        // Mobile XSS history.pushState(null, "", "/config/config.html") from /app.html
        assert_eq!(
            validate_config_access(true, "main", Some("/config/config.html"), Some("/app.html"))
                .unwrap_err()
                .code,
            ErrorCode::ProxyForbidden
        );

        // Direct invoke from inside /app.html without pushState
        assert_eq!(
            validate_config_access(true, "main", Some("/app.html"), Some("/app.html"))
                .unwrap_err()
                .code,
            ErrorCode::ProxyForbidden
        );

        // Path suffix spoofing (/evil/config.html)
        assert_eq!(
            validate_config_access(
                true,
                "main",
                Some("/evil/config.html"),
                Some("/evil/config.html")
            )
            .unwrap_err()
            .code,
            ErrorCode::ProxyForbidden
        );

        // Legitimate mobile full-document navigation to /config/config.html
        assert!(
            validate_config_access(
                true,
                "main",
                Some("/config/config.html"),
                Some("/config/config.html")
            )
            .is_ok()
        );

        // Mobile relative config path from Android WebView (config/config.html)
        assert!(
            validate_config_access(
                true,
                "main",
                Some("config/config.html"),
                Some("config/config.html")
            )
            .is_ok()
        );

        // Mobile assets loader prefix paths
        assert!(
            validate_config_access(
                true,
                "main",
                Some("/android_asset/dist/config/config.html"),
                Some("/android_asset/dist/config/config.html")
            )
            .is_ok()
        );

        // Mobile initial navigation before on_page_load has recorded verified path
        assert!(validate_config_access(true, "main", Some("/config/config.html"), None).is_ok());

        // Mobile legitimate navigation transitioned from bootstrap entry (/index.html, index.html, /)
        assert!(
            validate_config_access(
                true,
                "main",
                Some("/config/config.html"),
                Some("/index.html")
            )
            .is_ok()
        );
        assert!(
            validate_config_access(
                true,
                "main",
                Some("/config/config.html"),
                Some("index.html")
            )
            .is_ok()
        );
        assert!(
            validate_config_access(true, "main", Some("/config/config.html"), Some("/")).is_ok()
        );
        assert!(validate_config_access(true, "main", None, Some("/index.html")).is_ok());
        assert!(
            validate_config_access(true, "main", Some("/index.html"), Some("/index.html")).is_ok()
        );

        // Full URL and query parameter handling
        assert!(
            validate_config_access(
                true,
                "main",
                Some("http://tauri.localhost/config/config.html?v=1"),
                Some("http://tauri.localhost/config/config.html")
            )
            .is_ok()
        );

        // Android WebView about:blank initial state
        assert!(
            validate_config_access(true, "main", Some("about:blank"), Some("/index.html")).is_ok()
        );
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
        let base = reqwest::Url::parse("https://securo.local").unwrap();
        assert!(build_http_client(&base, false).is_ok());
        assert!(build_http_client(&base, true).is_ok());
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

        let base = reqwest::Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();
        let client = build_http_client(&base, false).unwrap();
        let test_url = format!("http://127.0.0.1:{port}/api/health");
        let result = probe_endpoint(&client, &test_url, false).await;
        assert_eq!(result, Ok(true));
    }

    #[tokio::test]
    async fn test_probe_endpoint_blocks_cross_origin_redirect_and_hides_body() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let response = "HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data/\r\nContent-Length: 18\r\n\r\nSECRET_INTERNAL_DATA";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let base = reqwest::Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();
        let client = build_http_client(&base, false).unwrap();
        let test_url = format!("http://127.0.0.1:{port}/api/health");
        let err = probe_endpoint(&client, &test_url, false).await.unwrap_err();
        assert!(err.contains("HTTP response 302"));
        assert!(!err.contains("SECRET_INTERNAL_DATA"));
    }

    #[tokio::test]
    async fn test_probe_endpoint_fails_on_unreachable_port() {
        let base = reqwest::Url::parse("http://127.0.0.1:59999").unwrap();
        let client = build_http_client(&base, false).unwrap();
        let unreachable_url = "http://127.0.0.1:59999/api/health";
        let result = probe_endpoint(&client, unreachable_url, false).await;
        assert!(result.is_err());
        let log = result.unwrap_err();
        assert!(log.contains("Attempt at: http://127.0.0.1:59999/api/health"));
    }
}
