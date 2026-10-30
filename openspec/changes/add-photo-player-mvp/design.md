# Design

## Context

O porquê está em `proposal.md`; o comportamento, nas specs `media-catalog`, `playlist` e `web-player`. Fatos medidos em 2026-10-28 que moldam o como:

- **Fonte (`https://api.yanlucas.com`)**: Express atrás de nginx, sem proxy da Cloudflare (responde `server: nginx`). `GET /images` devolve `{images, total}` com as URLs já completas. Não existe busca por id: com `?id=<id>&limit=1`, a API devolve a página do começo até o item mais 10 (≈48 KB). Com id desconhecido ou malformado, responde `500` com o texto `Erro ao listar imagens`, igual a qualquer outra falha.
- **Documento da foto**: `images[]` (versões editadas, com `versionName`, ex.: `V1`) e `original`. Cada versão tem `thumbnailUrl`, `optimizedUrl`, `fullSizeUrl` e `colorPalette[{red,green,blue,score,pixelFraction}]`. As dimensões ficam em `metadata.{fullSize,optimized,thumbnail}{Width,Height}`, uma vez só por documento, mesmo quando as versões são arquivos diferentes. A galeria mostra `images[0]` e cai para `original` quando não há versão editada.
- **Acervo**: 784 fotos. O original tem por volta de 3000 px no lado maior e cerca de 1,1 MB. O otimizado tem 1/3 disso (≈1000 px, dezenas de KB), e a miniatura, 1/10. Quase sempre o otimizado é pequeno demais para TV e para celular em alta densidade, então o original é que vai ser servido na maioria das telas.
- **`cdn.yanlucas.com`**: R2 com domínio próprio. Responde sem `Cache-Control` e com `cf-cache-status: DYNAMIC`, ou seja, a borda da Cloudflare hoje não guarda as fotos. O R2 não cobra saída de dados, mas cobra cada leitura que chega até ele.
- **Servidor**: uma stack Docker por pasta, nginx com certificado curinga e SQLite já usado em outra stack.
- **Visual do DeckLock** (`yan-vidal/DeckLock`): `themes/default/style.css:14-37` (véu, `#clock` 96px/300, `#date` 22px, sombra, destaque `#7aa2f7`), `src/ui.rs:1224-1253` (formatos de hora e data), `src/ui/adaptive.rs:40-48` (escala pela referência 1280×800, só para baixo), `src/ui.rs:285-312` (crossfade de 600 ms). O modo repouso centraliza o bloco do relógio (`src/ui.rs:1965-1978`). A data sai com a primeira letra maiúscula (`src/ui.rs:1245`). Linhas conferidas em `origin/main` (58f54ec).

## Goals / Non-Goals

**Goals:**
- Um único binário, que serve a API e o player.
- Playlist respondida da memória, sem tocar no banco. O SQLite só é usado nas escritas do catálogo.
- O mesmo algoritmo de faixa de tela no Rust e no TypeScript, provado pela mesma tabela de casos.
- Player com menos de 50 KB comprimidos e sem dependências em tempo de execução.

**Non-Goals:**
- Gerar variantes próprias das fotos ou usar transformações de imagem da Cloudflare (ver Riscos).
- Service worker e cache offline das fotos. Por ora, o cache HTTP do navegador basta.
- Mais de uma fonte de fotos, upload de arquivos, painel web de administração.
- Idiomas além de pt-BR e inglês.

## Decisions

### D1. Um binário axum serve API e front
A rota `/api/*` é a API. O resto é `web/dist` servido do disco pelo `tower-http::ServeDir`. Os arquivos com hash no nome recebem `Cache-Control: public, max-age=31536000, immutable`, e `index.html` e o manifesto recebem `no-cache`. O front chama a API pelo caminho relativo `/api`, então dá para mudar o front para o Cloudflare Pages depois sem mudar código. *Alternativa:* Pages desde já. Descartei porque seria mais uma peça para implantar hoje.

### D2. Crates
`axum` 0.8, `tokio`, `sqlx` (SQLite, migrações embutidas e consultas em tempo de execução, para o build não precisar de banco), `reqwest` (rustls, timeout de 10 s), `serde`/`serde_json`, `tower-http` (`cors`, `compression-gzip`/`br`, `fs`, `trace`), `tracing`, `imagesize`, `subtle` (comparação do token em tempo constante) e `thiserror`. Nos testes: `wiremock` e `tower::ServiceExt::oneshot`. *Alternativa ao axum:* actix-web, equivalente. Fiquei com o axum porque é a escolha mais comum hoje e encaixa direto no ecossistema Tower.

### D3. Modelo de dados (SQLite, WAL)
```sql
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
CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- 'revision'
```
O id do DeckLive é o próprio `_id` da fonte, porque é o que o Yan já conhece e é o que `DELETE` recebe. Fontes futuras vão usar um prefixo (`own:...`). A `revision` sobe na mesma transação de cada escrita.

### D4. Importação de uma foto
1. Validar o formato do id (24 hex). Se não bater, responder `422` sem chamar a fonte.
2. Chamar `GET {fonte}/images?id=<id>&limit=1` e procurar o item por `_id`.
3. Se a fonte responder `500`, sondar `GET {fonte}/images?limit=1`. Se a sonda responder `200`, a fonte está no ar e a foto não existe (`404`). Se não, a fonte está fora (`502`). Esse é o único jeito de distinguir os dois casos, porque a fonte responde igual a ambos.
4. Escolher a versão (spec `media-catalog`). A cor é a de maior `score` em `colorPalette`.
5. Medir as dimensões de cada arquivo lendo só o cabeçalho, com `Range: bytes=0-65535` + `imagesize`, porque `metadata` é um só por documento e as versões editadas podem ter outro tamanho. Se a medição falhar, usar `metadata` e registrar um aviso no log.
6. Aceitar só URLs `https` cujo host esteja em `DECKLIVE_MEDIA_HOSTS` (padrão `cdn.yanlucas.com`). Assim a playlist nunca aponta para um host fora da lista.

### D5. Playlist servida da memória
Um `ArcSwap<Snapshot>` guarda o catálogo inteiro e a `revision`. Ele é recarregado do SQLite depois de cada escrita e na inicialização. Cada resposta é calculada a partir do snapshot e memorizada já serializada (`Bytes` + `ETag`) por `(revision, faixa)`. São no máximo cerca de 44 faixas, e o cache é limpo quando a `revision` muda. O `ETag` tem o formato `"r<revision>-<w>x<h>-<boot>"`, em que `<boot>` identifica o processo (instante de início em base 36). Assim, um deploy que mude a conta do corte ou da faixa invalida as respostas guardadas pelos clientes, ao custo de uma resposta completa por cliente depois de cada reinício.

### D6. Faixas canônicas (Rust e TS)
1. A orientação vem de `w` e `h`. A razão é `lado longo / lado curto`.
2. A classe de proporção é a mais próxima em `|ln(r) − ln(c)|`, com `c ∈ {1, 4/3, 16/10, 16/9, 19.5/9, 21/9}`. Com `w` e `h` inteiros não há empate. A mesma conta classifica a foto: classe 1:1 (`r < √(4/3) ≈ 1,155`) é `square`.
3. O lado longo é o menor de `{1280, 1920, 2560, 3840}` que seja `≥` o lado longo real, limitado a 3840.
4. O lado curto é `round(longo / c)`, com meio arredondado para cima. Na classe 1:1, `w = h`.

A tabela de casos fica em `fixtures/screen-buckets.json` e é lida pelos testes do Rust e do front. Isso inclui os exemplos da spec: `1170×2532 → 1182×2560`, `5120×2880 → 3840×2160` e `1920×1080 → 1920×1080`.

### D7. Corte e escolha do arquivo
As contas são feitas em pixels sobre as dimensões do original. Todas as variantes têm a mesma proporção, e o resultado é normalizado para 0..1.
- Seja `A = W/H` a proporção da tela canônica e `iw×ih` a foto. O **corte máximo** é `ch = ih, cw = ih·A` se `iw/ih > A`; caso contrário, `cw = iw, ch = iw/A`.
- **Com região** da orientação da tela: `cw = max(rw, rh·A)` e `ch = cw/A`. Se isso passar do corte máximo, usar o corte máximo. O corte é centrado no centro da região.
- **Sem região**: ponto de interesse = a região da outra orientação, se existir (o centro dela); senão, o `focus` gravado. Corte máximo centrado nele.
- Numa tela quadrada, vale a região de `landscape`.
- Por fim, deslocar o corte para dentro da foto (*clamp*).
- **Arquivo**: o primeiro da lista, do menor para o maior, com `crop.w·variant.width ≥ 0.9·W` e `crop.h·variant.height ≥ 0.9·H`. Se nenhum servir, o maior.

O corte é calculado para `fill`. No modo `fit`, o player usa o mesmo arquivo; às vezes é maior que o necessário, mas é uma requisição só e o cache vale para os dois modos.

### D8. Token e configuração
Variáveis de ambiente: `DECKLIVE_ADMIN_TOKEN` (obrigatória, ≥ 32 caracteres), `DECKLIVE_DATABASE` (padrão `./data/decklive.db`), `DECKLIVE_SOURCE_API` (padrão `https://api.yanlucas.com`), `DECKLIVE_MEDIA_HOSTS` (padrão `cdn.yanlucas.com`), `DECKLIVE_BIND` (padrão `0.0.0.0:8080`) e `DECKLIVE_WEB_DIR` (padrão `./web/dist`). O token é comparado com `subtle::ConstantTimeEq`.

### D9. Player em TypeScript puro
Vite só para o build e o servidor de desenvolvimento (com proxy de `/api`), sem dependências em tempo de execução. O alvo do build é `chrome53` + `safari12`, e o esbuild rebaixa a sintaxe (inclusive `async`/`await`). Ele não acrescenta funções que faltam, então o `tsconfig` usa `lib: ["ES2016", "DOM"]`: o próprio TypeScript recusa `Object.values`, `padStart` e outras APIs de 2017 em diante. Essa escolha cobre webOS 4 (Chromium 53) e Tizen 4 (Chromium 56). O primeiro teste real é numa TV Samsung com Tizen. Os testes usam Vitest nos módulos puros. Módulos:
- `screen.ts`: faixa canônica.
- `api.ts`: playlist com `If-None-Match` e a última resposta em `localStorage`.
- `shuffle.ts`: embaralhamento que não repete a última foto na virada.
- `stage.ts`: duas camadas `<img>` alternadas por `opacity` com `transition` de 600 ms. No `fill`, a faixa canônica é aproximada, e a janela real pode ter outra proporção (5:4 cai em 4:3; a barra do Safari muda a altura). Por isso, o player não estica o corte. Ele escala a foto por `s = max(Vw/(crop.w·iw), Vh/(crop.h·ih))`, com `iw×ih` o tamanho natural da imagem, põe o centro do corte no centro da janela e desloca (*clamp*) para não mostrar borda vazia. Com a janela na proporção exata da faixa, o resultado é o próprio corte. No `fit`, `object-fit: contain` sobre `color`.
- `clock.ts`: `Intl.DateTimeFormat`, com `setTimeout` até a virada do minuto e nova sincronização no `visibilitychange`.
- `settings.ts`: padrões, validação e chave `decklive.settings.v1`.
- `controls.ts`: esconder e mostrar controles e cursor, foco por setas e as teclas Voltar: `Escape`, `Backspace`, `keyCode` 461 (webOS) e 10009 (Tizen).
- `wake.ts` e `fullscreen.ts`: com detecção de recurso e prefixo `webkit`.

### D10. Tokens visuais
`web/src/tokens.css` define `--dl-*` (cores, véu, sombra, tamanhos de referência e tempos), copiados de `themes/default/style.css` do DeckLock. Tudo é medido em `calc(<px de referência> * var(--dl-u))`. O `--dl-u` é definido pelo JS no `resize` como `max(0.6, min(lado longo/1280, lado curto/800))` px; a referência gira com a tela, senão um celular em pé (390×844) teria relógio de 29 px e data de 6,7 px. Botões e painel usam `--dl-ui = max(1, --dl-u)`, para continuarem tocáveis no celular. Diferente do DeckLock, o fator também amplia, porque uma TV de 1080p a três metros precisa do relógio proporcional à tela. O DeckLock pode adotar isso quando copiar este layout. Não uso `min()` do CSS porque navegadores de TV de 2018 não o suportam.

### D11. Testes
- Rust: testes de tabela para faixas, corte e escolha de arquivo. Testes de integração das rotas com `oneshot`, SQLite em memória e a fonte simulada com `wiremock` (inclui o caso `500` + sonda).
- Front: Vitest para `screen`, `shuffle`, `settings` e o estilo de corte.
- Conferência no navegador real (Playwright) em 1920×1080 e 390×844.

### D12. Implantação
- Dockerfile multiestágio: Node compila `web/`, Rust compila o binário, e a imagem final é `debian:bookworm-slim` com `ca-certificates`, usuário sem privilégios e `/app/data` como volume.
- Stack numa pasta própria do servidor, com a porta publicada só no loopback, um `server` no nginx para o subdomínio do DeckLive e o certificado curinga que já existe.
- O `.env` com o token fica só no servidor.

## Risks / Trade-offs

- [O original de ~1,1 MB vai para a maioria das telas] → Por ora, aceito. A escolha do arquivo é uma função isolada (D7), então dá para encaixar depois as transformações de imagem da Cloudflare ou variantes próprias em 1280/1920/2560/3840, sem mudar o contrato da playlist.
- [`cdn.yanlucas.com` sem cache na borda: cada exibição vira uma leitura no R2] → O custo é baixo (10 milhões de leituras grátis por mês, depois US$ 0,36 por milhão). Mitigação fora do código: uma Cache Rule que torna `cdn.yanlucas.com` cacheável, com TTL longo na borda e no navegador. Os nomes dos arquivos têm timestamp e não mudam, então o cache pode ser longo.
- [O subdomínio sem proxy da Cloudflare deixa o `s-maxage` sem efeito] → Para poucos testadores, o servidor atende tudo direto, da memória. Ligar o proxy depois não exige mudar código.
- [A fonte não distingue "não existe" de "erro"] → A sonda de D4. O custo é uma requisição a mais, só no registro de foto inexistente.
- [O relógio central cobre o centro da foto] → É a escolha de seguir o DeckLock em repouso. A posição vira opção quando chegarem os widgets.
- [Navegadores de TV antigos] → Alvo `chrome53`, `lib` ES2016 no TypeScript, sem `min()` no CSS, detecção de `decode`, tela cheia e Wake Lock.
- [No navegador da Samsung, as setas do controle podem mover um ponteiro em vez de chegar à página] → Os controles também respondem a movimento e clique do ponteiro (requisito "Controles discretos"). A tarefa 7.2 confere na TV qual dos dois modos o navegador usa.
- [O servidor cai] → O player continua com a playlist guardada, e as fotos vêm direto do R2.

## Migration Plan

Projeto novo, sem migração. Implantação:
1. Construir a imagem.
2. Subir a stack com o `.env`.
3. Criar o `server` no nginx e o DNS do subdomínio.
4. Registrar as primeiras fotos com `curl`.
5. Abrir numa TV e num celular.

Para voltar atrás: `docker compose down` e remover o bloco do nginx. Nada nos sistemas do yanlucas.com é alterado.

## Open Questions

- A porta livre no servidor e se o subdomínio vai passar pelo proxy da Cloudflare agora ou depois. Nenhuma das duas muda as specs nem as tarefas.
