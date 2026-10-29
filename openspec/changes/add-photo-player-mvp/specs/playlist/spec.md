# Spec Delta

## Purpose

Entrega a qualquer tela a lista de fotos liberadas, já com o arquivo certo e o corte certo para ela, numa resposta pequena e cacheável, para que o custo não cresça com o número de telas.

## ADDED Requirements

### Requirement: Rota pública da playlist
`GET /api/playlist?w=<largura>&h=<altura>` SHALL ser pública, sem token, e responder com todas as fotos do catálogo. `w` e `h` são o tamanho da área de exibição em pixels físicos (tamanho CSS da janela × densidade de pixels). A API MUST aceitar CORS de qualquer origem nessa rota.

#### Scenario: Pedido de uma tela
- **WHEN** um cliente sem token chama `GET /api/playlist?w=1920&h=1080`
- **THEN** a API responde `200` com um item para cada foto do catálogo

#### Scenario: Catálogo vazio
- **WHEN** o catálogo não tem fotos
- **THEN** a API responde `200` com `items` vazio

#### Scenario: Parâmetros ausentes ou inválidos
- **WHEN** falta `w` ou `h`, ou um deles não é um inteiro entre 1 e 16384
- **THEN** a API responde `400`

### Requirement: Faixas de tela canônicas
A API SHALL tratar cada tela pela sua faixa canônica, para que poucas URLs diferentes existam e o cache funcione. A faixa usa a proporção mais próxima da lista fixa (1:1, 4:3, 16:10, 16:9, 19,5:9, 21:9) e o menor lado longo da lista (1280, 1920, 2560, 3840) que cubra a tela; acima de 3840 usa 3840. Se `w`/`h` não forem canônicos, a API MUST redirecionar com `308` para a URL canônica.

#### Scenario: Tela já canônica
- **WHEN** o cliente pede `w=1920&h=1080`
- **THEN** a API responde `200` direto

#### Scenario: Celular em pé com tamanho real
- **WHEN** o cliente pede `w=1170&h=2532` (celular em pé, proporção perto de 19,5:9)
- **THEN** a API responde `308` para `/api/playlist?w=1182&h=2560`

#### Scenario: Tela maior que 4K
- **WHEN** o cliente pede `w=5120&h=2880`
- **THEN** a API redireciona para `w=3840&h=2160`

### Requirement: Item da playlist
Cada item SHALL trazer `id`, `src` (URL do arquivo em cdn.yanlucas.com), `width` e `height` do arquivo escolhido, `crop` (`x`, `y`, `w`, `h` relativos à foto, entre 0 e 1), `color` (cor dominante em `#rrggbb`) e `orientation` (`landscape`, `portrait` ou `square`). A foto é `square` quando lado longo / lado curto < 1,155 (a classe 1:1 das faixas). A API MUST NOT servir os bytes das fotos.

#### Scenario: Formato do item
- **WHEN** a playlist é pedida para uma tela 16:9
- **THEN** cada item traz todos os campos acima, e `src` aponta para `https://cdn.yanlucas.com/...`

### Requirement: Arquivo mais leve que fica nítido
Para cada foto, a API SHALL escolher o menor arquivo (miniatura, otimizado ou original) em que a área do corte tenha pelo menos 90% dos pixels da tela, na largura e na altura. Se nenhum alcançar, MUST escolher o maior.

#### Scenario: Otimizado basta
- **WHEN** a foto tem otimizado de 2000×1333 e original de 6000×4000, e é pedida para `w=1920&h=1080`
- **THEN** `src` é o arquivo otimizado, porque o corte 16:9 dele (2000×1125) passa de 90% da tela

#### Scenario: TV Full HD
- **WHEN** a foto tem otimizado de 981×613 e original de 2944×1839, e é pedida para `w=1920&h=1080`
- **THEN** `src` é o arquivo original, porque o corte 16:9 do otimizado (981×552) não chega a 90% da tela

### Requirement: Corte calculado para a proporção da tela
O `crop` SHALL ter a mesma proporção, em pixels, da tela canônica e ficar inteiro dentro da foto. Ele usa a região de interesse da orientação da tela quando existe (o menor corte que a contém, centrado nela). Sem essa região, usa o ponto de interesse (o maior corte possível, centrado nele o quanto der). Numa tela quadrada, vale a região de `landscape`.

#### Scenario: Sem enquadramento informado
- **WHEN** uma foto 3:2 sem região nem ponto de interesse é pedida para uma tela 16:9
- **THEN** o corte é o maior retângulo 16:9 dentro da foto, centralizado

#### Scenario: Ponto de interesse perto da borda
- **WHEN** a foto tem ponto de interesse `x=0.95` e é pedida para uma tela em pé
- **THEN** o corte encosta na borda direita da foto, sem sair dela

#### Scenario: Região de interesse para tela em pé
- **WHEN** a foto tem `crops.portrait` e é pedida para uma tela em pé
- **THEN** o corte contém a região inteira e fica centrado nela, ajustado para dentro da foto

#### Scenario: Região maior do que cabe
- **WHEN** a região de interesse é mais larga do que o maior corte possível na proporção da tela
- **THEN** o corte é o maior possível, centrado no centro da região

#### Scenario: Tela quadrada
- **WHEN** a foto tem `crops.landscape` e `crops.portrait` e é pedida para `w=1920&h=1920`
- **THEN** o corte usa a região de `landscape`

#### Scenario: Só existe a região da outra orientação
- **WHEN** a foto tem apenas `crops.landscape` e é pedida para uma tela em pé
- **THEN** o centro dessa região é usado como ponto de interesse

### Requirement: Ordem estável
A playlist SHALL listar os itens sempre na mesma ordem (a ordem de registro no catálogo). Embaralhar é responsabilidade de quem exibe.

#### Scenario: Pedidos repetidos
- **WHEN** a mesma URL é pedida duas vezes sem mudança no catálogo
- **THEN** as duas respostas têm o mesmo corpo

### Requirement: Cache e versão
A resposta SHALL trazer `ETag` derivado da versão do catálogo, da faixa e da instância do servidor em execução, e `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`. Qualquer registro ou remoção MUST mudar a versão. Com `If-None-Match` igual ao `ETag` atual, a API responde `304` sem corpo.

#### Scenario: Cliente com a versão atual
- **WHEN** o cliente repete o pedido com `If-None-Match` igual ao `ETag` recebido e o catálogo não mudou
- **THEN** a API responde `304` sem corpo

#### Scenario: Catálogo mudou
- **WHEN** uma foto é registrada ou removida depois do primeiro pedido
- **THEN** o próximo pedido recebe `200` com um `ETag` diferente
