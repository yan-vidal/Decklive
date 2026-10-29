# Spec Delta

## ADDED Requirements

### Requirement: Local pronto para exibir
Cada item da playlist SHALL trazer `place`, o local da foto em uma linha: cidade, estado e país, nessa ordem, separados por vírgula, sem as partes vazias e sem repetir uma parte igual à anterior. Sem nenhuma parte, `place` MUST ser `null`. O item MUST NOT trazer coordenadas geográficas.

#### Scenario: Local completo
- **WHEN** a foto tem cidade "Jericoacoara", estado "Ceará" e país "Brazil"
- **THEN** `place` é "Jericoacoara, Ceará, Brazil"

#### Scenario: Cidade igual ao estado
- **WHEN** a foto tem cidade "São Paulo", estado "São Paulo" e país "Brazil"
- **THEN** `place` é "São Paulo, Brazil"

#### Scenario: Só o país
- **WHEN** a foto tem só o país "Japan"
- **THEN** `place` é "Japan"

### Requirement: Título separado da descrição
Cada item SHALL trazer `title`. Quando a descrição começa com um título seguido de dois-pontos e espaço, e esses dois-pontos aparecem nos primeiros 80 caracteres, `title` é o texto antes deles. Nos outros casos, inclusive sem descrição, `title` MUST ser `null`.

#### Scenario: Descrição com título
- **WHEN** a descrição é "Sunset Dune: This natural formation is part of the dynamic dune system along the northeastern coast of Brazil. Constantly shaped by the wind…"
- **THEN** `title` é "Sunset Dune"

#### Scenario: Descrição sem título
- **WHEN** a descrição é "Formiga Waterfall is a hidden gem located in the Jalapão region, near Mateiros, Tocantins. …"
- **THEN** `title` é `null`

### Requirement: Resumo curto da descrição
Cada item SHALL trazer `text`: a primeira frase do que sobra da descrição depois do título, com a primeira letra maiúscula. Uma frase termina em `.`, `!` ou `?`, com as aspas ou o parêntese que fecham logo depois, seguido de espaço ou do fim do texto. Se a frase passar de 240 caracteres, MUST ser cortada no último espaço antes do limite, com "…" no fim. Sem descrição, `text` é `null`.

#### Scenario: Primeira frase
- **WHEN** a descrição é "Sunset Dune: This natural formation is part of the dynamic dune system along the northeastern coast of Brazil. Constantly shaped by the wind…"
- **THEN** `text` é "This natural formation is part of the dynamic dune system along the northeastern coast of Brazil."

#### Scenario: Texto começando em minúscula
- **WHEN** a descrição é "Catavento Museum: housed in the historic Palace of Industries building, is dedicated to interactive science. …"
- **THEN** `text` começa com "Housed in the historic Palace"

#### Scenario: Frase longa demais
- **WHEN** a primeira frase tem 300 caracteres
- **THEN** `text` tem no máximo 241 caracteres, termina em "…" e não corta uma palavra no meio

#### Scenario: Foto sem descrição
- **WHEN** a foto não tem descrição
- **THEN** `title` e `text` são `null`
