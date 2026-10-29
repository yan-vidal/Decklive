//! Erros da API, sempre com corpo JSON `{error, message, ...}`.

use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("token de administrador ausente ou inválido")]
    Unauthorized,
    #[error("{message}")]
    InvalidField { field: String, message: String },
    #[error("a foto não tem a versão '{requested}'")]
    UnknownVersion {
        requested: String,
        available: Vec<String>,
    },
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadGateway(String),
    /// Limite de memória cheio (envio de ajustes).
    #[error("{0}")]
    Unavailable(String),
    /// Rejeição do extrator (JSON malformado, tipo de conteúdo etc.).
    #[error("{message}")]
    Rejected { status: StatusCode, message: String },
    #[error("erro interno")]
    Internal(String),
}

impl ApiError {
    pub fn invalid(field: impl Into<String>, message: impl Into<String>) -> Self {
        ApiError::InvalidField {
            field: field.into(),
            message: message.into(),
        }
    }

    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            ApiError::InvalidField { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_field"),
            ApiError::UnknownVersion { .. } => {
                (StatusCode::UNPROCESSABLE_ENTITY, "unknown_version")
            }
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::BadGateway(_) => (StatusCode::BAD_GATEWAY, "bad_gateway"),
            ApiError::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
            ApiError::Rejected { status, .. } => (*status, "invalid_body"),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(e.to_string())
    }
}

impl From<axum::extract::rejection::JsonRejection> for ApiError {
    fn from(r: axum::extract::rejection::JsonRejection) -> Self {
        ApiError::Rejected {
            status: r.status(),
            message: r.body_text(),
        }
    }
}

impl From<axum::extract::rejection::BytesRejection> for ApiError {
    fn from(r: axum::extract::rejection::BytesRejection) -> Self {
        ApiError::Rejected {
            status: r.status(),
            message: r.body_text(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        if let ApiError::Internal(detail) = &self {
            tracing::error!(%detail, "erro interno");
        }
        let mut body = json!({ "error": code, "message": self.to_string() });
        match &self {
            ApiError::InvalidField { field, .. } => {
                body["field"] = Value::from(field.as_str());
            }
            ApiError::UnknownVersion { available, .. } => {
                body["available"] = Value::from(available.clone());
            }
            _ => {}
        }
        let mut response = (status, axum::Json(body)).into_response();
        if status == StatusCode::UNAUTHORIZED {
            response
                .headers_mut()
                .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        }
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    }
}
