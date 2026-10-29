//! Configuração por variáveis de ambiente (design D8).

use std::net::SocketAddr;
use std::path::PathBuf;

pub const MIN_TOKEN_LEN: usize = 32;

pub const ENV_ADMIN_TOKEN: &str = "DECKLIVE_ADMIN_TOKEN";
pub const ENV_DATABASE: &str = "DECKLIVE_DATABASE";
pub const ENV_SOURCE_API: &str = "DECKLIVE_SOURCE_API";
pub const ENV_MEDIA_HOSTS: &str = "DECKLIVE_MEDIA_HOSTS";
pub const ENV_BIND: &str = "DECKLIVE_BIND";
pub const ENV_WEB_DIR: &str = "DECKLIVE_WEB_DIR";

#[derive(Debug, Clone)]
pub struct Config {
    pub admin_token: String,
    pub database: PathBuf,
    pub source_api: String,
    pub media_hosts: Vec<String>,
    pub bind: SocketAddr,
    pub web_dir: PathBuf,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error(
        "falta a variável {ENV_ADMIN_TOKEN}: defina um token de administrador com pelo menos {MIN_TOKEN_LEN} caracteres"
    )]
    MissingToken,
    #[error("a variável {ENV_ADMIN_TOKEN} tem {0} caracteres; o mínimo é {MIN_TOKEN_LEN}")]
    ShortToken(usize),
    #[error("a variável {ENV_BIND} não é um endereço válido (ex.: 0.0.0.0:8080): {0}")]
    InvalidBind(String),
    #[error("a variável {ENV_SOURCE_API} precisa ser uma URL http(s): {0}")]
    InvalidSourceApi(String),
    #[error("a variável {ENV_MEDIA_HOSTS} não tem nenhum host")]
    EmptyMediaHosts,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Lê a configuração de qualquer fonte de chave/valor (facilita os testes).
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let admin_token = get(ENV_ADMIN_TOKEN).unwrap_or_default();
        if admin_token.is_empty() {
            return Err(ConfigError::MissingToken);
        }
        let len = admin_token.chars().count();
        if len < MIN_TOKEN_LEN {
            return Err(ConfigError::ShortToken(len));
        }

        let source_api = get(ENV_SOURCE_API)
            .unwrap_or_else(|| "https://api.yanlucas.com".into())
            .trim()
            .trim_end_matches('/')
            .to_string();
        if !(source_api.starts_with("https://") || source_api.starts_with("http://")) {
            return Err(ConfigError::InvalidSourceApi(source_api));
        }

        let media_hosts: Vec<String> = get(ENV_MEDIA_HOSTS)
            .unwrap_or_else(|| "cdn.yanlucas.com".into())
            .split(',')
            .map(|h| h.trim().to_ascii_lowercase())
            .filter(|h| !h.is_empty())
            .collect();
        if media_hosts.is_empty() {
            return Err(ConfigError::EmptyMediaHosts);
        }

        let bind_raw = get(ENV_BIND).unwrap_or_else(|| "0.0.0.0:8080".into());
        let bind = bind_raw
            .trim()
            .parse()
            .map_err(|_| ConfigError::InvalidBind(bind_raw.clone()))?;

        Ok(Config {
            admin_token,
            database: get(ENV_DATABASE)
                .unwrap_or_else(|| "./data/decklive.db".into())
                .into(),
            source_api,
            media_hosts,
            bind,
            web_dir: get(ENV_WEB_DIR)
                .unwrap_or_else(|| "./web/dist".into())
                .into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn load(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|k| map.get(k).cloned())
    }

    #[test]
    fn missing_token_names_the_variable() {
        let err = load(&[]).unwrap_err();
        assert_eq!(err, ConfigError::MissingToken);
        assert!(err.to_string().contains("DECKLIVE_ADMIN_TOKEN"));
        // vazio conta como ausente
        assert_eq!(
            load(&[(ENV_ADMIN_TOKEN, "")]).unwrap_err(),
            ConfigError::MissingToken
        );
    }

    #[test]
    fn short_token_is_rejected() {
        let err = load(&[(ENV_ADMIN_TOKEN, &TOKEN[..31])]).unwrap_err();
        assert_eq!(err, ConfigError::ShortToken(31));
        assert!(err.to_string().contains("DECKLIVE_ADMIN_TOKEN"));
    }

    #[test]
    fn valid_token_uses_defaults() {
        let cfg = load(&[(ENV_ADMIN_TOKEN, TOKEN)]).unwrap();
        assert_eq!(cfg.admin_token, TOKEN);
        assert_eq!(cfg.database, PathBuf::from("./data/decklive.db"));
        assert_eq!(cfg.source_api, "https://api.yanlucas.com");
        assert_eq!(cfg.media_hosts, vec!["cdn.yanlucas.com".to_string()]);
        assert_eq!(cfg.bind, "0.0.0.0:8080".parse().unwrap());
        assert_eq!(cfg.web_dir, PathBuf::from("./web/dist"));
    }

    #[test]
    fn overrides_are_read() {
        let cfg = load(&[
            (ENV_ADMIN_TOKEN, TOKEN),
            (ENV_DATABASE, "/tmp/x.db"),
            (ENV_SOURCE_API, "http://localhost:9000/"),
            (ENV_MEDIA_HOSTS, "cdn.yanlucas.com, CDN2.example.com ,"),
            (ENV_BIND, "127.0.0.1:9999"),
            (ENV_WEB_DIR, "/srv/web"),
        ])
        .unwrap();
        assert_eq!(cfg.database, PathBuf::from("/tmp/x.db"));
        assert_eq!(cfg.source_api, "http://localhost:9000");
        assert_eq!(
            cfg.media_hosts,
            vec!["cdn.yanlucas.com", "cdn2.example.com"]
        );
        assert_eq!(cfg.bind, "127.0.0.1:9999".parse().unwrap());
        assert_eq!(cfg.web_dir, PathBuf::from("/srv/web"));
    }

    #[test]
    fn invalid_bind_and_hosts_are_rejected() {
        assert!(matches!(
            load(&[(ENV_ADMIN_TOKEN, TOKEN), (ENV_BIND, "8080")]),
            Err(ConfigError::InvalidBind(_))
        ));
        assert_eq!(
            load(&[(ENV_ADMIN_TOKEN, TOKEN), (ENV_MEDIA_HOSTS, " , ")]).unwrap_err(),
            ConfigError::EmptyMediaHosts
        );
    }
}
