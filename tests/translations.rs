//! Cenários de `/api/translations/{lang}` (spec media-catalog de
//! `add-localized-descriptions`).

mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use common::*;
use decklive::model::{Crops, NewMedia};
use serde_json::{Value, json};

const PT: &str = "/api/translations/pt-BR";

/// Foto sintética com descrição e local.
fn placed(id: &str, description: Option<&str>, place: [Option<&str>; 3]) -> NewMedia {
    let [city, state, country] = place.map(|p| p.map(String::from));
    NewMedia {
        description: description.map(String::from),
        city,
        state,
        country,
        ..synthetic(id, 2944, 1839, Crops::default())
    }
}

/// Duas fotos de "Osaka, Japan" e uma só de "Japan".
async fn osaka_catalog() -> TestApp {
    let t = TestApp::new().await;
    let osaka = [Some("Osaka"), Some("Osaka"), Some("Japan")];
    t.insert(placed(
        "000000000000000000000001",
        Some("Castle: Old."),
        osaka,
    ))
    .await;
    t.insert(placed(
        "000000000000000000000002",
        Some("Castle: Old."),
        osaka,
    ))
    .await;
    t.insert(placed(
        "000000000000000000000003",
        None,
        [None, None, Some("Japan")],
    ))
    .await;
    t
}

fn items(source_text: &[(&str, &str)]) -> Value {
    let items: Vec<Value> = source_text
        .iter()
        .map(|(s, t)| json!({"source": s, "text": t}))
        .collect();
    json!({ "items": items })
}

async fn save(t: &TestApp, uri: &str, pairs: &[(&str, &str)]) -> Reply {
    t.admin(Method::PUT, uri, Some(items(pairs))).await
}

/// Pares `(source, text)` gravados no idioma, lidos pela rota.
async fn saved(t: &TestApp, uri: &str) -> Vec<(String, String)> {
    let reply = t.admin(Method::GET, uri, None).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json());
    reply.json()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            (
                i["source"].as_str().unwrap().to_string(),
                i["text"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn playlist_items(reply: &Reply) -> Vec<Value> {
    assert_eq!(reply.status, StatusCode::OK);
    reply.json()["items"].as_array().unwrap().clone()
}

/// Descrição de uma foto do fixture, como o registro a grava.
fn source_description(id: &str) -> String {
    let page: Value = serde_json::from_str(PAGE).unwrap();
    page["images"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["_id"] == id)
        .and_then(|i| i["description"].as_str())
        .unwrap()
        .trim()
        .to_string()
}

// --- Gravação de traduções ---

#[tokio::test]
async fn batch_save() {
    let t = osaka_catalog().await;
    let before = t.repo.revision().await.unwrap();
    let reply = save(
        &t,
        "/api/translations/pt-br",
        &[("Japan", "Japão"), ("Castle: Old.", "Castelo: Antigo.")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json());
    assert_eq!(reply.json(), json!({"lang": "pt-BR", "saved": 2}));
    assert_eq!(t.repo.revision().await.unwrap(), before + 1);
    // o catálogo na memória já tem o idioma
    assert_eq!(t.state.catalog().snapshot().langs(), ["pt-BR"]);

    let list = t.admin(Method::GET, PT, None).await;
    assert_eq!(list.status, StatusCode::OK);
    let body = list.json();
    assert_eq!(body["lang"], "pt-BR");
    assert_eq!(body["total"], 2);
    let first = &body["items"][0];
    assert_eq!(first["source"], "Castle: Old.");
    assert_eq!(first["text"], "Castelo: Antigo.");
    assert!(first["updated_at"].as_str().unwrap().ends_with('Z'));
    assert_eq!(body["items"][1]["source"], "Japan");
}

#[tokio::test]
async fn save_replaces_trims_and_keeps_the_last_repeated_source() {
    let t = osaka_catalog().await;
    save(&t, PT, &[("Japan", "Japao")]).await;
    let reply = save(
        &t,
        PT,
        &[
            (" Japan ", " Japão "),
            ("Osaka", "Ósaka"),
            ("Osaka", "Osaka"),
        ],
    )
    .await;
    assert_eq!(reply.json(), json!({"lang": "pt-BR", "saved": 2}));
    assert_eq!(
        saved(&t, PT).await,
        [
            ("Japan".to_string(), "Japão".to_string()),
            ("Osaka".to_string(), "Osaka".to_string())
        ]
    );
}

#[tokio::test]
async fn source_language_is_refused() {
    let t = osaka_catalog().await;
    let before = t.repo.revision().await.unwrap();
    for lang in ["en", "EN", "en-US"] {
        let reply = save(
            &t,
            &format!("/api/translations/{lang}"),
            &[("Japan", "Japan")],
        )
        .await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{lang}");
        assert_eq!(reply.json()["field"], "lang");
        for method in [Method::GET, Method::DELETE] {
            let body = (method == Method::DELETE).then(|| json!({"sources": ["Japan"]}));
            let reply = t
                .admin(method.clone(), &format!("/api/translations/{lang}"), body)
                .await;
            assert_eq!(
                reply.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{method} {lang}"
            );
        }
    }
    assert_eq!(t.repo.revision().await.unwrap(), before);
    assert!(t.repo.load().await.unwrap().translations.is_empty());
}

#[tokio::test]
async fn invalid_requests_are_refused_and_nothing_is_saved() {
    let t = osaka_catalog().await;
    let before = t.repo.revision().await.unwrap();
    let cases: Vec<(&str, Value, &str)> = vec![
        (
            "/api/translations/pt_BR",
            items(&[("Japan", "Japão")]),
            "lang",
        ),
        (
            "/api/translations/portuguese",
            items(&[("Japan", "Japão")]),
            "lang",
        ),
        (PT, json!({"items": []}), "items"),
        (
            PT,
            items(&[("Japan", "Japão"), ("  ", "x")]),
            "items[1].source",
        ),
        (
            PT,
            items(&[("Japan", "Japão"), ("Osaka", " ")]),
            "items[1].text",
        ),
    ];
    for (uri, body, field) in cases {
        let reply = t.admin(Method::PUT, uri, Some(body.clone())).await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{uri} {body}"
        );
        assert_eq!(reply.json()["field"], field, "{uri} {body}");
    }

    // mais de 2.000 itens
    let many: Vec<(String, String)> = (0..2001)
        .map(|i| (format!("Text {i}"), format!("Texto {i}")))
        .collect();
    let many: Vec<(&str, &str)> = many.iter().map(|(s, t)| (s.as_str(), t.as_str())).collect();
    let reply = save(&t, PT, &many).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json()["field"], "items");

    // campo desconhecido e JSON malformado
    let reply = t
        .admin(
            Method::PUT,
            PT,
            Some(json!({"items": [{"source": "Japan", "txt": "Japão"}]})),
        )
        .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    let reply = t
        .send(
            Request::put(PT)
                .header("authorization", format!("Bearer {TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from("{\"items\": ["))
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);

    assert_eq!(t.repo.revision().await.unwrap(), before);
    assert!(t.repo.load().await.unwrap().translations.is_empty());
}

#[tokio::test]
async fn body_over_2_mb_is_413() {
    let t = osaka_catalog().await;
    let long = "x".repeat(1100);
    let many: Vec<(String, String)> = (0..2000)
        .map(|i| (format!("Text {i}"), long.clone()))
        .collect();
    let many: Vec<(&str, &str)> = many.iter().map(|(s, t)| (s.as_str(), t.as_str())).collect();
    let reply = save(&t, PT, &many).await;
    assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(t.repo.load().await.unwrap().translations.is_empty());

    // 2.000 itens dentro do limite passam
    let short: Vec<(String, String)> = (0..2000)
        .map(|i| (format!("Text {i}"), format!("Texto {i}")))
        .collect();
    let short: Vec<(&str, &str)> = short
        .iter()
        .map(|(s, t)| (s.as_str(), t.as_str()))
        .collect();
    let reply = save(&t, PT, &short).await;
    assert_eq!(reply.json(), json!({"lang": "pt-BR", "saved": 2000}));
}

// --- Consulta e remoção ---

#[tokio::test]
async fn missing_texts() {
    let t = osaka_catalog().await;
    let reply = t
        .admin(Method::GET, &format!("{PT}?missing=true"), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.json(),
        json!({
            "lang": "pt-BR",
            "items": [
                {"source": "Japan", "kind": "country", "photos": 3},
                {"source": "Castle: Old.", "kind": "description", "photos": 2},
                {"source": "Osaka", "kind": "city", "photos": 2},
            ]
        })
    );

    save(&t, "/api/translations/pt-br", &[("Japan", "Japão")]).await;
    let reply = t
        .admin(Method::GET, "/api/translations/pt-br?missing=true", None)
        .await;
    let sources: Vec<String> = reply.json()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["source"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(sources, ["Castle: Old.", "Osaka"]);

    // missing=false é a lista de traduções; outro valor é erro
    let reply = t
        .admin(Method::GET, &format!("{PT}?missing=false"), None)
        .await;
    assert_eq!(reply.json()["total"], 1);
    let reply = t
        .admin(Method::GET, &format!("{PT}?missing=sim"), None)
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.json()["error"], "bad_request");
}

#[tokio::test]
async fn removal() {
    let t = osaka_catalog().await;
    save(
        &t,
        PT,
        &[("Japan", "Japão"), ("Castle: Old.", "Castelo: Antigo.")],
    )
    .await;
    let pt = playlist_items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await);
    assert_eq!(pt[0]["place"], "Osaka, Japão");

    let before = t.repo.revision().await.unwrap();
    let reply = t
        .admin(
            Method::DELETE,
            PT,
            Some(json!({"sources": ["Japan", " Japan ", "Nowhere"]})),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.json(),
        json!({"removed": ["Japan"], "not_found": ["Nowhere"]})
    );
    assert_eq!(t.repo.revision().await.unwrap(), before + 1);
    assert_eq!(
        saved(&t, PT).await,
        [("Castle: Old.".to_string(), "Castelo: Antigo.".to_string())]
    );

    // a playlist em pt-BR volta a mostrar Japan
    let pt = playlist_items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await);
    assert_eq!(pt[0]["place"], "Osaka, Japan");
    assert_eq!(pt[0]["title"], "Castelo");

    // nada a remover: a versão não muda; lista vazia é erro
    let reply = t
        .admin(Method::DELETE, PT, Some(json!({"sources": ["Nowhere"]})))
        .await;
    assert_eq!(
        reply.json(),
        json!({"removed": [], "not_found": ["Nowhere"]})
    );
    assert_eq!(t.repo.revision().await.unwrap(), before + 1);
    let reply = t
        .admin(Method::DELETE, PT, Some(json!({"sources": []})))
        .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json()["field"], "sources");
}

#[tokio::test]
async fn routes_require_the_token() {
    let t = osaka_catalog().await;
    save(&t, PT, &[("Japan", "Japão")]).await;
    let before = t.repo.revision().await.unwrap();
    let requests = [
        (Method::PUT, Some(items(&[("Osaka", "Ósaka")]))),
        (Method::GET, None),
        (Method::DELETE, Some(json!({"sources": ["Japan"]}))),
    ];
    for (method, body) in requests {
        for token in [None, Some("errado")] {
            let reply = t
                .send(json_request(method.clone(), PT, body.clone(), token))
                .await;
            assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{method} {token:?}");
            assert_eq!(reply.json()["error"], "unauthorized");
        }
    }
    let reply = t
        .send(json_request(
            Method::GET,
            &format!("{PT}?missing=true"),
            None,
            None,
        ))
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(t.repo.revision().await.unwrap(), before);
    assert_eq!(
        saved(&t, PT).await,
        [("Japan".to_string(), "Japão".to_string())]
    );

    // sem CORS, como as rotas de catálogo
    let reply = t
        .send(
            Request::get(PT)
                .header("origin", "https://tv.example")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(reply.header("access-control-allow-origin"), None);
}

// --- Dicionário de traduções ---

#[tokio::test]
async fn repeated_text_in_several_photos() {
    let t = TestApp::new().await;
    for id in [
        "000000000000000000000001",
        "000000000000000000000002",
        "000000000000000000000003",
    ] {
        t.insert(placed(
            id,
            Some("Castle: Old walls. More."),
            [None, None, None],
        ))
        .await;
    }
    save(
        &t,
        PT,
        &[(
            "Castle: Old walls. More.",
            "Castelo: Muralhas antigas. Mais.",
        )],
    )
    .await;
    let pt = playlist_items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await);
    assert_eq!(pt.len(), 3);
    for item in pt {
        assert_eq!(item["title"], "Castelo");
        assert_eq!(item["text"], "Muralhas antigas.");
    }
}

#[tokio::test]
async fn photo_registered_after_the_translation() {
    let t = TestApp::new().await;
    t.source_up().await;
    let description = source_description(WITH_V1);
    assert!(description.starts_with("Sunset Dune: "));
    let translated = "Duna do Pôr do Sol: Esta formação natural faz parte do sistema de dunas.";
    save(
        &t,
        PT,
        &[(description.as_str(), translated), ("Brazil", "Brasil")],
    )
    .await;

    let reply = t.register(json!({ "id": WITH_V1 })).await;
    assert_eq!(reply.status, StatusCode::CREATED);
    let pt = playlist_items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await);
    assert_eq!(pt[0]["title"], "Duna do Pôr do Sol");
    assert_eq!(
        pt[0]["text"],
        "Esta formação natural faz parte do sistema de dunas."
    );
    assert_eq!(pt[0]["place"], "Jericoacoara, Ceará, Brasil");
}

#[tokio::test]
async fn text_changed_at_the_source() {
    let t = TestApp::new().await;
    let id = "000000000000000000000001";
    t.insert(placed(
        id,
        Some("Castle: Old walls."),
        [None, None, Some("Japan")],
    ))
    .await;
    save(
        &t,
        PT,
        &[
            ("Castle: Old walls.", "Castelo: Muralhas antigas."),
            ("Japan", "Japão"),
        ],
    )
    .await;
    let pt = playlist_items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await);
    assert_eq!(pt[0]["title"], "Castelo");

    // a origem mudou a descrição e a foto foi registrada de novo
    t.insert(placed(
        id,
        Some("Osaka Castle: Old stone walls."),
        [None, None, Some("Japan")],
    ))
    .await;
    let pt = playlist_items(&t.get("/api/playlist?w=1920&h=1080&lang=pt-BR").await);
    assert_eq!(pt[0]["title"], "Osaka Castle");
    assert_eq!(pt[0]["text"], "Old stone walls.");
    assert_eq!(pt[0]["place"], "Japão");
    let reply = t
        .admin(Method::GET, &format!("{PT}?missing=true"), None)
        .await;
    assert_eq!(
        reply.json()["items"],
        json!([{"source": "Osaka Castle: Old stone walls.", "kind": "description", "photos": 1}])
    );
}
