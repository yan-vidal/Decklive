# Spec Delta

## ADDED Requirements

### Requirement: Modo de edição da tela
O painel de ajustes SHALL ter "Editar tela", que entra no modo de edição. Nele, cada elemento móvel (relógio, data, local, descrição e cada área própria) ganha contorno e nome, e a troca de fotos MUST pausar até o modo fechar. "Concluir", Esc ou Voltar fecham o modo e salvam as posições.

#### Scenario: Entrar e sair
- **WHEN** o usuário escolhe "Editar tela" e depois "Concluir"
- **THEN** os elementos ganham contorno enquanto o modo está aberto, a foto não troca, e ao concluir a tela volta ao normal com as posições novas

### Requirement: Mover elementos
No modo de edição, os elementos SHALL ser arrastados com o mouse ou o toque. Pelo controle: as setas navegam entre os elementos e os botões, OK pega o elemento em foco, as setas o movem em passos de 1% da tela e OK ou Voltar o soltam. Nenhum elemento MUST passar da borda da janela. A foto de fundo não se move.

#### Scenario: Arrastar o relógio
- **WHEN** o usuário arrasta o relógio para o canto superior esquerdo
- **THEN** o relógio fica lá, inteiro dentro da janela, também depois de recarregar a página

#### Scenario: Mover pelo controle
- **WHEN** o usuário foca a data, aperta OK e aperta a seta para a direita 5 vezes
- **THEN** a data anda 5% da largura da tela para a direita

### Requirement: Posições por orientação
As posições SHALL ser guardadas no navegador em proporção da janela, uma para a tela deitada e outra para a tela em pé. Um elemento nunca movido numa orientação MUST ficar na posição padrão dela. Ao girar ou redimensionar, os elementos seguem a posição da orientação nova, sempre dentro da janela.

#### Scenario: Celular girado
- **WHEN** o usuário moveu o relógio com o celular em pé e depois gira o celular
- **THEN** com o celular deitado, o relógio aparece na posição padrão, e volta à posição movida quando o celular fica em pé de novo

### Requirement: Restaurar posições padrão
O painel de ajustes e o modo de edição SHALL ter "Restaurar posições padrão". A opção devolve o relógio, a data, o local e a descrição às posições do DeckLock, nas duas orientações, e MUST manter as áreas próprias, que não têm posição padrão.

#### Scenario: Restaurar
- **WHEN** o usuário moveu o relógio e o local e escolhe "Restaurar posições padrão"
- **THEN** o relógio volta ao centro e o local ao canto inferior esquerdo, e as áreas próprias ficam onde estavam

### Requirement: Áreas próprias
No modo de edição, "Nova área" SHALL criar uma área retangular, que pode ser movida, redimensionada (pelo canto, ou pelas setas depois de escolher "Redimensionar"), configurada e excluída. São no máximo 8 áreas, cada uma com posição e tamanho por orientação, como os outros elementos. O conteúdo de cada área MUST ser de um tipo: texto, imagem ou endpoint.

#### Scenario: Nova área
- **WHEN** o usuário cria uma área, a redimensiona e escolhe "Concluir"
- **THEN** a área aparece no tamanho e na posição escolhidos, sobre a foto, também depois de recarregar

### Requirement: Área de texto ou imagem
Uma área de texto SHALL mostrar o texto informado, com quebras de linha, em branco com sombra, em um de três tamanhos (pequeno, médio, grande). Uma área de imagem mostra a imagem da URL `https` informada, inteira e centrada na área. Se a imagem falhar, a área MUST ficar vazia, sem quebrar o player.

#### Scenario: Aviso fixo
- **WHEN** o usuário cria uma área de texto com "Bem-vindo à clínica"
- **THEN** o texto aparece na área escolhida, por cima de todas as fotos

#### Scenario: Imagem quebrada
- **WHEN** a URL da imagem responde `404`
- **THEN** a área fica vazia e as fotos e o relógio continuam normais

### Requirement: Área de endpoint
Uma área de endpoint SHALL chamar, do navegador, a URL `https` informada, com o cabeçalho `Authorization` informado (opcional), na frequência escolhida (10 s a 1 h, padrão 30 s), e mostrar o modelo HTML preenchido com o JSON da resposta. As chamadas MUST pausar com a página oculta.

#### Scenario: Senhas da sala de espera
- **WHEN** o endpoint responde `{"atual": "A12", "proximas": [{"senha": "A13"}, {"senha": "A14"}]}` e o modelo é `<h1>{{atual}}</h1><ul>{{#proximas}}<li>{{senha}}</li>{{/proximas}}</ul>`
- **THEN** a área mostra "A12" em destaque e a lista com A13 e A14, e se atualiza na frequência escolhida

### Requirement: Modelo HTML da área
O modelo SHALL aceitar `{{campo}}` (com caminho por ponto, como `{{fila.atual}}`), `{{#lista}}…{{/lista}}` para listas ou valores verdadeiros e `{{^campo}}…{{/campo}}` para valores ausentes ou falsos. Os valores MUST entrar escapados como texto. O resultado aparece num `iframe` com `sandbox` sem scripts, de fundo transparente.

#### Scenario: Valor com HTML
- **WHEN** o endpoint responde `{"atual": "<b>A12</b>"}`
- **THEN** a área mostra o texto `<b>A12</b>` literalmente, sem negrito

#### Scenario: Script no modelo
- **WHEN** o modelo contém `<script>`
- **THEN** o script não roda e o player continua funcionando

### Requirement: Falha do endpoint
Se uma chamada falhar (rede, CORS, status diferente de 2xx ou JSON inválido), a área SHALL manter o último conteúdo exibido e mostrar uma marca discreta de erro. Sem nenhum conteúdo anterior, mostra uma mensagem curta de erro. A próxima tentativa MUST seguir a frequência configurada.

#### Scenario: Endpoint sem CORS
- **WHEN** o endpoint não libera CORS para a origem do player
- **THEN** a área mostra a mensagem de erro, e o resto do player continua normal
