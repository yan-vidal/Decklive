//! Player web servido pelo binário com os cabeçalhos de cache (tarefa 5.9).

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

const IMMUTABLE: &str = "public, max-age=31536000, immutable";

struct Reply {
    status: StatusCode,
    cache: Option<String>,
    content_type: Option<String>,
    body: Vec<u8>,
}

async fn get(app: &axum::Router, uri: &str) -> Reply {
    let response = app
        .clone()
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .map(|v| v.to_str().unwrap().to_string())
    };
    let (status, cache, content_type) = (
        response.status(),
        header("cache-control"),
        header("content-type"),
    );
    let body = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    Reply {
        status,
        cache,
        content_type,
        body,
    }
}

fn web_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("index.html"),
        "<!doctype html><title>DeckLive</title>",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("manifest.webmanifest"),
        r#"{"name":"DeckLive"}"#,
    )
    .unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/app-abc123.js"), "console.log(1)").unwrap();
    dir
}

#[tokio::test]
async fn hashed_assets_are_immutable() {
    let dir = web_dir();
    let app = common::full_app(dir.path()).await;
    let reply = get(&app, "/assets/app-abc123.js").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.cache.as_deref(), Some(IMMUTABLE));
    assert!(reply.content_type.unwrap().contains("javascript"));
    assert_eq!(reply.body, b"console.log(1)");
}

#[tokio::test]
async fn index_and_manifest_are_no_cache() {
    let dir = web_dir();
    let app = common::full_app(dir.path()).await;
    for uri in ["/", "/index.html"] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
        assert_eq!(reply.cache.as_deref(), Some("no-cache"), "{uri}");
        assert!(reply.content_type.unwrap().starts_with("text/html"));
    }
    let reply = get(&app, "/manifest.webmanifest").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.cache.as_deref(), Some("no-cache"));
}

#[tokio::test]
async fn missing_files_are_not_cached_and_api_still_wins() {
    let dir = web_dir();
    let app = common::full_app(dir.path()).await;
    let reply = get(&app, "/assets/app-zzz999.js").await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_ne!(reply.cache.as_deref(), Some(IMMUTABLE));

    assert_eq!(
        get(&app, "/api/playlist?w=1920&h=1080").await.status,
        StatusCode::OK
    );
    let api_missing = get(&app, "/api/nada").await;
    assert_eq!(api_missing.status, StatusCode::NOT_FOUND);
    assert!(api_missing.content_type.unwrap().contains("json"));
}
