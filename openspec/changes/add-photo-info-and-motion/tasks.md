# Tasks

## 1. Local no catálogo (`media-catalog`)

- [x] 1.1 Escrever primeiro o teste do cliente da fonte com `wiremock` (documento com `city`/`state`/`country`, com `city` nulo e com `latitude`/`longitude` nos metadados) e depois ler os três campos em `source.rs`, com texto vazio virando `None`; verificar com `cargo test source`
- [x] 1.2 Criar `migrations/0002_place.sql` (três colunas `TEXT` anuláveis) e gravar os campos no registro; verificar com teste de integração que um banco criado pela migração 0001 com uma foto sobe com a 0002 e mantém a foto
- [x] 1.3 Devolver `city`, `state` e `country` no registro e em `GET /api/media`, sem coordenadas; verificar com testes de integração dos cenários "Foto com local na origem", "Foto sem local na origem" e "Foto com coordenadas na origem"

## 2. Textos prontos na playlist (`playlist`)

- [x] 2.1 Escrever primeiro os testes de tabela de `place` (completo, cidade igual ao estado, só o país, tudo vazio) e depois implementar em `src/info.rs`; verificar com `cargo test info`
- [x] 2.2 Escrever primeiro os testes de tabela de `split_description` e `summary` (com título, sem título, dois-pontos depois do caractere 80, minúscula inicial, frase terminada em `."`, frase de 300 caracteres, texto com acento perto do limite, sem descrição) e depois implementar; verificar com `cargo test info`
- [x] 2.3 Acrescentar `place`, `title` e `text` ao item da playlist, calculados uma vez por `revision`; verificar com teste de integração que o item traz os três campos (e `null` sem descrição) e que o snapshot memorizado continua sendo reutilizado entre pedidos
- [x] 2.4 Refazer a medição com 1.000 fotos com descrições reais; verificar que o p95 continua abaixo de 1 ms e anotar no `README.md` o tamanho novo da resposta com e sem brotli

## 3. Textos sobre a foto (`web-player`)

- [x] 3.1 Acrescentar `place`, `title` e `text` opcionais ao tipo do item em `api.ts`; verificar com teste que uma playlist guardada sem esses campos é aceita
- [x] 3.2 Levar o véu para dentro de cada camada (`img` + `div.veil` + `div.info`), tirar o `#veil` global e preencher os textos com o marcador em SVG; verificar no navegador que o crossfade continua igual e que os cenários "Foto com local e descrição" e "Foto só com local" aparecem certos
- [x] 3.3 Criar os tokens `--dl-info-*` do design D6 e os estilos (corte em 4 linhas, ou 2 em janela baixa; título em 2, ou 1); verificar com Playwright que em 1280×800 o título tem 24 px, em 1920×1080 tem 32,4 px, e que em 844×390 e 390×844 os textos não cobrem o relógio nem a data
- [x] 3.4 Acrescentar `place` e `description` a `settings.ts`, ao painel e a `i18n.ts`, com as classes em `#app`; verificar com teste de "Só o local" e, no navegador, que a mudança vale na foto atual

## 4. Movimento de câmera (`web-player`)

- [x] 4.1 Escrever primeiro os testes das funções puras do movimento (estados `A`/`B` de `fill` e `fit`, alternância, diagonal, estado no progresso `p`) e a prova de cobertura: amostrar `p` de 0 a 1 em 1920×970, 1280×1024 e 390×844 e conferir que a caixa transformada cobre a janela; depois implementar; verificar com `npm --prefix web test`
- [x] 4.2 Aplicar o movimento em `stage.ts` com a transição CSS do design D4 (início no crossfade, duração `interval + 600 ms`, reenquadramento pelo progresso, desligar na hora); verificar no navegador, com o tempo por foto em 10 s, que a foto se move, que a seguinte vai na direção contrária e que girar a janela no meio não mostra borda
- [x] 4.3 Acrescentar `motion` a `settings.ts`, com padrão desligado sob `prefers-reduced-motion: reduce`, e a opção ao painel; verificar com testes de "Padrão" e "Aparelho pede menos movimento" e, no Playwright com `reducedMotion: 'reduce'`, que as fotos ficam paradas

## 5. Conferência de ponta a ponta

- [x] 5.1 Conferir o build; verificar que HTML + CSS + JS com gzip continuam abaixo de 50 KB e que o JS gerado não tem sintaxe acima de ES2016
- [x] 5.2 Reconstruir o container local, registrar de novo as 18 fotos com o mesmo `version`, `focus` e `crops` (lidos de `GET /api/media`) e registrar mais algumas fotos com descrição (São Paulo, Jericoacoara e Japão); verificar com `curl` que a playlist traz `place`, `title` e `text`, e com screenshots do Playwright em 1920×1080 e 390×844 que os textos e o movimento aparecem

## Workflow follow-up

- Conferir o movimento e os textos na TV Samsung com Tizen junto com a tarefa 7.2 de `add-photo-player-mvp`.
- Arquivar esta mudança com `/opsx:archive` depois de `add-photo-player-mvp`.
