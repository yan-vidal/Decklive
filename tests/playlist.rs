//! Cenários de `GET /api/playlist` (spec playlist).

mod common;

use std::io::Read;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::*;
use decklive::bucket::Bucket;
use decklive::catalog::Boot;
use decklive::model::{Crops, Rect};
use serde_json::{Value, json};

const CACHE: &str = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

/// Instante de início fixo dos testes que conferem o `ETag` exato.
fn boot_at(millis: u64) -> Boot {
    Boot::at(UNIX_EPOCH + Duration::from_millis(millis))
}

async fn with_photos() -> TestApp {
    with_photos_booted(Boot::now()).await
}

async fn with_photos_booted(boot: Boot) -> TestApp {
    let t = TestApp::with_boot(boot).await;
    t.insert(synthetic(
        "aaaaaaaaaaaaaaaaaaaaaaaa",
        2944,
        1839,
        Crops::default(),
    ))
    .await;
    t.insert(synthetic(
        "bbbbbbbbbbbbbbbbbbbbbbbb",
        1839,
        2944,
        Crops {
            landscape: None,
            portrait: Some(Rect {
                x: 0.1,
                y: 0.2,
                w: 0.5,
                h: 0.5,
            }),
        },
    ))
    .await;
    t.insert(synthetic(
        "cccccccccccccccccccccccc",
        6000,
        4000,
        Crops::default(),
    ))
    .await;
    t
}

fn items(reply: &Reply) -> Vec<Value> {
    reply.json()["items"].as_array().unwrap().clone()
}

// --- Rota pública da playlist ---

#[tokio::test]
async fn request_from_a_screen_without_token() {
    let t = with_photos().await;
    let reply = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("content-type"), Some("application/json"));
    assert_eq!(items(&reply).len(), 3);
}

#[tokio::test]
async fn empty_catalog_gives_empty_items() {
    let t = TestApp::new().await;
    let reply = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json(), json!({ "items": [] }));
}

#[tokio::test]
async fn missing_or_invalid_parameters_are_400() {
    let t = with_photos().await;
    for uri in [
        "/api/playlist",
        "/api/playlist?w=1920",
        "/api/playlist?h=1080",
        "/api/playlist?w=0&h=1080",
        "/api/playlist?w=16385&h=1080",
        "/api/playlist?w=abc&h=1080",
        "/api/playlist?w=-1920&h=1080",
        "/api/playlist?w=1920.5&h=1080",
        "/api/playlist?w=1920&h=",
    ] {
        let reply = t.get(uri).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(reply.json()["error"], "bad_request");
    }
}

// --- Faixas de tela canônicas ---

#[tokio::test]
async fn canonical_screen_is_answered_directly() {
    let t = with_photos().await;
    assert_eq!(
        t.get("/api/playlist?w=1920&h=1080").await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn phone_size_is_redirected_to_its_bucket() {
    let t = with_photos().await;
    let reply = t.get("/api/playlist?w=1170&h=2532").await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(
        reply.header("location"),
        Some("/api/playlist?w=1182&h=2560")
    );
    assert_eq!(
        t.get("/api/playlist?w=1182&h=2560").await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn screen_above_4k_is_redirected() {
    let t = with_photos().await;
    let reply = t.get("/api/playlist?w=5120&h=2880").await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(
        reply.header("location"),
        Some("/api/playlist?w=3840&h=2160")
    );
}

#[tokio::test]
async fn non_canonical_query_form_is_redirected() {
    let t = with_photos().await;
    for uri in [
        "/api/playlist?h=1080&w=1920",
        "/api/playlist?w=01920&h=1080",
        "/api/playlist?w=1920&h=1080&t=1",
    ] {
        let reply = t.get(uri).await;
        assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT, "{uri}");
        assert_eq!(
            reply.header("location"),
            Some("/api/playlist?w=1920&h=1080")
        );
    }
}

// --- Item da playlist ---

#[tokio::test]
async fn item_format_for_16_9() {
    let t = with_photos().await;
    let reply = t.get("/api/playlist?w=1920&h=1080").await;
    for item in items(&reply) {
        let keys: Vec<&String> = item.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "color",
                "crop",
                "height",
                "id",
                "orientation",
                "place",
                "src",
                "text",
                "title",
                "width"
            ],
            "{item}"
        );
        assert!(
            item["src"]
                .as_str()
                .unwrap()
                .starts_with("https://cdn.yanlucas.com/")
        );
        assert!(item["color"].as_str().unwrap().starts_with('#'));
        for k in ["x", "y", "w", "h"] {
            let v = item["crop"][k].as_f64().unwrap();
            assert!((0.0..=1.0).contains(&v));
        }
    }
    let all = items(&reply);
    assert_eq!(all[0]["orientation"], "landscape");
    assert_eq!(all[1]["orientation"], "portrait");
}

// --- Local, título e resumo prontos para exibir ---

#[tokio::test]
async fn item_has_place_title_and_text() {
    let t = TestApp::new().await;
    let mut described = synthetic("aaaaaaaaaaaaaaaaaaaaaaaa", 2944, 1839, Crops::default());
    described.description = Some(
        "Catavento Museum: housed in the historic Palace of Industries building, is \
         dedicated to interactive science. It opened in 2009."
            .into(),
    );
    described.city = Some("São Paulo".into());
    described.state = Some("São Paulo".into());
    described.country = Some("Brazil".into());
    t.insert(described).await;
    let mut bare = synthetic("bbbbbbbbbbbbbbbbbbbbbbbb", 2944, 1839, Crops::default());
    bare.description = None;
    t.insert(bare).await;
    let mut only_country = synthetic("cccccccccccccccccccccccc", 2944, 1839, Crops::default());
    only_country.description = Some("A quiet street at night. Lanterns everywhere.".into());
    only_country.country = Some("Japan".into());
    t.insert(only_country).await;

    for uri in ["/api/playlist?w=1920&h=1080", "/api/playlist?w=1182&h=2560"] {
        let all = items(&t.get(uri).await);
        assert_eq!(all[0]["place"], "São Paulo, Brazil");
        assert_eq!(all[0]["title"], "Catavento Museum");
        assert_eq!(
            all[0]["text"],
            "Housed in the historic Palace of Industries building, is dedicated to \
             interactive science."
        );
        // sem descrição nem local: os três campos vêm, nulos
        for key in ["place", "title", "text"] {
            assert_eq!(all[1].get(key), Some(&Value::Null), "{key}");
        }
        assert_eq!(all[2]["place"], "Japan");
        assert_eq!(all[2]["title"], Value::Null);
        assert_eq!(all[2]["text"], "A quiet street at night.");
        // nem a descrição inteira nem o local separado vão na playlist
        for key in ["description", "city", "state", "country"] {
            assert!(all[0].get(key).is_none(), "{key}");
        }
    }
}

#[tokio::test]
async fn memoized_playlist_is_reused_between_requests() {
    let t = TestApp::new().await;
    let mut m = synthetic("aaaaaaaaaaaaaaaaaaaaaaaa", 2944, 1839, Crops::default());
    m.description = Some("Sunset Dune: This natural formation is part of the dune system.".into());
    m.country = Some("Brazil".into());
    t.insert(m).await;
    let tv = Bucket { w: 1920, h: 1080 };

    let first = t.get("/api/playlist?w=1920&h=1080").await;
    let snapshot = t.state.catalog().snapshot();
    let rendered = snapshot.playlist(tv, None);
    let second = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(first.body, second.body);
    assert_eq!(items(&second)[0]["title"], "Sunset Dune");
    // o mesmo snapshot e a mesma resposta já serializada servem os dois pedidos
    assert!(Arc::ptr_eq(&snapshot, &t.state.catalog().snapshot()));
    assert!(Arc::ptr_eq(
        &rendered,
        &t.state.catalog().snapshot().playlist(tv, None)
    ));
}

// --- Arquivo mais leve que fica nítido ---

#[tokio::test]
async fn file_choice_depends_on_the_screen() {
    let t = with_photos().await;
    // 6000×4000: o otimizado (2000×1333) basta para 1920×1080
    let tv = items(&t.get("/api/playlist?w=1920&h=1080").await);
    assert_eq!(
        tv[2]["src"],
        "https://cdn.yanlucas.com/cccccccccccccccccccccccc-optimized.jpeg"
    );
    assert_eq!(
        (tv[2]["width"].as_u64(), tv[2]["height"].as_u64()),
        (Some(2000), Some(1333))
    );
    // 2944×1839: o otimizado (981×613) não chega a 90 % de 1920×1080
    assert_eq!(
        tv[0]["src"],
        "https://cdn.yanlucas.com/aaaaaaaaaaaaaaaaaaaaaaaa.jpeg"
    );
    // em 4K, nenhum alcança: vai o maior
    let uhd = items(&t.get("/api/playlist?w=3840&h=2160").await);
    assert_eq!(
        uhd[2]["src"],
        "https://cdn.yanlucas.com/cccccccccccccccccccccccc.jpeg"
    );
}

// --- Corte calculado para a proporção da tela ---

#[tokio::test]
async fn crop_has_screen_aspect_and_uses_portrait_region() {
    let t = with_photos().await;
    let phone = items(&t.get("/api/playlist?w=1182&h=2560").await);
    let aspect = 1182.0 / 2560.0;
    for (item, (iw, ih)) in phone
        .iter()
        .zip([(2944.0, 1839.0), (1839.0, 2944.0), (6000.0, 4000.0)])
    {
        let c = &item["crop"];
        let ratio = c["w"].as_f64().unwrap() * iw / (c["h"].as_f64().unwrap() * ih);
        assert!((ratio / aspect - 1.0).abs() < 0.005, "{item}");
    }
    // região de retrato da foto b: x 0.1..0.6, y 0.2..0.7
    let c = &phone[1]["crop"];
    let (x, y, w, h) = (
        c["x"].as_f64().unwrap(),
        c["y"].as_f64().unwrap(),
        c["w"].as_f64().unwrap(),
        c["h"].as_f64().unwrap(),
    );
    assert!(
        x <= 0.1 && x + w >= 0.6 - 1e-6 && y <= 0.2 && y + h >= 0.7 - 1e-6,
        "{c}"
    );
}

// --- Ordem estável ---

#[tokio::test]
async fn repeated_requests_have_the_same_body() {
    let t = with_photos().await;
    let a = t.get("/api/playlist?w=1920&h=1080").await;
    let b = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(a.body, b.body);
    let ids: Vec<String> = items(&a)
        .iter()
        .map(|i| i["id"].as_str().unwrap().into())
        .collect();
    assert_eq!(
        ids,
        [
            "aaaaaaaaaaaaaaaaaaaaaaaa",
            "bbbbbbbbbbbbbbbbbbbbbbbb",
            "cccccccccccccccccccccccc"
        ]
    );
}

// --- Cache e versão ---

#[tokio::test]
async fn cache_headers_and_etag() {
    // 1.790.000.000.000 ms desde a época Unix = "mubbs7i8" em base 36
    let t = with_photos_booted(boot_at(1_790_000_000_000)).await;
    let reply = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(reply.header("cache-control"), Some(CACHE));
    let revision = t.repo.revision().await.unwrap();
    assert_eq!(
        reply.header("etag"),
        Some(format!("\"r{revision}-1920x1080-en-mubbs7i8\"").as_str())
    );
}

#[tokio::test]
async fn restart_changes_the_etag_for_the_same_catalog() {
    let first = with_photos_booted(boot_at(1_790_000_000_000)).await;
    // mesmo banco, processo iniciado 30 s depois (um novo deploy)
    let second = first.restart(boot_at(1_790_000_030_000)).await;

    let before = first.get("/api/playlist?w=1920&h=1080").await;
    let after = second.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(before.body, after.body, "mesmo catálogo, mesmo corpo");
    let old = before.header("etag").unwrap();
    let new = after.header("etag").unwrap();
    assert_ne!(old, new);
    let revision = first.repo.revision().await.unwrap();
    assert!(old.starts_with(&format!("\"r{revision}-1920x1080-en-")));
    assert!(new.starts_with(&format!("\"r{revision}-1920x1080-en-")));

    // o ETag guardado antes do reinício não vale mais: resposta completa
    let reply = second
        .send(
            Request::get("/api/playlist?w=1920&h=1080")
                .header("if-none-match", old)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("etag"), Some(new));
}

#[tokio::test]
async fn client_with_current_version_gets_304() {
    let t = with_photos().await;
    let first = t.get("/api/playlist?w=1920&h=1080").await;
    let etag = first.header("etag").unwrap().to_string();
    for value in [etag.clone(), format!("W/{etag}")] {
        let reply = t
            .send(
                Request::get("/api/playlist?w=1920&h=1080")
                    .header("if-none-match", value)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        assert_eq!(reply.status, StatusCode::NOT_MODIFIED);
        assert!(reply.body.is_empty());
        assert_eq!(reply.header("etag"), Some(etag.as_str()));
        assert_eq!(reply.header("cache-control"), Some(CACHE));
    }
}

#[tokio::test]
async fn catalog_change_gives_200_with_new_etag() {
    let t = with_photos().await;
    let first = t.get("/api/playlist?w=1920&h=1080").await;
    let etag = first.header("etag").unwrap().to_string();

    // registro pela API (origem simulada)
    t.source_up().await;
    assert_eq!(
        t.register(json!({ "id": WITH_V1 })).await.status,
        StatusCode::CREATED
    );
    let request = || {
        Request::get("/api/playlist?w=1920&h=1080")
            .header("if-none-match", etag.as_str())
            .body(Body::empty())
            .unwrap()
    };
    let after_register = t.send(request()).await;
    assert_eq!(after_register.status, StatusCode::OK);
    assert_ne!(after_register.header("etag"), Some(etag.as_str()));
    assert_eq!(items(&after_register).len(), 4);

    // remoção pela API
    let etag2 = after_register.header("etag").unwrap().to_string();
    t.admin(
        axum::http::Method::DELETE,
        "/api/media",
        Some(json!({ "ids": [WITH_V1] })),
    )
    .await;
    let after_remove = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(after_remove.status, StatusCode::OK);
    assert_ne!(after_remove.header("etag"), Some(etag2.as_str()));
    assert_eq!(items(&after_remove).len(), 3);
}

// --- Idioma da playlist ---

const SUNSET: &str = "Sunset Dune: This natural formation is part of the dynamic dune system \
    along the northeastern coast of Brazil. Constantly shaped by the wind…";
const SUNSET_PT: &str = "Duna do Pôr do Sol: Esta formação natural faz parte do sistema \
    dinâmico de dunas da costa nordeste do Brasil. Moldada constantemente pelo vento…";

/// Uma foto de "Osaka, Japan" com a descrição da duna, e as traduções dadas em pt-BR.
async fn translated(pairs: &[(&str, &str)]) -> TestApp {
    let t = TestApp::with_boot(boot_at(1_790_000_000_000)).await;
    let mut m = synthetic("aaaaaaaaaaaaaaaaaaaaaaaa", 2944, 1839, Crops::default());
    m.description = Some(SUNSET.into());
    m.city = Some("Osaka".into());
    m.state = Some("Osaka".into());
    m.country = Some("Japan".into());
    t.insert(m).await;
    if !pairs.is_empty() {
        let items: Vec<Value> = pairs
            .iter()
            .map(|(s, t)| json!({"source": s, "text": t}))
            .collect();
        let reply = t
            .admin(
                axum::http::Method::PUT,
                "/api/translations/pt-BR",
                Some(json!({ "items": items })),
            )
            .await;
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.json());
    }
    t
}

#[tokio::test]
async fn existing_translation() {
    let t = translated(&[(SUNSET, SUNSET_PT)]).await;
    let reply = t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await;
    assert_eq!(reply.status, StatusCode::OK);
    let item = &items(&reply)[0];
    assert_eq!(item["title"], "Duna do Pôr do Sol");
    assert!(
        item["text"]
            .as_str()
            .unwrap()
            .starts_with("Esta formação natural"),
        "{item}"
    );
    // Japan sem tradução: o local fica em inglês
    assert_eq!(item["place"], "Osaka, Japan");

    // sem lang, o inglês da origem
    let en = &items(&t.get("/api/playlist?w=1920&h=1080").await)[0];
    assert_eq!(en["title"], "Sunset Dune");
    assert_eq!(en["src"], item["src"]);
}

#[tokio::test]
async fn partial_translation() {
    let t = translated(&[("Japan", "Japão")]).await;
    let item = &items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await)[0];
    assert_eq!(item["place"], "Osaka, Japão");
    assert_eq!(item["title"], "Sunset Dune");
}

#[tokio::test]
async fn same_language_other_region() {
    let t = translated(&[("Japan", "Japão")]).await;
    for (uri, location) in [
        (
            "/api/playlist?w=1920&h=1080&lang=pt-PT",
            "/api/playlist?w=1920&h=1080&lang=pt-BR",
        ),
        (
            "/api/playlist?w=1920&h=1080&lang=pt",
            "/api/playlist?w=1920&h=1080&lang=pt-BR",
        ),
        // mesma etiqueta, outra caixa
        (
            "/api/playlist?w=1920&h=1080&lang=pt-br",
            "/api/playlist?w=1920&h=1080&lang=pt-BR",
        ),
        // ordem dos parâmetros
        (
            "/api/playlist?lang=pt-BR&w=1920&h=1080",
            "/api/playlist?w=1920&h=1080&lang=pt-BR",
        ),
    ] {
        let reply = t.get(uri).await;
        assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT, "{uri}");
        assert_eq!(reply.header("location"), Some(location), "{uri}");
    }
}

#[tokio::test]
async fn language_without_translation() {
    let t = translated(&[("Japan", "Japão")]).await;
    let reply = t.get("/api/playlist?w=1920&h=1080&lang=fr").await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(
        reply.header("location"),
        Some("/api/playlist?w=1920&h=1080")
    );
    // sem nenhuma tradução no banco, pt-BR também vai para o inglês
    let empty = translated(&[]).await;
    let reply = empty.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(
        reply.header("location"),
        Some("/api/playlist?w=1920&h=1080")
    );
}

#[tokio::test]
async fn english_requested() {
    let t = translated(&[("Japan", "Japão")]).await;
    for lang in ["en", "EN", "en-US"] {
        let reply = t
            .get(&format!("/api/playlist?w=1920&h=1080&lang={lang}"))
            .await;
        assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT, "{lang}");
        assert_eq!(
            reply.header("location"),
            Some("/api/playlist?w=1920&h=1080"),
            "{lang}"
        );
    }
}

#[tokio::test]
async fn screen_and_language_are_canonized_in_one_redirect() {
    let t = translated(&[("Japan", "Japão")]).await;
    let reply = t.get("/api/playlist?w=1170&h=2532&lang=pt-PT").await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    let location = reply.header("location").unwrap();
    assert_eq!(location, "/api/playlist?w=1182&h=2560&lang=pt-BR");
    assert_eq!(t.get(location).await.status, StatusCode::OK);

    let reply = t.get("/api/playlist?w=1170&h=2532&lang=en").await;
    assert_eq!(
        reply.header("location"),
        Some("/api/playlist?w=1182&h=2560")
    );
    // o redirecionamento por idioma depende das traduções: cache curto
    assert_eq!(reply.header("cache-control"), Some(CACHE));
    // só a faixa: o redirecionamento continua com cache longo
    let reply = t.get("/api/playlist?w=1170&h=2532").await;
    assert_eq!(reply.header("cache-control"), Some("public, max-age=86400"));
}

#[tokio::test]
async fn invalid_language_is_400() {
    let t = translated(&[("Japan", "Japão")]).await;
    for lang in ["", "pt_BR", "português", "p", "pt-BR-x-y", "pt%2DBR", "*"] {
        let uri = format!("/api/playlist?w=1920&h=1080&lang={lang}");
        let reply = t.get(&uri).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(reply.json()["error"], "bad_request");
    }
    // a faixa inválida continua dando 400 antes do idioma
    let reply = t.get("/api/playlist?w=0&h=1080&lang=pt-BR").await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn etag_and_memo_are_per_language() {
    let t = translated(&[("Japan", "Japão")]).await;
    let revision = t.repo.revision().await.unwrap();
    let pt = t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await;
    let en = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(
        pt.header("etag"),
        Some(format!("\"r{revision}-1920x1080-pt-BR-mubbs7i8\"").as_str())
    );
    assert_eq!(
        en.header("etag"),
        Some(format!("\"r{revision}-1920x1080-en-mubbs7i8\"").as_str())
    );
    assert_eq!(pt.header("cache-control"), Some(CACHE));
    assert_ne!(pt.body, en.body);

    // memorizada por (versão, faixa, idioma)
    let tv = Bucket { w: 1920, h: 1080 };
    let snapshot = t.state.catalog().snapshot();
    let rendered = snapshot.playlist(tv, Some("pt-BR"));
    let again = t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await;
    assert_eq!(again.body, pt.body);
    assert!(Arc::ptr_eq(
        &rendered,
        &t.state.catalog().snapshot().playlist(tv, Some("pt-BR"))
    ));
    assert!(!Arc::ptr_eq(&rendered, &snapshot.playlist(tv, None)));

    // 304 com o ETag do idioma; o do inglês não vale para pt-BR
    let conditional = |etag: &str| {
        Request::get("/api/playlist?w=1920&h=1080&lang=pt-BR")
            .header("if-none-match", etag)
            .body(Body::empty())
            .unwrap()
    };
    let etag = pt.header("etag").unwrap();
    assert_eq!(
        t.send(conditional(etag)).await.status,
        StatusCode::NOT_MODIFIED
    );
    let en_etag = en.header("etag").unwrap();
    assert_eq!(t.send(conditional(en_etag)).await.status, StatusCode::OK);
}

#[tokio::test]
async fn new_translation_gives_200_with_new_etag() {
    let t = translated(&[("Japan", "Japão")]).await;
    let first = t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await;
    let etag = first.header("etag").unwrap().to_string();

    let reply = t
        .admin(
            axum::http::Method::PUT,
            "/api/translations/pt-BR",
            Some(json!({"items": [{"source": SUNSET, "text": SUNSET_PT}]})),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    let reply = t
        .send(
            Request::get("/api/playlist?w=1920&h=1080&lang=pt-BR")
                .header("if-none-match", etag.as_str())
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_ne!(reply.header("etag"), Some(etag.as_str()));
    assert_eq!(items(&reply)[0]["title"], "Duna do Pôr do Sol");

    // remover também muda a versão
    let etag = reply.header("etag").unwrap().to_string();
    t.admin(
        axum::http::Method::DELETE,
        "/api/translations/pt-BR",
        Some(json!({"sources": [SUNSET]})),
    )
    .await;
    let reply = t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_ne!(reply.header("etag"), Some(etag.as_str()));
    assert_eq!(items(&reply)[0]["title"], "Sunset Dune");
}

// --- CORS e compressão ---

#[tokio::test]
async fn cors_from_any_origin() {
    let t = with_photos().await;
    let reply = t
        .send(
            Request::get("/api/playlist?w=1920&h=1080")
                .header("origin", "https://tv.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("access-control-allow-origin"), Some("*"));
    assert!(
        reply
            .header("access-control-expose-headers")
            .unwrap()
            .contains("etag")
    );

    let preflight = t
        .send(
            Request::options("/api/playlist?w=1920&h=1080")
                .header("origin", "https://tv.example")
                .header("access-control-request-method", "GET")
                .header("access-control-request-headers", "if-none-match")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert!(preflight.status.is_success());
    assert_eq!(preflight.header("access-control-allow-origin"), Some("*"));
    assert!(
        preflight
            .header("access-control-allow-headers")
            .unwrap()
            .contains("if-none-match")
    );

    // o redirecionamento também leva CORS
    let redirect = t
        .send(
            Request::get("/api/playlist?w=1170&h=2532")
                .header("origin", "https://tv.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(redirect.header("access-control-allow-origin"), Some("*"));

    // as rotas de catálogo não têm CORS
    let media = t
        .send(
            Request::get("/api/media")
                .header("origin", "https://tv.example")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(media.header("access-control-allow-origin"), None);
}

#[tokio::test]
async fn compressed_responses_match_the_plain_body() {
    let t = TestApp::new().await;
    for i in 0..20 {
        t.insert(synthetic(
            &format!("{i:024x}"),
            3000,
            2000,
            Crops::default(),
        ))
        .await;
    }
    let plain = t.get("/api/playlist?w=1920&h=1080").await;
    assert_eq!(plain.header("content-encoding"), None);
    assert_eq!(plain.header("vary"), Some("Accept-Encoding"));

    let get = |enc: &'static str| {
        Request::get("/api/playlist?w=1920&h=1080")
            .header("accept-encoding", enc)
            .body(Body::empty())
            .unwrap()
    };
    let br = t.send(get("gzip, deflate, br")).await;
    assert_eq!(br.header("content-encoding"), Some("br"));
    let mut out = Vec::new();
    brotli::Decompressor::new(&br.body[..], 4096)
        .read_to_end(&mut out)
        .unwrap();
    assert_eq!(out, plain.body);

    let gz = t.send(get("gzip")).await;
    assert_eq!(gz.header("content-encoding"), Some("gzip"));
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(&gz.body[..])
        .read_to_end(&mut out)
        .unwrap();
    assert_eq!(out, plain.body);
    assert!(gz.body.len() < plain.body.len() / 3);
}

#[tokio::test]
async fn unknown_api_route_is_json_404() {
    let t = TestApp::new().await;
    let reply = t.get("/api/nada").await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.json()["error"], "not_found");
}
