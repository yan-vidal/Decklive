//! Token de administrador nas rotas `/api/media`.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use subtle::ConstantTimeEq;

use crate::error::ApiError;

/// Token esperado, guardado à parte do resto do estado.
#[derive(Clone)]
pub struct AdminToken(pub Arc<str>);

pub async fn require_admin(
    State(token): State<AdminToken>,
    request: Request,
    next: Next,
) -> Response {
    if bearer_matches(request.headers(), &token.0) {
        next.run(request).await
    } else {
        ApiError::Unauthorized.into_response()
    }
}

/// Compara `Authorization: Bearer <token>` em tempo constante.
pub fn bearer_matches(headers: &HeaderMap, expected: &str) -> bool {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    let Some((scheme, given)) = value.trim().split_once(' ') else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("bearer") {
        return false;
    }
    given.trim().as_bytes().ct_eq(expected.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn with_auth(value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, HeaderValue::from_str(value).unwrap());
        h
    }

    #[test]
    fn accepts_only_the_exact_bearer_token() {
        assert!(bearer_matches(
            &with_auth(&format!("Bearer {TOKEN}")),
            TOKEN
        ));
        assert!(bearer_matches(
            &with_auth(&format!("bearer {TOKEN}")),
            TOKEN
        ));
        assert!(!bearer_matches(&HeaderMap::new(), TOKEN));
        assert!(!bearer_matches(&with_auth(TOKEN), TOKEN));
        assert!(!bearer_matches(
            &with_auth(&format!("Basic {TOKEN}")),
            TOKEN
        ));
        assert!(!bearer_matches(
            &with_auth(&format!("Bearer {TOKEN}x")),
            TOKEN
        ));
        assert!(!bearer_matches(
            &with_auth(&format!("Bearer {}", &TOKEN[1..])),
            TOKEN
        ));
        assert!(!bearer_matches(&with_auth("Bearer "), TOKEN));
    }
}
