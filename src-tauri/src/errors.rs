use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidUrl,
    InvalidUrlScheme,
    InvalidUrlCredentials,
    ConfigOpenFailed,
    HttpClientBuildFailed,
    ServerUnreachable,
    #[allow(dead_code)]
    ServerHttpError,
    ConfigSaveFailed,
    ProxyForbidden,
}

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            status: None,
            details: None,
        }
    }

    pub fn with_details(code: ErrorCode, details: impl Into<String>) -> Self {
        Self {
            code,
            status: None,
            details: Some(details.into()),
        }
    }

    #[allow(dead_code)]
    pub fn server_http_error(status: u16) -> Self {
        Self {
            code: ErrorCode::ServerHttpError,
            status: Some(status),
            details: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_screaming_snake_case_serialization() {
        assert_eq!(
            serde_json::to_string(&ErrorCode::InvalidUrl).unwrap(),
            "\"INVALID_URL\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::InvalidUrlScheme).unwrap(),
            "\"INVALID_URL_SCHEME\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::InvalidUrlCredentials).unwrap(),
            "\"INVALID_URL_CREDENTIALS\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ConfigOpenFailed).unwrap(),
            "\"CONFIG_OPEN_FAILED\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::HttpClientBuildFailed).unwrap(),
            "\"HTTP_CLIENT_BUILD_FAILED\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ServerUnreachable).unwrap(),
            "\"SERVER_UNREACHABLE\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ServerHttpError).unwrap(),
            "\"SERVER_HTTP_ERROR\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ConfigSaveFailed).unwrap(),
            "\"CONFIG_SAVE_FAILED\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ProxyForbidden).unwrap(),
            "\"PROXY_FORBIDDEN\""
        );
    }

    #[test]
    fn test_app_error_new_omits_none_fields() {
        let err = AppError::new(ErrorCode::InvalidUrl);
        let serialized = serde_json::to_string(&err).unwrap();
        assert_eq!(serialized, "{\"code\":\"INVALID_URL\"}");
    }

    #[test]
    fn test_app_error_with_details_serialization() {
        let err =
            AppError::with_details(ErrorCode::ServerUnreachable, "Connection refused by host");
        let serialized = serde_json::to_string(&err).unwrap();
        assert_eq!(
            serialized,
            "{\"code\":\"SERVER_UNREACHABLE\",\"details\":\"Connection refused by host\"}"
        );
    }

    #[test]
    fn test_app_error_server_http_error_serialization() {
        let err = AppError::server_http_error(404);
        let serialized = serde_json::to_string(&err).unwrap();
        assert_eq!(
            serialized,
            "{\"code\":\"SERVER_HTTP_ERROR\",\"status\":404}"
        );
    }
}
