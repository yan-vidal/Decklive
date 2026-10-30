# Design

## Context

Estado do player hoje:
- O relógio, a data e o aviso ficam em `#clock-box`, uma coluna flex centrada na tela.
- O local, o título e o resumo ficam em `.info`, dentro de cada uma das duas camadas da foto, no canto inferior esquerdo.
- O painel de ajustes é uma lista de opções com botões, montada por `panel.ts`, navegável por setas (`controls.ts`).

Restrições de compatibilidade:
- **Chromium 53 e Safari 12:** sem Pointer Events (o Chromium só tem a partir do 55, e o Safari do 13), então o arraste usa eventos de mouse e de toque.
- **CSS:** sem `min()` e sem `gap` em flex.
- **Disponível:** `iframe` com `srcdoc` e `sandbox`.

## Goals / Non-Goals

**Goals:**
- O layout padrão continua idêntico ao de hoje enquanto o usuário não move nada.
- Todo o modo de edição funciona só com o controle remoto.
- O conteúdo do usuário (modelo, JSON) não consegue quebrar nem ler o player.

**Non-Goals:**
- Mudar tamanhos de fonte.
- Camadas, ou ordem de sobreposição, escolhidas pelo usuário.
- Rodar scripts no modelo.
- Proxy do endpoint no servidor.

## Decisions

### D1. Posição como ponto central em proporção da janela, só para quem foi movido
- **Formato salvo:** `layout = { landscape: { [id]: {x, y} }, portrait: { ... } }`. `x` e `y` (de 0 a 1) são o centro do elemento em proporção da janela, e os ids fixos são `clock`, `date`, `place` e `description`.
- **Elemento sem entrada:** fica onde o CSS de hoje o põe, e isso garante o padrão idêntico.
- **Elemento movido:** recebe a classe `.moved` e fica em `position: absolute`, com `left`/`top` calculados a partir do centro, menos metade do tamanho medido, e limitados para caber na janela.
- **Alinhamento do texto:** vem do terço horizontal onde o centro fica (esquerda, centro ou direita), para que um texto encostado à direita cresça para a esquerda.
- **Restaurar:** apaga as entradas dos ids fixos nas duas orientações.

Considerei e descartei "âncora + deslocamento em px": isso quebra quando a mesma posição vai do computador para a TV, porque o tamanho em px muda.

### D2. Separar os blocos para que cada um se mova sozinho
- **Relógio e data:** saem de `#clock-box` para elementos posicionáveis próprios. No padrão, continuam numa coluna centrada, porque a regra do padrão empilha a data sob o relógio. Quando o relógio é movido, a data sozinha fica onde o padrão a põe, como já acontece hoje com o relógio desligado. O aviso acompanha o relógio.
- **Local e descrição:** `.info` vira dois blocos em cada camada, `.info-place` e `.info-desc`.
  - A posição deles é calculada em cada camada, com o texto daquela foto medido antes de ela aparecer, a partir do mesmo centro salvo. Uma variável única em `#app` faria a foto seguinte sair do centro guardado ou saltar no crossfade, porque cada foto tem um texto de altura diferente.
  - O elemento se prende pela borda mais próxima quando está no terço de fora, e pelo centro no terço do meio, para que um texto que muda de tamanho cresça para longe da borda.
  - O padrão (os dois empilhados no canto inferior esquerdo) é reproduzido por regras quando nenhum dos dois foi movido.
  - Se só um for movido, o outro fica no canto, sozinho.

### D3. Modo de edição
`editor.ts` monta uma camada `#editor` por cima de tudo, com:
- um contorno e um rótulo por elemento;
- uma barra com "Nova área", "Restaurar posições padrão" e "Concluir".

**Navegação pelo controle**, em dois estados:
- **Navegar:** as setas escolhem o próximo item na direção apertada, entre os elementos e os botões da barra, pela distância entre os centros. Enter abre a ação do item.
- **Mover:** depois de OK num elemento, as setas o movem 1% da tela por toque; segurar a tecla repete. OK ou Voltar soltam.

**Nas áreas próprias**, OK abre um menu com "Mover", "Redimensionar", "Conteúdo" e "Excluir". "Redimensionar" faz as setas mudarem a largura e a altura em 1%.

**Mouse e toque:**
- `mousedown`/`touchstart` num elemento começa o arraste, e `touchmove` usa `preventDefault` para a página não rolar.
- As áreas têm uma alça no canto inferior direito para o tamanho.

**Durante a edição**, o `Stage` recebe `pause()`/`resume()`: o temporizador da troca para e a foto atual fica. O movimento de câmera também para.

O Voltar fecha o modo, e não sai da página, como no painel.

### D4. Áreas próprias
Cada área é salva assim:
```
{ id, kind: 'text'|'image'|'endpoint',
  text?, size?: 's'|'m'|'l',
  imageUrl?,
  endpoint?: { url, auth, interval, template },
  layout: { landscape?: {x, y, w, h}, portrait?: {x, y, w, h} } }
```

- **Medidas:** `x` e `y` são o centro e `w` e `h` o tamanho, tudo em proporção da janela. Sem `layout` na orientação atual, a área usa o da outra orientação, limitado para caber.
- **Limites:** no máximo 8 áreas; tamanho mínimo de 5% × 5%.
- **Pintura:** as áreas ficam acima do véu e abaixo dos controles.

**Formulário de conteúdo** (`panel.ts`, com um sub-painel):
- tipo;
- texto (`textarea`);
- tamanho;
- URL da imagem;
- URL, `Authorization`, frequência (10 s, 30 s, 1 min, 5 min, 15 min, 1 h) e modelo (`textarea`).

O teclado na tela da TV abre nos campos. Para conteúdo longo, o caminho pensado é o envio de outra tela (D7).

### D5. Chamada ao endpoint
- **Requisição:** `fetch(url, { headers: auth ? { Authorization: auth } : {}, cache: 'no-store' })`. O `fetch` existe no Chromium 53 e no Safari 12.
- **Validação:** `url` (e a URL da imagem) tem de ser `https:`, porque a página é https e o navegador bloqueia conteúdo misto. A exceção é a página servida em `http:`, como no desenvolvimento local: aí `http:` também é aceito, porque não há conteúdo misto.
- **Tempo limite:** 10 s, com `Promise.race`, porque o Chromium 53 não tem `AbortController`.
- **Agendamento:** a próxima chamada é marcada com `setTimeout` depois de cada resposta, e não com `setInterval`, para que chamadas não se acumulem. Com `document.hidden`, a área para; ao voltar à visibilidade, chama na hora.
- **Erros:**
  - Rede, CORS, status fora de 2xx e JSON inválido dão o mesmo erro, porque o navegador não deixa distinguir CORS de rede.
  - Com conteúdo anterior, ele fica e aparece um ponto âmbar no canto da área.
  - Sem conteúdo anterior, aparece a mensagem "Não foi possível ler o endpoint".
- **Segurança:** o token fica em `localStorage`, legível só pela própria origem. Não mando o token para a API do DeckLive, exceto no envio do D7.

### D6. Modelo e `iframe`
**`template.ts`** é um subconjunto de Mustache, com cerca de 80 linhas e testado:
- campos e caminhos com ponto;
- `{{.}}` para o item atual;
- seções `#` e invertidas `^`;
- escape de `& < > " '` em todo valor;
- nada de parciais nem de `{{{ }}}`.

Uma seção sobre lista repete o conteúdo para cada item, com o contexto empilhado. Uma seção sobre um valor verdadeiro não-lista renderiza uma vez, com esse valor no topo da pilha.

**`iframe`:**
- tem `sandbox=""`, sem `allow-scripts` e sem `allow-same-origin`, e `srcdoc` com o resultado;
- recebe um estilo base: fundo transparente, texto branco com a mesma sombra da data, fonte do sistema e tamanho base `16 × --dl-ui` px, passado em px no `<style>`;
- é recriado só quando o HTML muda, comparando a string, para não piscar a cada chamada igual;
- o `iframe` é transparente por padrão quando o documento não define fundo.

Considerei e descartei limpar o HTML e inseri-lo no DOM do player: exige uma lista de permissões (allowlist) que é fácil de errar, e o CSS do usuário vazaria para o player.

### D7. Envio de ajustes (`settings-transfer`)
**API** (`src/routes/pairing.rs` e `src/pairing.rs`):
- `Mutex<HashMap<code, (Instant, Bytes)>>`, com no máximo 500 pacotes;
- a limpeza dos vencidos acontece a cada operação;
- código de 6 caracteres do alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 símbolos, 887 milhões de combinações), gerado com `rand`, ou com `getrandom`, se ainda não houver dependência;
- `GET` com remoção atômica, `DefaultBodyLimit` de 64 KB e nenhum log do corpo;
- sem CORS, porque o player é da mesma origem.

Tentar 31⁶ códigos dentro de 10 minutos esbarra no limite do nginx (`soft_limit`, 50 por segundo): no máximo cerca de 30 mil tentativas.

**Player (`transfer.ts`):**
- o pacote enviado é `{v: 1, settings, layout, areas}`;
- ao receber, o player valida campo a campo, como `settings.validate`, e tudo que vier inválido volta ao padrão;
- o tempo restante aparece no painel, e o código também aparece grande no centro da tela enquanto o painel está aberto.

### D8. Formato salvo no navegador
- `decklive.settings.v1` continua com as preferências.
- Duas chaves novas: `decklive.layout.v1` e `decklive.areas.v1`, cada uma validada ao ler, com `try/catch`.
- Juntas, as três formam o pacote de envio.

## Risks / Trade-offs

- **[Endpoint do usuário sem CORS]** → A área mostra o erro. O README documenta os cabeçalhos necessários (`Access-Control-Allow-Origin`, `Access-Control-Allow-Headers: Authorization`). Se for preciso, um proxy pode ser uma mudança futura.
- **[Token do endpoint no `localStorage` e de passagem pela memória da API]** → Está restrito à origem e é de uso único por 10 minutos, sem log. O README recomenda um token só de leitura.
- **[Modo de edição pesado de usar no controle remoto]** → A navegação por direção e os passos de 1% resolvem as posições. O conteúdo longo vem pelo envio de outra tela.
- **[Tamanho do pacote]** → O orçamento é de cerca de 12 KB a mais com gzip (editor, áreas, modelo, envio). A tarefa de conferência mede, e o limite continua em 50 KB.
- **[Muitos `iframe`s numa TV fraca]** → São no máximo 8 áreas, e um `iframe` só existe na área de endpoint.

## Migration Plan

- **Dados:** nada muda no banco. Os ajustes antigos continuam válidos, e as chaves novas começam vazias, o que dá o layout padrão e nenhuma área.
- **Deploy:** imagem nova no servidor, com o mesmo procedimento.
