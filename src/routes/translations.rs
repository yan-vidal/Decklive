//! Rotas do dicionário de traduções: `/api/translations/{lang}` (spec media-catalog de
//! `add-localized-descriptions`, design D4). Exigem o token, como `/api/media`.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::app::AppState;
use crate::catalog::Missing;
use crate::db::Translation;
use crate::error::ApiError;
use crate::lang::{self, TagError};

/// Itens por gravação, numa transação só.
pub const MAX_ITEMS: usize = 2000;
/// Corpo das rotas de tradução. A carga no servidor de casa vai direto ao loopback,
/// sem o nginx (que limita o corpo a 1 MB).
pub const MAX_BODY: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    pub items: Vec<SaveItem>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveItem {
    pub source: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SaveResponse {
    pub lang: String,
    pub saved: usize,
}

/// `PUT /api/translations/{lang}`: grava ou substitui traduções, tudo ou nada.
pub async fn save(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<SaveRequest>, JsonRejection>,
) -> Result<Json<SaveResponse>, ApiError> {
    let lang = lang_of(path)?;
    let Json(request) = body?;
    if request.items.is_empty() {
        return Err(ApiError::invalid(
            "items",
            "a lista de traduções está vazia",
        ));
    }
    if request.items.len() > MAX_ITEMS {
        return Err(ApiError::invalid(
            "items",
            format!(
                "são {} traduções; o máximo por pedido é {MAX_ITEMS}",
                request.items.len()
            ),
        ));
    }
    // Sem espaços nas pontas, como os textos da origem; o mesmo texto repetido fica
    // com a última tradução.
    let mut items: Vec<(String, String)> = Vec::with_capacity(request.items.len());
    for (i, item) in request.items.iter().enumerate() {
        let source = item.source.trim();
        let text = item.text.trim();
        if source.is_empty() {
            return Err(ApiError::invalid(
                format!("items[{i}].source"),
                "o texto da origem está vazio",
            ));
        }
        if text.is_empty() {
            return Err(ApiError::invalid(
                format!("items[{i}].text"),
                "a tradução está vazia",
            ));
        }
        match items.iter_mut().find(|(s, _)| s == source) {
            Some(existing) => existing.1 = text.to_string(),
            None => items.push((source.to_string(), text.to_string())),
        }
    }
    let saved = state.save_translations(&lang, &items).await?;
    tracing::info!(%lang, saved, "traduções gravadas");
    Ok(Json(SaveResponse { lang, saved }))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub missing: bool,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub lang: String,
    pub items: Vec<Translation>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct MissingResponse {
    pub lang: String,
    pub items: Vec<Missing>,
}

/// `GET /api/translations/{lang}`: as traduções do idioma, ou, com `missing=true`,
/// os textos do catálogo que ainda faltam traduzir.
pub async fn list(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Response, ApiError> {
    let lang = lang_of(path)?;
    let Query(query) =
        query.map_err(|_| ApiError::BadRequest("missing precisa ser true ou false".into()))?;
    if query.missing {
        let items = state.catalog().snapshot().missing(&lang);
        return Ok(Json(MissingResponse { lang, items }).into_response());
    }
    let items = state.inner.repo.translations(&lang).await?;
    Ok(Json(ListResponse {
        lang,
        total: items.len(),
        items,
    })
    .into_response())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoveRequest {
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RemoveResponse {
    pub removed: Vec<String>,
    pub not_found: Vec<String>,
}

/// `DELETE /api/translations/{lang}`: remove traduções; a foto volta ao inglês.
pub async fn remove(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<RemoveRequest>, JsonRejection>,
) -> Result<Json<RemoveResponse>, ApiError> {
    let lang = lang_of(path)?;
    let Json(request) = body?;
    if request.sources.is_empty() {
        return Err(ApiError::invalid("sources", "a lista de textos está vazia"));
    }
    // Mesma forma da gravação; sem repetir textos.
    let mut sources: Vec<String> = Vec::with_capacity(request.sources.len());
    for raw in &request.sources {
        let source = raw.trim().to_string();
        if !sources.contains(&source) {
            sources.push(source);
        }
    }
    let removal = state.remove_translations(&lang, &sources).await?;
    if !removal.removed.is_empty() {
        tracing::info!(%lang, removed = removal.removed.len(), "traduções removidas");
    }
    Ok(Json(RemoveResponse {
        removed: removal.removed,
        not_found: removal.not_found,
    }))
}

/// Idioma do caminho, normalizado; o inglês da origem não tem traduções.
fn lang_of(path: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Path(raw) = path.map_err(|r| ApiError::BadRequest(r.body_text()))?;
    lang::for_translations(&raw).map_err(|e| match e {
        TagError::Format => ApiError::invalid(
            "lang",
            format!("'{raw}' não é uma etiqueta de idioma (exemplos: pt-BR, es)"),
        ),
        TagError::Source => ApiError::invalid(
            "lang",
            format!(
                "'{raw}' é o idioma da origem ({}): os textos já estão nele",
                lang::SOURCE_LANG
            ),
        ),
    })
}
