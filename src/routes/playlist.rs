//! `GET /api/playlist`: rota pública, servida da memória (spec playlist).

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};

use crate::app::AppState;
use crate::bucket::{self, MAX_SIDE};
use crate::error::ApiError;

pub const CACHE_CONTROL: &str = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
/// O redirecionamento para a faixa canônica só muda se o algoritmo mudar.
const REDIRECT_CACHE_CONTROL: &str = "public, max-age=86400";
/// Abaixo disso, comprimir não compensa.
const MIN_COMPRESS: usize = 512;

pub async fn get(State(state): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    let query = uri.query().unwrap_or("");
    let (w, h) = match parse_size(query) {
        Ok(size) => size,
        Err(message) => return ApiError::BadRequest(message).into_response(),
    };

    // Só a URL canônica, byte a byte, é respondida; o resto vai para ela.
    let screen = bucket::canonical(w, h);
    let canonical = format!("w={}&h={}", screen.w, screen.h);
    if query != canonical {
        let location = format!("/api/playlist?{canonical}");
        return (
            StatusCode::PERMANENT_REDIRECT,
            [
                (header::LOCATION, location),
                (header::CACHE_CONTROL, REDIRECT_CACHE_CONTROL.to_string()),
            ],
        )
            .into_response();
    }

    let snapshot = state.catalog().snapshot();
    let rendered = snapshot.playlist(screen);
    let etag = HeaderValue::from_str(&rendered.etag).expect("ETag é ASCII");
    let common = [
        (header::ETAG, etag),
        (
            header::CACHE_CONTROL,
            HeaderValue::from_static(CACHE_CONTROL),
        ),
        (header::VARY, HeaderValue::from_static("Accept-Encoding")),
    ];

    if etag_matches(&headers, &rendered.etag) {
        return (StatusCode::NOT_MODIFIED, common).into_response();
    }

    let json = HeaderValue::from_static("application/json");
    let encoding = if rendered.body.len() < MIN_COMPRESS {
        Encoding::Identity
    } else {
        negotiate(&headers)
    };
    match encoding {
        Encoding::Brotli => (
            common,
            [
                (header::CONTENT_TYPE, json),
                (header::CONTENT_ENCODING, HeaderValue::from_static("br")),
            ],
            rendered.brotli().clone(),
        )
            .into_response(),
        Encoding::Gzip => (
            common,
            [
                (header::CONTENT_TYPE, json),
                (header::CONTENT_ENCODING, HeaderValue::from_static("gzip")),
            ],
            rendered.gzip().clone(),
        )
            .into_response(),
        Encoding::Identity => (
            common,
            [(header::CONTENT_TYPE, json)],
            rendered.body.clone(),
        )
            .into_response(),
    }
}

/// Lê `w` e `h`: inteiros de 1 a 16384, só dígitos.
fn parse_size(query: &str) -> Result<(u32, u32), String> {
    let mut w = None;
    let mut h = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let slot = match key {
            "w" => &mut w,
            "h" => &mut h,
            _ => continue,
        };
        if slot.is_none() {
            *slot = Some(value);
        }
    }
    let parse = |name: &str, value: Option<&str>| -> Result<u32, String> {
        let value = value.ok_or_else(|| format!("falta o parâmetro {name}"))?;
        let ok = !value.is_empty() && value.len() <= 5 && value.bytes().all(|b| b.is_ascii_digit());
        value
            .parse::<u32>()
            .ok()
            .filter(|v| ok && (1..=MAX_SIDE).contains(v))
            .ok_or_else(|| format!("{name} precisa ser um inteiro entre 1 e {MAX_SIDE}"))
    };
    Ok((parse("w", w)?, parse("h", h)?))
}

/// `If-None-Match` com o ETag atual (comparação fraca, como manda o HTTP para 304).
fn etag_matches(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .any(|tag| tag == "*" || tag.strip_prefix("W/").unwrap_or(tag) == etag)
}

#[derive(Debug, PartialEq, Eq)]
enum Encoding {
    Brotli,
    Gzip,
    Identity,
}

/// Prefere brotli, depois gzip; `q=0` desliga a codificação.
fn negotiate(headers: &HeaderMap) -> Encoding {
    let mut brotli = false;
    let mut gzip = false;
    for value in headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|v| v.to_str().ok())
    {
        for part in value.split(',') {
            let mut pieces = part.split(';');
            let name = pieces.next().unwrap_or("").trim().to_ascii_lowercase();
            let q = pieces
                .filter_map(|p| p.trim().strip_prefix("q="))
                .filter_map(|q| q.trim().parse::<f32>().ok())
                .next()
                .unwrap_or(1.0);
            if q <= 0.0 {
                continue;
            }
            match name.as_str() {
                "br" => brotli = true,
                "gzip" | "x-gzip" => gzip = true,
                "*" => {
                    brotli = true;
                    gzip = true;
                }
                _ => {}
            }
        }
    }
    if brotli {
        Encoding::Brotli
    } else if gzip {
        Encoding::Gzip
    } else {
        Encoding::Identity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_must_be_digits_in_range() {
        assert_eq!(parse_size("w=1920&h=1080"), Ok((1920, 1080)));
        assert_eq!(parse_size("h=1080&w=1920&x=1"), Ok((1920, 1080)));
        assert_eq!(parse_size("w=1&h=16384"), Ok((1, 16384)));
        for bad in [
            "",
            "w=1920",
            "h=1080",
            "w=0&h=10",
            "w=16385&h=10",
            "w=abc&h=10",
            "w=-5&h=10",
            "w=1.5&h=10",
            "w=&h=10",
            "w=+5&h=10",
            "w=999999&h=10",
            "w=19%2020&h=10",
        ] {
            assert!(parse_size(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn negotiation_prefers_brotli_and_honors_q_zero() {
        let headers = |v: &str| {
            let mut h = HeaderMap::new();
            h.insert(header::ACCEPT_ENCODING, HeaderValue::from_str(v).unwrap());
            h
        };
        assert_eq!(negotiate(&headers("gzip, deflate, br")), Encoding::Brotli);
        assert_eq!(negotiate(&headers("gzip, deflate")), Encoding::Gzip);
        assert_eq!(negotiate(&headers("br;q=0, gzip;q=0.5")), Encoding::Gzip);
        assert_eq!(negotiate(&headers("identity")), Encoding::Identity);
        assert_eq!(negotiate(&HeaderMap::new()), Encoding::Identity);
    }

    #[test]
    fn etag_comparison_is_weak() {
        let headers = |v: &str| {
            let mut h = HeaderMap::new();
            h.insert(header::IF_NONE_MATCH, HeaderValue::from_str(v).unwrap());
            h
        };
        let etag = "\"r3-1920x1080-mubbs7i8\"";
        assert!(etag_matches(&headers("\"r3-1920x1080-mubbs7i8\""), etag));
        assert!(etag_matches(&headers("W/\"r3-1920x1080-mubbs7i8\""), etag));
        assert!(etag_matches(
            &headers("\"r2-1920x1080-mubbs7i8\", \"r3-1920x1080-mubbs7i8\""),
            etag
        ));
        assert!(etag_matches(&headers("*"), etag));
        assert!(!etag_matches(&headers("\"r2-1920x1080-mubbs7i8\""), etag));
        // mesmo catálogo, outra instância do processo
        assert!(!etag_matches(&headers("\"r3-1920x1080-mubbs7i9\""), etag));
        assert!(!etag_matches(&HeaderMap::new(), etag));
    }
}
