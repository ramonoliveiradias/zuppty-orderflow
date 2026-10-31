# Zuppty OrderFlow

Uma demonstração de pedidos e pagamentos baseada em um recorte do Zuppty GO.
O objetivo é mostrar o comportamento quando uma requisição é repetida, quando
dois operadores tentam alterar o mesmo pedido e quando um cliente tenta acessar
o pedido de outro.

Os produtos e as contas são fictícios. O pagamento é uma gravação local, sem
conexão com banco, gateway ou infraestrutura do Zuppty.

## Executar

Use Node.js 24.15 ou superior dentro da versão 24. O Node executa o TypeScript
diretamente e fornece o SQLite usado pelo projeto.

```sh
npm start
```

Abra **http://127.0.0.1:4317**. Não é preciso instalar dependências para executar.
O banco é criado em `data/orderflow.sqlite` e os pedidos permanecem após reiniciar.

Para verificar os tipos e executar os testes:

```sh
npm ci
npm run check
```

Alternativa com Docker:

```sh
docker compose up --build
```

O Compose publica a porta somente em `127.0.0.1` e mantém o banco em um volume.
O Dockerfile está incluído, mas não foi executado na preparação inicial porque
o ambiente não tinha Docker. A configuração de CI inclui o build da imagem;
a execução remota do workflow depende de publicar o repositório.

## Experimente em cinco minutos

1. Entre como **Ana**, crie um pedido e simule o pagamento PIX.
2. Clique em **Repetir a mesma requisição**. A transação é a mesma e o histórico
   continua com apenas uma aprovação de pagamento.
3. Troque para **Operação da loja**, selecione o pedido e avance as etapas.
4. Troque para **Bruno**. O pedido de Ana não aparece. A API também impede o acesso direto.
5. Faça outro pedido com **Retirada**. Depois de ficar pronto, ele pode ser
   entregue sem passar pela etapa de transporte.

O seletor de contas é proposital: facilita a avaliação das permissões. Não é um
sistema de login para produção. Não publique esta versão em uma URL aberta;
qualquer avaliador local pode assumir os perfis da demonstração.

## Regras que importam

- O servidor calcula o total usando o catálogo. Preço e total enviados pelo
  navegador não determinam o valor do pedido.
- Quantidade é inteira, de 1 a 20 por produto. Valores monetários são centavos inteiros.
- A confirmação depende de pagamento aprovado.
- Entrega: `PENDING → CONFIRMED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED`.
- Retirada: `PENDING → CONFIRMED → PREPARING → READY → DELIVERED`.
- Somente a operação e o administrador alteram etapas. Clientes só consultam
  e pagam seus próprios pedidos; o administrador também pode simular pagamentos.
- Pedido cancelado não recebe pagamento. Pedido pago não é cancelado nesta demo:
  seria necessário um fluxo de estorno, que não está implementado.
- Uma chave repetida com o mesmo conteúdo retorna a resposta original.
  Reutilizar a chave com outro conteúdo retorna `409`.
- Mesmo com uma chave nova, um pedido não recebe um segundo pagamento.
- Alterações de etapa exigem a versão lida pelo cliente. Se ela mudou, a API
  devolve `409 STALE_VERSION` e pede uma nova leitura.

## Organização

```text
src/domain.ts       catálogo, entradas e transições permitidas
src/orders.ts       pedidos, pagamentos, transações e histórico
src/server.ts       HTTP, sessão de demonstração e respostas de erro
src/main.ts         processo, porta e caminho do banco
public/             interface sem build
tests/              regras, HTTP, persistência e concorrência
docs/               contrato da API e decisões do recorte
```

Não há uma camada de repository genérica: só existe um armazenamento e o recorte
é pequeno. As regras de entrada e estados ficam separadas do HTTP. A classe
`Orders` concentra as operações que precisam da mesma transação.

## Por que não copiar o sistema inteiro?

O Zuppty tem clientes, lojas, entregadores, integrações de pagamento e outros
fluxos. Isso tornaria a avaliação dependente de credenciais e serviços externos.
Este recorte mantém as decisões que podem ser demonstradas localmente.

As referências foram as regras de estado em
`packages/business/src/order-status.ts` e o tratamento de valores e repetição
em `apps/backend-express/src/lib/counter-payments.ts`, no projeto Zuppty GO.
Aqui o fluxo foi reduzido: não há estados intermediários do entregador, dinheiro
com troco, pagamento dividido, estorno ou regras de várias lojas.

O código desta demonstração é uma implementação separada. Não usa contas,
segredos, bancos nem dados de clientes do sistema original.

## Decisões e limites

- **SQLite** permite iniciar sem banco externo e testar concorrência entre
  conexões reais. Só um escritor pode gravar por vez; isso não é uma prova de
  desempenho para alto volume.
- **`BEGIN IMMEDIATE`** reserva a escrita antes da leitura do estado. Pagamento,
  histórico e resposta idempotente são confirmados na mesma transação.
- **`UNIQUE(order_id)`** no pagamento reforça no banco a regra de uma cobrança
  por pedido. O backend também verifica o estado e o valor.
- **TypeScript sem framework HTTP** mantém o recorte pequeno e executável sem
  dependências de runtime. Não pretende substituir Express no Zuppty original.
- **HTML/CSS/JavaScript** é suficiente para esta interface. O foco da prova é
  backend; ela não demonstra arquitetura React.
- **Sem gateway real.** Em uma integração externa, uma transação SQL não abrange
  o gateway. Seriam necessários estados intermediários, webhooks autenticados,
  idempotência no provedor e reconciliação. Veja `docs/decisoes.md`.
- As sessões duram uma hora e ficam na memória. Reiniciar o processo exige
  selecionar a conta novamente; pedidos e chaves continuam no banco.
- A listagem mostra os últimos 100 pedidos. Não há paginação, tarefas de
  limpeza, frete, estoque, múltiplas lojas ou atualização automática por socket.

## Leitura para a entrevista

- [Contrato HTTP e exemplos](docs/api.md)
- [Decisões técnicas e alternativas](docs/decisoes.md)
- [Roteiro de apresentação em espanhol](docs/apresentacao-es.md)

Ramon Oliveira · Demonstração técnica baseada no Zuppty GO.
