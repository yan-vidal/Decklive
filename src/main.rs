//! Binário do DeckLive: API e player web no mesmo processo.

use std::process::ExitCode;
use std::sync::Arc;

use tracing_subscriber::EnvFilter;

use decklive::app::{self, AppDeps, AppState};
use decklive::catalog::Boot;
use decklive::config::Config;
use decklive::db::{self, Repo};
use decklive::measure::HttpProbe;
use decklive::source::{DEFAULT_TIMEOUT, SourceClient};

#[tokio::main]
async fn main() -> ExitCode {
    // identifica esta instância no ETag da playlist (design D5)
    let boot = Boot::now();
    tracing_subscriber::fmt()
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("decklive=info,tower_http=info")),
        )
        .init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("decklive: {e}");
            return ExitCode::FAILURE;
        }
    };

    match run(config, boot).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("decklive: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(config: Config, boot: Boot) -> Result<(), Box<dyn std::error::Error>> {
    let pool = db::connect(&config.database).await?;
    let repo = Repo::new(pool);
    let source = SourceClient::new(&config.source_api, DEFAULT_TIMEOUT)?;
    let probe = Arc::new(HttpProbe::new(source.http().clone()));
    let state = AppState::new(AppDeps {
        admin_token: config.admin_token.clone(),
        repo,
        source,
        probe,
        media_hosts: config.media_hosts.clone(),
        boot: boot.clone(),
    })
    .await?;
    let snapshot = state.catalog().snapshot();
    tracing::info!(
        photos = snapshot.media.len(),
        revision = snapshot.revision,
        boot = boot.as_str(),
        database = %config.database.display(),
        "catálogo carregado"
    );

    if !config.web_dir.join("index.html").is_file() {
        tracing::warn!(
            web_dir = %config.web_dir.display(),
            "player web não encontrado; só a API vai responder"
        );
    }
    let app = app::app(state, &config.web_dir);

    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(addr = %listener.local_addr()?, "DeckLive no ar");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Encerra com Ctrl+C ou SIGTERM (Docker).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("encerrando");
}
