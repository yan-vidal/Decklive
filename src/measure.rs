//! Dimensões dos arquivos lidas só do cabeçalho (design D4, passo 5).

use std::future::Future;
use std::pin::Pin;

use reqwest::header::RANGE;

/// Quantos bytes do começo do arquivo são lidos.
pub const HEADER_BYTES: usize = 65536;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Mede um arquivo pela URL. Trocável nos testes, para não sair para a rede.
pub trait DimensionProbe: Send + Sync {
    fn probe<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<(u32, u32), String>>;
}

/// Medição real: `Range: bytes=0-65535` + `imagesize`.
pub struct HttpProbe {
    client: reqwest::Client,
}

impl HttpProbe {
    pub fn new(client: reqwest::Client) -> Self {
        HttpProbe { client }
    }
}

impl DimensionProbe for HttpProbe {
    fn probe<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<(u32, u32), String>> {
        Box::pin(measure_header(&self.client, url))
    }
}

/// Baixa só o começo do arquivo e lê largura e altura.
pub async fn measure_header(client: &reqwest::Client, url: &str) -> Result<(u32, u32), String> {
    let mut response = client
        .get(url)
        .header(RANGE, format!("bytes=0-{}", HEADER_BYTES - 1))
        .send()
        .await
        .map_err(|e| format!("falha ao baixar o cabeçalho: {e}"))?;
    let status = response.status().as_u16();
    if status != 200 && status != 206 {
        return Err(format!("status {status}"));
    }
    // Se o servidor ignorar o Range, para de ler depois de HEADER_BYTES.
    let mut head = Vec::with_capacity(HEADER_BYTES);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("falha ao ler o cabeçalho: {e}"))?
    {
        head.extend_from_slice(&chunk);
        if head.len() >= HEADER_BYTES {
            break;
        }
    }
    head.truncate(HEADER_BYTES);
    dimensions_from_header(&head).ok_or_else(|| "cabeçalho de imagem não reconhecido".into())
}

/// Mede pelo cabeçalho; se falhar, usa as dimensões de `metadata` e avisa no log.
pub async fn resolve_dimensions(
    probe: &dyn DimensionProbe,
    url: &str,
    fallback: Option<(u32, u32)>,
) -> Option<(u32, u32)> {
    match probe.probe(url).await {
        Ok(dims) => Some(dims),
        Err(reason) => {
            tracing::warn!(%url, %reason, ?fallback, "medição falhou; usando metadata da origem");
            fallback.filter(|(w, h)| *w > 0 && *h > 0)
        }
    }
}

/// Largura e altura como o navegador mostra (respeita a orientação EXIF do JPEG).
pub fn dimensions_from_header(head: &[u8]) -> Option<(u32, u32)> {
    let size = imagesize::blob_size(head).ok()?;
    let w = u32::try_from(size.width).ok()?;
    let h = u32::try_from(size.height).ok()?;
    if w == 0 || h == 0 {
        return None;
    }
    match jpeg_exif_orientation(head) {
        // 5 a 8: a foto gira 90°, então largura e altura trocam.
        Some(5..=8) => Some((h, w)),
        _ => Some((w, h)),
    }
}

/// Valor da tag Orientation (0x0112) do APP1 Exif, se houver.
fn jpeg_exif_orientation(data: &[u8]) -> Option<u16> {
    if !data.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut i = 2;
    while i + 4 <= data.len() {
        if data[i] != 0xFF {
            return None;
        }
        let marker = data[i + 1];
        match marker {
            0xFF => {
                i += 1;
                continue;
            }
            0x01 | 0xD0..=0xD8 => {
                i += 2;
                continue;
            }
            0xD9 | 0xDA => return None,
            _ => {}
        }
        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        if len < 2 {
            return None;
        }
        let segment = data.get(i + 4..i + 2 + len)?;
        if marker == 0xE1 && segment.starts_with(b"Exif\0\0") {
            return tiff_orientation(&segment[6..]);
        }
        i += 2 + len;
    }
    None
}

fn tiff_orientation(t: &[u8]) -> Option<u16> {
    let little = match t.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |o: usize| -> Option<u16> {
        let b: [u8; 2] = t.get(o..o + 2)?.try_into().ok()?;
        Some(if little {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    };
    let u32_at = |o: usize| -> Option<u32> {
        let b: [u8; 4] = t.get(o..o + 4)?.try_into().ok()?;
        Some(if little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = u32_at(4)? as usize;
    let entries = u16_at(ifd)? as usize;
    (0..entries)
        .map(|k| ifd + 2 + 12 * k)
        .find(|&e| u16_at(e) == Some(0x0112))
        .and_then(|e| u16_at(e + 8))
        .filter(|v| (1..=8).contains(v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const TINY: &[u8] = include_bytes!("../tests/fixtures/tiny.jpg");
    const TINY_ROTATED: &[u8] = include_bytes!("../tests/fixtures/tiny-rotated.jpg");

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    }

    #[test]
    fn reads_jpeg_dimensions_and_exif_rotation() {
        assert_eq!(dimensions_from_header(TINY), Some((30, 20)));
        assert_eq!(jpeg_exif_orientation(TINY_ROTATED), Some(6));
        assert_eq!(dimensions_from_header(TINY_ROTATED), Some((20, 30)));
        assert_eq!(dimensions_from_header(b"not an image"), None);
        assert_eq!(dimensions_from_header(&TINY[..4]), None);
    }

    #[tokio::test]
    async fn measures_small_jpeg_with_range_request() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/tiny.jpg"))
            .and(header("range", "bytes=0-65535"))
            .respond_with(ResponseTemplate::new(206).set_body_raw(TINY, "image/jpeg"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/rotated.jpg"))
            .respond_with(ResponseTemplate::new(206).set_body_raw(TINY_ROTATED, "image/jpeg"))
            .mount(&server)
            .await;

        let c = client();
        let url = format!("{}/tiny.jpg", server.uri());
        assert_eq!(measure_header(&c, &url).await, Ok((30, 20)));
        let url = format!("{}/rotated.jpg", server.uri());
        assert_eq!(measure_header(&c, &url).await, Ok((20, 30)));
    }

    #[tokio::test]
    async fn server_ignoring_range_is_read_only_up_to_the_limit() {
        let server = MockServer::start().await;
        let mut big = TINY.to_vec();
        big.resize(HEADER_BYTES * 8, 0);
        Mock::given(method("GET"))
            .and(path("/big.jpg"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(big, "application/octet-stream"))
            .mount(&server)
            .await;
        let url = format!("{}/big.jpg", server.uri());
        assert_eq!(measure_header(&client(), &url).await, Ok((30, 20)));
    }

    #[tokio::test]
    async fn falls_back_to_metadata_when_measurement_fails() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/missing.jpg"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/garbage.jpg"))
            .respond_with(ResponseTemplate::new(206).set_body_raw(&b"lixo"[..], "image/jpeg"))
            .mount(&server)
            .await;

        let probe = HttpProbe::new(client());
        let missing = format!("{}/missing.jpg", server.uri());
        let garbage = format!("{}/garbage.jpg", server.uri());
        assert!(measure_header(&client(), &missing).await.is_err());
        assert_eq!(
            resolve_dimensions(&probe, &missing, Some((981, 613))).await,
            Some((981, 613))
        );
        assert_eq!(
            resolve_dimensions(&probe, &garbage, Some((196, 123))).await,
            Some((196, 123))
        );
        assert_eq!(resolve_dimensions(&probe, &missing, None).await, None);
        assert_eq!(
            resolve_dimensions(&probe, &missing, Some((0, 10))).await,
            None
        );
    }
}
