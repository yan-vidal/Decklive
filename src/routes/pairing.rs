//! Envio de ajustes para outra tela: `/api/pairing` (spec settings-transfer de
//! `add-screen-customization`, design D7). Rotas públicas, sem CORS (o player é da
//! mesma origem) e sem nenhum log do pacote: ele pode levar o token do endpoint do
//! usuário.

use axum::Json;
use axum::extract::rejection::BytesRejection;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde::Serialize;

use crate::app::AppState;
use crate::error::ApiError;
use crate::pairing::{PairingError, TTL};

#[derive(Debug, Serialize)]
pub struct Created {
    pub code: String,
    /// Segundos até o código vencer.
    pub expires_in: u64,
}

/// `POST /api/pairing`: guarda o pacote (um objeto JSON de até 64 KB) e devolve o código.
pub async fn create(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let body = body?;
    // Só confere que é um objeto; o player valida campo a campo ao receber. A mensagem
    // de erro é fixa, para não repetir nada do corpo.
    if serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(&body).is_err() {
        return Err(ApiError::invalid(
            "body",
            "o pacote de ajustes precisa ser um objeto JSON",
        ));
    }
    let code = state.pairing().put(body).map_err(|e| match e {
        PairingError::Full => {
            tracing::warn!("limite de envios de ajustes pendentes atingido");
            ApiError::Unavailable(e.to_string())
        }
        PairingError::Random(detail) => ApiError::Internal(detail),
    })?;
    let created = Created {
        code,
        expires_in: TTL.as_secs(),
    };
    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(created),
    )
        .into_response())
}

/// `GET /api/pairing/{code}`: entrega o pacote e o apaga na mesma operação.
pub async fn take(State(state): State<AppState>, Path(code): Path<String>) -> Response {
    match state.pairing().take(&code) {
        Some(body) => (
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            body,
        )
            .into_response(),
        None => ApiError::NotFound("código inválido, vencido ou já usado".into()).into_response(),
    }
}
