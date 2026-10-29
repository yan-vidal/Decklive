# Design

## Context

- **Repetição na origem:** em 28/10/2026, a origem tinha 784 fotos com 103 descrições distintas e 62 locais. Quase sempre o mesmo texto se repete em dezenas de fotos (por exemplo, a descrição "São Paulo: A megacity…").
- **Onde ficam os textos hoje:** `media.description`, `city`, `state` e `country` guardam o texto da origem, em inglês.
- **Como os textos chegam à playlist:**
  - `info.rs` calcula `place`, `title` e `text` uma vez por `revision`;
  - o snapshot memoriza a resposta por `(revision, faixa)`.
- **No player:** `i18n.ts` só escolhe pt-BR ou inglês para os textos fixos da interface.

## Goals / Non-Goals

**Goals:**
- Uma tradução por texto distinto, não por foto. Assim, a carga em pt-BR é de cerca de 160 textos, e não de 784 fotos.
- Poucas URLs de playlist no cache: o idioma é canonizado com `308`, como a faixa de tela.

**Non-Goals:**
- Tradução automática na API.
- Tradução feita por foto, para trocar o texto de uma foto só.
- Idioma escolhido nos ajustes.

## Decisions

### D1. Tabela `translation` com chave pelo texto da origem
```sql
CREATE TABLE translation (
  lang       TEXT NOT NULL,   -- etiqueta canônica: 'pt-BR', 'es'
  source     TEXT NOT NULL,   -- texto exato da origem, sem espaços nas pontas
  text       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (lang, source)
);
```

A chave é o texto inteiro. O SQLite indexa o texto pela chave primária sem problema nesse volume. A alternativa seria usar um hash como chave, e descartei porque a listagem `missing` e a depuração ficam mais simples com o texto inteiro.

Se o texto mudar na origem, a busca deixa de achar a tradução, e a foto volta ao inglês. É o comportamento certo, porque não mostra uma tradução de um texto que já não existe.

Considerei e descartei uma tabela por foto `(media_id, lang)`: exigiria gravar 784 linhas para cobrir 103 textos, e as fotos registradas depois não herdariam a tradução.

### D2. Etiqueta de idioma
- **Validação:** a etiqueta tem de casar com `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$`.
- **Normalização:** a língua fica em minúsculas, a região de 2 letras em maiúsculas e o script de 4 letras com a primeira maiúscula. Exemplos: `pt-br` vira `pt-BR`, e `zh-hant-tw` vira `zh-Hant-TW`.
- **Idioma da origem:** `en` é constante (`SOURCE_LANG`). Gravar traduções em `en` dá `422`.
- **Escolha do idioma canônico** (spec `playlist`): o conjunto de idiomas disponíveis vem de `SELECT DISTINCT lang`, carregado junto com o catálogo a cada `revision`. Em seguida:
  1. vale a etiqueta igual, sem diferenciar maiúsculas;
  2. senão, a mesma língua: o primeiro idioma disponível, em ordem alfabética, com a mesma subetiqueta primária;
  3. senão, inglês, que é a URL sem `lang`.

### D3. Playlist por idioma
- **Cálculo dos textos:** `info.rs` passa a receber uma função de busca (`lookup(source) -> Option<&str>`). Antes de `split_description`/`summary`, a descrição é trocada pela tradução, se houver. Cada parte do local também é trocada, e a regra de não repetir parte vale sobre o texto traduzido.
- **Momento do cálculo:** os textos são calculados por `(revision, lang)`, uma vez, e o snapshot memoriza por `(revision, faixa, lang)`.
- **Gravação:** as rotas de tradução sobem a `revision` na mesma transação, como as de catálogo.
- **Formato do `ETag`:** `"r<rev>-<w>x<h>-<lang|en>-<boot>"`.
- **Ordem do redirecionamento:** o `308` canoniza a faixa e o idioma juntos, num único redirecionamento.

### D4. Rotas de administrador
Ficam em `src/routes/translations.rs`, atrás do mesmo middleware de token.

| Rota | Corpo ou parâmetros | Resposta |
|---|---|---|
| `PUT /api/translations/{lang}` | `{items: [{source, text}]}`, até 2.000 itens, numa transação só | `{lang, saved}` |
| `GET /api/translations/{lang}` | — | `{lang, items: [{source, text, updated_at}], total}` |
| `GET /api/translations/{lang}?missing=true` | — | `{lang, items: [{source, kind, photos}]}` |
| `DELETE /api/translations/{lang}` | `{sources: [...]}` | `{removed, not_found}` |

- **Lista `missing`:** `kind` é `description`, `city`, `state` ou `country`. A lista vem ordenada por `photos`, da maior para a menor, e é montada do catálogo em memória.
- **Corpo:** limite de 2 MB na rota. A carga no servidor de casa é feita de dentro dele, direto em `127.0.0.1:8084`, sem passar pelo nginx, que limita o corpo a 1 MB.

### D5. Player
- **Pedido da playlist:** `api.ts` passa a mandar `lang` com a etiqueta do navegador. O `_` vira `-`, e o `lang` só vai quando a etiqueta passa na mesma validação da API: com uma etiqueta como `en-US-u-ca-gregory`, a API responderia `400` e o player ficaria sem fotos. Quem canoniza é a API, e o `fetch` segue o `308` sozinho.
- **Playlist guardada:** a chave do `localStorage` ganha o idioma pedido (`decklive.playlist.v1.<lang>`), para não mostrar português guardado num navegador em inglês.
- **`i18n.ts` não muda:** os textos fixos da interface continuam em pt-BR ou inglês.

### D6. Carga inicial em pt-BR
O arquivo `fixtures/translations/pt-BR.json` tem o formato `{"items": [{"source", "text"}]}`. Ele é gerado a partir da amostra das 784 fotos e cobre todas as descrições e partes de local distintas.

A tradução é feita uma vez, nesta mudança, por um subagente, com estas regras:
- manter o formato "Título: texto";
- nomes próprios e de lugar no uso brasileiro: `Japan` vira "Japão", `Tokyo` vira "Tóquio", e `São Paulo` fica igual;
- textos que não mudam (por exemplo, `Osaka`) entram com o texto igual ao original. Assim, `missing=true` mostra só o que ainda falta traduzir.

A revisão confere uma amostra à mão. A carga é feita com `PUT /api/translations/pt-BR`, na máquina local e no servidor de casa.

## Risks / Trade-offs

- **[Tradução de máquina com erro de fato ou de nome]** → O arquivo fica no repositório e é revisável. A correção é regravar só o item.
- **[A playlist em pt-BR é uma URL a mais no cache]** → São dois idiomas por faixa. O custo de memória por snapshot é pequeno (medido na mudança anterior: 365 KB para 1.000 itens, sem compressão).
- **[Etiquetas raras (`zh-Hant`) nunca usadas]** → A canonização leva qualquer idioma sem tradução ao inglês, então não há explosão de URLs.

## Migration Plan

1. A migração `0003_translation.sql` cria a tabela vazia, e nada muda para quem não manda `lang`.
2. Antes do deploy, fazer uma cópia de `data/decklive.db` (como na mudança anterior, a imagem antiga não sobe com uma migração desconhecida).
3. Depois do deploy, carregar `fixtures/translations/pt-BR.json` no servidor de casa com `PUT /api/translations/pt-BR`.
