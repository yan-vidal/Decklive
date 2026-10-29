//! Estado compartilhado e montagem das rotas.

use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::http::{Method, header};
use axum::middleware::from_fn_with_state;
use axum::routing::{any, get};

use crate::auth::{AdminToken, require_admin};
use crate::catalog::{Boot, Catalog};
use crate::db::{Removal, Repo};
use crate::error::ApiError;
use crate::measure::DimensionProbe;
use crate::model::{Media, NewMedia};
use crate::routes;
use crate::source::SourceClient;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

/// Peças do serviço, montadas no `main` ou nos testes.
pub struct AppDeps {
    pub admin_token: String,
    pub repo: Repo,
    pub source: SourceClient,
    pub probe: Arc<dyn DimensionProbe>,
    pub media_hosts: Vec<String>,
    /// Instante de início do processo, que entra no `ETag` da playlist.
    pub boot: Boot,
}

#[derive(Clone)]
pub struct AppState {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub admin_token: AdminToken,
    pub repo: Repo,
    pub source: SourceClient,
    pub probe: Arc<dyn DimensionProbe>,
    pub media_hosts: Vec<String>,
    pub catalog: Catalog,
    /// Uma escrita por vez, com a troca do snapshot, para nunca guardar um snapshot velho.
    write_lock: tokio::sync::Mutex<()>,
}

impl AppState {
    /// Carrega o catálogo do banco para a memória.
    pub async fn new(deps: AppDeps) -> Result<Self, sqlx::Error> {
        let catalog = Catalog::load(&deps.repo, deps.boot).await?;
        Ok(AppState {
            inner: Arc::new(Inner {
                admin_token: AdminToken(Arc::from(deps.admin_token)),
                repo: deps.repo,
                source: deps.source,
                probe: deps.probe,
                media_hosts: deps.media_hosts,
                catalog,
                write_lock: tokio::sync::Mutex::new(()),
            }),
        })
    }

    pub fn catalog(&self) -> &Catalog {
        &self.inner.catalog
    }

    pub(crate) async fn upsert(&self, media: &NewMedia) -> Result<(Media, bool), ApiError> {
        let _guard = self.inner.write_lock.lock().await;
        let result = self.inner.repo.upsert(media).await?;
        self.reload().await;
        Ok(result)
    }

    pub(crate) async fn remove(&self, ids: &[String]) -> Result<Removal, ApiError> {
        let _guard = self.inner.write_lock.lock().await;
        let removal = self.inner.repo.remove(ids).await?;
        if !removal.removed.is_empty() {
            self.reload().await;
        }
        Ok(removal)
    }

    /// A escrita já foi gravada; se a releitura falhar, só registra (a próxima escrita corrige).
    async fn reload(&self) {
        if let Err(e) = self.inner.catalog.reload(&self.inner.repo).await {
            tracing::error!(error = %e, "falha ao recarregar o catálogo na memória");
        }
    }
}

/// Aplicação completa: API, player web e log das requisições.
pub fn app(state: AppState, web_dir: &Path) -> Router {
    router(state)
        .fallback_service(crate::web::service(web_dir))
        .layer(TraceLayer::new_for_http())
}

/// Monta o roteador da API.
pub fn router(state: AppState) -> Router {
    let media = Router::new()
        .route(
            "/api/media",
            get(routes::media::list)
                .post(routes::media::register)
                .delete(routes::media::remove),
        )
        .route_layer(from_fn_with_state(
            state.inner.admin_token.clone(),
            require_admin,
        ))
        .layer(CompressionLayer::new());

    // Pública e com CORS de qualquer origem; comprime por conta própria (resposta memorizada).
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::HEAD])
        .allow_headers([header::IF_NONE_MATCH])
        .expose_headers([header::ETAG])
        .max_age(std::time::Duration::from_secs(86400));
    let playlist = Router::new()
        .route("/api/playlist", get(routes::playlist::get))
        .layer(cors);

    Router::new()
        .merge(media)
        .merge(playlist)
        .route("/api/{*rest}", any(api_not_found))
        .with_state(state)
}

async fn api_not_found() -> ApiError {
    ApiError::NotFound("rota inexistente".into())
}
