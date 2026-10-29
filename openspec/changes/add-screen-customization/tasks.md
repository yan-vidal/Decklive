# Tasks

## 1. Envio de ajustes na API (`settings-transfer`)

- [x] 1.1 Escrever primeiro os testes do armazenamento em memória (código no alfabeto, vencimento com relógio injetável, uso único, limite de 500, busca sem diferenciar maiúsculas) e depois implementar `src/pairing.rs`; verificar com `cargo test pairing`
- [x] 1.2 Implementar `POST /api/pairing` e `GET /api/pairing/{code}` (64 KB, `413`/`422`/`503`/`404`, sem log do corpo); verificar com testes de integração de todos os cenários da spec `settings-transfer` do lado da API e documentar no `README.md`

## 2. Posições e modo de edição (`web-player`)

- [x] 2.1 Separar relógio, data, local e descrição em blocos posicionáveis (design D2) sem mudar o padrão; verificar com Playwright que os retângulos do relógio, da data e dos textos em 1920×1080, 390×844 e 844×390 são os mesmos de antes da mudança (diferença ≤ 1 px)
- [x] 2.2 Implementar `layout.ts` (formato D1, validação, posição por orientação, limite para dentro da janela, alinhamento por terço, restaurar); verificar com testes de unidade de "Celular girado", "Restaurar" e posição limitada à janela
- [x] 2.3 Implementar `editor.ts` com arraste por mouse e toque, navegação por direção, estado de mover pelo controle, barra (Nova área, Restaurar, Concluir) e pausa do `Stage`; verificar no navegador os cenários "Entrar e sair", "Arrastar o relógio" e "Mover pelo controle" (este só com teclado)
- [x] 2.4 Acrescentar "Editar tela" e "Restaurar posições padrão" ao painel; verificar no navegador que as duas opções funcionam pelo controle e que o Voltar fecha o modo sem sair da página

## 3. Áreas próprias (`web-player`)

- [x] 3.1 Implementar `template.ts` (D6) com testes primeiro: campos com caminho, `{{.}}`, seções sobre lista, objeto e booleano, seções invertidas, escape e campo ausente; verificar com `npm --prefix web test`
- [x] 3.2 Implementar `areas.ts` com a criação, o redimensionamento (alça e setas), a exclusão, o limite de 8 e o formato D4 salvo em `decklive.areas.v1`; verificar com teste de validação do formato e, no navegador, o cenário "Nova área"
- [x] 3.3 Implementar as áreas de texto e imagem e o sub-painel de conteúdo; verificar no navegador "Aviso fixo" e "Imagem quebrada"
- [x] 3.4 Implementar a área de endpoint (D5) com `iframe` em `sandbox`, a pausa com a página oculta e o tratamento de erro; verificar com testes de agendamento (relógio falso) e, no navegador, contra um endpoint de teste local com CORS, os cenários "Senhas da sala de espera", "Valor com HTML", "Script no modelo" e "Endpoint sem CORS"

## 4. Envio e recebimento no player (`settings-transfer`)

- [x] 4.1 Implementar `transfer.ts` e as opções "Enviar para outra tela" e "Receber ajustes" no painel, com a validação do pacote recebido; verificar com testes de validação e, no Playwright, com dois contextos de navegador, os cenários "Do computador para a TV" e "Código errado" contra o container local

## 5. Conferência

- [x] 5.1 Conferir o build; verificar que HTML + CSS + JS com gzip ficam abaixo de 50 KB e que o JS gerado não tem sintaxe acima de ES2016
- [x] 5.2 Reconstruir o container local e conferir de ponta a ponta com Playwright em 1920×1080 e 390×844: mover elementos, restaurar, criar uma área de cada tipo, girar a tela e enviar os ajustes de um contexto para outro; guardar screenshots

## Workflow follow-up

- Implantar no servidor de casa, junto com `add-localized-descriptions`.
- Testar o modo de edição e o recebimento de ajustes na TV Samsung com Tizen (junto com a tarefa 7.2 de `add-photo-player-mvp`).
- Arquivar depois de `add-photo-info-and-motion`.
