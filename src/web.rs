//! Player web compilado (`web/dist`), servido do disco com cache (design D1).

use std::path::Path;

use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::{Next, from_fn};
use axum::response::Response;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;

/// Arquivos com hash no nome: o conteúdo nunca muda naquela URL.
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// `index.html`, manifesto e o resto: sempre revalidar.
pub const NO_CACHE: &str = "no-cache";

/// O Vite põe em `assets/` só arquivos com hash no nome.
const HASHED_DIR: &str = "/assets/";

pub fn service(web_dir: &Path) -> Router {
    let files = ServeDir::new(web_dir)
        .append_index_html_on_directories(true)
        .precompressed_br()
        .precompressed_gzip();
    Router::new()
        .fallback_service(files)
        .layer(from_fn(cache_headers))
        .layer(CompressionLayer::new())
}

async fn cache_headers(request: Request, next: Next) -> Response {
    let hashed = request.uri().path().starts_with(HASHED_DIR);
    let mut response = next.run(request).await;
    let status = response.status();
    if status.is_success() || status == StatusCode::NOT_MODIFIED {
        let value = if hashed { IMMUTABLE } else { NO_CACHE };
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    response
}
