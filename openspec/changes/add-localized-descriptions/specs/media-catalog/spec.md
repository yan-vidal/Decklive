# Spec Delta

## ADDED Requirements

### Requirement: Dicionário de traduções
A API SHALL guardar traduções por idioma e por texto da origem. Valem a descrição, a cidade, o estado e o país, comparados como vêm da origem, sem espaços nas pontas. Uma tradução vale para toda foto do catálogo com o mesmo texto, inclusive as registradas depois. Se o texto mudar na origem, a foto MUST voltar ao inglês até ganhar uma tradução nova.

#### Scenario: Texto repetido em várias fotos
- **WHEN** três fotos têm a mesma descrição e o administrador grava a tradução dela em `pt-BR`
- **THEN** as três aparecem traduzidas na playlist em `pt-BR`

#### Scenario: Foto registrada depois da tradução
- **WHEN** o administrador registra uma foto nova cuja descrição já tem tradução em `pt-BR`
- **THEN** a foto já aparece traduzida, sem outra gravação

#### Scenario: Texto alterado na origem
- **WHEN** a descrição de uma foto muda na origem e a foto é registrada de novo
- **THEN** a foto aparece com a descrição nova em inglês até a tradução dela ser gravada

### Requirement: Gravação de traduções
`PUT /api/translations/{lang}` SHALL receber `{"items": [{"source": "...", "text": "..."}]}` e gravar ou substituir as traduções, respondendo com quantas foram gravadas. O idioma é uma etiqueta como `pt-BR` ou `es`, normalizada (`pt-br` vira `pt-BR`). A rota MUST exigir o token e responder `422` para etiqueta inválida, para `en` (o idioma da origem), para lista vazia ou para `source` ou `text` vazios, sem gravar nada.

#### Scenario: Gravação em lote
- **WHEN** o administrador envia duas traduções para `PUT /api/translations/pt-br`
- **THEN** a API responde `200` com `{"lang": "pt-BR", "saved": 2}`

#### Scenario: Idioma da origem
- **WHEN** o administrador envia traduções para `PUT /api/translations/en`
- **THEN** a API responde `422` e nada é gravado

### Requirement: Consulta e remoção de traduções
`GET /api/translations/{lang}` SHALL listar as traduções do idioma. Com `?missing=true`, MUST listar os textos do catálogo (descrições e partes do local) que ainda não têm tradução nesse idioma, cada um com quantas fotos o usam. `DELETE /api/translations/{lang}` recebe `{"sources": [...]}` e responde com os removidos e os que não existiam. As três rotas exigem o token.

#### Scenario: Textos que faltam traduzir
- **WHEN** o catálogo tem fotos de "Osaka, Japan" sem tradução e o administrador chama `GET /api/translations/pt-BR?missing=true`
- **THEN** a resposta inclui `Osaka` e `Japan` com o número de fotos de cada um

#### Scenario: Remoção
- **WHEN** o administrador remove a tradução de `Japan` em `pt-BR`
- **THEN** a playlist em `pt-BR` volta a mostrar `Japan`
