-- Traduções por idioma e por texto da origem (design D1 de add-localized-descriptions).
-- Uma linha vale para todas as fotos com o mesmo texto, inclusive as registradas
-- depois. Se o texto mudar na origem, a busca deixa de achar a tradução.
CREATE TABLE translation (
  lang       TEXT NOT NULL,   -- etiqueta canônica: 'pt-BR', 'es'
  source     TEXT NOT NULL,   -- texto exato da origem, sem espaços nas pontas
  text       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (lang, source)
);
