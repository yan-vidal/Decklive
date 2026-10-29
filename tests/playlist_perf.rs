//! Medição da playlist com 1.000 fotos (tarefa 4.6 de `add-photo-player-mvp` e 2.4 de
//! `add-photo-info-and-motion`).
//!
//! As descrições e os locais vêm de uma cópia de `GET /images` do yanlucas.com, indicada
//! em `DECKLIVE_PERF_IMAGES`; sem ela, a medição usa só as fotos do fixture.
//!
//! ```sh
//! curl -sS 'https://api.yanlucas.com/images?limit=1000' -o /tmp/images.json
//! DECKLIVE_PERF_IMAGES=/tmp/images.json \
//!   cargo test --release --test playlist_perf -- --ignored --nocapture
//! ```

mod common;

use std::hint::black_box;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::*;
use decklive::info::Info;
use decklive::model::{Crops, Point, Rect};
use decklive::source::SourceDoc;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

const PHOTOS: usize = 1000;
const RUNS: usize = 2000;

/// Fotos reais da origem (só descrição e local interessam aqui).
fn source_docs() -> Vec<SourceDoc> {
    let (label, text) = match std::env::var("DECKLIVE_PERF_IMAGES") {
        Ok(path) => {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("não deu para ler {path}: {e}"));
            (path, text)
        }
        Err(_) => {
            println!(
                "AVISO: sem DECKLIVE_PERF_IMAGES, usando só as fotos do fixture; \
                 os números não valem para o README"
            );
            ("fixture".into(), PAGE.to_string())
        }
    };
    let page: Value = serde_json::from_str(&text).expect("JSON de GET /images");
    let docs: Vec<SourceDoc> = page["images"]
        .as_array()
        .expect("campo images")
        .iter()
        .filter_map(|d| serde_json::from_value(d.clone()).ok())
        .collect();
    assert!(!docs.is_empty(), "nenhuma foto em {label}");
    let described = docs
        .iter()
        .filter(|d| {
            d.description
                .as_deref()
                .is_some_and(|t| !t.trim().is_empty())
        })
        .count();
    println!(
        "origem: {label}, {} fotos, {described} com descrição",
        docs.len()
    );
    docs
}

fn percentile(sorted: &[Duration], p: f64) -> Duration {
    let i = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[i]
}

fn report(label: &str, mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    let (p50, p95, p99) = (
        percentile(&samples, 0.50),
        percentile(&samples, 0.95),
        percentile(&samples, 0.99),
    );
    println!(
        "{label}: p50 {p50:?}  p95 {p95:?}  p99 {p99:?}  ({} pedidos)",
        samples.len()
    );
    p95
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "medição de desempenho; rode com --release"]
async fn playlist_p95_with_1000_photos() {
    let t = TestApp::new().await;
    let docs = source_docs();
    // fotos variadas: tamanhos, orientações, ponto e regiões
    let mut seed: u64 = 42;
    let mut next = move || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (seed >> 33) as f64 / (1u64 << 31) as f64
    };
    for i in 0..PHOTOS {
        let (w, h) = if i % 3 == 0 {
            (1839, 2944)
        } else {
            (2944 + (i as u32 % 400), 1839)
        };
        let region = Rect {
            x: next() * 0.5,
            y: next() * 0.5,
            w: 0.1 + next() * 0.4,
            h: 0.1 + next() * 0.4,
        };
        let crops = match i % 4 {
            0 => Crops::default(),
            1 => Crops {
                landscape: Some(region),
                portrait: None,
            },
            2 => Crops {
                landscape: None,
                portrait: Some(region),
            },
            _ => Crops {
                landscape: Some(region),
                portrait: Some(region),
            },
        };
        let mut m = synthetic(&format!("{i:024x}"), w, h, crops);
        m.focus = Point {
            x: next(),
            y: next(),
        };
        // descrição e local reais, repetindo as fotos da origem até completar 1.000
        let doc = &docs[i % docs.len()];
        m.description = doc
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(String::from);
        m.city = doc.city.clone();
        m.state = doc.state.clone();
        m.country = doc.country.clone();
        t.repo.upsert(&m).await.unwrap();
    }

    // textos prontos: calculados uma vez por versão, na troca do snapshot
    let state = t.repo.load().await.unwrap();
    let started = Instant::now();
    let infos: Vec<Info> = state.media.iter().map(Info::of).collect();
    let elapsed = started.elapsed();
    black_box(&infos);
    println!(
        "textos de {} fotos: {elapsed:?} ({} com local, {} com título, {} com resumo)",
        infos.len(),
        infos.iter().filter(|i| i.place.is_some()).count(),
        infos.iter().filter(|i| i.title.is_some()).count(),
        infos.iter().filter(|i| i.text.is_some()).count(),
    );
    let started = Instant::now();
    t.state.catalog().reload(&t.repo).await.unwrap();
    println!(
        "troca do snapshot (leitura do banco + textos): {:?}",
        started.elapsed()
    );

    let uri = "/api/playlist?w=1920&h=1080";
    let request = |encoding: &'static str| {
        Request::get(uri)
            .header("accept-encoding", encoding)
            .body(Body::empty())
            .unwrap()
    };

    // primeiro pedido de cada codificação: calcula e comprime
    for encoding in ["identity", "gzip", "br"] {
        let started = Instant::now();
        let response = t.app.clone().oneshot(request(encoding)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        println!(
            "primeiro pedido ({encoding}): {:?}, {} bytes",
            started.elapsed(),
            bytes.len()
        );
        if encoding == "identity" {
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            let items = body["items"].as_array().unwrap();
            assert_eq!(items.len(), PHOTOS);
            for key in ["place", "title", "text"] {
                assert!(items.iter().all(|i| i.get(key).is_some()), "falta {key}");
            }
            let text_chars: usize = items
                .iter()
                .filter_map(|i| i["text"].as_str())
                .map(|t| t.chars().count())
                .sum();
            println!(
                "por item: {} bytes em média; resumos somam {text_chars} caracteres",
                bytes.len() / items.len()
            );
        }
    }

    // pedidos memorizados, no processo (rota + middlewares, sem rede)
    let mut p95 = Duration::ZERO;
    for encoding in ["identity", "gzip", "br"] {
        let mut samples = Vec::with_capacity(RUNS);
        for _ in 0..RUNS {
            let started = Instant::now();
            let response = t.app.clone().oneshot(request(encoding)).await.unwrap();
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            samples.push(started.elapsed());
            assert!(!bytes.is_empty());
        }
        p95 = p95.max(report(&format!("memorizada ({encoding})"), samples));
    }

    // os mesmos pedidos por TCP local (servidor axum de verdade)
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = t.app.clone();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let url = format!("http://{addr}{uri}");
    let mut samples = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let started = Instant::now();
        let response = client
            .get(&url)
            .header("accept-encoding", "br")
            .send()
            .await
            .unwrap();
        let bytes = response.bytes().await.unwrap();
        samples.push(started.elapsed());
        assert!(!bytes.is_empty());
    }
    report("memorizada por TCP local (br)", samples);

    assert!(p95 < Duration::from_millis(1), "p95 {p95:?} passou de 1 ms");
}
