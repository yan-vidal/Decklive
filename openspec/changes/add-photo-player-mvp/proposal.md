# Proposal

## Why

O DeckLock vai buscar as mídias de idle e de fundo num servidor externo, e esse servidor ainda não existe. O DeckLive é esse servidor. Além disso, ele traz um player web que transforma qualquer TV ou celular com navegador num porta-retratos com relógio. As fotos já estão no R2 e catalogadas na API do yanlucas.com. Falta escolher quais delas aparecem e entregá-las a cada tela sem que o custo cresça com o número de telas. Esta primeira versão precisa ficar utilizável hoje, para algumas pessoas testarem em TVs e celulares.

## What Changes

- Nova API em Rust (axum + SQLite) com um catálogo próprio das fotos liberadas para exibição:
  - `POST /api/media` registra uma foto da API do yanlucas.com pelo id, com corte opcional.
  - `DELETE /api/media` remove uma lista de fotos da exibição.
  - `GET /api/media` lista o que o sistema fornece.
  - As três rotas exigem um token de administrador.
- Nova rota pública `GET /api/playlist`. Ela recebe a faixa de tela do aparelho e devolve, para cada foto, o arquivo mais leve que ainda fica nítido naquela tela e o corte já calculado. A resposta é pequena e cacheável.
- Novo player web em TypeScript puro, servido pelo mesmo binário:
  - Sequência de fotos com transição suave e botão de tela cheia.
  - Relógio ligado por padrão, no fuso do aparelho, e data (o "calendário") opcional.
  - Ajustes de exibição (modo de enquadramento, orientação, tempo por foto) salvos só no navegador.
  - Funciona com mouse, toque e setas do controle remoto da TV.
- O layout do player segue o do DeckLock (relógio, data, véu, transição). As medidas, cores e tempos ficam em variáveis CSS, para que o DeckLock possa copiá-las depois.
- Fora desta mudança: vídeo, widgets (música, senhas de sala de espera), anúncios, mídias próprias do usuário, envio de arquivos, contas de usuário e o DeckLock consumindo a API.

## Capabilities

### New Capabilities
- `media-catalog`: escolha das fotos disponíveis para exibição. Cobre o registro a partir da API do yanlucas.com, a remoção em lote, a listagem, a proteção por token e os cortes ou o ponto de interesse de cada foto.
- `playlist`: entrega pública das fotos para uma tela. Cobre as faixas de tela aceitas, a escolha do tamanho de arquivo, o corte calculado para a proporção da tela e as regras de cache.
- `web-player`: exibição no navegador. Cobre a sequência de fotos, o relógio, a data, os ajustes salvos localmente, a tela cheia, o uso em TV e celular e o comportamento quando a rede falha.

### Modified Capabilities
- Nenhuma (projeto novo).

## Impact

- Repositório novo (`yan-vidal/Decklive`): crate Rust na raiz e front em `web/`.
- Dependências novas: Rust (axum, tokio, sqlx/SQLite, reqwest, serde, tower-http) e, no front, Vite e TypeScript, só para o build.
- Depende da API pública `https://api.yanlucas.com/images` (somente leitura) e das URLs públicas de `cdn.yanlucas.com`. Nada muda nesses sistemas.
- Implantação: um container num servidor, publicado num subdomínio próprio e com um token de administrador em variável de ambiente.
