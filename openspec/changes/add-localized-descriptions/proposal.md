# Proposal

## Why

A fonte (yanlucas.com) só tem as descrições e os nomes de lugar em inglês, e o player está em pt-BR para quem o usa hoje. O DeckLive precisa guardar esses textos em outros idiomas e entregar cada tela no idioma do navegador, com inglês quando não houver tradução.

## What Changes

- Novo dicionário de traduções no banco do DeckLive, por idioma e por texto da origem. Ele vale para a descrição e para as partes do local: cidade, estado e país.
  - Como a origem repete muito texto (784 fotos, 103 descrições e 62 locais), uma tradução cobre todas as fotos com o mesmo texto, inclusive as registradas depois.
- Novas rotas de administrador, protegidas pelo token:
  - `PUT /api/translations/{lang}` grava traduções;
  - `GET /api/translations/{lang}` lista as traduções, e com `missing=true` lista os textos do catálogo que ainda faltam traduzir;
  - `DELETE /api/translations/{lang}` remove traduções.
- `GET /api/playlist` aceita `lang`. A API escolhe o idioma disponível mais próximo e redireciona com `308` para a URL canônica, para manter poucas URLs no cache. Ela devolve `place`, `title` e `text` nesse idioma, e cada texto sem tradução cai no inglês.
- O player passa a mandar o idioma do navegador no pedido da playlist.
- Carga inicial: as descrições e os nomes de lugar das 784 fotos da origem são traduzidos para pt-BR uma vez. O arquivo `fixtures/translations/pt-BR.json` guarda o resultado, que é gravado pela rota nova.
- Fora desta mudança: tradução automática, idioma escolhido nos ajustes e tradução dos textos fixos da interface além de pt-BR e inglês.

## Capabilities

### New Capabilities
- Nenhuma.

### Modified Capabilities
Estas capacidades nascem em `add-photo-player-mvp`, que ainda não foi arquivada. Esta mudança só acrescenta requisitos e deve ser arquivada depois de `add-photo-info-and-motion`.
- `media-catalog`: dicionário de traduções e suas rotas de administrador.
- `playlist`: parâmetro `lang`, idioma canônico e textos no idioma pedido, com o inglês como reserva.
- `web-player`: o pedido da playlist leva o idioma do navegador.

## Impact

- **Banco:** migração `0003_translation.sql`, com a tabela `translation (lang, source, text)`. Escrever traduções sobe a `revision` do catálogo.
- **API:**
  - rotas novas em `src/routes/`;
  - `info.rs` passa a receber os textos já traduzidos;
  - a chave do snapshot memorizado ganha o idioma;
  - o `ETag` também passa a incluir o idioma.
- **Front:** `api.ts` (URL com `lang`) e a playlist guardada separada por idioma.
- **Custo:** nenhum serviço externo; a carga em pt-BR é feita uma vez só, nesta mudança.
