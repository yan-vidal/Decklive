# Spec Delta

## Purpose

Define quais fotos do acervo do yanlucas.com o DeckLive oferece para exibição e como cada uma deve ser enquadrada, sem copiar nem servir os arquivos das fotos.

## ADDED Requirements

### Requirement: Proteção das rotas de catálogo
As rotas `POST /api/media`, `DELETE /api/media` e `GET /api/media` SHALL exigir o cabeçalho `Authorization: Bearer <token>` com o token de administrador configurado no servidor. O serviço MUST se recusar a iniciar se o token não estiver configurado ou tiver menos de 32 caracteres.

#### Scenario: Requisição sem token
- **WHEN** um cliente chama `POST /api/media` sem o cabeçalho `Authorization`
- **THEN** a API responde `401` e nada é gravado

#### Scenario: Token errado
- **WHEN** um cliente chama `GET /api/media` com um token diferente do configurado
- **THEN** a API responde `401`

#### Scenario: Servidor sem token configurado
- **WHEN** o serviço é iniciado sem o token de administrador
- **THEN** o processo termina com uma mensagem de erro que diz qual variável falta

### Requirement: Registro de foto a partir do yanlucas.com
`POST /api/media` SHALL receber o `id` de uma foto da API do yanlucas.com, buscar os dados dela nessa API e gravá-la no catálogo. A API grava as URLs e dimensões dos arquivos (miniatura, otimizado e original), a descrição, a data da foto e a cor dominante. A resposta MUST trazer a foto como ficou gravada.

#### Scenario: Foto nova
- **WHEN** o administrador envia `{"id": "66d312a4124fa13304b01ea7"}` e essa foto existe no yanlucas.com
- **THEN** a API responde `201` com a foto gravada, incluindo os três arquivos com largura e altura

#### Scenario: Foto já registrada
- **WHEN** o administrador envia o `id` de uma foto que já está no catálogo
- **THEN** a API responde `200`, atualiza os dados vindos do yanlucas.com e substitui o enquadramento pelo que veio na requisição

#### Scenario: Foto inexistente na origem
- **WHEN** o `id` enviado não existe na API do yanlucas.com
- **THEN** a API responde `404` e nada é gravado

#### Scenario: Origem fora do ar
- **WHEN** a API do yanlucas.com não responde ou responde com erro
- **THEN** a API responde `502` e o catálogo fica como estava

### Requirement: Escolha da versão da foto
Quando a foto tem versões editadas na origem, o registro SHALL usar por padrão a primeira versão editada, como faz a galeria do yanlucas.com; sem versões editadas, usa a original. O campo opcional `version` MUST permitir escolher `"original"` ou o nome de uma versão (ex.: `"V1"`).

#### Scenario: Versão padrão
- **WHEN** a foto tem a versão editada `V1` e a requisição não traz `version`
- **THEN** os arquivos gravados são os da versão `V1`

#### Scenario: Original pedido
- **WHEN** a requisição traz `"version": "original"`
- **THEN** os arquivos gravados são os do original

#### Scenario: Versão desconhecida
- **WHEN** a requisição traz um `version` que a foto não tem
- **THEN** a API responde `422` listando as versões disponíveis

### Requirement: Enquadramento informado no registro
O registro SHALL aceitar, de forma opcional, um ponto de interesse `focus` (`x`, `y` entre 0 e 1) e regiões de interesse `crops.landscape` e `crops.portrait` (`x`, `y`, `w`, `h` entre 0 e 1, relativos à foto). Sem nada informado, o ponto de interesse padrão MUST ser o centro da foto (`0.5`, `0.5`).

#### Scenario: Registro sem enquadramento
- **WHEN** o administrador registra uma foto só com o `id`
- **THEN** a foto fica gravada com ponto de interesse no centro e sem regiões de interesse

#### Scenario: Registro com região para telas em pé
- **WHEN** o administrador envia `"crops": {"portrait": {"x": 0.3, "y": 0, "w": 0.4, "h": 1}}`
- **THEN** a foto fica gravada com essa região para telas em pé e sem região para telas deitadas

#### Scenario: Coordenadas inválidas
- **WHEN** uma região sai da foto (por exemplo, `x + w > 1`), tem largura ou altura zero, ou o ponto de interesse sai do intervalo de 0 a 1
- **THEN** a API responde `422` dizendo qual campo está errado e nada é gravado

### Requirement: Remoção em lote
`DELETE /api/media` SHALL receber `{"ids": [...]}` e tirar do catálogo as fotos listadas. A resposta MUST separar os ids removidos dos que não estavam no catálogo. As fotos removidas deixam de aparecer na playlist e continuam intactas no yanlucas.com e no R2.

#### Scenario: Remoção de fotos existentes e inexistentes
- **WHEN** o administrador envia dois ids do catálogo e um id desconhecido
- **THEN** a API responde `200` com os dois em `removed` e o desconhecido em `not_found`

#### Scenario: Lista vazia
- **WHEN** o administrador envia `{"ids": []}`
- **THEN** a API responde `422` e nada muda

### Requirement: Listagem do catálogo
`GET /api/media` SHALL devolver todas as fotos do catálogo, das mais recentes no catálogo para as mais antigas, com os dados gravados de cada uma (arquivos, enquadramento, descrição, data e cor) e o total.

#### Scenario: Catálogo com fotos
- **WHEN** o administrador chama `GET /api/media` com três fotos registradas
- **THEN** a API responde `200` com as três fotos e `total` igual a 3

#### Scenario: Catálogo vazio
- **WHEN** o administrador chama `GET /api/media` sem nenhuma foto registrada
- **THEN** a API responde `200` com a lista vazia e `total` igual a 0
