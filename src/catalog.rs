//! Catálogo em memória: snapshot trocado a cada escrita e playlist memorizada (design D5).

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use arc_swap::ArcSwap;
use bytes::Bytes;
use serde::Serialize;

use crate::bucket::{self, Bucket, Orientation};
use crate::crop;
use crate::db::{CatalogState, Repo};
use crate::info::Info;
use crate::model::{Media, Rect};
use crate::variant;

/// Identifica a instância do processo no `ETag` (design D5): o instante de início,
/// em milissegundos desde a época Unix, escrito em base 36. Um deploy que mude a
/// conta do corte ou da faixa invalida assim as respostas guardadas pelos clientes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Boot(Arc<str>);

impl Boot {
    /// O `main` chama uma vez, logo na partida.
    pub fn now() -> Self {
        Self::at(SystemTime::now())
    }

    /// Instante dado, para os testes ficarem determinísticos.
    pub fn at(instant: SystemTime) -> Self {
        let millis = instant
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        Boot(Arc::from(base36(millis)))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn base36(mut n: u128) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).expect("dígitos ASCII")
}

/// Fotos e versão do catálogo num instante, com as playlists já calculadas.
pub struct Snapshot {
    pub revision: i64,
    /// Na ordem de registro.
    pub media: Vec<Media>,
    /// Local, título e resumo de cada foto, na ordem de `media`. Não dependem da tela,
    /// então são calculados uma vez por versão, e não a cada faixa.
    info: Vec<Info>,
    boot: Boot,
    /// Uma resposta por faixa; some junto com o snapshot quando a versão muda.
    memo: Mutex<HashMap<Bucket, Arc<Rendered>>>,
}

/// Playlist de uma faixa, serializada uma vez e comprimida sob demanda.
pub struct Rendered {
    pub etag: String,
    pub body: Bytes,
    gzip: OnceLock<Bytes>,
    brotli: OnceLock<Bytes>,
}

#[derive(Debug, Serialize)]
pub struct PlaylistItem<'a> {
    pub id: &'a str,
    pub src: &'a str,
    pub width: u32,
    pub height: u32,
    pub crop: Rect,
    pub color: &'a str,
    pub orientation: Orientation,
    /// Sempre presentes: `null` quando a foto não tem local ou descrição.
    pub place: Option<&'a str>,
    pub title: Option<&'a str>,
    pub text: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct PlaylistBody<'a> {
    items: Vec<PlaylistItem<'a>>,
}

impl Snapshot {
    pub fn new(state: CatalogState, boot: Boot) -> Self {
        let info = state.media.iter().map(Info::of).collect();
        Snapshot {
            revision: state.revision,
            media: state.media,
            info,
            boot,
            memo: Mutex::new(HashMap::new()),
        }
    }

    /// Playlist da faixa, calculada na primeira vez e depois servida da memória.
    pub fn playlist(&self, screen: Bucket) -> Arc<Rendered> {
        let mut memo = self.memo.lock().unwrap_or_else(|e| e.into_inner());
        memo.entry(screen)
            .or_insert_with(|| Arc::new(self.render(screen)))
            .clone()
    }

    fn render(&self, screen: Bucket) -> Rendered {
        let items = self
            .media
            .iter()
            .zip(&self.info)
            .filter_map(|(m, info)| item(m, info, screen))
            .collect();
        let body = serde_json::to_vec(&PlaylistBody { items }).expect("playlist sempre vira JSON");
        Rendered {
            etag: format!(
                "\"r{}-{}x{}-{}\"",
                self.revision,
                screen.w,
                screen.h,
                self.boot.as_str()
            ),
            body: Bytes::from(body),
            gzip: OnceLock::new(),
            brotli: OnceLock::new(),
        }
    }
}

/// Item da playlist: corte para a tela, o arquivo mais leve que fica nítido e os
/// textos já calculados. Foto sem arquivo (só se o banco for editado à mão) fica de fora.
pub fn item<'a>(m: &'a Media, info: &'a Info, screen: Bucket) -> Option<PlaylistItem<'a>> {
    let full = m.largest()?;
    let crop = crop::compute(full.width, full.height, screen, m.focus, &m.crops);
    let file = variant::choose(&m.variants, &crop, screen);
    Some(PlaylistItem {
        id: &m.id,
        src: &file.url,
        width: file.width,
        height: file.height,
        crop,
        color: &m.color,
        orientation: bucket::orientation(full.width, full.height),
        place: info.place.as_deref(),
        title: info.title.as_deref(),
        text: info.text.as_deref(),
    })
}

impl Rendered {
    pub fn gzip(&self) -> &Bytes {
        self.gzip.get_or_init(|| {
            let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(6));
            enc.write_all(&self.body).expect("escrita em memória");
            Bytes::from(enc.finish().expect("escrita em memória"))
        })
    }

    pub fn brotli(&self) -> &Bytes {
        self.brotli.get_or_init(|| {
            let mut out = Vec::new();
            {
                let mut enc = brotli::CompressorWriter::new(&mut out, 4096, 6, 22);
                enc.write_all(&self.body).expect("escrita em memória");
            }
            Bytes::from(out)
        })
    }
}

pub struct Catalog {
    current: ArcSwap<Snapshot>,
    boot: Boot,
}

impl Catalog {
    pub async fn load(repo: &Repo, boot: Boot) -> Result<Self, sqlx::Error> {
        let state = repo.load().await?;
        Ok(Catalog {
            current: ArcSwap::from_pointee(Snapshot::new(state, boot.clone())),
            boot,
        })
    }

    pub fn snapshot(&self) -> Arc<Snapshot> {
        self.current.load_full()
    }

    /// Relê o banco e troca o snapshot (o cache das playlists vai junto).
    pub async fn reload(&self, repo: &Repo) -> Result<(), sqlx::Error> {
        let state = repo.load().await?;
        self.current
            .store(Arc::new(Snapshot::new(state, self.boot.clone())));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connect_memory;
    use crate::model::{Crops, NewMedia, Point, Variant, VariantKind};
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn boot_is_the_start_instant_in_base36() {
        assert_eq!(Boot::at(UNIX_EPOCH).as_str(), "0");
        assert_eq!(
            Boot::at(UNIX_EPOCH + Duration::from_millis(36 * 36 + 35)).as_str(),
            "10z"
        );
        assert_eq!(boot().as_str(), "mubbs7i8");
        // instantes diferentes, identificadores diferentes
        let later = Boot::at(UNIX_EPOCH + Duration::from_millis(1_790_000_000_001));
        assert_ne!(later, boot());
    }

    const TV: Bucket = Bucket { w: 1920, h: 1080 };
    const PHONE: Bucket = Bucket { w: 1182, h: 2560 };

    /// 1.790.000.000.000 ms desde a época Unix, que em base 36 é "mubbs7i8".
    fn boot() -> Boot {
        Boot::at(UNIX_EPOCH + Duration::from_millis(1_790_000_000_000))
    }

    fn sample(id: &str) -> NewMedia {
        let file = |kind, suffix: &str, width, height| Variant {
            kind,
            url: format!("https://cdn.yanlucas.com/{id}{suffix}.jpeg"),
            width,
            height,
        };
        NewMedia {
            id: id.into(),
            version: "V1".into(),
            description: None,
            taken_at: None,
            color: "#c79442".into(),
            variants: vec![
                file(VariantKind::Thumbnail, "-thumbnail", 196, 123),
                file(VariantKind::Optimized, "-optimized", 981, 613),
                file(VariantKind::Full, "", 2944, 1839),
            ],
            focus: Point::CENTER,
            crops: Crops::default(),
            city: None,
            state: None,
            country: None,
        }
    }

    #[tokio::test]
    async fn write_changes_the_etag_and_memo_is_reused() {
        let repo = Repo::new(connect_memory().await.unwrap());
        repo.upsert(&sample("aaaaaaaaaaaaaaaaaaaaaaaa"))
            .await
            .unwrap();
        let catalog = Catalog::load(&repo, boot()).await.unwrap();
        let b = boot();
        let b = b.as_str();

        let snap = catalog.snapshot();
        let first = snap.playlist(TV);
        assert_eq!(first.etag, format!("\"r1-1920x1080-{b}\""));
        assert!(Arc::ptr_eq(&first, &snap.playlist(TV)), "memorizada");
        assert_eq!(snap.playlist(PHONE).etag, format!("\"r1-1182x2560-{b}\""));

        repo.upsert(&sample("bbbbbbbbbbbbbbbbbbbbbbbb"))
            .await
            .unwrap();
        catalog.reload(&repo).await.unwrap();
        let after_insert = catalog.snapshot().playlist(TV);
        assert_eq!(after_insert.etag, format!("\"r2-1920x1080-{b}\""));
        assert_ne!(after_insert.body, first.body);

        repo.remove(&["aaaaaaaaaaaaaaaaaaaaaaaa".into()])
            .await
            .unwrap();
        catalog.reload(&repo).await.unwrap();
        assert_eq!(
            catalog.snapshot().playlist(TV).etag,
            format!("\"r3-1920x1080-{b}\"")
        );
    }

    #[tokio::test]
    async fn playlist_items_have_every_field_in_registration_order() {
        let repo = Repo::new(connect_memory().await.unwrap());
        repo.upsert(&sample("aaaaaaaaaaaaaaaaaaaaaaaa"))
            .await
            .unwrap();
        repo.upsert(&sample("bbbbbbbbbbbbbbbbbbbbbbbb"))
            .await
            .unwrap();
        let catalog = Catalog::load(&repo, boot()).await.unwrap();

        let body: serde_json::Value =
            serde_json::from_slice(&catalog.snapshot().playlist(TV).body).unwrap();
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["id"], "aaaaaaaaaaaaaaaaaaaaaaaa");
        let first = &items[0];
        assert_eq!(
            first["src"],
            "https://cdn.yanlucas.com/aaaaaaaaaaaaaaaaaaaaaaaa.jpeg"
        );
        assert_eq!(first["width"], 2944);
        assert_eq!(first["height"], 1839);
        assert_eq!(first["color"], "#c79442");
        assert_eq!(first["orientation"], "landscape");
        for k in ["x", "y", "w", "h"] {
            assert!(first["crop"][k].is_f64(), "crop.{k}");
        }
    }

    #[tokio::test]
    async fn texts_are_computed_once_when_the_snapshot_is_built() {
        let repo = Repo::new(connect_memory().await.unwrap());
        let mut m = sample("aaaaaaaaaaaaaaaaaaaaaaaa");
        m.description = Some("Sunset Dune: This natural formation is part of it. More.".into());
        m.city = Some("Jericoacoara".into());
        repo.upsert(&m).await.unwrap();
        repo.upsert(&sample("bbbbbbbbbbbbbbbbbbbbbbbb"))
            .await
            .unwrap();
        let catalog = Catalog::load(&repo, boot()).await.unwrap();

        // prontos antes de qualquer faixa ser pedida
        let snap = catalog.snapshot();
        assert_eq!(snap.info.len(), snap.media.len());
        assert_eq!(snap.info[0].title.as_deref(), Some("Sunset Dune"));
        assert_eq!(
            snap.info[0].text.as_deref(),
            Some("This natural formation is part of it.")
        );
        assert_eq!(snap.info[0].place.as_deref(), Some("Jericoacoara"));
        assert_eq!(snap.info[1], Info::default());

        // as faixas usam os mesmos textos
        for screen in [TV, PHONE] {
            let body: serde_json::Value =
                serde_json::from_slice(&snap.playlist(screen).body).unwrap();
            assert_eq!(body["items"][0]["title"], "Sunset Dune");
            assert_eq!(body["items"][1]["text"], serde_json::Value::Null);
        }
    }

    #[test]
    fn compressed_bodies_round_trip() {
        use std::io::Read;
        let snap = Snapshot::new(
            CatalogState {
                revision: 7,
                media: Vec::new(),
            },
            boot(),
        );
        let r = snap.playlist(TV);
        assert_eq!(&r.body[..], br#"{"items":[]}"#);
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&r.gzip()[..])
            .read_to_end(&mut out)
            .unwrap();
        assert_eq!(out, r.body);
        let mut out = Vec::new();
        brotli::Decompressor::new(&r.brotli()[..], 4096)
            .read_to_end(&mut out)
            .unwrap();
        assert_eq!(out, r.body);
    }
}
