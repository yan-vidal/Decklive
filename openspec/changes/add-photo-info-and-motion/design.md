# Design

## Context

O que medi na fonte em 28/10/2026, nas 784 fotos de `https://api.yanlucas.com/images`:

- **Local:** cada documento tem `city`, `state` e `country` na raiz. Só uma foto não tem cidade nem estado, e todas têm país. São 62 locais diferentes, com nomes em inglês (`Brazil`, `Japan`) e cidade igual ao estado em vários casos (`São Paulo, São Paulo`; `Osaka, Osaka`).
- **Descrição:** 411 fotos têm `description`, com 103 textos diferentes, em inglês, de 560 a 1.400 caracteres. Em 99 desses 103 textos há um título antes de `": "`, sempre nos primeiros 60 caracteres. A primeira frase depois do título tem de 86 a 217 caracteres (p50 114). Com duas frases, a mediana já chega a 271.
- **Coordenadas:** só 2 das primeiras 40 fotos têm `metadata.latitude`/`longitude`. O DeckLive não precisa delas, e a playlist é pública.

No código atual:

- `source.rs` lê o documento da fonte, mas ignora `city`/`state`/`country`.
- A tabela `media` (design D3 de `add-photo-player-mvp`) já guarda `description`.
- O player tem duas camadas (`.layer` com um `img`) e um véu único (`#veil`) acima delas.
- No modo `fill`, o `img` recebe `left`/`top`/`width`/`height` calculados por `fillBox`. No modo `fit`, ele usa `object-fit: contain`.

## Goals / Non-Goals

**Goals:**
- A API decide o texto que aparece (local, título e resumo), e o front só o mostra, como já acontece com o corte.
- O movimento roda no compositor do navegador, sem custo de JavaScript por quadro, inclusive na TV com Tizen.
- A playlist continua pequena: o resumo é uma frase, não a descrição inteira.

**Non-Goals:**
- Traduzir o local ou a descrição.
- Mostrar a descrição inteira, um mapa ou as coordenadas.
- Copiar o movimento e os textos para o DeckLock nesta mudança. Eles ficam nas variáveis CSS e nas constantes do front, que o DeckLock poderá copiar depois.

## Decisions

### D1. Local gravado no registro, sem geocodificação
`source.rs` passa a ler `city`, `state` e `country`. Valores vazios ou só com espaços viram `None`. Uma migração nova (`0002_place.sql`) acrescenta três colunas `TEXT` anuláveis à tabela `media`. O registro grava os três campos, e `GET /api/media` os devolve. `latitude` e `longitude` nem chegam a ser lidas.

Considerei e descartei:
- **Geocodificação reversa (Nominatim) a partir das coordenadas:** quase nenhuma foto tem coordenadas, e o nome do lugar já vem pronto.
- **Campo `place` manual no `POST`:** nada pede isso hoje.

### D2. Textos prontos calculados na API, num módulo puro
Um módulo novo, `src/info.rs`, tem três funções sem efeito colateral, com testes de tabela que seguem os cenários da spec `playlist`:

- `place(city, state, country)`: junta as partes com `", "`, pula as vazias e não repete uma parte igual à anterior.
- `split_description(desc)`: devolve `(title, rest)`. Há título quando `": "` aparece nos primeiros 80 caracteres (contados em `char`, não em bytes).
- `summary(rest)`: devolve a primeira frase, com a primeira letra maiúscula, cortada em 240 caracteres.

O fim da frase é `[.!?]`, seguido opcionalmente de `"`, `”`, `’` ou `)`, e depois de um espaço ou do fim do texto. O corte acontece no último espaço antes do limite, e o resultado ganha "…" no fim.

Os textos não dependem da tela. Por isso são calculados uma vez por `revision`, quando o catálogo é carregado para o snapshot, e não a cada faixa.

Considerei e descartei:
- **Mandar a descrição inteira e cortar no front com CSS:** isso triplicaria o tamanho da playlist, e o corte cairia no meio de uma frase.
- **Duas frases:** o texto ficaria grande demais para o canto da tela, porque a mediana já chega a 271 caracteres.

### D3. Item da playlist
O item ganha `place`, `title` e `text`, sempre presentes, como string ou `null`. Nenhum campo existente muda. O `ETag` já inclui o boot id, então o deploy desta mudança já invalida as playlists cacheadas.

Tamanho estimado: até 103 resumos distintos de cerca de 120 caracteres, repetidos entre as fotos do mesmo lugar, que o brotli comprime bem. A tarefa de medição refaz a conta de 1.000 itens e atualiza o `README.md`.

### D4. Movimento por transição CSS de `transform` no `img`
Cada camada aplica o movimento só no seu `img`. Os textos e o véu não se movem.

- **Duração:** igual a `interval × 1000 + crossfade (600 ms)`, com `linear`.
- **Início:** a transição começa quando a camada passa a ser a da frente, ou seja, no começo do crossfade. A camada que sai continua o seu movimento durante o crossfade.
- **Como é aplicada:** a camada recebe o estado inicial com `transition: none` e passa por um reflow forçado. Depois recebe `transition: transform <D>ms linear` e o estado final. Isso funciona no Chromium 53 e no Safari 12, ao contrário da Web Animations API, que o Safari 12 não tem.
- **Modo `fill`:** `transform-origin` fica no centro da janela, em coordenadas do `img` (`vw/2 − left`, `vh/2 − top`).
  - Os dois estados são `A = scale(1)` e `B = translate(tx, ty) scale(1.06)`, com `|tx| = 0,6 × (s − 1) × vw / 2` e `|ty| = 0,6 × (s − 1) × vh / 2`. A diagonal muda a cada foto, girando entre as quatro.
  - Como o `img` já cobre a janela, qualquer estado com `|tx| ≤ (s − 1)·vw/2` e `|ty| ≤ (s − 1)·vh/2` continua cobrindo.
  - O navegador interpola componente a componente entre listas de funções iguais. Por isso escrevo `A` como `translate(0px, 0px) scale(1)`, e todo ponto intermediário cai dentro dessa região, que é convexa. Assim nunca aparece borda.
- **Modo `fit`:** a escala vai de `0,97` a `1`, a partir do centro e sem deslocamento, então a foto continua inteira.
- **Direção:** aproximação (`A → B`) e afastamento (`B → A`) se alternam a cada foto mostrada.
- **Reenquadramento** (giro, mudança de tamanho, troca de modo): o progresso `p = decorrido / D` é guardado. O estado em `p` é recalculado com a geometria nova, e a transição segue até o fim no tempo que falta.
- **Movimento desligado:** `transition` e `transform` são removidos na hora.
- **Constantes:** `1.06`, `0.97` e `0.6` ficam no começo de `stage.ts` (`MOTION_ZOOM`, `FIT_ZOOM`, `MOTION_PAN`).

Considerei e descartei:
- **Animação por `requestAnimationFrame`:** faz trabalho de JavaScript a cada quadro na TV.
- **`@keyframes` fixos:** a duração e a origem mudam a cada foto.
- **`will-change` permanente:** reserva memória de GPU para as duas camadas o tempo todo. O próprio navegador promove a camada enquanto há transição de `transform`.

### D5. Véu e textos dentro de cada camada
A camada passa a ser `img` + `div.veil` + `div.info`, e o `#veil` global sai.

O véu tem de ficar abaixo dos textos, senão os escurece. Com os textos e o véu dentro da camada, os textos trocam no mesmo crossfade da foto, sem nenhum sincronismo extra. O resultado do crossfade é o mesmo de antes: o véu é igual nas duas camadas, e a mistura de duas imagens com o mesmo véu é igual ao véu sobre a mistura das imagens.

O `div.info` é preenchido quando a foto entra na camada:
- o local, com um marcador em SVG inline que usa `currentColor`;
- o título;
- o resumo.

A opção "Local" liga e desliga uma classe em `#app`, e a opção "Descrição" liga e desliga outra. Assim, a mudança vale na hora, nas duas camadas, sem refazer o DOM.

### D6. Medidas dos textos
Os tokens novos ficam em `tokens.css`:

| Token | Valor |
|---|---|
| `--dl-info-title-size` | 24 |
| `--dl-info-text-size` | 16 |
| `--dl-info-place-size` | 15 |
| `--dl-info-width` | 560 |
| `--dl-info-margin` | 32 |
| `--dl-info-gap` | 6 |
| `--dl-info-lines` | 4 |
| `--dl-info-color` | `#ffffff` |
| `--dl-info-muted` | `rgba(255,255,255,0.85)` |

A sombra é a mesma da data. Os números multiplicam `--dl-ui`, como os botões, porque o fator mínimo de 0,6 do relógio deixaria o resumo com 9,6 px no celular.

O resumo usa `-webkit-line-clamp`, que o Chromium 53 e o Safari 12 suportam. O título fica limitado a 2 linhas. A coluna tem `max-width: min(560 × ui, 100% − 2 × margem)`, escrito com `calc` em dois níveis, porque o Chromium 53 não tem `min()`.

Em janelas baixas (`max-height: 560px`, como o celular deitado), o resumo cai para 2 linhas e o título para 1. A conta para 844×390:
- o relógio (57,6 px) e a data terminam perto de y = 250;
- os textos começam perto de y = 256.

A conferência com Playwright confirma isso: sobram 17 px.

Mais abaixo de 560 px, a folga acaba. Ela cai para 2 px em 640×360, e em 568×320 os textos cobrem a data. Por isso, em janelas de até 380 px de altura, o resumo some e ficam só o local e o título.

### D7. Ajustes
`Settings` ganha `motion`, `place` e `description`, e a chave do `localStorage` continua `decklive.settings.v1`, porque `validate` já completa os campos que faltam com o padrão.

O padrão de `motion` é calculado ao abrir:

```ts
!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)
```

Num navegador que não conhece a media query, ela simplesmente não casa. `validate` passa a receber os padrões como parâmetro, para que os testes cubram os dois casos.

O painel ganha as três opções depois das que já existem, com rótulos em `i18n.ts`:
- pt-BR: "Movimento", "Local", "Descrição";
- inglês: "Motion", "Location", "Description".

## Risks / Trade-offs

- **[Transição de `transform` numa imagem 4K na TV com Tizen pode engasgar]** → O movimento roda no compositor e é lento: perto de 2 px/s numa tela 1080p. Se a TV engasgar, o usuário desliga o movimento nos ajustes, e a tarefa 7.2 da mudança anterior passa a conferir também o movimento.
- **[Textos em inglês num player em pt-BR]** → É o que a fonte tem. A tradução fica para uma mudança futura, que pode traduzir uma vez no registro.
- **[Resumo de uma frase perde detalhes da descrição]** → É a escolha de mostrar pouco texto, como a tela de bloqueio do Windows. A descrição inteira continua gravada no catálogo.
- **[Texto fixo no canto de TVs OLED]** → O texto muda a cada foto e o relógio já é fixo. Não há mitigação extra nesta mudança.
- **[Fotos já registradas ficam sem local]** → Na máquina local, elas são registradas de novo com o mesmo enquadramento (tarefa 5.2). O servidor ainda não tem catálogo.

## Migration Plan

1. A migração `0002_place.sql` roda sozinha ao iniciar, e as colunas novas começam nulas.
2. As fotos já registradas são registradas de novo com o mesmo `version`, `focus` e `crops`, lidos de `GET /api/media`, para gravar o local.
3. Para voltar atrás, é preciso restaurar a cópia de `data/decklive.db` feita antes da atualização. Sem a cópia, a imagem anterior não sobe: o sqlx dela recusa um banco que já tem uma migração que ela não conhece. O `ETag` muda com o boot id, então os navegadores pegam a playlist nova sozinhos.
