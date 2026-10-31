# Contrato HTTP

Base local: `http://127.0.0.1:4317`. Corpo JSON, máximo de 16 KB.
Não há CORS. Requisições com `Origin` de outra página são recusadas.

## Sessão de demonstração

`GET /api/demo/accounts` lista as contas fictícias.

```sh
curl -s http://127.0.0.1:4317/api/demo/session \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"ana"}'
```

Resposta `201`: `{ "token": "...", "actor": { "id": "ana", "role": "CUSTOMER", "name": "Ana · cliente" }, "expiresIn": 3600 }`.
Use `Authorization: Bearer <token>` nas rotas de pedidos.
Contas: `ana`, `bruno`, `loja`, `admin`. Abrir sessão é público por ser uma demo;
esta rota não deve existir em uma aplicação real. Limite de 60 sessões/minuto por IP.

## Rotas

| Método e rota | Entrada | Resultado |
| --- | --- | --- |
| `GET /api/health` | Sem sessão | `200`, estado do processo e acesso ao banco |
| `GET /api/catalog` | Sem sessão | `200`, produtos e `priceCents` |
| `GET /api/orders` | Bearer | `200`, até 100 pedidos visíveis ao perfil |
| `POST /api/orders` | Bearer cliente, `Idempotency-Key`, carrinho | `201` novo / `200` replay |
| `GET /api/orders/:id` | Bearer | `200`, pedido, pagamento, eventos e próximos estados |
| `POST /api/orders/:id/payments` | Bearer cliente dono ou admin, `Idempotency-Key`, valor e método | `201` novo / `200` replay |
| `PATCH /api/orders/:id/status` | Bearer loja ou admin, estado e versão | `200`, pedido atualizado |

### Criar pedido

```json
{
  "fulfillment": "DELIVERY",
  "items": [{ "productId": "burger", "quantity": 2 }]
}
```

`fulfillment`: `DELIVERY` ou `PICKUP`. De 1 a 10 itens, sem produto repetido;
quantidades inteiras de 1 a 20. A chave deve ter de 8 a 100 caracteres:
letras ASCII, números, `_`, `.`, `:`, `-`.

Resposta: `{ "data": Order, "replayed": false }`.
`Order`: `id`, `customerId`, `fulfillment`, `status`, `items`, `totalCents`,
`paid`, `version`, `createdAt`. Cada item tem `productId`, `name`, `quantity`
e `unitPriceCents`. Identificadores são UUIDs; datas são ISO 8601 UTC.

### Pagamento simulado

```json
{ "method": "PIX", "amountCents": 4800 }
```

Métodos: `PIX` ou `CARD`, ambos simulados e aprovados imediatamente quando
as validações passam. O valor deve ser inteiro, positivo e igual ao total.

Resposta: `{ "data": { "id": "...", "orderId": "...", "amountCents": 4800,
"method": "PIX", "createdAt": "..." }, "replayed": false }`.

O replay retorna a resposta original, mesmo que o pedido já tenha avançado.
Para o estado atual, consulte `GET /api/orders/:id`.
As chaves são isoladas por ator e operação; não expiram nesta demonstração.

### Mudança de estado

```json
{ "status": "CONFIRMED", "version": 2 }
```

Cada pagamento ou transição incrementa a versão. Ler a versão 2 e enviar
uma alteração depois que outro operador gravou a versão 3 retorna `409`.
A interface deve reler o pedido antes de pedir outra alteração ao usuário.

### Erros

```json
{
  "error": {
    "code": "STALE_VERSION",
    "message": "O pedido mudou. Atualize antes de tentar novamente.",
    "requestId": "..."
  }
}
```

| HTTP | Exemplos de código |
| --- | --- |
| 400 | `INVALID_JSON`, `INVALID_INPUT`, `INVALID_ITEMS`, `UNKNOWN_PRODUCT`, `DUPLICATE_PRODUCT`, `INVALID_QUANTITY`, `INVALID_KEY`, `INVALID_VERSION`, `INVALID_METHOD`, `INVALID_AMOUNT`, `INVALID_ACCOUNT`, `INVALID_FULFILLMENT` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `ORIGIN_DENIED`, `HOST_DENIED` |
| 404 | `NOT_FOUND` (inclui pedido de outro cliente) |
| 409 | `STALE_VERSION`, `IDEMPOTENCY_CONFLICT`, `NOT_PAYABLE`, `PAYMENT_REQUIRED`, `INVALID_TRANSITION`, `REFUND_REQUIRED` |
| 413 / 415 | `BODY_TOO_LARGE` / `JSON_REQUIRED` |
| 422 | `AMOUNT_MISMATCH` |
| 429 / 503 | `RATE_LIMIT` / `SESSION_LIMIT` |
| 500 | `INTERNAL_ERROR` (detalhes internos não são enviados ao navegador) |

Todas as respostas incluem `X-Request-Id`. Não existe endpoint de exclusão
de pedidos ou de alteração do catálogo nesta versão.
