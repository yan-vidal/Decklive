# Spec Delta

## Purpose

Transforma qualquer navegador de TV ou celular num porta-retratos com relógio, que mostra as fotos da playlist com o mesmo visual do DeckLock e guarda as preferências só naquele navegador.

## ADDED Requirements

### Requirement: Sequência de fotos
O player SHALL pedir a playlist da faixa canônica da sua janela (tamanho CSS × `devicePixelRatio`) e mostrar as fotos em ordem embaralhada, com novo embaralhamento a cada volta e sem repetir a última foto no começo da volta seguinte. Cada foto fica o tempo configurado (padrão 30 s) e a troca MUST ser um crossfade de 600 ms.

#### Scenario: Início
- **WHEN** o player abre numa TV 1920×1080 e a playlist tem fotos
- **THEN** a primeira foto aparece com o corte recebido e a próxima troca acontece depois de 30 s

#### Scenario: Fim da volta
- **WHEN** todas as fotos já foram mostradas
- **THEN** o player embaralha de novo e a primeira foto da nova volta é diferente da última mostrada (se houver mais de uma foto)

### Requirement: Carga antes da troca
O player SHALL baixar e decodificar a próxima foto antes de começar a transição, direto da URL `src`, e MUST manter em memória só a foto atual e a próxima. Se a próxima foto falhar, o player pula para a seguinte, sem tela vazia.

#### Scenario: Foto lenta
- **WHEN** o tempo da foto atual acaba e a próxima ainda está baixando
- **THEN** a foto atual continua na tela até a próxima estar pronta

#### Scenario: Foto com erro
- **WHEN** o download da próxima foto falha
- **THEN** o player tenta a foto seguinte e a foto atual continua na tela enquanto isso

### Requirement: Modos de enquadramento
O player SHALL oferecer três modos: `auto` (padrão), `fill` e `fit`. Em `fill`, a foto cobre a janela sem deformar, com o `crop` recebido ajustado à proporção exata da janela pelo centro dele. Em `fit`, mostra a foto inteira sobre a cor dominante dela. Em `auto`, usa `fill` quando a orientação da foto bate com a da tela e `fit` quando não bate; foto `square` só bate com tela quadrada.

#### Scenario: Foto deitada em TV, modo auto
- **WHEN** o modo é `auto` e uma foto `landscape` aparece numa TV deitada
- **THEN** a foto preenche a tela com o corte recebido

#### Scenario: Janela com proporção diferente da faixa
- **WHEN** o modo é `fill` numa janela de 1920×970, que cai na faixa 19,5:9
- **THEN** a foto cobre a janela inteira sem deformar e o centro do corte recebido fica no centro da janela, salvo quando isso mostraria borda vazia

#### Scenario: Foto em pé em TV, modo auto
- **WHEN** o modo é `auto` e uma foto `portrait` aparece numa TV deitada
- **THEN** a foto aparece inteira, centralizada, sobre a cor dominante dela

### Requirement: Pular fotos de outra orientação
O player SHALL ter a opção, desligada por padrão, de pular as fotos cuja orientação não bate com a da tela. Fotos `square` nunca são puladas. Se nenhuma foto bater, MUST mostrar todas.

#### Scenario: Opção ligada no celular em pé
- **WHEN** a opção está ligada e o celular está em pé
- **THEN** só aparecem fotos `portrait` e `square`

### Requirement: Mudança de tamanho ou rotação
Quando a faixa canônica da tela muda (rotação do celular, janela redimensionada), o player SHALL pedir a playlist da nova faixa e reenquadrar a foto atual em até 1 s depois da resposta.

#### Scenario: Celular girado
- **WHEN** o celular passa de em pé para deitado
- **THEN** o player pede a playlist da nova faixa e a foto atual passa a usar o corte novo

### Requirement: Relógio
O player SHALL mostrar o relógio por padrão, no fuso horário do aparelho, no formato 24 h (`HH:MM`), com opção de 12 h. A troca de minuto MUST aparecer em até 1 s depois da virada no relógio do aparelho.

#### Scenario: Relógio padrão
- **WHEN** o player abre pela primeira vez num aparelho com fuso `America/Fortaleza` às 18:05 locais
- **THEN** o relógio mostra `18:05`

#### Scenario: Relógio desligado
- **WHEN** o usuário desliga o relógio nos ajustes
- **THEN** o relógio some; se a data estiver ligada, ela continua visível sozinha

### Requirement: Data
O player SHALL ter a data (o "calendário") desligada por padrão. Ligada, ela aparece abaixo do relógio com dia da semana, dia e mês por extenso, no idioma do navegador com a primeira letra maiúscula, como no DeckLock (pt-BR: "Quarta-feira, 28 de outubro"; outros: inglês, "Wednesday, October 28"), e MUST virar à meia-noite local.

#### Scenario: Data ligada em português
- **WHEN** o navegador está em pt-BR e o usuário liga a data em 28/10/2026
- **THEN** aparece "Quarta-feira, 28 de outubro" abaixo do relógio

### Requirement: Visual de referência
O player SHALL reproduzir o visual do DeckLock em repouso: relógio e data centralizados, em branco com sombra, sobre um véu escuro na foto. Na tela de referência de 1280×800, o relógio tem 96 px com peso 300 e a data 22 px; em outras telas, relógio e data escalam pelo menor fator entre lado longo/1280 e lado curto/800 (a referência gira com a tela), nunca abaixo de 0,6. Botões e painel nunca ficam menores que o tamanho de referência. Medidas, cores e tempos MUST ficar em variáveis CSS.

#### Scenario: TV 4K
- **WHEN** o player abre numa tela de 3840×2160 pixels CSS
- **THEN** o relógio tem 259 px de altura de fonte (96 × 2,7)

#### Scenario: Celular em pé
- **WHEN** o player abre num celular de 390×844 pixels CSS
- **THEN** o relógio tem 57,6 px e a data 13,2 px (fator mínimo 0,6), e os botões têm pelo menos o tamanho de referência

### Requirement: Ajustes salvos no navegador
O player SHALL ter um painel de ajustes com relógio, formato 12/24 h, data, modo de enquadramento, pular outra orientação e tempo por foto (10 s, 30 s, 1 min, 5 min). As mudanças valem na hora e MUST ficar salvas no `localStorage`. Sem `localStorage`, o player funciona com os padrões durante a visita.

#### Scenario: Preferência lembrada
- **WHEN** o usuário liga a data, fecha o navegador e abre o player de novo
- **THEN** a data já aparece ligada

#### Scenario: Armazenamento bloqueado
- **WHEN** o navegador bloqueia o `localStorage`
- **THEN** o player abre com os padrões e os ajustes valem até a página fechar

### Requirement: Controles discretos
Os botões de ajustes e de tela cheia e o cursor SHALL ficar escondidos enquanto ninguém mexe. Qualquer movimento de mouse, toque ou tecla os mostra, e eles MUST sumir 4 s depois da última interação, a não ser que o painel esteja aberto.

#### Scenario: Toque no celular
- **WHEN** o usuário toca na tela
- **THEN** os botões aparecem e somem 4 s depois se não houver outro toque

### Requirement: Controle remoto da TV
Todo o player SHALL ser operável só com as setas, Enter/OK e Voltar/Esc. O item em foco MUST ter destaque visível na cor de destaque do DeckLock (`#7aa2f7`).

#### Scenario: Abrir ajustes pelo controle
- **WHEN** o usuário aperta OK com os controles escondidos
- **THEN** os controles aparecem com o foco no botão de ajustes, e as setas movem o foco entre as opções

#### Scenario: Fechar com Voltar
- **WHEN** o painel está aberto e o usuário aperta Voltar ou Esc
- **THEN** o painel fecha e a página não sai do player

### Requirement: Tela cheia e tela acesa
O botão de tela cheia SHALL alternar a tela cheia do navegador e MUST sumir onde a API de tela cheia não existe. A página MUST ter um manifesto de app web com exibição em tela cheia, para ser adicionada à tela inicial. Enquanto visível, o player pede ao aparelho para não apagar a tela, onde houver suporte.

#### Scenario: iPhone
- **WHEN** o navegador não tem a API de tela cheia para elementos
- **THEN** o botão de tela cheia não aparece

#### Scenario: Celular parado
- **WHEN** o player fica 10 min aberto num celular com suporte a manter a tela acesa
- **THEN** a tela continua acesa

### Requirement: Falhas de rede
O player SHALL guardar no navegador a última playlist recebida e usá-la ao abrir se a API falhar. Ele MUST atualizar a playlist a cada 10 min usando `If-None-Match`. Sem nenhuma playlist, mostra o relógio sobre fundo preto com um aviso discreto e tenta de novo com espera crescente até 5 min.

#### Scenario: API fora do ar com playlist guardada
- **WHEN** a API está fora do ar e o player já recebeu uma playlist antes
- **THEN** o player abre com as fotos da playlist guardada

#### Scenario: Primeira visita sem API
- **WHEN** a API está fora do ar e não há playlist guardada
- **THEN** aparece o relógio sobre fundo preto com o aviso, e as tentativas continuam

### Requirement: Leveza e compatibilidade
O player SHALL funcionar em navegadores Chromium 53 ou mais novos e Safari 12 ou mais novo, o que cobre TVs Samsung (Tizen) e LG (webOS) de 2018 em diante. HTML, CSS e JavaScript juntos MUST somar menos de 50 KB comprimidos. Recursos ausentes (tela cheia, tela acesa, `img.decode`) são detectados e contornados, sem erro.

#### Scenario: TV Samsung com Tizen
- **WHEN** o player abre no navegador de uma TV Samsung com Tizen
- **THEN** as fotos trocam, o relógio aparece e os ajustes abrem pelo controle remoto

#### Scenario: Navegador sem img.decode
- **WHEN** o navegador não tem `HTMLImageElement.decode`
- **THEN** o player espera o evento `load` da imagem e segue normalmente
