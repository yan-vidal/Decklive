# Proposal

## Why

O layout fixo do DeckLock nem sempre combina com a TV ou com o lugar onde ela fica. Além disso, o DeckLive precisa de um espaço para informação do próprio usuário: um aviso, uma imagem ou, por exemplo, as senhas da sala de espera vindas de um endpoint dele. Como os ajustes ficam só no navegador, também é preciso um jeito de levar uma configuração feita no computador para a TV, onde digitar com o controle é inviável.

## What Changes

- **Modo de edição da tela**, aberto pelos ajustes:
  - O relógio, a data, o local, a descrição e as áreas próprias podem ser arrastados com o mouse ou o toque, ou movidos com as setas do controle. A foto de fundo fica fixa.
  - As posições são salvas no navegador, uma para a tela deitada e outra para a tela em pé.
  - A opção "Restaurar posições padrão" volta ao layout do DeckLock.
- **Áreas próprias**, criadas e posicionadas no modo de edição, com tamanho ajustável. Cada área mostra um de três conteúdos:
  - um texto;
  - uma imagem, por URL;
  - um HTML montado com o JSON de um endpoint. A URL, o cabeçalho `Authorization` e a frequência são configuráveis, e o navegador chama o endpoint direto. O HTML usa um modelo com campos do JSON, e o resultado aparece isolado do player, sem rodar scripts.
- **Envio de ajustes para outra tela:** no computador, "Enviar para outra tela" gera um código de 6 caracteres válido por 10 minutos. Na TV, "Receber ajustes" com esse código traz todos os ajustes: preferências, posições e áreas. A API guarda o pacote só na memória, por um uso.
- Fora desta mudança:
  - mudar o tamanho do relógio, da data e dos textos da foto;
  - proxy do endpoint no servidor;
  - scripts no HTML da área;
  - contas e sincronização contínua entre telas.

## Capabilities

### New Capabilities
- `settings-transfer`: código de uso único para copiar os ajustes de um navegador para outro, guardado só na memória da API por pouco tempo.

### Modified Capabilities
`web-player` nasce em `add-photo-player-mvp`, que ainda não foi arquivada. Aqui ela ganha:
- o modo de edição da tela;
- as posições salvas por orientação;
- a restauração das posições padrão;
- as áreas próprias de texto, imagem e endpoint.

## Impact

- **Front (a maior parte da mudança):**
  - módulos novos: `layout.ts` (posições), `editor.ts` (modo de edição), `areas.ts` (áreas e chamadas ao endpoint), `template.ts` (modelo do HTML) e `transfer.ts`;
  - mudanças em `index.html`, `style.css`, `panel.ts`, `settings.ts` (formato novo dos ajustes) e `i18n.ts`;
  - o build com gzip tem de continuar abaixo de 50 KB.
- **API:** `POST /api/pairing` e `GET /api/pairing/{code}`, com o estado só na memória, com limites. Não muda nada no banco.
- **Segurança:**
  - o token do endpoint do usuário fica no `localStorage` daquele navegador, e passa pela memória da API por até 10 minutos durante um envio;
  - o HTML da área roda num `iframe` com `sandbox` sem scripts.
- **Requisito para o endpoint do usuário:** liberar CORS para o domínio onde o DeckLive está publicado, com o cabeçalho `Authorization`, e ser `https`.
