//! Regras de importação de uma foto da origem: versão, cor e hosts (design D4).

use crate::error::ApiError;
use crate::measure::{DimensionProbe, resolve_dimensions};
use crate::model::{Crops, NewMedia, Point, Variant, VariantKind};
use crate::source::{PaletteColor, SourceDoc, SourceVersion};

pub const ORIGINAL: &str = "original";

#[derive(Debug, Clone, PartialEq)]
pub struct ChosenVersion<'a> {
    /// `original` ou o `versionName` da origem.
    pub name: String,
    pub files: &'a SourceVersion,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionError {
    Unknown {
        requested: String,
        available: Vec<String>,
    },
    /// A origem não trouxe nenhum arquivo para a foto.
    NoFiles,
}

/// Nome de cada versão editada; sem `versionName`, usa a posição (`V1`, `V2`...).
fn edited_versions(doc: &SourceDoc) -> impl Iterator<Item = (String, &SourceVersion)> {
    doc.images.iter().enumerate().map(|(i, v)| {
        let name = v
            .version_name
            .clone()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| format!("V{}", i + 1));
        (name, v)
    })
}

/// Versões que podem ser pedidas em `version`.
pub fn available_versions(doc: &SourceDoc) -> Vec<String> {
    let mut names: Vec<String> = edited_versions(doc).map(|(n, _)| n).collect();
    if doc.original.is_some() {
        names.push(ORIGINAL.into());
    }
    names
}

/// Sem pedido, usa a primeira versão editada, como a galeria; sem versões, o original.
pub fn choose_version<'a>(
    doc: &'a SourceDoc,
    requested: Option<&str>,
) -> Result<ChosenVersion<'a>, VersionError> {
    let Some(wanted) = requested else {
        return edited_versions(doc)
            .next()
            .map(|(name, files)| ChosenVersion { name, files })
            .or_else(|| {
                doc.original.as_ref().map(|files| ChosenVersion {
                    name: ORIGINAL.into(),
                    files,
                })
            })
            .ok_or(VersionError::NoFiles);
    };

    let wanted = wanted.trim();
    if wanted.eq_ignore_ascii_case(ORIGINAL)
        && let Some(files) = doc.original.as_ref()
    {
        return Ok(ChosenVersion {
            name: ORIGINAL.into(),
            files,
        });
    }
    edited_versions(doc)
        .find(|(name, _)| !wanted.is_empty() && name.eq_ignore_ascii_case(wanted))
        .map(|(name, files)| ChosenVersion { name, files })
        .ok_or_else(|| VersionError::Unknown {
            requested: wanted.into(),
            available: available_versions(doc),
        })
}

/// Cor de maior `score` da paleta, em `#rrggbb`.
pub fn dominant_color(palette: &[PaletteColor]) -> Option<String> {
    let best = palette.iter().max_by(|a, b| a.score.total_cmp(&b.score))?;
    let channel = |v: f64| v.round().clamp(0.0, 255.0) as u8;
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel(best.red),
        channel(best.green),
        channel(best.blue)
    ))
}

/// Aceita só `https` num host da lista; assim a playlist nunca aponta para fora dela.
pub fn check_media_url(url: &str, hosts: &[String]) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| format!("URL inválida: {url}"))?;
    if parsed.scheme() != "https" {
        return Err(format!("a URL não usa https: {url}"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!("a URL tem usuário ou senha: {url}"));
    }
    let host = parsed.host_str().unwrap_or_default();
    if hosts.iter().any(|h| h.eq_ignore_ascii_case(host)) {
        Ok(())
    } else {
        Err(format!(
            "o host {host} não está em DECKLIVE_MEDIA_HOSTS: {url}"
        ))
    }
}

/// Cor usada quando a origem não traz paleta.
const FALLBACK_COLOR: &str = "#000000";

/// Monta a foto a gravar: versão, arquivos medidos, cor, descrição, local e data.
pub async fn build_media(
    doc: &SourceDoc,
    requested_version: Option<&str>,
    media_hosts: &[String],
    probe: &dyn DimensionProbe,
    focus: Point,
    crops: Crops,
) -> Result<NewMedia, ApiError> {
    let chosen = choose_version(doc, requested_version).map_err(|e| match e {
        VersionError::Unknown {
            requested,
            available,
        } => ApiError::UnknownVersion {
            requested,
            available,
        },
        VersionError::NoFiles => {
            ApiError::BadGateway("a origem não trouxe nenhum arquivo para a foto".into())
        }
    })?;

    let md = &doc.metadata;
    let pair = |w: Option<u32>, h: Option<u32>| w.zip(h);
    let candidates = [
        (
            VariantKind::Thumbnail,
            chosen.files.thumbnail_url.as_deref(),
            pair(md.thumbnail_width, md.thumbnail_height),
        ),
        (
            VariantKind::Optimized,
            chosen.files.optimized_url.as_deref(),
            pair(md.optimized_width, md.optimized_height),
        ),
        (
            VariantKind::Full,
            chosen.files.full_size_url.as_deref(),
            pair(md.full_size_width, md.full_size_height),
        ),
    ];
    for (_, url, _) in &candidates {
        if let Some(url) = url.filter(|u| !u.trim().is_empty()) {
            check_media_url(url, media_hosts).map_err(ApiError::BadGateway)?;
        }
    }

    // As três medições correm juntas.
    let measure = |i: usize| {
        let (kind, url, fallback) = candidates[i];
        async move {
            let url = url.filter(|u| !u.trim().is_empty())?;
            let (width, height) = resolve_dimensions(probe, url, fallback).await?;
            Some(Variant {
                kind,
                url: url.to_string(),
                width,
                height,
            })
        }
    };
    let (thumbnail, optimized, full) = tokio::join!(measure(0), measure(1), measure(2));
    let Some(full) = full else {
        return Err(ApiError::BadGateway(
            "não deu para obter o arquivo original da foto nem as dimensões dele".into(),
        ));
    };
    for (kind, missing) in [("miniatura", &thumbnail), ("otimizado", &optimized)] {
        if missing.is_none() {
            tracing::warn!(id = %doc.id, kind, "arquivo sem URL ou sem dimensões; ficou de fora");
        }
    }
    let mut variants: Vec<Variant> = [thumbnail, optimized, Some(full)]
        .into_iter()
        .flatten()
        .collect();
    variants.sort_by_key(|v| u64::from(v.width) * u64::from(v.height));

    let color = dominant_color(&chosen.files.color_palette)
        .or_else(|| {
            doc.original
                .as_ref()
                .and_then(|o| dominant_color(&o.color_palette))
        })
        .unwrap_or_else(|| FALLBACK_COLOR.into());

    Ok(NewMedia {
        id: doc.id.clone(),
        version: chosen.name,
        description: doc
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(String::from),
        taken_at: md.taken_at.clone(),
        color,
        variants,
        focus,
        crops,
        // já sem os espaços das pontas (`source.rs`); as coordenadas nem são lidas
        city: doc.city.clone(),
        state: doc.state.clone(),
        country: doc.country.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = include_str!("../tests/fixtures/source-page.json");

    fn doc(id: &str) -> SourceDoc {
        let page: serde_json::Value = serde_json::from_str(PAGE).unwrap();
        let item = page["images"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["_id"] == id)
            .unwrap()
            .clone();
        serde_json::from_value(item).unwrap()
    }

    const WITH_V1: &str = "66d312a4124fa13304b01ea7";
    const WITH_V1_V2_V3: &str = "66d31e67124fa13304b0236d";
    const ONLY_ORIGINAL: &str = "66d31f8f124fa13304b024c1";

    #[test]
    fn default_version_is_the_first_edited_one() {
        let d = doc(WITH_V1);
        let chosen = choose_version(&d, None).unwrap();
        assert_eq!(chosen.name, "V1");
        assert_eq!(
            chosen.files.full_size_url.as_deref(),
            Some("https://cdn.yanlucas.com/1725108890838-IMG_8665.jpeg")
        );
    }

    #[test]
    fn original_requested() {
        let d = doc(WITH_V1);
        let chosen = choose_version(&d, Some("original")).unwrap();
        assert_eq!(chosen.name, "original");
        assert_eq!(
            chosen.files.full_size_url.as_deref(),
            Some("https://cdn.yanlucas.com/1725108894849-IMG_8666.jpeg")
        );
        // sem diferenciar maiúsculas
        assert_eq!(
            choose_version(&d, Some("Original")).unwrap().name,
            "original"
        );
    }

    #[test]
    fn named_version_requested() {
        let d = doc(WITH_V1_V2_V3);
        let chosen = choose_version(&d, Some("v2")).unwrap();
        assert_eq!(chosen.name, "V2");
        assert_eq!(chosen.files, &d.images[1]);
    }

    #[test]
    fn unknown_version_lists_available_ones() {
        let d = doc(WITH_V1_V2_V3);
        assert_eq!(
            choose_version(&d, Some("V9")),
            Err(VersionError::Unknown {
                requested: "V9".into(),
                available: vec!["V1".into(), "V2".into(), "V3".into(), "original".into()],
            })
        );
        assert!(matches!(
            choose_version(&d, Some("")),
            Err(VersionError::Unknown { .. })
        ));
    }

    #[test]
    fn without_edited_versions_uses_original() {
        let d = doc(ONLY_ORIGINAL);
        let chosen = choose_version(&d, None).unwrap();
        assert_eq!(chosen.name, "original");
        assert_eq!(
            choose_version(&d, Some("V1")),
            Err(VersionError::Unknown {
                requested: "V1".into(),
                available: vec!["original".into()],
            })
        );
    }

    #[test]
    fn missing_version_name_uses_position() {
        let mut d = doc(WITH_V1_V2_V3);
        d.images[1].version_name = None;
        assert_eq!(available_versions(&d), ["V1", "V2", "V3", "original"]);
        assert_eq!(choose_version(&d, Some("V2")).unwrap().files, &d.images[1]);
    }

    #[test]
    fn no_files_at_all() {
        let mut d = doc(ONLY_ORIGINAL);
        d.original = None;
        assert_eq!(choose_version(&d, None), Err(VersionError::NoFiles));
    }

    fn color(r: f64, g: f64, b: f64, score: f64) -> PaletteColor {
        PaletteColor {
            red: r,
            green: g,
            blue: b,
            score,
        }
    }

    #[test]
    fn dominant_color_is_the_highest_score() {
        let d = doc(WITH_V1);
        assert_eq!(
            dominant_color(&d.images[0].color_palette).as_deref(),
            Some("#c79442")
        );
        let palette = [color(0.0, 0.0, 0.0, 0.1), color(255.0, 16.0, 1.4, 0.9)];
        assert_eq!(dominant_color(&palette).as_deref(), Some("#ff1001"));
        // valores fora da faixa são limitados
        assert_eq!(
            dominant_color(&[color(300.0, -5.0, 127.6, 1.0)]).as_deref(),
            Some("#ff0080")
        );
        assert_eq!(dominant_color(&[]), None);
    }

    #[test]
    fn media_hosts_allow_list() {
        let hosts = vec!["cdn.yanlucas.com".to_string()];
        assert!(check_media_url("https://cdn.yanlucas.com/a.jpeg", &hosts).is_ok());
        assert!(check_media_url("https://CDN.yanlucas.com/a.jpeg", &hosts).is_ok());
        assert!(check_media_url("http://cdn.yanlucas.com/a.jpeg", &hosts).is_err());
        assert!(check_media_url("https://evil.example/a.jpeg", &hosts).is_err());
        assert!(check_media_url("https://cdn.yanlucas.com.evil.example/a", &hosts).is_err());
        assert!(check_media_url("https://x@cdn.yanlucas.com/a.jpeg", &hosts).is_err());
        assert!(check_media_url("/relativo.jpeg", &hosts).is_err());
        assert!(check_media_url("javascript:alert(1)", &hosts).is_err());
    }
}
