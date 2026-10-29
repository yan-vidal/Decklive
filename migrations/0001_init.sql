-- Catálogo de fotos liberadas para exibição (design D3).
CREATE TABLE media (
  id             TEXT PRIMARY KEY,   -- _id do yanlucas.com (24 hex)
  source         TEXT NOT NULL DEFAULT 'yanlucas',
  version        TEXT NOT NULL,      -- 'original' ou versionName
  description    TEXT,
  taken_at       TEXT,
  color          TEXT NOT NULL,      -- '#rrggbb'
  variants       TEXT NOT NULL,      -- JSON [{kind,url,width,height}], do menor para o maior
  focus_x        REAL NOT NULL DEFAULT 0.5,
  focus_y        REAL NOT NULL DEFAULT 0.5,
  crop_landscape TEXT,               -- JSON {x,y,w,h} ou NULL
  crop_portrait  TEXT,
  created_at     TEXT NOT NULL,      -- não muda ao registrar de novo
  updated_at     TEXT NOT NULL
);

CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

INSERT INTO catalog_meta (key, value) VALUES ('revision', '0');
