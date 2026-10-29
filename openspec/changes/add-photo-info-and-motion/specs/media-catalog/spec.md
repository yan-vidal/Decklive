# Spec Delta

## ADDED Requirements

### Requirement: Local da foto gravado no registro
O registro SHALL gravar a cidade, o estado e o país da foto como vêm da API do yanlucas.com, e a listagem `GET /api/media` MUST devolvê-los em `city`, `state` e `country` (nulos quando a origem não os tem). Um novo registro da mesma foto atualiza esses campos. As coordenadas geográficas que a origem tiver MUST NOT ser gravadas.

#### Scenario: Foto com local na origem
- **WHEN** o administrador registra uma foto que na origem tem `city` "Jericoacoara", `state` "Ceará" e `country` "Brazil"
- **THEN** a resposta e a listagem trazem esses três valores

#### Scenario: Foto sem local na origem
- **WHEN** a foto não tem cidade nem estado na origem
- **THEN** a foto é registrada normalmente, com `city` e `state` nulos

#### Scenario: Foto com coordenadas na origem
- **WHEN** a foto tem `latitude` e `longitude` nos metadados da origem
- **THEN** nem a resposta do registro nem a listagem trazem as coordenadas
