# Tasks

## 1. Base do projeto

- [x] 1.1 Criar o crate Rust na raiz (`Cargo.toml`, `src/main.rs`) com as dependências do design D2, `rustfmt.toml` e `.gitignore` (`target/`, `data/`, `web/node_modules/`, `web/dist/`); verificar com `cargo build` sem erros
- [x] 1.2 Criar `web/` com Vite + TypeScript (`strict`, `lib` ES2016 + DOM, build com alvo `chrome53` + `safari12`), Vitest e proxy de `/api` para `localhost:8080`; verificar com `npm --prefix web run build` gerando `web/dist/index.html` e sem `async` nativo no JS gerado
- [x] 1.3 Criar `fixtures/screen-buckets.json` com pelo menos 12 casos de faixa (incluindo os 3 da spec `playlist`, telas quadradas, telas exatamente em 1280 e 1920 no lado longo, telas menores que 1280 e fotos perto do limite de `square`); verificar que o arquivo é JSON válido com `jq . fixtures/screen-buckets.json`

## 2. Configuração, banco e token

- [x] 2.1 Carregar a configuração do design D8, com o processo encerrando quando falta `DECKLIVE_ADMIN_TOKEN` ou ele tem menos de 32 caracteres; verificar com teste de unidade que cobre token ausente, curto e válido
- [x] 2.2 Criar a migração SQLite do design D3 (WAL ligado) e o repositório de leitura/escrita do catálogo com a `revision` incrementada na mesma transação; verificar com teste que registrar, registrar de novo e remover sobem a `revision` e preservam `created_at`
- [x] 2.3 Implementar o middleware de token (comparação em tempo constante) nas rotas `/api/media`; verificar com testes de integração dos cenários "Requisição sem token" e "Token errado" da spec `media-catalog`

## 3. Catálogo (`media-catalog`)

- [x] 3.1 Escrever primeiro os testes do cliente da fonte com `wiremock` (item achado, `500` + sonda `200` → não existe, `500` + sonda falhando → fora do ar, timeout) e depois implementar o cliente do design D4; verificar com `cargo test source`
- [x] 3.2 Escrever primeiro os testes da escolha de versão, da cor dominante e da lista de hosts permitidos e depois implementar; verificar com os cenários "Versão padrão", "Original pedido" e "Versão desconhecida"
- [x] 3.3 Implementar a medição das dimensões pelo cabeçalho do arquivo (`Range` + `imagesize`) com volta para `metadata`; verificar com teste que usa um JPEG pequeno servido pelo `wiremock`
- [x] 3.4 Escrever primeiro os testes de validação de `focus` e `crops` (fora de 0..1, `x + w > 1`, largura zero) e depois implementar; verificar com o cenário "Coordenadas inválidas"
- [x] 3.5 Implementar `POST /api/media` (201 nova, 200 já registrada, 404, 422, 502); verificar com testes de integração de todos os cenários do requisito "Registro de foto a partir do yanlucas.com"
- [x] 3.6 Implementar `DELETE /api/media` e `GET /api/media`; verificar com testes de integração dos cenários "Remoção de fotos existentes e inexistentes", "Lista vazia", "Catálogo com fotos" e "Catálogo vazio"
- [x] 3.7 Documentar no `README.md` o registro, a remoção e a listagem com exemplos de `curl`; verificar rodando os três exemplos contra o servidor local

## 4. Playlist (`playlist`)

- [x] 4.1 Escrever primeiro o teste que lê `fixtures/screen-buckets.json` e depois implementar a faixa canônica do design D6; verificar com `cargo test bucket`
- [x] 4.2 Escrever primeiro os testes de tabela do corte (sem enquadramento, ponto perto da borda, região, região grande demais, só a região da outra orientação) e depois implementar o design D7; verificar que o corte tem a proporção da tela com erro abaixo de 0,5 % e fica dentro da foto
- [x] 4.3 Escrever primeiro os testes da escolha de arquivo ("Otimizado basta", "TV Full HD", nenhum alcança) e depois implementar; verificar com `cargo test variant`
- [x] 4.4 Implementar o snapshot em memória com memorização por `(revision, faixa)` do design D5; verificar com teste que uma escrita no catálogo troca o `ETag`
- [x] 4.5 Implementar `GET /api/playlist` com `400`, redirecionamento `308`, `Cache-Control`, `ETag`, `304` e CORS; verificar com testes de integração de todos os cenários da spec `playlist`
- [x] 4.6 Medir a rota com 1.000 fotos no catálogo; verificar que a resposta memorizada sai em menos de 1 ms no p95, com o número anotado no `README.md`

## 5. Player web (`web-player`)

- [x] 5.1 Implementar `screen.ts` lendo a mesma `fixtures/screen-buckets.json` nos testes; verificar com `npm --prefix web test`
- [x] 5.2 Implementar `settings.ts` (padrões, validação, `localStorage` com `try/catch`) e `shuffle.ts`; verificar com testes de "Preferência lembrada", "Armazenamento bloqueado" e "Fim da volta"
- [x] 5.3 Implementar `tokens.css` com os valores de `themes/default/style.css` do DeckLock e o `--dl-u` do design D10; verificar no navegador que, em 1280×800, o relógio tem 96 px e, em 3840×2160, 259 px
- [x] 5.4 Implementar `api.ts` (faixa canônica, `If-None-Match`, última playlist guardada, atualização a cada 10 min, nova tentativa com espera crescente até 5 min); verificar com testes de "API fora do ar com playlist guardada" e "Primeira visita sem API"
- [x] 5.5 Implementar `stage.ts` (duas camadas, carga e decodificação antes da troca, crossfade de 600 ms, modos `auto`/`fill`/`fit`, pular outra orientação, reenquadrar na rotação); verificar com testes do cálculo de estilo do corte (sem deformação em 1280×1024 e 1920×970) e, no navegador, os cenários de "Modos de enquadramento" e "Foto com erro"
- [x] 5.6 Implementar `clock.ts` (24/12 h, fuso do aparelho, virada do minuto, data em pt-BR e inglês, virada à meia-noite); verificar com testes usando relógio falso do Vitest para "Relógio padrão" e "Data ligada em português"
- [x] 5.7 Implementar o painel de ajustes e `controls.ts` (esconder após 4 s, cursor, foco por setas, Voltar/Esc com os `keyCode` de TV); verificar no navegador, só pelo teclado, os cenários "Abrir ajustes pelo controle" e "Fechar com Voltar"
- [x] 5.8 Implementar `fullscreen.ts`, `wake.ts` e o manifesto de app web; verificar que o botão some quando a API de tela cheia não existe e que o manifesto passa no painel Application do DevTools
- [x] 5.9 Servir `web/dist` pelo binário com os cabeçalhos de cache do design D1; verificar com `curl -I` que os arquivos com hash têm `immutable` e `index.html` tem `no-cache`
- [x] 5.10 Conferir o tamanho do build; verificar que HTML + CSS + JS comprimidos com gzip somam menos de 50 KB

## 6. Implantação

- [x] 6.1 Escrever o `Dockerfile` multiestágio e o `docker-compose.yml` do design D12; verificar com `docker build` e `docker compose up` local respondendo `GET /api/playlist?w=1920&h=1080`
- [x] 6.2 Documentar no `README.md` as variáveis de ambiente, a implantação num servidor e as Cache Rules recomendadas para `cdn.yanlucas.com`; verificar que os comandos do README sobem o serviço do zero numa pasta limpa
- [x] 6.3 Com a confirmação do Yan, subir a stack no servidor, configurar o nginx e o DNS do subdomínio; verificar com `curl` em `/api/playlist?w=1920&h=1080` pelo endereço público

## 7. Conferência de ponta a ponta

- [x] 7.1 Registrar pelo menos 10 fotos reais, com e sem enquadramento, e abrir o player com Playwright em 1920×1080 e 390×844; verificar com screenshots que o corte, o relógio, a data e o modo `auto` estão corretos
- [ ] 7.2 Abrir o player na TV Samsung com Tizen e num celular reais; verificar a troca de fotos, o controle remoto (setas ou ponteiro), a tela cheia e o celular girado

## Workflow follow-up

- Arquivar a mudança com `/opsx:archive` depois que o Yan aprovar o teste em TV e celular.
