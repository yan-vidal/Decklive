# DeckLive: referência

Configuração, imagem Docker, rotas da API, implantação num servidor e testes.
Para a visão geral e o primeiro uso, veja o [README](../README.md).

## Configuração

Tudo por variáveis de ambiente. Só o token é obrigatório: sem
`DECKLIVE_ADMIN_TOKEN` (ou com menos de 32 caracteres) o processo termina com uma
mensagem que diz o que falta.

| Variável | Padrão | Na imagem Docker | Para quê |
| --- | --- | --- | --- |
| `DECKLIVE_ADMIN_TOKEN` | (obrigatória) | vem do `.env` | Token das rotas `/api/media` e `/api/translations`, com 32 caracteres ou mais |
| `DECKLIVE_DATABASE` | `./data/decklive.db` | `/app/data/decklive.db` | Arquivo SQLite (criado se não existir, em WAL) |
| `DECKLIVE_SOURCE_API` | `https://api.yanlucas.com` | igual | API de origem das fotos |
| `DECKLIVE_MEDIA_HOSTS` | `cdn.yanlucas.com` | igual | Hosts aceitos nas URLs das fotos (separados por vírgula) |
| `DECKLIVE_BIND` | `0.0.0.0:8080` | igual | Endereço do servidor |
| `DECKLIVE_WEB_DIR` | `./web/dist` | `/app/web` | Pasta do player compilado |
| `RUST_LOG` | `decklive=info,tower_http=info` | igual | Nível do log |

## Docker

A imagem (`Dockerfile`) é montada em três estágios: o Node compila o player, o
Rust compila o binário e a imagem final (`debian:bookworm-slim` com
`ca-certificates`, cerca de 96 MB) leva só os dois. O serviço roda como o
usuário `decklive` (uid 10001); o entrypoint começa como root só para entregar
`/app/data` a esse usuário, porque a pasta montada do host costuma nascer como
root. O `docker-compose.yml` publica a porta só no loopback (`127.0.0.1:8083`) e
guarda o banco em `./data`.

Do zero, numa pasta com o código:

```sh
cp .env.example .env
sed -i "s/^DECKLIVE_ADMIN_TOKEN=.*/DECKLIVE_ADMIN_TOKEN=$(openssl rand -hex 24)/" .env
chmod 600 .env
docker compose up -d --build
curl -sS 'http://127.0.0.1:8083/api/playlist?w=1920&h=1080'   # {"items":[]}
```

O player fica em `http://127.0.0.1:8083/`. Para os exemplos de `curl` abaixo,
use `API=http://127.0.0.1:8083` e leia o token com
`DECKLIVE_ADMIN_TOKEN=$(sed -n 's/^DECKLIVE_ADMIN_TOKEN=//p' .env)`.

O primeiro build leva uns 3 minutos (as dependências do Rust ficam numa camada
própria; mudar só o código recompila em menos de 1 minuto). Para atualizar:
`docker compose up -d --build`. Para ver o log: `docker compose logs -f`.

As migrações do banco (`migrations/`) rodam sozinhas quando o serviço sobe. Antes
de atualizar para uma versão com migração nova, guarde uma cópia de `data/` com o
container parado: para voltar atrás, é preciso restaurar essa cópia, porque a
imagem anterior não sobe com um banco que já tem uma migração que ela não conhece.
A `0002_place.sql` só acrescenta `city`, `state` e `country` à tabela `media`; as
fotos registradas antes dela ficam sem local até serem registradas de novo (com o
mesmo `version`, `focus` e `crops`, lidos de `GET /api/media`). A
`0003_translation.sql` só cria a tabela `translation`, vazia: nada muda para quem
não manda `lang` até alguma tradução ser gravada.

## Catálogo (`/api/media`)

As três rotas exigem `Authorization: Bearer <token>`; sem ele, ou com token
errado, a resposta é `401`. Nos exemplos:

```sh
API=http://localhost:8080
AUTH="Authorization: Bearer $DECKLIVE_ADMIN_TOKEN"
```

### Registrar uma foto

Envie o `_id` da foto no yanlucas.com. A API busca a foto na origem, mede os
três arquivos (miniatura, otimizado e original) e grava. Responde `201` para foto
nova e `200` para foto já registrada (os dados da origem, inclusive o local, são
atualizados e o enquadramento é substituído pelo que veio no pedido). O local
(`city`, `state` e `country`) é gravado como vem da origem, em inglês; texto vazio
vira `null`. As coordenadas que a origem tiver em `metadata` não são lidas nem
gravadas.

```sh
curl -sS -X POST "$API/api/media" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"id": "66d312a4124fa13304b01ea7"}'
```

Campos opcionais:

- `version`: `"original"` ou o nome de uma versão editada (`"V1"`, `"V2"`...).
  Sem ele, vale a primeira versão editada, como na galeria; sem versões
  editadas, o original.
- `focus`: ponto de interesse `{"x", "y"}` entre 0 e 1. Padrão: o centro.
- `crops.landscape` e `crops.portrait`: regiões de interesse `{"x", "y", "w", "h"}`
  entre 0 e 1, relativas à foto, usadas em telas deitadas e em pé.

```sh
curl -sS -X POST "$API/api/media" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"id": "66d31e67124fa13304b0236d", "version": "V2",
       "crops": {"portrait": {"x": 0.3, "y": 0, "w": 0.4, "h": 1}}}'
```

Erros: `404` se a foto não existe na origem, `502` se a origem está fora do ar,
`422` para id malformado, coordenada inválida (o corpo diz qual campo) ou versão
desconhecida (o corpo lista as versões em `available`). Em todos esses casos,
nada é gravado.

### Remover fotos

Tira as fotos da exibição; nada muda no yanlucas.com nem no R2. A resposta separa
os ids removidos dos que não estavam no catálogo. Lista vazia dá `422`.

```sh
curl -sS -X DELETE "$API/api/media" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"ids": ["66d31e67124fa13304b0236d", "0123456789abcdef01234567"]}'
# {"removed":["66d31e67124fa13304b0236d"],"not_found":["0123456789abcdef01234567"]}
```

### Listar o catálogo

Das fotos registradas mais recentemente para as mais antigas, com `total`.

```sh
curl -sS "$API/api/media" -H "$AUTH"
```

Cada foto traz `id`, `source`, `version`, `description`, `city`, `state` e
`country` (nulos quando a origem não os tem), `taken_at`, `color`, `variants`
(`kind` = `thumbnail`, `optimized` ou `full`, com `url`, `width` e `height`, do
menor para o maior), `focus`, `crops`, `created_at` e `updated_at`.

## Traduções (`/api/translations/{lang}`)

A origem só tem os textos em inglês. O DeckLive guarda traduções por idioma e por
**texto da origem**, não por foto: uma tradução vale para todas as fotos com o mesmo
texto, inclusive as registradas depois. Valem a descrição e cada parte do local
(`city`, `state` e `country`), comparadas como vêm da origem, sem espaços nas pontas.
Se o texto mudar na origem, a foto volta ao inglês até ganhar uma tradução nova.

As três rotas exigem o token (`401` sem ele), não têm CORS e aceitam corpo de até
2 MB. O idioma é uma etiqueta como `pt-BR`, `es` ou `zh-Hant-TW`, normalizada
(`pt-br` → `pt-BR`); etiqueta inválida ou o inglês da origem (`en`, `en-US`...)
dão `422`. Gravar ou remover sobe a versão do catálogo, como registrar uma foto.

### Gravar

Grava ou substitui até 2.000 traduções numa transação só. Lista vazia, `source` ou
`text` vazios (o corpo diz qual item, como `items[3].text`) ou campo desconhecido
dão `422`, e nada é gravado. Espaços nas pontas são tirados; se o mesmo `source`
vier duas vezes, vale a última.

```sh
curl -sS -X PUT "$API/api/translations/pt-br" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"items": [{"source": "Brazil", "text": "Brasil"}, {"source": "Japan", "text": "Japão"}]}'
# {"lang":"pt-BR","saved":2}
```

A carga inicial em pt-BR fica em `fixtures/translations/pt-BR.json`, no mesmo
formato:

```sh
curl -sS -X PUT "$API/api/translations/pt-BR" -H "$AUTH" -H 'Content-Type: application/json' \
  --data-binary @fixtures/translations/pt-BR.json
```

Atrás do nginx do exemplo de implantação, que limita o corpo a 1 MB, rode a
carga de dentro do servidor, direto na porta do container
(`http://127.0.0.1:8083`).

### Listar e ver o que falta

```sh
curl -sS "$API/api/translations/pt-BR" -H "$AUTH"
# {"lang":"pt-BR","items":[{"source":"Brazil","text":"Brasil","updated_at":"2026-10-29T03:29:50.492Z"},
#   {"source":"Japan","text":"Japão","updated_at":"2026-10-29T03:29:50.492Z"}],"total":2}

curl -sS "$API/api/translations/pt-BR?missing=true" -H "$AUTH"
# {"lang":"pt-BR","items":[{"source":"São Paulo","kind":"city","photos":12},
#   {"source":"São Paulo: A megacity that stands as a global hub for commerce, ...","kind":"description","photos":9},
#   {"source":"Ceará","kind":"state","photos":7}, ...]}
```

Com `missing=true`, a lista traz os textos do catálogo sem tradução no idioma, das
mais usadas para as menos usadas (empate em ordem do texto). `photos` conta cada
foto uma vez, mesmo que o texto apareça em dois papéis nela (cidade e estado "São
Paulo", por exemplo); `kind` é o primeiro papel do texto na ordem `description`,
`city`, `state`, `country`. Textos que ficam iguais no idioma (`Osaka`, `São
Paulo`) continuam na lista enquanto não forem gravados. `missing` aceita só `true`
ou `false` (`400` para outro valor).

### Remover

A foto volta ao texto em inglês. A resposta separa os removidos dos que não
existiam; lista vazia dá `422`.

```sh
curl -sS -X DELETE "$API/api/translations/pt-BR" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"sources": ["Japan", "Osaka"]}'
# {"removed":["Japan"],"not_found":["Osaka"]}
```

## Playlist (`/api/playlist`)

Rota pública, sem token, com CORS de qualquer origem. Recebe o tamanho da área
de exibição em pixels físicos (tamanho CSS da janela × `devicePixelRatio`):

```sh
curl -sS "$API/api/playlist?w=1920&h=1080"
# {"items":[{"id":"66d312a4124fa13304b01ea7",
#   "src":"https://cdn.yanlucas.com/1725108890838-IMG_8665.jpeg","width":2944,"height":1839,
#   "crop":{"x":0.0,"y":0.049755,"w":1.0,"h":0.900489},"color":"#c79442","orientation":"landscape",
#   "place":"Jericoacoara, Ceará, Brazil","title":"Sunset Dune",
#   "text":"This natural formation is part of the dynamic dune system along the northeastern coast of Brazil."}]}
```

- A tela é levada à sua **faixa canônica** (proporção mais próxima entre 1:1,
  4:3, 16:10, 16:9, 19,5:9 e 21:9; lado longo 1280, 1920, 2560 ou 3840). Qualquer
  outra URL, inclusive com os parâmetros em outra ordem ou com parâmetros a mais,
  recebe `308` para a canônica: `?w=1170&h=2532` → `/api/playlist?w=1182&h=2560`.
  A tabela de casos compartilhada com o front fica em `fixtures/screen-buckets.json`.
- `w` ou `h` ausente, ou fora de 1 a 16384, dá `400`.
- Cada item traz o arquivo mais leve em que o corte tem pelo menos 90 % dos
  pixels da tela nos dois eixos (ou o maior, se nenhum alcançar) e o `crop`
  (relativo à foto, 0 a 1) na proporção da tela.
- Cada item traz também os textos prontos para exibir, sempre presentes (string
  ou `null`):
  - `place`: cidade, estado e país numa linha, sem as partes vazias e sem repetir
    uma parte igual à anterior (`São Paulo, São Paulo, Brazil` → `São Paulo, Brazil`);
  - `title`: o texto antes de `": "` na descrição, quando esses dois-pontos estão
    nos primeiros 80 caracteres;
  - `text`: a primeira frase do resto da descrição, com a primeira letra maiúscula,
    cortada no último espaço antes de 240 caracteres (com "…") se passar disso.

  Eles vêm no idioma pedido em `lang` (abaixo), e cada parte sem tradução cai no
  inglês da origem; são calculados uma vez por versão do catálogo e por idioma
  (`src/info.rs`). A descrição inteira e as coordenadas não vão na playlist.
- `lang` (opcional) é a etiqueta de idioma do navegador, como vier (`pt-BR`,
  `pt-pt`, `es-419`). A API usa o idioma disponível mais próximo, entre os que têm
  ao menos uma tradução: a etiqueta igual, sem diferenciar maiúsculas; senão, a
  mesma língua com outra região (a primeira em ordem alfabética); senão, o inglês,
  que é a URL **sem** `lang`. Qualquer outra forma recebe `308` para a canônica,
  com a faixa e o idioma acertados num só redirecionamento. Etiqueta com formato
  inválido dá `400`.

  ```sh
  curl -sSI "$API/api/playlist?w=1170&h=2532&lang=pt-pt" | grep -iE '^(HTTP|location)'
  # HTTP/1.1 308 Permanent Redirect
  # location: /api/playlist?w=1182&h=2560&lang=pt-BR
  curl -sSI "$API/api/playlist?w=1920&h=1080&lang=en" | grep -i '^location'
  # location: /api/playlist?w=1920&h=1080          (o mesmo para lang=fr, sem tradução)
  curl -sS "$API/api/playlist?w=1920&h=1080&lang=pt-BR"
  # {"items":[{"id":"66d312a4124fa13304b01ea7", ...,
  #   "place":"Jericoacoara, Ceará, Brasil","title":"Sunset Dune",
  #   "text":"This natural formation is part of the dynamic dune system along the northeastern coast of Brazil."}, ...]}
  #   (só "Brazil" traduzido: o resto fica em inglês)
  ```

  O redirecionamento só pela faixa sai com `Cache-Control: public, max-age=86400`;
  quando há `lang`, com o mesmo cache curto da playlist, porque o destino muda
  quando um idioma ganha ou perde traduções.
- Itens na ordem de registro; embaralhar é papel do player.
- `ETag: "r<versão>-<w>x<h>-<idioma>-<boot>"`, em que `<idioma>` é o canônico (`en`
  sem `lang`) e `<boot>` é o instante de início do processo em base 36 (por
  exemplo, `"r12-1920x1080-pt-BR-mvspt55e"`), e
  `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`.
  Com `If-None-Match` igual ao `ETag` atual, a resposta é `304` sem corpo.
  Qualquer registro ou remoção de foto ou de tradução muda a versão, e cada
  reinício (um deploy, por exemplo) muda o `<boot>`: depois dele, cada cliente
  recebe uma resposta completa uma vez.
- A resposta é calculada uma vez por faixa, idioma e versão, guardada na memória
  já serializada e comprimida (brotli ou gzip, conforme `Accept-Encoding`).

### Desempenho medido

Com 1.000 fotos no catálogo (faixa 1920×1080, 2.000 pedidos por codificação,
build `--release`, máquina de desenvolvimento em 2026-10-28). O enquadramento é
sintético; a descrição e o local vêm das 784 fotos reais de `GET /images` do
yanlucas.com, repetidas até completar 1.000 (627 com resumo, 612 com título,
todas com local):

| Medida | p50 | p95 | p99 |
| --- | --- | --- | --- |
| Rota memorizada, no processo (`oneshot`), sem compressão | 2,6 µs | 3,2 µs | 3,8 µs |
| Rota memorizada, no processo, brotli | 2,6 µs | 3,5 µs | 3,9 µs |
| Rota memorizada por TCP local (servidor axum + cliente HTTP) | 74 µs | 106 µs | 131 µs |

Os textos (`place`, `title` e `text`) das 1.000 fotos levam 0,7 ms, uma vez por
versão do catálogo, dentro da troca do snapshot (11 ms com a leitura do banco). O
primeiro pedido de uma faixa monta a playlist em 1,1 ms; a primeira compressão leva
5,8 ms (gzip) ou 7,6 ms (brotli). O corpo tem 365 KB sem compressão, 34,9 KB em
gzip e 27 KB em brotli (sem os textos, eram 221 KB, 20,5 KB e 18 KB). Para repetir
com as descrições reais:

```sh
curl -sS 'https://api.yanlucas.com/images?limit=1000' -o /tmp/images.json
DECKLIVE_PERF_IMAGES=/tmp/images.json \
  cargo test --release --test playlist_perf -- --ignored --nocapture
```

Sem `DECKLIVE_PERF_IMAGES`, a medição usa só as fotos do fixture e avisa que os
números não valem para esta tabela.

## Envio de ajustes (`/api/pairing`)

Leva os ajustes de um navegador para outro (do computador para a TV) com um código
curto de uso único. As rotas são públicas e sem CORS (o player é da mesma origem).
O pacote fica só na memória do processo, nunca no disco nem no log, e some ao ser
lido, depois de 10 minutos ou num reinício. Ele pode levar o token do endpoint de
uma área do usuário: prefira um token só de leitura.

```sh
curl -sS -X POST "$API/api/pairing" -H 'Content-Type: application/json' \
  -d '{"v": 1, "settings": {"interval": 30}, "layout": {"landscape": {"clock": {"x": 0.8, "y": 0.1}}}, "areas": []}'
# {"code":"GB7WX5","expires_in":600}                                       (201)

curl -sS "$API/api/pairing/gb7wx5"        # sem diferenciar maiúsculas
# {"v": 1, "settings": {"interval": 30}, "layout": {"landscape": {"clock": {"x": 0.8, "y": 0.1}}}, "areas": []}

curl -sS "$API/api/pairing/GB7WX5"        # já usado
# {"error":"not_found","message":"código inválido, vencido ou já usado"}   (404)
```

- `POST /api/pairing` aceita um objeto JSON de até 64 KB e responde `201` com o
  código (6 caracteres de `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, sem `0`, `O`, `1`, `I`
  nem `L`) e `expires_in` em segundos. Corpo maior dá `413`; corpo que não é um
  objeto JSON (lista, texto, JSON malformado) dá `422`. A API não olha os campos:
  quem valida o pacote é o player que o recebe.
- `GET /api/pairing/{code}` devolve o pacote como foi enviado e o apaga na mesma
  operação. Código inexistente, vencido ou já usado dá `404`.
- No máximo 500 pacotes ao mesmo tempo; com o limite cheio, o envio dá `503` até
  algum ser lido ou vencer. As duas respostas saem com `Cache-Control: no-store`.
- Tentar códigos às cegas esbarra no `limit_req` do nginx (cerca de 30 mil
  tentativas em 10 minutos, contra 887 milhões de códigos).

## Player web

Tudo o que não começa com `/api/` vem de `DECKLIVE_WEB_DIR` (padrão `web/dist`).
Os arquivos em `assets/` (o Vite põe ali só arquivos com hash no nome) saem com
`Cache-Control: public, max-age=31536000, immutable`; `index.html`, o manifesto e
os demais, com `no-cache`.

```sh
curl -sI "$API/assets/app-abc123.js" | grep -i cache-control   # immutable
curl -sI "$API/" | grep -i cache-control                        # no-cache
```

## Implantação num servidor

O container publica a porta só no loopback, e um proxy na mesma máquina cuida do
HTTPS. A porta é a `8083`; para usar outra, ponha `DECKLIVE_PORT` no `.env`. Nos
exemplos abaixo, troque `usuario@servidor`, `/srv/decklive` e
`decklive.example.com` pelos seus.

1. Copie o código para o servidor, sem os artefatos locais:

   ```sh
   rsync -a --delete --exclude-from=.dockerignore --exclude .claude ./ \
     usuario@servidor:/srv/decklive/
   ```

2. Na primeira vez, crie o `.env` no servidor:

   ```sh
   cd /srv/decklive
   umask 077
   printf 'DECKLIVE_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 24)" > .env
   ```

3. Suba. A cada atualização, repita este passo depois do passo 1:

   ```sh
   docker compose up -d --build
   docker builder prune -af   # libera todo o cache do build (veja abaixo)
   curl -sS 'http://127.0.0.1:8083/api/playlist?w=1920&h=1080'
   ```

   - **O banco e o token ficam:** o `--exclude-from=.dockerignore` também deixa
     de fora o `data/` e o `.env`, então repetir o passo 1 não apaga nenhum dos
     dois.
   - **Cache do build:** o build leva cerca de 10 minutos e deixa perto de 2 GB
     de cache (a imagem do Rust, com 0,9 GB, e as dependências compiladas, com
     0,85 GB). O `prune` libera esse espaço.
   - **Backup:** copie a pasta `data/` com o container parado
     (`docker compose stop`), porque o SQLite em WAL usa três arquivos.

4. Configure o proxy. Um exemplo com nginx:

   ```nginx
   # no bloco http:
   # limit_req_zone $binary_remote_addr zone=soft_limit:10m rate=50r/s;
   # limit_conn_zone $binary_remote_addr zone=addr_limit:10m;
   server {
       listen 443 ssl;
       listen [::]:443 ssl;
       http2 on;
       server_name decklive.example.com;

       ssl_certificate /etc/letsencrypt/live/decklive.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/decklive.example.com/privkey.pem;

       add_header X-Content-Type-Options nosniff;
       client_max_body_size 1M;
       limit_req zone=soft_limit burst=100 nodelay;
       limit_conn addr_limit 30;

       location / {
           proxy_pass http://127.0.0.1:8083;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

5. Registre as fotos com o token do servidor, sem tirá-lo de lá:

   ```sh
   cd /srv/decklive
   TOKEN=$(grep '^DECKLIVE_ADMIN_TOKEN=' .env | cut -d= -f2-)
   curl -sS -X POST http://127.0.0.1:8083/api/media \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"id":"66d312a4124fa13304b01ea7"}'
   ```

## Cache Rules recomendadas (Cloudflare)

### `cdn.yanlucas.com` (fotos no R2)

Os arquivos nunca mudam numa mesma URL: o nome leva o instante do envio
(`1725108890838-IMG_8665.jpeg`), e uma foto nova ganha um nome novo. Então dá
para guardar tudo pelo máximo de tempo na borda e no navegador, o que poupa
leituras no R2 e banda na TV. Em **Caching → Cache Rules**, uma regra:

- **Quando:** `Hostname` igual a `cdn.yanlucas.com`.
- **Cache eligibility:** *Eligible for cache*.
- **Edge TTL:** *Ignore cache-control header and use this TTL*, 1 ano.
- **Browser TTL:** *Override origin and use this TTL*, 1 ano.

Opcional: ligar o *Tiered Cache* (*Smart Tiered Caching*, grátis) para que só um
data center da Cloudflare busque cada arquivo no R2. Se um arquivo for trocado
mantendo o nome (não deveria acontecer), purgue a URL em **Caching →
Configuration → Purge Cache**.

### Domínio do DeckLive (opcional)

Por padrão a Cloudflare não guarda JSON, então o `s-maxage=300` da playlist só
vale com uma regra: `Hostname` igual ao domínio do DeckLive e `URI Path`
começando com `/api/playlist` → *Eligible for cache*, Edge TTL *Use cache-control
header if present*, Browser TTL *Respect origin*. As rotas `/api/media`,
`/api/translations` e `/api/pairing` não entram na regra (têm token ou
`no-store`). A chave de cache padrão inclui a query, então `lang` separa as
playlists por idioma sem configuração extra.

## Testes

```sh
cargo test                      # unidade + integração (origem simulada com wiremock)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
npm --prefix web test           # player web (Vitest)
```

Os testes nunca acessam a rede: a API do yanlucas.com é simulada com `wiremock`
e a medição dos arquivos é trocada por uma falsa.
