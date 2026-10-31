import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orders } from '../src/orders.ts';
import { AppError } from '../src/domain.ts';
import type { Actor } from '../src/domain.ts';

const ana: Actor = { id: 'ana', role: 'CUSTOMER' };
const bruno: Actor = { id: 'bruno', role: 'CUSTOMER' };
const loja: Actor = { id: 'loja', role: 'STORE' };
const input = { fulfillment: 'DELIVERY', items: [{ productId: 'burger', quantity: 1 }] };
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;
function fixture(t: TestContext) {
  const orders = new Orders(); t.after(() => orders.close()); return orders;
}

test('repetição do pedido retorna o mesmo resultado; conteúdo diferente conflita', t => {
  const orders = fixture(t);
  const first = orders.create(ana, input, 'order-001');
  const again = orders.create(ana, { items: input.items, fulfillment: 'DELIVERY' }, 'order-001');
  assert.equal(again.replayed, true); assert.deepEqual(again.data, first.data);
  assert.equal(orders.list(ana).length, 1);
  assert.throws(() => orders.create(ana, { ...input, fulfillment: 'PICKUP' }, 'order-001'), code('IDEMPOTENCY_CONFLICT'));
});
test('cliente não consulta pedido alheio nem altera o estado', t => {
  const orders = fixture(t); const order = orders.create(ana, input, 'order-001').data;
  assert.equal(orders.list(bruno).length, 0);
  assert.throws(() => orders.get(bruno, order.id), code('NOT_FOUND'));
  assert.throws(() => orders.transition(ana, order.id, { status: 'CANCELLED', version: 1 }), code('FORBIDDEN'));
  assert.throws(() => orders.pay(bruno, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001'), code('NOT_FOUND'));
});
test('pagamento exige valor exato e não duplica com chave nova', t => {
  const orders = fixture(t); const order = orders.create(ana, input, 'order-001').data;
  assert.throws(() => orders.pay(ana, order.id, { method: 'PIX', amountCents: 1 }, 'payment-001'), code('AMOUNT_MISMATCH'));
  assert.equal(orders.get(ana, order.id).paid, false);
  const first = orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001');
  const again = orders.pay(ana, order.id, { amountCents: 2400, method: 'PIX' }, 'payment-001');
  assert.deepEqual(first.data, again.data); assert.equal(again.replayed, true);
  assert.throws(() => orders.pay(ana, order.id, { method: 'CARD', amountCents: 2400 }, 'payment-001'), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-002'), code('NOT_PAYABLE'));
  assert.equal(orders.get(ana, order.id).events.filter(e => e.kind === 'PAYMENT_APPROVED').length, 1);
});
test('não confirma sem pagamento e recusa versão desatualizada', t => {
  const orders = fixture(t); const order = orders.create(ana, input, 'order-001').data;
  assert.throws(() => orders.transition(loja, order.id, { status: 'CONFIRMED', version: 1 }), code('PAYMENT_REQUIRED'));
  orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001');
  assert.throws(() => orders.transition(loja, order.id, { status: 'CONFIRMED', version: 1 }), code('STALE_VERSION'));
  assert.equal(orders.transition(loja, order.id, { status: 'CONFIRMED', version: 2 }).version, 3);
});
test('cancelamento não aceita pagamento posterior nem finge estorno', t => {
  const orders = fixture(t); const order = orders.create(ana, input, 'order-001').data;
  orders.transition(loja, order.id, { status: 'CANCELLED', version: 1 });
  assert.throws(() => orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001'), code('NOT_PAYABLE'));
  const paid = orders.create(ana, input, 'order-002').data;
  orders.pay(ana, paid.id, { method: 'PIX', amountCents: 2400 }, 'payment-002');
  assert.throws(() => orders.transition(loja, paid.id, { status: 'CANCELLED', version: 2 }), code('REFUND_REQUIRED'));
});
test('retirada completa o ciclo sem etapa de entrega', t => {
  const orders = fixture(t); let order = orders.create(ana, { ...input, fulfillment: 'PICKUP' }, 'order-001').data;
  orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001');
  for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'DELIVERED']) {
    const current = orders.get(loja, order.id);
    order = orders.transition(loja, order.id, { status, version: current.version });
  }
  assert.equal(order.status, 'DELIVERED');
  assert.throws(() => orders.transition(loja, order.id, { status: 'PREPARING', version: order.version }), code('INVALID_TRANSITION'));
});
test('idempotência e pagamento sobrevivem à reabertura do banco', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orderflow-')); const path = join(dir, 'db.sqlite');
  let orders = new Orders(path);
  try {
    const order = orders.create(ana, input, 'order-001').data;
    const payment = orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001').data;
    orders.close(); orders = new Orders(path);
    const retry = orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001');
    assert.equal(retry.replayed, true); assert.equal(retry.data.id, payment.id);
    assert.equal(orders.get(ana, order.id).paid, true);
  } finally { orders.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('falha ao gravar resposta idempotente desfaz pagamento e histórico', t => {
  const orders = fixture(t); const order = orders.create(ana, input, 'order-001').data;
  orders.db.exec(`CREATE TRIGGER fail_response BEFORE INSERT ON requests
    WHEN NEW.operation LIKE 'pay:%' BEGIN SELECT RAISE(ABORT, 'falha de gravação simulada'); END;`);
  assert.throws(() => orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001'));
  const after = orders.get(ana, order.id);
  assert.equal(after.paid, false); assert.equal(after.payment, null);
  assert.equal(after.version, 1); assert.equal(after.events.length, 1);
  orders.db.exec('DROP TRIGGER fail_response');
  assert.equal(orders.pay(ana, order.id, { method: 'PIX', amountCents: 2400 }, 'payment-001').replayed, false);
});
