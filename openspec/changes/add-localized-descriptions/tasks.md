# Tasks

## 1. Dicionário de traduções (`media-catalog`)

- [x] 1.1 Escrever primeiro os testes de tabela da etiqueta de idioma (validação, normalização, `en` recusado) e da escolha do idioma canônico (igual, mesma língua, sem tradução, ordem alfabética) e depois implementar; verificar com `cargo test lang`
- [x] 1.2 Criar `migrations/0003_translation.sql` e o repositório de leitura e escrita com a `revision` subindo na mesma transação; verificar com teste que gravar e remover sobem a `revision` e que um banco com a 0002 e fotos sobe com a 0003
- [x] 1.3 Implementar `PUT`, `GET` (com `missing=true`) e `DELETE /api/translations/{lang}`; verificar com testes de integração dos cenários da spec `media-catalog` (gravação em lote, idioma da origem, textos que faltam, remoção, sem token)

## 2. Playlist por idioma (`playlist`)

- [x] 2.1 Escrever primeiro os testes de `info.rs` com tradução (descrição traduzida com título, tradução parcial do local, parte traduzida igual à anterior) e depois implementar a busca; verificar com `cargo test info`
- [x] 2.2 Acrescentar `lang` à rota: `400`, `308` junto com a faixa, `ETag` com idioma e memorização por `(revision, faixa, lang)`; verificar com testes de integração dos cenários "Tradução existente", "Mesma língua, outra região", "Idioma sem tradução", "Inglês pedido" e "Tradução nova"
- [x] 2.3 Documentar no `README.md` as rotas de tradução e o `lang` com exemplos de `curl`; verificar rodando os exemplos contra o container local

## 3. Player (`web-player`)

- [x] 3.1 Mandar `lang` em `api.ts` e separar a playlist guardada por idioma; verificar com testes de "Navegador em português" (URL com `lang=pt-BR`) e de playlist guardada por idioma, e com `npm --prefix web test`

## 4. Carga em pt-BR e conferência

- [x] 4.1 Gerar `fixtures/translations/pt-BR.json` com todas as descrições e partes de local distintas da amostra de 784 fotos, traduzidas pelas regras do design D6; verificar que o JSON é válido, que todo `source` existe na amostra e que todo texto com título mantém o "Título: "
- [x] 4.2 Reconstruir o container local, carregar o arquivo e conferir com `GET /api/translations/pt-BR?missing=true` que não falta nenhum texto do catálogo local; verificar com Playwright em 1920×1080, com o navegador em `pt-BR` e em `en-US`, que os textos aparecem em português e em inglês

## Workflow follow-up

- Implantar no servidor de casa (cópia de `data/`, `rsync`, `docker compose up -d --build`, `docker builder prune -af`) e carregar o `pt-BR.json` de dentro do servidor, direto em `127.0.0.1:8084`.
- Arquivar depois de `add-photo-info-and-motion`.
