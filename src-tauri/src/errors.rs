use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidUrl,
    InvalidUrlScheme,
    InvalidUrlCredentials,
    ConfigOpenFailed,
    HttpClientBuildFailed,
    ServerUnreachable,
    ServerHttpError,
    ConfigSaveFailed,
}

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, status: None }
    }

    pub fn server_http_error(status: u16) -> Self {
        Self {
            code: ErrorCode::ServerHttpError,
            status: Some(status),
        }
    }
}
