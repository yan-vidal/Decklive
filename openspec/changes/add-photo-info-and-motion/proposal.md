# Proposal

## Why

A foto parada com o relógio em cima funciona, mas fica estática numa TV que passa o dia ligada, e quem olha não sabe onde a foto foi tirada. A API do yanlucas.com já tem, para quase todas as fotos, a cidade, o estado e o país, e para metade delas uma descrição no formato "Título: texto" sobre o lugar. Com esses dados, o DeckLive pode mostrar a foto como a tela de bloqueio do Windows: com um pouco de movimento e um texto discreto que diz o que é o lugar.

## What Changes

- **Movimento de câmera:** o player passa a aplicar, em cada foto, uma aproximação ou um afastamento lento, com um leve deslocamento. O movimento é ligado por padrão, nunca mostra borda vazia e pode ser desligado nos ajustes. Ele também começa desligado quando o aparelho pede menos movimento.
- **Local e descrição sobre a foto:** o player mostra, num canto de baixo, o local ("Jericoacoara, Ceará, Brazil"), o título e um resumo curto da descrição. Esses textos trocam junto com a foto e podem ser desligados nos ajustes, cada um separadamente.
- O registro de foto passa a gravar a cidade, o estado e o país vindos do yanlucas.com, e a listagem do catálogo passa a mostrá-los.
- O item da playlist ganha `place`, `title` e `text`, já prontos para exibir. A API separa o título do texto e reduz o texto à primeira frase, para que a resposta continue pequena e o front só aplique.
- As coordenadas que algumas fotos têm na origem não são gravadas nem expostas, porque a playlist é pública.
- Fora desta mudança: tradução dos textos (eles vêm em inglês da origem), texto completo sob demanda, mapa e edição manual do local.

## Capabilities

### New Capabilities
- Nenhuma.

### Modified Capabilities
Estas três capacidades nascem na mudança `add-photo-player-mvp`, que ainda não foi arquivada. Esta mudança só acrescenta requisitos a elas e deve ser arquivada depois dela.
- `media-catalog`: o registro grava o local da foto (cidade, estado e país), e a listagem o devolve.
- `playlist`: o item ganha o local e a descrição prontos para exibir (`place`, `title`, `text`).
- `web-player`: movimento de câmera, local e descrição sobre a foto, e três novos ajustes (movimento, local e descrição).

## Impact

- Banco: nova migração que acrescenta `city`, `state` e `country` à tabela `media`. As fotos já registradas ficam sem local até serem registradas de novo.
- API: `GET /api/media` e `GET /api/playlist` ganham campos novos. Nenhum campo existente muda, então clientes antigos continuam funcionando.
- Front: `stage.ts` (movimento e textos na camada da foto), `settings.ts`, painel de ajustes, `i18n.ts`, `tokens.css` e `style.css`. O build tem de continuar abaixo de 50 KB com gzip.
- Nenhuma dependência nova, nenhum serviço externo novo e nenhum custo novo: os dados já vêm na mesma chamada à API do yanlucas.com que o registro faz hoje.
