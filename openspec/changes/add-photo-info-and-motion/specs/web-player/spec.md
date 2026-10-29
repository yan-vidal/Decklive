# Spec Delta

## ADDED Requirements

### Requirement: Movimento de câmera
Com o movimento ligado, o player SHALL mover cada foto devagar durante todo o tempo dela na tela, troca incluída: uma aproximação de 100% para 106% do enquadramento ou um afastamento de 106% para 100%, alternando de uma foto para a outra, com um leve deslocamento na parte ampliada. O movimento MUST ter velocidade constante. Relógio, data e textos da foto não se movem.

#### Scenario: Duas fotos seguidas
- **WHEN** o movimento está ligado e uma foto se aproxima durante o seu tempo na tela
- **THEN** a foto seguinte se afasta, e a outra depois dela volta a se aproximar

#### Scenario: Foto que demora a trocar
- **WHEN** o tempo da foto acaba e a próxima ainda está baixando
- **THEN** a foto atual fica parada na posição final do movimento até a troca

### Requirement: Movimento sem borda vazia
O movimento MUST NOT mostrar borda vazia quando a foto preenche a tela, em nenhum momento, nem tirar parte da foto de vista quando ela aparece inteira. Quando a foto aparece inteira, o movimento usa de 97% a 100% do tamanho dela, sem deslocamento.

#### Scenario: Foto preenchendo a tela
- **WHEN** o movimento está ligado e a foto aparece em `fill` numa janela de 1920×970
- **THEN** em qualquer momento do movimento a foto cobre a janela inteira

#### Scenario: Foto inteira
- **WHEN** o movimento está ligado e uma foto `portrait` aparece em `fit` numa TV deitada
- **THEN** em qualquer momento do movimento a foto inteira continua visível

### Requirement: Ajuste de movimento
O painel de ajustes SHALL ter a opção "Movimento", salva no navegador como as outras. Ela começa ligada, exceto quando o aparelho pede menos movimento (`prefers-reduced-motion: reduce`) e o usuário ainda não escolheu. Desligada, a foto MUST voltar na hora ao enquadramento parado.

#### Scenario: Padrão
- **WHEN** o player abre pela primeira vez num aparelho sem preferência de movimento
- **THEN** a opção "Movimento" está ligada e as fotos se movem

#### Scenario: Aparelho pede menos movimento
- **WHEN** o player abre pela primeira vez num aparelho com `prefers-reduced-motion: reduce`
- **THEN** a opção "Movimento" está desligada e as fotos ficam paradas

#### Scenario: Desligar no meio de uma foto
- **WHEN** o usuário desliga o movimento enquanto uma foto se move
- **THEN** a foto volta ao enquadramento parado e as próximas também ficam paradas

### Requirement: Local e descrição sobre a foto
O player SHALL mostrar no canto inferior esquerdo, de baixo para cima, o resumo (`text`), o título (`title`) e o local (`place`, com um ícone de marcador) da foto atual, em branco com sombra como o relógio. Os textos trocam junto com a foto, no mesmo crossfade, e não se movem com ela. Um campo `null` ou ausente não aparece; sem nenhum, nada aparece.

#### Scenario: Foto com local e descrição
- **WHEN** a foto atual tem `place` "Jericoacoara, Ceará, Brazil", `title` "Sunset Dune" e um `text`
- **THEN** o canto inferior esquerdo mostra o local com o marcador, o título e o resumo

#### Scenario: Foto só com local
- **WHEN** a foto atual tem `place` e não tem `title` nem `text`
- **THEN** só o local aparece

#### Scenario: Playlist guardada de uma versão anterior
- **WHEN** o player abre com uma playlist guardada cujos itens não têm `place`, `title` nem `text`
- **THEN** as fotos aparecem normalmente, sem textos, e sem erro

### Requirement: Tamanho e espaço dos textos da foto
Na tela de referência de 1280×800, o título SHALL ter 24 px, o resumo 16 px e o local 15 px, numa coluna de até 560 px a 32 px das bordas. Eles escalam como os botões (nunca menores que a referência) e MUST caber na janela sem cobrir o relógio nem a data. Medidas e cores ficam em variáveis CSS.

#### Scenario: TV Full HD
- **WHEN** o player abre numa TV de 1920×1080 pixels CSS
- **THEN** o título tem 32,4 px e o resumo 21,6 px (fator 1,35)

#### Scenario: Celular deitado
- **WHEN** o player abre num celular de 844×390 pixels CSS com relógio e data ligados
- **THEN** os textos da foto ficam visíveis inteiros ou cortados com "…", sem cobrir o relógio nem a data

### Requirement: Ajustes de local e descrição
O painel de ajustes SHALL ter as opções "Local" e "Descrição", ligadas por padrão e salvas no navegador como as outras. "Local" mostra ou esconde o local; "Descrição" mostra ou esconde o título e o resumo. A mudança MUST valer na hora, na foto atual.

#### Scenario: Só o local
- **WHEN** o usuário desliga "Descrição" e deixa "Local" ligado
- **THEN** só o local aparece, nesta foto e nas próximas, também depois de abrir o player de novo
