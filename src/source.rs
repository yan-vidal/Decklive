//! Cliente da API do yanlucas.com (design D4).

use std::time::Duration;

use serde::{Deserialize, Deserializer};
use serde_json::Value;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SourceError {
    #[error("a foto não existe na API do yanlucas.com")]
    NotFound,
    #[error("a API do yanlucas.com está fora do ar ou respondeu com erro: {0}")]
    Unavailable(String),
}

/// Documento de uma foto na origem (só os campos que usamos).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SourceDoc {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Local da foto como a origem o escreve (design D1 de `add-photo-info-and-motion`).
    /// As coordenadas de `metadata` não são lidas: a playlist é pública.
    #[serde(default, deserialize_with = "lenient_text")]
    pub city: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    pub state: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    pub country: Option<String>,
    #[serde(default)]
    pub images: Vec<SourceVersion>,
    #[serde(default)]
    pub original: Option<SourceVersion>,
    #[serde(default)]
    pub metadata: SourceMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceVersion {
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub optimized_url: Option<String>,
    #[serde(default)]
    pub full_size_url: Option<String>,
    #[serde(default)]
    pub version_name: Option<String>,
    #[serde(default)]
    pub color_palette: Vec<PaletteColor>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PaletteColor {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetadata {
    #[serde(default)]
    pub taken_at: Option<String>,
    #[serde(default, deserialize_with = "lenient_u32")]
    pub full_size_width: Option<u32>,
    #[serde(default, deserialize_with = "lenient_u32")]
    pub full_size_height: Option<u32>,
    #[serde(default, deserialize_with = "lenient_u32")]
    pub optimized_width: Option<u32>,
    #[serde(default, deserialize_with = "lenient_u32")]
    pub optimized_height: Option<u32>,
    #[serde(default, deserialize_with = "lenient_u32")]
    pub thumbnail_width: Option<u32>,
    #[serde(default, deserialize_with = "lenient_u32")]
    pub thumbnail_height: Option<u32>,
}

/// Aceita número ou texto numérico; qualquer outra coisa vira `None`.
fn lenient_u32<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::Number(n)) => n
            .as_u64()
            .or_else(|| n.as_f64().filter(|f| *f >= 0.0).map(|f| f.round() as u64))
            .and_then(|n| u32::try_from(n).ok()),
        Some(Value::String(s)) => s.trim().parse().ok(),
        _ => None,
    })
}

/// Texto sem os espaços das pontas; vazio, nulo ou de outro tipo vira `None`.
fn lenient_text<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::String(s)) => Some(s.trim()).filter(|t| !t.is_empty()).map(String::from),
        _ => None,
    })
}

#[derive(Clone)]
pub struct SourceClient {
    http: reqwest::Client,
    base: String,
}

impl SourceClient {
    pub fn new(base: &str, timeout: Duration) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .user_agent(concat!("decklive/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(SourceClient {
            http,
            base: base.trim_end_matches('/').to_string(),
        })
    }

    /// Cliente HTTP compartilhado (mesmo timeout), usado também na medição.
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Busca uma foto pelo `_id`.
    ///
    /// A origem não tem busca por id: `?id=<id>&limit=1` devolve a página até o item.
    /// Id desconhecido e falha geral dão o mesmo `500`; a sonda separa os dois casos.
    pub async fn fetch_photo(&self, id: &str) -> Result<SourceDoc, SourceError> {
        let url = format!("{}/images", self.base);
        let response = self
            .http
            .get(&url)
            .query(&[("id", id), ("limit", "1")])
            .send()
            .await
            .map_err(|e| SourceError::Unavailable(describe(&e)))?;

        match response.status().as_u16() {
            200 => {
                let body = response
                    .bytes()
                    .await
                    .map_err(|e| SourceError::Unavailable(describe(&e)))?;
                find_in_page(&body, id)
            }
            500 => {
                if self.is_up().await {
                    Err(SourceError::NotFound)
                } else {
                    Err(SourceError::Unavailable(
                        "status 500 e a sonda falhou".into(),
                    ))
                }
            }
            status => Err(SourceError::Unavailable(format!("status {status}"))),
        }
    }

    /// Sonda: a listagem simples responde `200` quando a origem está no ar.
    async fn is_up(&self) -> bool {
        let url = format!("{}/images", self.base);
        match self.http.get(&url).query(&[("limit", "1")]).send().await {
            Ok(r) => r.status().is_success(),
            Err(_) => false,
        }
    }
}

#[derive(Deserialize)]
struct Page {
    images: Vec<Value>,
}

fn find_in_page(body: &[u8], id: &str) -> Result<SourceDoc, SourceError> {
    let page: Page = serde_json::from_slice(body)
        .map_err(|e| SourceError::Unavailable(format!("resposta inválida: {e}")))?;
    // Só o item procurado é convertido: os vizinhos da página podem ter outro formato.
    let item = page
        .images
        .into_iter()
        .find(|doc| doc.get("_id").and_then(Value::as_str) == Some(id))
        .ok_or(SourceError::NotFound)?;
    serde_json::from_value(item)
        .map_err(|e| SourceError::Unavailable(format!("documento da foto inválido: {e}")))
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "tempo esgotado".into()
    } else if e.is_connect() {
        "sem conexão".into()
    } else {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param, query_param_is_missing};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const ID: &str = "66d312a4124fa13304b01ea7";
    /// Fotos reais do fixture: sem cidade nem estado, e com latitude e longitude.
    const NO_CITY: &str = "66ee7c372e06e822f24ebbbf";
    const WITH_COORDS: &str = "66d405ca124fa13304b052bc";
    const PAGE: &str = include_str!("../tests/fixtures/source-page.json");

    fn client(server: &MockServer) -> SourceClient {
        SourceClient::new(&server.uri(), Duration::from_millis(300)).unwrap()
    }

    async fn mock_lookup(server: &MockServer, id: &str, response: ResponseTemplate) {
        Mock::given(method("GET"))
            .and(path("/images"))
            .and(query_param("id", id))
            .and(query_param("limit", "1"))
            .respond_with(response)
            .expect(1)
            .mount(server)
            .await;
    }

    async fn mock_probe(server: &MockServer, response: ResponseTemplate, times: u64) {
        Mock::given(method("GET"))
            .and(path("/images"))
            .and(query_param_is_missing("id"))
            .and(query_param("limit", "1"))
            .respond_with(response)
            .expect(times)
            .mount(server)
            .await;
    }

    fn source_500() -> ResponseTemplate {
        ResponseTemplate::new(500).set_body_string("Erro ao listar imagens")
    }

    #[tokio::test]
    async fn source_finds_item_in_page() {
        let server = MockServer::start().await;
        mock_lookup(
            &server,
            ID,
            ResponseTemplate::new(200).set_body_raw(PAGE, "application/json"),
        )
        .await;
        mock_probe(&server, ResponseTemplate::new(200), 0).await;

        let doc = client(&server).fetch_photo(ID).await.unwrap();
        assert_eq!(doc.id, ID);
        assert!(doc.description.unwrap().starts_with("Sunset Dune"));
        assert_eq!(doc.images.len(), 1);
        assert_eq!(doc.images[0].version_name.as_deref(), Some("V1"));
        assert_eq!(
            doc.images[0].full_size_url.as_deref(),
            Some("https://cdn.yanlucas.com/1725108890838-IMG_8665.jpeg")
        );
        assert_eq!(doc.images[0].color_palette.len(), 5);
        assert_eq!(
            doc.original.unwrap().version_name.as_deref(),
            Some("Original")
        );
        assert_eq!(doc.metadata.full_size_width, Some(2944));
        assert_eq!(doc.metadata.thumbnail_height, Some(123));
        assert_eq!(
            doc.metadata.taken_at.as_deref(),
            Some("2015-10-16T15:35:41.000Z")
        );
    }

    /// Busca uma foto do fixture pela rota simulada.
    async fn fetch_from_page(id: &str) -> SourceDoc {
        let server = MockServer::start().await;
        mock_lookup(
            &server,
            id,
            ResponseTemplate::new(200).set_body_raw(PAGE, "application/json"),
        )
        .await;
        client(&server).fetch_photo(id).await.unwrap()
    }

    #[tokio::test]
    async fn source_reads_city_state_and_country() {
        let doc = fetch_from_page(ID).await;
        assert_eq!(doc.city.as_deref(), Some("Jericoacoara"));
        assert_eq!(doc.state.as_deref(), Some("Ceará"));
        assert_eq!(doc.country.as_deref(), Some("Brazil"));
    }

    #[tokio::test]
    async fn source_without_city_gives_none() {
        // na origem, esta foto não tem `city` e tem `state: null`
        let doc = fetch_from_page(NO_CITY).await;
        assert_eq!(doc.city, None);
        assert_eq!(doc.state, None);
        assert_eq!(doc.country.as_deref(), Some("Brazil"));
    }

    #[tokio::test]
    async fn source_ignores_coordinates() {
        let raw: Value = serde_json::from_str(PAGE).unwrap();
        let item = raw["images"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["_id"] == WITH_COORDS)
            .unwrap();
        assert!(
            item["metadata"]["latitude"].is_f64(),
            "o fixture tem coordenadas"
        );

        let doc = fetch_from_page(WITH_COORDS).await;
        assert_eq!(doc.city.as_deref(), Some("São Paulo"));
        // as coordenadas nem chegam a ser lidas
        let debug = format!("{doc:?}");
        assert!(
            !debug.contains("23.54") && !debug.contains("46.64"),
            "{debug}"
        );
    }

    #[test]
    fn blank_place_text_is_none() {
        let mut item: Value = serde_json::from_str::<Value>(PAGE).unwrap()["images"][0].clone();
        item["city"] = Value::from("  ");
        item["state"] = Value::from("");
        item["country"] = Value::from(" Brazil ");
        let doc: SourceDoc = serde_json::from_value(item.clone()).unwrap();
        assert_eq!(doc.city, None);
        assert_eq!(doc.state, None);
        assert_eq!(doc.country.as_deref(), Some("Brazil"));
        // tipo inesperado não derruba o registro
        item["city"] = Value::from(42);
        let doc: SourceDoc = serde_json::from_value(item).unwrap();
        assert_eq!(doc.city, None);
    }

    #[tokio::test]
    async fn source_500_with_healthy_probe_means_not_found() {
        let server = MockServer::start().await;
        let unknown = "0123456789abcdef01234567";
        mock_lookup(&server, unknown, source_500()).await;
        mock_probe(
            &server,
            ResponseTemplate::new(200).set_body_raw(PAGE, "application/json"),
            1,
        )
        .await;

        assert_eq!(
            client(&server).fetch_photo(unknown).await,
            Err(SourceError::NotFound)
        );
    }

    #[tokio::test]
    async fn source_500_with_failing_probe_means_unavailable() {
        let server = MockServer::start().await;
        mock_lookup(&server, ID, source_500()).await;
        mock_probe(&server, source_500(), 1).await;

        let err = client(&server).fetch_photo(ID).await.unwrap_err();
        assert!(matches!(err, SourceError::Unavailable(_)), "{err:?}");
    }

    #[tokio::test]
    async fn source_timeout_means_unavailable() {
        let server = MockServer::start().await;
        mock_lookup(
            &server,
            ID,
            ResponseTemplate::new(200)
                .set_body_raw(PAGE, "application/json")
                .set_delay(Duration::from_secs(2)),
        )
        .await;

        let started = std::time::Instant::now();
        let err = client(&server).fetch_photo(ID).await.unwrap_err();
        assert!(matches!(err, SourceError::Unavailable(_)), "{err:?}");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn source_other_errors_mean_unavailable_without_probe() {
        let server = MockServer::start().await;
        mock_lookup(&server, ID, ResponseTemplate::new(503)).await;
        mock_probe(&server, ResponseTemplate::new(200), 0).await;
        assert!(matches!(
            client(&server).fetch_photo(ID).await,
            Err(SourceError::Unavailable(_))
        ));
    }

    #[tokio::test]
    async fn source_invalid_json_means_unavailable() {
        let server = MockServer::start().await;
        mock_lookup(
            &server,
            ID,
            ResponseTemplate::new(200).set_body_string("<html>"),
        )
        .await;
        assert!(matches!(
            client(&server).fetch_photo(ID).await,
            Err(SourceError::Unavailable(_))
        ));
    }

    #[tokio::test]
    async fn source_page_without_the_item_means_not_found() {
        let server = MockServer::start().await;
        let other = "aaaaaaaaaaaaaaaaaaaaaaaa";
        mock_lookup(
            &server,
            other,
            ResponseTemplate::new(200).set_body_raw(PAGE, "application/json"),
        )
        .await;
        assert_eq!(
            client(&server).fetch_photo(other).await,
            Err(SourceError::NotFound)
        );
    }

    #[tokio::test]
    async fn source_unreachable_means_unavailable() {
        // porta fechada: o servidor sobe e cai antes do pedido
        let uri = {
            let server = MockServer::start().await;
            server.uri()
        };
        let client = SourceClient::new(&uri, Duration::from_millis(300)).unwrap();
        assert!(matches!(
            client.fetch_photo(ID).await,
            Err(SourceError::Unavailable(_))
        ));
    }
}
