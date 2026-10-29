# Spec Delta

## Purpose

Leva os ajustes de um navegador para outro (do computador para a TV, por exemplo) com um código curto de uso único, sem contas e sem guardar nada em disco.

## ADDED Requirements

### Requirement: Código de envio
`POST /api/pairing` SHALL receber um objeto JSON de até 64 KB e responder `201` com `{"code", "expires_in": 600}`. O código tem 6 caracteres de um alfabeto sem caracteres ambíguos (sem `0`, `O`, `1`, `I` ou `L`). O pacote fica só na memória e some depois de 10 minutos. A rota é pública e MUST NOT registrar o conteúdo nos logs.

#### Scenario: Envio
- **WHEN** um navegador envia seus ajustes para `POST /api/pairing`
- **THEN** a API responde `201` com um código de 6 caracteres e `expires_in` 600

#### Scenario: Pacote grande demais
- **WHEN** o corpo passa de 64 KB ou não é um objeto JSON
- **THEN** a API responde `413` ou `422`, e nada é guardado

### Requirement: Recebimento de uso único
`GET /api/pairing/{code}` SHALL devolver o pacote e apagá-lo na mesma operação, sem diferenciar maiúsculas no código. Um código inexistente, vencido ou já usado MUST dar `404`.

#### Scenario: Código válido
- **WHEN** a TV pede o código recebido há 2 minutos
- **THEN** a API responde `200` com o pacote, e um segundo pedido com o mesmo código dá `404`

#### Scenario: Código vencido
- **WHEN** a TV pede um código gerado há 11 minutos
- **THEN** a API responde `404`

### Requirement: Limites da memória
A API SHALL guardar no máximo 500 pacotes ao mesmo tempo. Com o limite cheio, `POST /api/pairing` MUST responder `503` até que pacotes vençam ou sejam usados.

#### Scenario: Limite cheio
- **WHEN** já existem 500 pacotes válidos guardados
- **THEN** um novo envio recebe `503`

### Requirement: Enviar e receber no player
O painel de ajustes SHALL ter "Enviar para outra tela", que envia todos os ajustes (preferências, posições e áreas) e mostra o código e o tempo restante. Também SHALL ter "Receber ajustes", com um campo para o código. Ao receber, o player MUST substituir todos os ajustes locais pelos recebidos, aplicá-los na hora e salvá-los.

#### Scenario: Do computador para a TV
- **WHEN** o usuário envia os ajustes no computador e digita o código na TV
- **THEN** a TV passa a mostrar as mesmas posições, áreas e preferências do computador

#### Scenario: Código errado
- **WHEN** o usuário digita um código inexistente na TV
- **THEN** o player mostra "Código inválido ou vencido" e mantém os ajustes atuais
