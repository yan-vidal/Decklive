//! Cenários de `/api/media` (spec media-catalog).

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use serde_json::{Value, json};

fn files(media: &Value) -> Vec<(String, String, u64, u64)> {
    media["variants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            (
                v["kind"].as_str().unwrap().to_string(),
                v["url"].as_str().unwrap().to_string(),
                v["width"].as_u64().unwrap(),
                v["height"].as_u64().unwrap(),
            )
        })
        .collect()
}

// --- Registro de foto a partir do yanlucas.com ---

#[tokio::test]
async fn new_photo_is_created_with_three_files() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t.register(json!({ "id": WITH_V1 })).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json());
    let m = reply.json();
    assert_eq!(m["id"], WITH_V1);
    assert_eq!(m["source"], "yanlucas");
    assert_eq!(m["version"], "V1");
    assert_eq!(m["color"], "#c79442");
    assert_eq!(m["taken_at"], "2015-10-16T15:35:41.000Z");
    assert!(
        m["description"]
            .as_str()
            .unwrap()
            .starts_with("Sunset Dune")
    );
    assert_eq!(
        files(&m),
        vec![
            (
                "thumbnail".into(),
                "https://cdn.yanlucas.com/1725108890838-IMG_8665-thumbnail.jpeg".into(),
                196,
                123
            ),
            (
                "optimized".into(),
                "https://cdn.yanlucas.com/1725108890838-IMG_8665-optimized.jpeg".into(),
                981,
                613
            ),
            (
                "full".into(),
                "https://cdn.yanlucas.com/1725108890838-IMG_8665.jpeg".into(),
                2944,
                1839
            ),
        ]
    );
    assert!(m["created_at"].is_string());
    assert_eq!(t.repo.load().await.unwrap().media.len(), 1);
}

#[tokio::test]
async fn photo_already_registered_is_updated_and_framing_replaced() {
    let t = TestApp::new().await;
    t.source_up().await;
    let first = t
        .register(json!({
            "id": WITH_V1,
            "focus": { "x": 0.2, "y": 0.3 },
            "crops": { "portrait": { "x": 0.3, "y": 0, "w": 0.4, "h": 1 } }
        }))
        .await;
    assert_eq!(first.status, StatusCode::CREATED);

    let second = t
        .register(json!({
            "id": WITH_V1,
            "version": "original",
            "crops": { "landscape": { "x": 0, "y": 0.1, "w": 1, "h": 0.5 } }
        }))
        .await;
    assert_eq!(second.status, StatusCode::OK, "{}", second.json());
    let m = second.json();
    assert_eq!(m["version"], "original");
    assert_eq!(m["focus"], json!({ "x": 0.5, "y": 0.5 }));
    assert_eq!(
        m["crops"],
        json!({ "landscape": { "x": 0.0, "y": 0.1, "w": 1.0, "h": 0.5 }, "portrait": null })
    );
    assert_eq!(m["created_at"], first.json()["created_at"]);
    assert_eq!(t.repo.load().await.unwrap().media.len(), 1);
}

#[tokio::test]
async fn photo_missing_at_source_is_404_and_nothing_is_written() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t.register(json!({ "id": UNKNOWN })).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.json()["error"], "not_found");
    // pedido do item + sonda
    assert_eq!(t.source_calls().await, 2);
    assert_eq!(t.repo.revision().await.unwrap(), 0);
}

#[tokio::test]
async fn source_down_is_502_and_catalog_is_unchanged() {
    let t = TestApp::new().await;
    t.source_up().await;
    assert_eq!(
        t.register(json!({ "id": WITH_V1 })).await.status,
        StatusCode::CREATED
    );
    let before = t.repo.load().await.unwrap();

    t.source_down().await;
    let reply = t
        .register(
            json!({ "id": WITH_V1, "crops": { "portrait": { "x": 0, "y": 0, "w": 0.5, "h": 1 } } }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_GATEWAY);
    assert_eq!(t.repo.load().await.unwrap(), before);
}

#[tokio::test]
async fn source_unreachable_is_502() {
    let t = TestApp::new().await;
    // origem que não responde nada: o MockServer sem mocks responde 404
    let reply = t.register(json!({ "id": WITH_V1 })).await;
    assert_eq!(reply.status, StatusCode::BAD_GATEWAY);
    assert_eq!(t.repo.revision().await.unwrap(), 0);
}

#[tokio::test]
async fn malformed_id_is_422_without_calling_the_source() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t.register(json!({ "id": "abc" })).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json()["field"], "id");
    assert_eq!(t.source_calls().await, 0);
}

#[tokio::test]
async fn invalid_body_is_rejected() {
    let t = TestApp::new().await;
    t.source_up().await;
    // campo desconhecido (erro de digitação)
    let reply = t.register(json!({ "id": WITH_V1, "crop": {} })).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json()["error"], "invalid_body");
    // JSON quebrado
    let reply = t
        .send(
            axum::http::Request::post("/api/media")
                .header("authorization", format!("Bearer {TOKEN}"))
                .header("content-type", "application/json")
                .body(axum::body::Body::from("{"))
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(t.source_calls().await, 0);
}

// --- Local da foto gravado no registro ---

/// Procura, em qualquer nível do JSON, uma chave com o nome dado.
fn has_key(value: &Value, name: &str) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(k, v)| k == name || has_key(v, name)),
        Value::Array(items) => items.iter().any(|v| has_key(v, name)),
        _ => false,
    }
}

fn place(media: &Value) -> (Value, Value, Value) {
    (
        media["city"].clone(),
        media["state"].clone(),
        media["country"].clone(),
    )
}

async fn listed(t: &TestApp, id: &str) -> Value {
    let list = t.admin(Method::GET, "/api/media", None).await.json();
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} não está na listagem"))
}

#[tokio::test]
async fn photo_with_place_at_source() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t.register(json!({ "id": WITH_V1 })).await;
    assert_eq!(reply.status, StatusCode::CREATED);
    let expected = (json!("Jericoacoara"), json!("Ceará"), json!("Brazil"));
    assert_eq!(place(&reply.json()), expected);
    assert_eq!(place(&listed(&t, WITH_V1).await), expected);
}

#[tokio::test]
async fn photo_without_place_at_source() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t.register(json!({ "id": NO_CITY })).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json());
    let expected = (Value::Null, Value::Null, json!("Brazil"));
    assert_eq!(place(&reply.json()), expected);
    assert_eq!(place(&listed(&t, NO_CITY).await), expected);
}

#[tokio::test]
async fn photo_with_coordinates_at_source() {
    let t = TestApp::new().await;
    t.source_up().await;
    // a origem tem metadata.latitude = -23.541744 e metadata.longitude = -46.6413137
    let page: Value = serde_json::from_str(PAGE).unwrap();
    let doc = page["images"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["_id"] == WITH_COORDS)
        .unwrap();
    assert!(has_key(doc, "latitude") && has_key(doc, "longitude"));

    let reply = t.register(json!({ "id": WITH_COORDS })).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json());
    let list = t.admin(Method::GET, "/api/media", None).await;
    for (what, body, text) in [
        (
            "registro",
            reply.json(),
            String::from_utf8_lossy(&reply.body).into_owned(),
        ),
        (
            "listagem",
            list.json(),
            String::from_utf8_lossy(&list.body).into_owned(),
        ),
    ] {
        for key in ["latitude", "longitude", "lat", "lon", "lng"] {
            assert!(!has_key(&body, key), "{what} traz {key}");
        }
        assert!(
            !text.contains("23.54") && !text.contains("46.64"),
            "{what} traz as coordenadas"
        );
    }
    assert_eq!(
        place(&reply.json()),
        (json!("São Paulo"), json!("São Paulo"), json!("Brazil"))
    );
}

// --- Escolha da versão da foto ---

#[tokio::test]
async fn default_version_uses_v1_files() {
    let t = TestApp::new().await;
    t.source_up().await;
    let m = t.register(json!({ "id": WITH_V1_V2_V3 })).await.json();
    assert_eq!(m["version"], "V1");
    let page: Value = serde_json::from_str(PAGE).unwrap();
    let doc = page["images"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["_id"] == WITH_V1_V2_V3)
        .unwrap();
    let v1 = &doc["images"][0];
    let urls: Vec<String> = files(&m).into_iter().map(|f| f.1).collect();
    let expected: Vec<&str> = ["thumbnailUrl", "optimizedUrl", "fullSizeUrl"]
        .iter()
        .map(|k| v1[*k].as_str().unwrap())
        .collect();
    assert_eq!(urls, expected);
}

#[tokio::test]
async fn original_requested_uses_original_files() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t
        .register(json!({ "id": WITH_V1, "version": "original" }))
        .await;
    assert_eq!(reply.status, StatusCode::CREATED);
    let m = reply.json();
    assert_eq!(m["version"], "original");
    assert_eq!(
        files(&m)[2].1,
        "https://cdn.yanlucas.com/1725108894849-IMG_8666.jpeg"
    );
}

#[tokio::test]
async fn unknown_version_is_422_listing_available_ones() {
    let t = TestApp::new().await;
    t.source_up().await;
    let reply = t
        .register(json!({ "id": WITH_V1_V2_V3, "version": "V7" }))
        .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = reply.json();
    assert_eq!(body["error"], "unknown_version");
    assert_eq!(body["available"], json!(["V1", "V2", "V3", "original"]));
    assert_eq!(t.repo.revision().await.unwrap(), 0);
}

// --- Enquadramento informado no registro ---

#[tokio::test]
async fn registration_without_framing_uses_center() {
    let t = TestApp::new().await;
    t.source_up().await;
    let m = t.register(json!({ "id": WITH_V1 })).await.json();
    assert_eq!(m["focus"], json!({ "x": 0.5, "y": 0.5 }));
    assert_eq!(m["crops"], json!({ "landscape": null, "portrait": null }));
}

#[tokio::test]
async fn registration_with_portrait_region() {
    let t = TestApp::new().await;
    t.source_up().await;
    let m = t
        .register(json!({ "id": WITH_V1, "crops": { "portrait": { "x": 0.3, "y": 0, "w": 0.4, "h": 1 } } }))
        .await
        .json();
    assert_eq!(
        m["crops"],
        json!({ "landscape": null, "portrait": { "x": 0.3, "y": 0.0, "w": 0.4, "h": 1.0 } })
    );
    let stored = &t.repo.load().await.unwrap().media[0];
    assert!(stored.crops.landscape.is_none());
    assert_eq!(stored.crops.portrait.unwrap().w, 0.4);
}

#[tokio::test]
async fn invalid_coordinates_are_422_and_nothing_is_written() {
    let t = TestApp::new().await;
    t.source_up().await;
    let cases = [
        (
            json!({ "crops": { "portrait": { "x": 0.7, "y": 0, "w": 0.4, "h": 1 } } }),
            "crops.portrait.w",
        ),
        (
            json!({ "crops": { "landscape": { "x": 0, "y": 0, "w": 0, "h": 1 } } }),
            "crops.landscape.w",
        ),
        (
            json!({ "crops": { "landscape": { "x": 0, "y": 0, "w": 1, "h": 0 } } }),
            "crops.landscape.h",
        ),
        (json!({ "focus": { "x": 1.5, "y": 0.5 } }), "focus.x"),
        (json!({ "focus": { "x": 0.5, "y": -0.5 } }), "focus.y"),
    ];
    for (mut body, field) in cases {
        body["id"] = json!(WITH_V1);
        let reply = t.register(body).await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{field}");
        assert_eq!(reply.json()["field"], field);
    }
    assert_eq!(t.repo.revision().await.unwrap(), 0);
    assert_eq!(t.source_calls().await, 0);
}

// --- Remoção em lote ---

#[tokio::test]
async fn removal_of_existing_and_unknown_photos() {
    let t = TestApp::new().await;
    t.source_up().await;
    for id in [WITH_V1, WITH_V1_B, ONLY_ORIGINAL] {
        assert_eq!(
            t.register(json!({ "id": id })).await.status,
            StatusCode::CREATED
        );
    }
    let reply = t
        .admin(
            Method::DELETE,
            "/api/media",
            Some(json!({ "ids": [WITH_V1, ONLY_ORIGINAL, UNKNOWN] })),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.json(),
        json!({ "removed": [WITH_V1, ONLY_ORIGINAL], "not_found": [UNKNOWN] })
    );
    let list = t.admin(Method::GET, "/api/media", None).await.json();
    assert_eq!(list["total"], 1);
    assert_eq!(list["items"][0]["id"], WITH_V1_B);
}

#[tokio::test]
async fn removal_with_empty_list_is_422() {
    let t = TestApp::new().await;
    t.source_up().await;
    t.register(json!({ "id": WITH_V1 })).await;
    let revision = t.repo.revision().await.unwrap();
    let reply = t
        .admin(Method::DELETE, "/api/media", Some(json!({ "ids": [] })))
        .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json()["field"], "ids");
    assert_eq!(t.repo.revision().await.unwrap(), revision);
    assert_eq!(t.repo.load().await.unwrap().media.len(), 1);
}

// --- Listagem do catálogo ---

#[tokio::test]
async fn listing_with_three_photos_newest_first() {
    let t = TestApp::new().await;
    t.source_up().await;
    for id in [WITH_V1, WITH_V1_B, ONLY_ORIGINAL] {
        t.register(json!({ "id": id })).await;
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }
    // registrar de novo não muda a posição
    t.register(json!({ "id": WITH_V1 })).await;
    let reply = t.admin(Method::GET, "/api/media", None).await;
    assert_eq!(reply.status, StatusCode::OK);
    let body = reply.json();
    assert_eq!(body["total"], 3);
    let ids: Vec<&str> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [ONLY_ORIGINAL, WITH_V1_B, WITH_V1]);
    let first = &body["items"][0];
    for key in [
        "variants",
        "focus",
        "crops",
        "description",
        "taken_at",
        "color",
        "city",
        "state",
        "country",
    ] {
        assert!(first.get(key).is_some(), "falta {key}");
    }
}

#[tokio::test]
async fn listing_empty_catalog() {
    let t = TestApp::new().await;
    let reply = t.admin(Method::GET, "/api/media", None).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json(), json!({ "items": [], "total": 0 }));
}
