//! Rotas do catálogo: `/api/media` (spec media-catalog).

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::app::AppState;
use crate::error::ApiError;
use crate::import::build_media;
use crate::model::{Crops, Media, Point};
use crate::source::SourceError;
use crate::validate::{normalize_id, validate_crops, validate_focus};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterRequest {
    pub id: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub focus: Option<Point>,
    #[serde(default)]
    pub crops: Option<Crops>,
}

/// `POST /api/media`: registra (ou registra de novo) uma foto do yanlucas.com.
pub async fn register(
    State(state): State<AppState>,
    body: Result<Json<RegisterRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Media>), ApiError> {
    let Json(request) = body?;
    // Tudo o que dá para conferir sem a origem é conferido antes de chamá-la.
    let id = normalize_id(&request.id)?;
    let focus = validate_focus(request.focus)?;
    let crops = validate_crops(request.crops)?;

    let doc = state
        .inner
        .source
        .fetch_photo(&id)
        .await
        .map_err(|e| match e {
            SourceError::NotFound => {
                ApiError::NotFound(format!("a foto {id} não existe no yanlucas.com"))
            }
            SourceError::Unavailable(_) => ApiError::BadGateway(e.to_string()),
        })?;

    let new = build_media(
        &doc,
        request.version.as_deref(),
        &state.inner.media_hosts,
        state.inner.probe.as_ref(),
        focus,
        crops,
    )
    .await?;

    let (media, created) = state.upsert(&new).await?;
    tracing::info!(id = %media.id, version = %media.version, created, "foto registrada");
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(media)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoveRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RemoveResponse {
    pub removed: Vec<String>,
    pub not_found: Vec<String>,
}

/// `DELETE /api/media`: tira fotos do catálogo (a origem não muda).
pub async fn remove(
    State(state): State<AppState>,
    body: Result<Json<RemoveRequest>, JsonRejection>,
) -> Result<Json<RemoveResponse>, ApiError> {
    let Json(request) = body?;
    if request.ids.is_empty() {
        return Err(ApiError::invalid("ids", "a lista de ids está vazia"));
    }
    // Mesma forma do registro; sem repetir ids.
    let mut ids: Vec<String> = Vec::with_capacity(request.ids.len());
    for raw in &request.ids {
        let id = normalize_id(raw).unwrap_or_else(|_| raw.trim().to_string());
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let removal = state.remove(&ids).await?;
    if !removal.removed.is_empty() {
        tracing::info!(removed = ?removal.removed, "fotos removidas");
    }
    Ok(Json(RemoveResponse {
        removed: removal.removed,
        not_found: removal.not_found,
    }))
}

#[derive(Debug, Serialize)]
pub struct ListResponse<'a> {
    pub items: Vec<&'a Media>,
    pub total: usize,
}

/// `GET /api/media`: o catálogo, das fotos mais recentes para as mais antigas.
pub async fn list(State(state): State<AppState>) -> Result<Response, ApiError> {
    let snapshot = state.catalog().snapshot();
    let items: Vec<&Media> = snapshot.media.iter().rev().collect();
    let body = ListResponse {
        total: items.len(),
        items,
    };
    let bytes = serde_json::to_vec(&body).map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(([(header::CONTENT_TYPE, "application/json")], bytes).into_response())
}
