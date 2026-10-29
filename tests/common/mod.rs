//! Utilidades dos testes de integração.
#![allow(dead_code)]

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use std::sync::Arc;
use std::time::Duration;

use wiremock::matchers::{method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

use decklive::app::{AppDeps, AppState, app, router};
use decklive::catalog::Boot;
use decklive::db::{Repo, connect_memory};
use decklive::measure::{BoxFuture, DimensionProbe};
use decklive::model::{Crops, NewMedia, Point, Variant, VariantKind};
use decklive::pairing::ManualClock;
use decklive::source::SourceClient;

pub const TOKEN: &str = "test-token-0123456789abcdef-0123456789";
pub const PAGE: &str = include_str!("../fixtures/source-page.json");

/// Fotos do fixture (tiradas da API real).
pub const WITH_V1: &str = "66d312a4124fa13304b01ea7";
pub const WITH_V1_B: &str = "66d31aac124fa13304b01fa6";
pub const WITH_V1_V2_V3: &str = "66d31e67124fa13304b0236d";
pub const ONLY_ORIGINAL: &str = "66d31f8f124fa13304b024c1";
/// Sem cidade nem estado na origem.
pub const NO_CITY: &str = "66ee7c372e06e822f24ebbbf";
/// Com `metadata.latitude` e `metadata.longitude` na origem.
pub const WITH_COORDS: &str = "66d405ca124fa13304b052bc";
pub const UNKNOWN: &str = "0123456789abcdef01234567";

/// Medição falsa: dimensões pelo sufixo da URL, sem rede.
pub struct FakeProbe;

impl DimensionProbe for FakeProbe {
    fn probe<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<(u32, u32), String>> {
        Box::pin(async move {
            if url.ends_with("-thumbnail.jpeg") {
                Ok((196, 123))
            } else if url.ends_with("-optimized.jpeg") {
                Ok((981, 613))
            } else {
                Ok((2944, 1839))
            }
        })
    }
}

/// Monta o app completo (API + arquivos do player em `web_dir`).
pub async fn full_app(web_dir: &std::path::Path) -> Router {
    let t = TestApp::new().await;
    app(t.state.clone(), web_dir)
}

pub struct TestApp {
    pub app: Router,
    pub repo: Repo,
    pub state: AppState,
    pub source: MockServer,
    /// Relógio do envio de ajustes: só anda com `clock.advance`.
    pub clock: Arc<ManualClock>,
}

impl TestApp {
    pub async fn new() -> Self {
        Self::with_boot(Boot::now()).await
    }

    /// App com o instante de início fixo, para conferir o `ETag` exato.
    pub async fn with_boot(boot: Boot) -> Self {
        let repo = Repo::new(connect_memory().await.unwrap());
        Self::on(repo, boot).await
    }

    /// Outra instância do app sobre o mesmo banco, como depois de um reinício.
    pub async fn restart(&self, boot: Boot) -> Self {
        Self::on(self.repo.clone(), boot).await
    }

    async fn on(repo: Repo, boot: Boot) -> Self {
        let source = MockServer::start().await;
        let clock = Arc::new(ManualClock::new());
        let state = AppState::new(AppDeps {
            admin_token: TOKEN.into(),
            repo: repo.clone(),
            source: SourceClient::new(&source.uri(), Duration::from_secs(2)).unwrap(),
            probe: Arc::new(FakeProbe),
            media_hosts: vec!["cdn.yanlucas.com".into()],
            boot,
            clock: clock.clone(),
        })
        .await
        .unwrap();
        TestApp {
            app: router(state.clone()),
            repo,
            state,
            source,
            clock,
        }
    }

    /// Origem no ar: as fotos do fixture existem; as outras dão 500, como a API real.
    pub async fn source_up(&self) {
        self.source.reset().await;
        for id in [
            WITH_V1,
            WITH_V1_B,
            WITH_V1_V2_V3,
            ONLY_ORIGINAL,
            NO_CITY,
            WITH_COORDS,
        ] {
            Mock::given(method("GET"))
                .and(path("/images"))
                .and(query_param("id", id))
                .respond_with(ResponseTemplate::new(200).set_body_raw(PAGE, "application/json"))
                .with_priority(1)
                .mount(&self.source)
                .await;
        }
        Mock::given(method("GET"))
            .and(path("/images"))
            .and(query_param_is_missing("id"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(PAGE, "application/json"))
            .with_priority(2)
            .mount(&self.source)
            .await;
        Mock::given(method("GET"))
            .and(path("/images"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Erro ao listar imagens"))
            .with_priority(3)
            .mount(&self.source)
            .await;
    }

    /// Origem fora do ar: tudo responde 500.
    pub async fn source_down(&self) {
        self.source.reset().await;
        Mock::given(method("GET"))
            .and(path("/images"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Erro ao listar imagens"))
            .mount(&self.source)
            .await;
    }

    /// Quantas chamadas a origem recebeu.
    pub async fn source_calls(&self) -> usize {
        self.source
            .received_requests()
            .await
            .unwrap_or_default()
            .len()
    }

    /// Grava direto no banco e troca o snapshot, sem passar pela origem.
    pub async fn insert(&self, media: NewMedia) {
        self.repo.upsert(&media).await.unwrap();
        self.state.catalog().reload(&self.repo).await.unwrap();
    }

    pub async fn get(&self, uri: &str) -> Reply {
        self.send(Request::get(uri).body(Body::empty()).unwrap())
            .await
    }

    pub async fn register(&self, body: Value) -> Reply {
        self.admin(Method::POST, "/api/media", Some(body)).await
    }

    pub async fn send(&self, request: Request<Body>) -> Reply {
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            headers,
            body: bytes.to_vec(),
        }
    }

    /// Requisição autenticada com corpo JSON opcional.
    pub async fn admin(&self, method: Method, uri: &str, body: Option<Value>) -> Reply {
        self.send(json_request(method, uri, body, Some(TOKEN)))
            .await
    }
}

pub fn json_request(
    method: Method,
    uri: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    match body {
        Some(body) => builder
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "corpo não é JSON ({e}): {:?}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

/// Foto sintética com miniatura, otimizado (1/3) e original `w×h`.
pub fn synthetic(id: &str, w: u32, h: u32, crops: Crops) -> NewMedia {
    let file = |kind, suffix: &str, div: u32| Variant {
        kind,
        url: format!("https://cdn.yanlucas.com/{id}{suffix}.jpeg"),
        width: w / div,
        height: h / div,
    };
    NewMedia {
        id: id.into(),
        version: "V1".into(),
        description: Some(format!("Foto {id}")),
        taken_at: None,
        color: "#336699".into(),
        variants: vec![
            file(VariantKind::Thumbnail, "-thumbnail", 10),
            file(VariantKind::Optimized, "-optimized", 3),
            file(VariantKind::Full, "", 1),
        ],
        focus: Point::CENTER,
        crops,
        city: None,
        state: None,
        country: None,
    }
}
