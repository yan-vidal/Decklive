//! SQLite: conexão, migrações e repositório do catálogo (design D3).

use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteRow,
    SqliteSynchronous,
};
use sqlx::{Row, Sqlite, Transaction};

use crate::model::{Crops, Media, NewMedia, Point, Rect, Variant};

/// Abre (ou cria) o banco em arquivo com WAL e aplica as migrações.
pub async fn connect(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}

/// Banco em memória para testes: uma conexão só, que nunca expira.
pub async fn connect_memory() -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

/// Estado do catálogo lido de uma vez: versão e fotos na ordem de registro.
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogState {
    pub revision: i64,
    pub media: Vec<Media>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Removal {
    pub removed: Vec<String>,
    pub not_found: Vec<String>,
}

#[derive(Clone)]
pub struct Repo {
    pool: SqlitePool,
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SELECT_COLUMNS: &str = "id, source, version, description, city, state, country, \
     taken_at, color, variants, focus_x, focus_y, crop_landscape, crop_portrait, \
     created_at, updated_at";

impl Repo {
    pub fn new(pool: SqlitePool) -> Self {
        Repo { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Grava a foto (nova ou de novo). Devolve a foto gravada e se ela é nova.
    pub async fn upsert(&self, m: &NewMedia) -> Result<(Media, bool), sqlx::Error> {
        let variants = to_json(&m.variants)?;
        let landscape = m.crops.landscape.map(|r| to_json(&r)).transpose()?;
        let portrait = m.crops.portrait.map(|r| to_json(&r)).transpose()?;

        let mut tx = self.pool.begin().await?;
        // A primeira instrução escreve: pega a trava de escrita logo de cara.
        bump_revision(&mut tx).await?;
        let existed: Option<i64> = sqlx::query_scalar("SELECT 1 FROM media WHERE id = ?")
            .bind(&m.id)
            .fetch_optional(&mut *tx)
            .await?;

        // `now` é o mesmo dentro de uma instrução, então created_at == updated_at na criação.
        let sql = format!(
            "INSERT INTO media (id, source, version, description, city, state, country, \
                taken_at, color, variants, focus_x, focus_y, crop_landscape, crop_portrait, \
                created_at, updated_at) \
             VALUES (?, 'yanlucas', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {NOW}, {NOW}) \
             ON CONFLICT(id) DO UPDATE SET \
                source = excluded.source, version = excluded.version, \
                description = excluded.description, city = excluded.city, \
                state = excluded.state, country = excluded.country, \
                taken_at = excluded.taken_at, \
                color = excluded.color, variants = excluded.variants, \
                focus_x = excluded.focus_x, focus_y = excluded.focus_y, \
                crop_landscape = excluded.crop_landscape, crop_portrait = excluded.crop_portrait, \
                updated_at = excluded.updated_at \
             RETURNING {SELECT_COLUMNS}"
        );
        let row = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(&m.id)
            .bind(&m.version)
            .bind(&m.description)
            .bind(&m.city)
            .bind(&m.state)
            .bind(&m.country)
            .bind(&m.taken_at)
            .bind(&m.color)
            .bind(variants)
            .bind(m.focus.x)
            .bind(m.focus.y)
            .bind(landscape)
            .bind(portrait)
            .fetch_one(&mut *tx)
            .await?;
        let media = media_from_row(&row)?;
        tx.commit().await?;
        Ok((media, existed.is_none()))
    }

    /// Remove as fotos listadas. A versão só sobe se alguma foto saiu.
    pub async fn remove(&self, ids: &[String]) -> Result<Removal, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        bump_revision(&mut tx).await?;
        let mut removal = Removal {
            removed: Vec::new(),
            not_found: Vec::new(),
        };
        for id in ids {
            let gone: Option<String> =
                sqlx::query_scalar("DELETE FROM media WHERE id = ? RETURNING id")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await?;
            match gone {
                Some(id) => removal.removed.push(id),
                None => removal.not_found.push(id.clone()),
            }
        }
        if removal.removed.is_empty() {
            tx.rollback().await?;
        } else {
            tx.commit().await?;
        }
        Ok(removal)
    }

    /// Lê a versão e todas as fotos numa leitura consistente.
    pub async fn load(&self) -> Result<CatalogState, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let revision = read_revision(&mut tx).await?;
        let sql = format!("SELECT {SELECT_COLUMNS} FROM media ORDER BY created_at, rowid");
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(&mut *tx)
            .await?;
        tx.commit().await?;
        let media = rows
            .iter()
            .map(media_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CatalogState { revision, media })
    }

    pub async fn revision(&self) -> Result<i64, sqlx::Error> {
        let mut conn = self.pool.acquire().await?;
        let value: String =
            sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'revision'")
                .fetch_one(&mut *conn)
                .await?;
        parse_revision(&value)
    }
}

async fn bump_revision(tx: &mut Transaction<'_, Sqlite>) -> Result<i64, sqlx::Error> {
    let value: String = sqlx::query_scalar(
        "UPDATE catalog_meta SET value = CAST(value AS INTEGER) + 1 \
         WHERE key = 'revision' RETURNING value",
    )
    .fetch_one(&mut **tx)
    .await?;
    parse_revision(&value)
}

async fn read_revision(tx: &mut Transaction<'_, Sqlite>) -> Result<i64, sqlx::Error> {
    let value: String = sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'revision'")
        .fetch_one(&mut **tx)
        .await?;
    parse_revision(&value)
}

fn parse_revision(value: &str) -> Result<i64, sqlx::Error> {
    value
        .parse()
        .map_err(|e| sqlx::Error::Decode(format!("revision inválida '{value}': {e}").into()))
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, sqlx::Error> {
    serde_json::to_string(value).map_err(|e| sqlx::Error::Encode(Box::new(e)))
}

fn from_json<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, sqlx::Error> {
    serde_json::from_str(text).map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

fn media_from_row(row: &SqliteRow) -> Result<Media, sqlx::Error> {
    let variants: String = row.try_get("variants")?;
    let landscape: Option<String> = row.try_get("crop_landscape")?;
    let portrait: Option<String> = row.try_get("crop_portrait")?;
    Ok(Media {
        id: row.try_get("id")?,
        source: row.try_get("source")?,
        version: row.try_get("version")?,
        description: row.try_get("description")?,
        city: row.try_get("city")?,
        state: row.try_get("state")?,
        country: row.try_get("country")?,
        taken_at: row.try_get("taken_at")?,
        color: row.try_get("color")?,
        variants: from_json::<Vec<Variant>>(&variants)?,
        focus: Point {
            x: row.try_get("focus_x")?,
            y: row.try_get("focus_y")?,
        },
        crops: Crops {
            landscape: landscape.as_deref().map(from_json::<Rect>).transpose()?,
            portrait: portrait.as_deref().map(from_json::<Rect>).transpose()?,
        },
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::VariantKind;

    fn sample(id: &str) -> NewMedia {
        NewMedia {
            id: id.into(),
            version: "V1".into(),
            description: Some("Duna".into()),
            taken_at: Some("2015-10-16T15:35:41.000Z".into()),
            color: "#c79442".into(),
            variants: vec![
                Variant {
                    kind: VariantKind::Thumbnail,
                    url: "https://cdn.yanlucas.com/a-thumbnail.jpeg".into(),
                    width: 196,
                    height: 123,
                },
                Variant {
                    kind: VariantKind::Full,
                    url: "https://cdn.yanlucas.com/a.jpeg".into(),
                    width: 2944,
                    height: 1839,
                },
            ],
            focus: Point::CENTER,
            crops: Crops::default(),
            city: None,
            state: None,
            country: None,
        }
    }

    fn with_place(id: &str) -> NewMedia {
        NewMedia {
            city: Some("Jericoacoara".into()),
            state: Some("Ceará".into()),
            country: Some("Brazil".into()),
            ..sample(id)
        }
    }

    #[tokio::test]
    async fn place_is_stored_and_replaced_on_new_registration() {
        let repo = Repo::new(connect_memory().await.unwrap());
        let id = "aaaaaaaaaaaaaaaaaaaaaaaa";
        let (m, _) = repo.upsert(&with_place(id)).await.unwrap();
        assert_eq!(m.city.as_deref(), Some("Jericoacoara"));
        assert_eq!(m.state.as_deref(), Some("Ceará"));
        assert_eq!(m.country.as_deref(), Some("Brazil"));
        assert_eq!(repo.load().await.unwrap().media[0], m);

        // a origem perdeu a cidade e o estado: o novo registro apaga os dois
        let again = NewMedia {
            city: None,
            state: None,
            ..with_place(id)
        };
        let (m, _) = repo.upsert(&again).await.unwrap();
        assert_eq!(
            (m.city, m.state, m.country.as_deref()),
            (None, None, Some("Brazil"))
        );
    }

    #[tokio::test]
    async fn migration_0002_keeps_photos_registered_before_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("decklive.db");
        let id = "66d312a4124fa13304b01ea7";
        let variants = to_json(&sample(id).variants).unwrap();

        // banco como a versão anterior o deixava: só a migração 0001, com uma foto
        {
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .unwrap();
            sqlx::migrate!("./migrations")
                .run_to(1, &pool)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO media (id, version, description, taken_at, color, variants, \
                    focus_x, focus_y, crop_portrait, created_at, updated_at) \
                 VALUES (?, 'V1', 'Duna', NULL, '#c79442', ?, 0.25, 0.75, \
                    '{\"x\":0.3,\"y\":0.0,\"w\":0.4,\"h\":1.0}', \
                    '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z')",
            )
            .bind(id)
            .bind(&variants)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query("UPDATE catalog_meta SET value = '1' WHERE key = 'revision'")
                .execute(&pool)
                .await
                .unwrap();
            pool.close().await;
        }

        // a versão nova aplica a 0002 ao abrir
        let repo = Repo::new(connect(&path).await.unwrap());
        let versions: Vec<i64> =
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(repo.pool())
                .await
                .unwrap();
        assert_eq!(versions, [1, 2]);

        let state = repo.load().await.unwrap();
        assert_eq!(state.revision, 1);
        assert_eq!(state.media.len(), 1);
        let m = &state.media[0];
        assert_eq!(m.id, id);
        assert_eq!(m.description.as_deref(), Some("Duna"));
        assert_eq!(m.variants, sample(id).variants);
        assert_eq!(m.focus, Point { x: 0.25, y: 0.75 });
        assert_eq!(m.crops.portrait.map(|r| r.w), Some(0.4));
        assert_eq!(m.created_at, "2026-10-28T12:00:00.000Z");
        assert_eq!((&m.city, &m.state, &m.country), (&None, &None, &None));

        // registrar de novo grava o local e mantém a data de criação
        let (m, created) = repo.upsert(&with_place(id)).await.unwrap();
        assert!(!created);
        assert_eq!(m.city.as_deref(), Some("Jericoacoara"));
        assert_eq!(m.created_at, "2026-10-28T12:00:00.000Z");
    }

    #[tokio::test]
    async fn revision_goes_up_and_created_at_is_kept() {
        let repo = Repo::new(connect_memory().await.unwrap());
        assert_eq!(repo.revision().await.unwrap(), 0);

        let (first, created) = repo
            .upsert(&sample("aaaaaaaaaaaaaaaaaaaaaaaa"))
            .await
            .unwrap();
        assert!(created);
        assert_eq!(first.created_at, first.updated_at);
        assert_eq!(repo.revision().await.unwrap(), 1);

        tokio::time::sleep(Duration::from_millis(5)).await;
        let mut again = sample("aaaaaaaaaaaaaaaaaaaaaaaa");
        again.crops.portrait = Some(Rect {
            x: 0.3,
            y: 0.0,
            w: 0.4,
            h: 1.0,
        });
        let (second, created) = repo.upsert(&again).await.unwrap();
        assert!(!created);
        assert_eq!(second.created_at, first.created_at);
        assert!(second.updated_at > first.updated_at);
        assert_eq!(second.crops.portrait, again.crops.portrait);
        assert_eq!(repo.revision().await.unwrap(), 2);

        let removal = repo
            .remove(&[
                "aaaaaaaaaaaaaaaaaaaaaaaa".into(),
                "bbbbbbbbbbbbbbbbbbbbbbbb".into(),
            ])
            .await
            .unwrap();
        assert_eq!(removal.removed, vec!["aaaaaaaaaaaaaaaaaaaaaaaa"]);
        assert_eq!(removal.not_found, vec!["bbbbbbbbbbbbbbbbbbbbbbbb"]);
        assert_eq!(repo.revision().await.unwrap(), 3);

        // nada removido: a versão não muda
        let removal = repo
            .remove(&["cccccccccccccccccccccccc".into()])
            .await
            .unwrap();
        assert!(removal.removed.is_empty());
        assert_eq!(repo.revision().await.unwrap(), 3);
    }

    #[tokio::test]
    async fn load_returns_registration_order_and_round_trips() {
        let repo = Repo::new(connect_memory().await.unwrap());
        let ids = [
            "000000000000000000000003",
            "000000000000000000000001",
            "000000000000000000000002",
        ];
        for id in ids {
            repo.upsert(&sample(id)).await.unwrap();
        }
        // registrar de novo não muda a ordem
        repo.upsert(&sample(ids[0])).await.unwrap();

        let state = repo.load().await.unwrap();
        assert_eq!(state.revision, 4);
        let got: Vec<&str> = state.media.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(got, ids);
        let m = &state.media[1];
        assert_eq!(m.source, "yanlucas");
        assert_eq!(m.variants, sample(ids[1]).variants);
        assert_eq!(m.focus, Point::CENTER);
        assert_eq!(m.crops, Crops::default());
    }

    #[tokio::test]
    async fn file_database_uses_wal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/decklive.db");
        let pool = connect(&path).await.unwrap();
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(mode, "wal");
        assert!(path.exists());
    }
}
