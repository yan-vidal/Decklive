//! Cenários de proteção das rotas de catálogo (spec media-catalog).

mod common;

use axum::http::{Method, StatusCode};
use common::{TOKEN, TestApp, json_request};
use serde_json::json;

#[tokio::test]
async fn request_without_token_is_rejected_and_nothing_is_written() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t
        .send(json_request(
            Method::POST,
            "/api/media",
            Some(json!({"id": "66d312a4124fa13304b01ea7"})),
            None,
        ))
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.header("www-authenticate"), Some("Bearer"));
    assert_eq!(reply.json()["error"], "unauthorized");
    assert_eq!(t.repo.revision().await.unwrap(), 0);
    assert!(t.repo.load().await.unwrap().media.is_empty());
    assert_eq!(t.source_calls().await, 0);
}

#[tokio::test]
async fn wrong_token_is_rejected() {
    let t = TestApp::new().await;
    let wrong = format!("{TOKEN}-errado");
    for token in [wrong.as_str(), &TOKEN[1..], "x"] {
        let reply = t
            .send(json_request(Method::GET, "/api/media", None, Some(token)))
            .await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "token {token:?}");
    }
    let reply = t
        .send(json_request(
            Method::DELETE,
            "/api/media",
            Some(json!({"ids": ["66d312a4124fa13304b01ea7"]})),
            Some("errado"),
        ))
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn right_token_is_accepted() {
    let t = TestApp::new().await;
    let reply = t.admin(Method::GET, "/api/media", None).await;
    assert_eq!(reply.status, StatusCode::OK);
}
