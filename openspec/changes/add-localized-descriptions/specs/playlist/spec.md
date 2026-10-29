# Spec Delta

## ADDED Requirements

### Requirement: Idioma da playlist
`GET /api/playlist` SHALL aceitar `lang`, uma etiqueta de idioma. `place`, `title` e `text` vêm desse idioma, e cada parte sem tradução (cada parte do local, a descrição) MUST cair no texto em inglês da origem. O título e o resumo saem da descrição traduzida pelas mesmas regras de antes. Etiqueta com formato inválido → `400`.

#### Scenario: Tradução existente
- **WHEN** a descrição "Sunset Dune: This natural formation…" tem tradução "Duna do Pôr do Sol: Esta formação natural…" em `pt-BR` e a playlist é pedida com `lang=pt-BR`
- **THEN** o item traz `title` "Duna do Pôr do Sol" e `text` começando em "Esta formação natural"

#### Scenario: Tradução parcial
- **WHEN** `Japan` tem tradução "Japão" em `pt-BR` e `Osaka` não tem
- **THEN** `place` é "Osaka, Japão"

### Requirement: Idioma canônico
A API SHALL tratar cada pedido pelo idioma disponível mais próximo, entre os que têm ao menos uma tradução. Vale a etiqueta igual, sem diferenciar maiúsculas; senão, a mesma língua com outra região; senão, inglês. Quando `lang` não é a forma canônica, a API MUST redirecionar com `308` para ela. O inglês é a URL sem `lang`.

#### Scenario: Mesma língua, outra região
- **WHEN** só existe `pt-BR` e o cliente pede `lang=pt-PT`
- **THEN** a API responde `308` para a mesma URL com `lang=pt-BR`

#### Scenario: Idioma sem tradução
- **WHEN** o cliente pede `lang=fr` e não existe tradução em francês
- **THEN** a API responde `308` para a URL sem `lang`

#### Scenario: Inglês pedido
- **WHEN** o cliente pede `lang=en`
- **THEN** a API responde `308` para a URL sem `lang`

### Requirement: Cache por idioma
O `ETag` SHALL incluir o idioma canônico, além da versão do catálogo, da faixa e da instância. Gravar ou remover traduções MUST mudar a versão do catálogo.

#### Scenario: Tradução nova
- **WHEN** o administrador grava uma tradução depois de um pedido em `pt-BR`
- **THEN** o próximo pedido em `pt-BR` recebe `200` com um `ETag` diferente
