# O que ficou do Zuppty

## Estados explícitos

O projeto original distingue entrega, retirada e etapas do entregador.
Aqui mantive apenas as etapas necessárias para discutir uma máquina de estados
e a separação de responsabilidades. O mapa em `domain.ts` diz quais mudanças
existem; a operação em `orders.ts` verifica quem pode fazê-las, pagamento e versão.

Uma retirada não deve passar por “saiu para entrega”. Um pedido entregue não
volta para a cozinha. O navegador mostra opções, mas quem decide é o servidor.

## O clique duplicado não é o único problema

Desabilitar um botão não impede retry de rede, outra aba ou outra instância.
Cada criação e pagamento recebe uma `Idempotency-Key`.

1. A entrada é validada e normalizada.
2. A transação reserva a escrita no banco.
3. Se a chave já existe, o hash da entrada é comparado e a resposta anterior é devolvida.
4. Se não existe, a operação, o evento e a resposta são gravados juntos.

O hash usa um objeto normalizado com ordem fixa dos campos. No carrinho os itens
são ordenados por produto. Campos extras que não fazem parte da operação não
mudam sua identidade. Se o catálogo passasse a variar, seria necessário definir
uma política para versões de preço e retries antes de mudar esse contrato.

As chaves pertencem a `(ator, operação, chave)`. O cliente não pode usar um
identificador para recuperar a resposta de outra pessoa. O pagamento também
tem uma restrição única por pedido: trocar a chave não permite cobrar duas vezes.

## Concorrência

SQLite em WAL permite leitores enquanto há uma escrita. `BEGIN IMMEDIATE`
serializa os escritores antes de consultar o estado. Não há `await` dentro da
transação. `busy_timeout` limita a espera de outra conexão a cinco segundos.

Há um teste com quatro workers, cada um com sua conexão SQLite, liberados juntos.
Com a mesma chave todos recebem a mesma transação; com chaves diferentes apenas
um pagamento é aceito. É prova de consistência nesse cenário, não um benchmark.

Para mudanças de etapa, uso uma versão. O segundo operador recebe um conflito
em vez de sobrescrever a decisão do primeiro. A checagem e a gravação ficam
na mesma transação. Em PostgreSQL eu avaliaria uma atualização condicional
`UPDATE ... WHERE version = ?` ou bloqueio de linha, conforme a operação.

## Limite do pagamento simulado

O “pagamento” desta demo não faz rede. O banco pode confirmar tudo atomicamente.
Isso não é verdade ao chamar um gateway externo. Nesse caso eu separaria:

- criação da tentativa com identificador estável;
- envio ao gateway com a chave do provedor;
- confirmação por webhook autenticado e deduplicado;
- estado pendente quando não se conhece o resultado;
- reconciliação para consultas e notificações perdidas.

Uma resposta de timeout não pode ser tratada automaticamente como recusa.
Também não acrescentaria `CANCELLED` a um pedido pago sem tratar o estorno.
Por isso a demo recusa essa operação com `REFUND_REQUIRED`.

## Persistência pequena, sem abstração extra

O documento do pedido é JSON em uma tabela, enquanto identidade do cliente,
unicidade de pagamento, chaves de requisição e eventos têm colunas próprias.
Isso economiza modelagem neste recorte. Para relatórios, catálogo mutável,
estoque ou consultas analíticas, normalizar itens e valores seria uma evolução
necessária. Não apresento esse esquema como modelo definitivo do Zuppty.

## Segurança do recorte

Tokens aleatórios de sessão apontam para perfis definidos pelo servidor.
Os endpoints protegidos não aceitam um cabeçalho com o papel escolhido pelo
cliente. A interface permite criar sessões desses perfis de propósito.
É uma ferramenta de avaliação local, não autenticação de produção.

O servidor aceita apenas Host local, recusa Origin divergente, limita o corpo
JSON, usa parâmetros nas consultas SQL e devolve 404 para pedido alheio.
A interface insere dados com `textContent`, sem interpolar HTML.

Para expor publicamente, seria preciso substituir o seletor de sessões por
autenticação real, definir isolamento por loja, política de retenção e limites
de uso, além de HTTPS e integração de pagamento apropriada.
