# Spec Delta

## ADDED Requirements

### Requirement: Playlist no idioma do navegador
O player SHALL pedir a playlist com `lang` igual ao primeiro idioma preferido do navegador (`navigator.languages[0]` ou, sem ele, `navigator.language`), sem `lang` quando o navegador não informa nenhum. A playlist guardada para uso sem rede MUST ser a do idioma pedido.

#### Scenario: Navegador em português
- **WHEN** o player abre num navegador em `pt-BR` e existe tradução em `pt-BR`
- **THEN** o local, o título e o resumo aparecem em português

#### Scenario: Navegador em idioma sem tradução
- **WHEN** o player abre num navegador em `fr`
- **THEN** os textos aparecem em inglês, depois do redirecionamento para a URL sem `lang`
