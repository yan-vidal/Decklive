//! Cenários de `/api/pairing` (spec settings-transfer de `add-screen-customization`).

mod common;

use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::*;
use decklive::pairing::{ALPHABET, MAX_BODY, MAX_PACKS};
use serde_json::{Value, json};

const MINUTE: Duration = Duration::from_secs(60);

fn post(body: impl Into<Body>) -> Request<Body> {
    Request::post("/api/pairing")
        .header("content-type", "application/json")
        .body(body.into())
        .unwrap()
}

/// Ajustes como o player manda (formato D7), com o token do endpoint do usuário.
fn settings() -> Value {
    json!({
        "v": 1,
        "settings": {"interval": 30, "clock": true},
        "layout": {"landscape": {"clock": {"x": 0.8, "y": 0.1}}, "portrait": {}},
        "areas": [{
            "id": "a1",
            "kind": "endpoint",
            "endpoint": {
                "url": "https://example.com/senhas",
                "auth": "Bearer segredo-do-endpoint-123",
                "interval": 30,
                "template": "<b>{{senha}}</b>"
            },
            "layout": {"landscape": {"x": 0.5, "y": 0.5, "w": 0.2, "h": 0.1}}
        }]
    })
}

async fn send_settings(t: &TestApp) -> String {
    let reply = t.send(post(settings().to_string())).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
    reply.json()["code"].as_str().unwrap().to_string()
}

// --- Código de envio ---

#[tokio::test]
async fn send() {
    let t = TestApp::new().await;
    // rota pública: sem token
    let reply = t.send(post(settings().to_string())).await;
    assert_eq!(reply.status, StatusCode::CREATED);
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    let body = reply.json();
    assert_eq!(body["expires_in"], 600);
    let code = body["code"].as_str().unwrap();
    assert_eq!(code.len(), 6);
    assert!(code.bytes().all(|b| ALPHABET.contains(&b)), "{code}");
    assert_eq!(body.as_object().unwrap().len(), 2, "{body}");
    assert_eq!(t.state.pairing().len(), 1);
}

#[tokio::test]
async fn package_too_large_or_not_an_object() {
    let t = TestApp::new().await;
    // 64 KB exatos passam; um byte a mais dá 413
    let exact = |size: usize| {
        let padding = "x".repeat(size - r#"{"p":""}"#.len());
        format!(r#"{{"p":"{padding}"}}"#)
    };
    let reply = t.send(post(exact(MAX_BODY))).await;
    assert_eq!(reply.status, StatusCode::CREATED);
    let reply = t.send(post(exact(MAX_BODY + 1))).await;
    assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(reply.json()["error"], "invalid_body");

    for body in ["[]", "null", "\"texto\"", "42", "{", "", "{\"a\":1} lixo"] {
        let reply = t.send(post(body)).await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
        assert_eq!(reply.json()["error"], "invalid_field", "{body:?}");
    }
    // só o primeiro pacote ficou guardado
    assert_eq!(t.state.pairing().len(), 1);
}

// --- Recebimento de uso único ---

#[tokio::test]
async fn valid_code() {
    let t = TestApp::new().await;
    let code = send_settings(&t).await;
    t.clock.advance(2 * MINUTE);

    // sem diferenciar maiúsculas
    let reply = t
        .get(&format!("/api/pairing/{}", code.to_lowercase()))
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("content-type"), Some("application/json"));
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    assert_eq!(reply.json(), settings());

    let again = t.get(&format!("/api/pairing/{code}")).await;
    assert_eq!(again.status, StatusCode::NOT_FOUND);
    assert_eq!(again.json()["error"], "not_found");
}

#[tokio::test]
async fn expired_code() {
    let t = TestApp::new().await;
    let code = send_settings(&t).await;
    t.clock.advance(11 * MINUTE);
    let reply = t.get(&format!("/api/pairing/{code}")).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(t.state.pairing().len(), 0);
}

#[tokio::test]
async fn unknown_or_malformed_code() {
    let t = TestApp::new().await;
    send_settings(&t).await;
    for code in ["ABC234", "000000", "ABC", "ABCDEFGH", "%20%20"] {
        let reply = t.get(&format!("/api/pairing/{code}")).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{code}");
        assert_eq!(reply.json()["error"], "not_found", "{code}");
    }
    assert_eq!(t.state.pairing().len(), 1);
}

// --- Limites da memória ---

#[tokio::test]
async fn memory_limit_full() {
    let t = TestApp::new().await;
    let mut codes = Vec::new();
    for _ in 0..MAX_PACKS {
        codes.push(send_settings(&t).await);
    }
    let reply = t.send(post("{}")).await;
    assert_eq!(reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(reply.json()["error"], "unavailable");

    // um código usado libera uma vaga
    assert_eq!(
        t.get(&format!("/api/pairing/{}", codes[0])).await.status,
        StatusCode::OK
    );
    assert_eq!(t.send(post("{}")).await.status, StatusCode::CREATED);
    assert_eq!(
        t.send(post("{}")).await.status,
        StatusCode::SERVICE_UNAVAILABLE
    );

    // vencidos também liberam
    t.clock.advance(10 * MINUTE);
    assert_eq!(t.send(post("{}")).await.status, StatusCode::CREATED);
    assert_eq!(t.state.pairing().len(), 1);
}

// --- Sem CORS e sem log do corpo ---

#[tokio::test]
async fn no_cors() {
    let t = TestApp::new().await;
    let reply = t
        .send(
            Request::post("/api/pairing")
                .header("origin", "https://outro.example")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CREATED);
    assert_eq!(reply.header("access-control-allow-origin"), None);

    let preflight = t
        .send(
            Request::options("/api/pairing")
                .header("origin", "https://outro.example")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(preflight.header("access-control-allow-origin"), None);
}

/// Saída do log guardada na memória.
#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
    type Writer = Capture;
    fn make_writer(&'a self) -> Capture {
        self.clone()
    }
}

#[tokio::test]
async fn package_is_not_logged() {
    use tower::ServiceExt;

    let capture = Capture::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(capture.clone())
        .with_ansi(false)
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    // o app completo, com o log das requisições
    let t = TestApp::new().await;
    let web = tempfile::tempdir().unwrap();
    let app = decklive::app::app(t.state.clone(), web.path());
    let response = app
        .clone()
        .oneshot(post(settings().to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    let code = serde_json::from_slice::<Value>(&bytes).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_string();
    let response = app
        .oneshot(
            Request::get(format!("/api/pairing/{code}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    drop(response);

    let log = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
    assert!(
        log.contains("/api/pairing"),
        "o log das requisições rodou: {log}"
    );
    for secret in ["segredo-do-endpoint-123", "senhas", "{{senha}}"] {
        assert!(!log.contains(secret), "{secret} apareceu no log:\n{log}");
    }
}
