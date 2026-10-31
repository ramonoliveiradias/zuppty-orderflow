import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Orders } from '../src/orders.ts';
import { createApp } from '../src/server.ts';

async function setup(t: TestContext) {
  const orders = new Orders(); const server = createApp(orders); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); orders.close(); });
  async function request(path: string, method = 'GET', token = '', data?: unknown, key?: string) {
    return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  }
  async function session(accountId: string) {
    const r = await request('/api/demo/session', 'POST', '', { accountId }); assert.equal(r.status, 201);
    return (await r.json()).token as string;
  }
  return { request, session, base };
}
const cart = { fulfillment: 'DELIVERY', items: [{ productId: 'burger', quantity: 1 }], totalCents: 1 };

test('API: compra, pagamento simultâneo e atualização concorrente de estado', async t => {
  const { request, session } = await setup(t); const ana = await session('ana'); const loja = await session('loja');
  const response = await request('/api/orders', 'POST', ana, cart, 'create-001');
  assert.equal(response.status, 201); const order = (await response.json()).data; assert.equal(order.totalCents, 2400);
  const payments = await Promise.all(Array.from({ length: 8 }, () => request(`/api/orders/${order.id}/payments`, 'POST', ana, { method: 'PIX', amountCents: 2400 }, 'payment-001')));
  assert.equal(payments.filter(r => r.status === 201).length, 1);
  const results = await Promise.all(payments.map(r => r.json()));
  assert.equal(new Set(results.map(r => r.data.id)).size, 1);
  assert.equal(results.filter(r => r.replayed).length, 7);
  const transitions = await Promise.all(Array.from({ length: 2 }, () => request(`/api/orders/${order.id}/status`, 'PATCH', loja, { status: 'CONFIRMED', version: 2 })));
  assert.deepEqual(transitions.map(r => r.status).sort(), [200, 409]);
  const detail = await (await request(`/api/orders/${order.id}`, 'GET', ana)).json();
  assert.equal(detail.version, 3); assert.equal(detail.events.length, 3);
});
test('API: token inválido, acesso alheio e papel da loja', async t => {
  const { request, session } = await setup(t);
  assert.equal((await request('/api/orders')).status, 401);
  assert.equal((await request('/api/orders', 'GET', 'fake')).status, 401);
  const ana = await session('ana'), bruno = await session('bruno'), loja = await session('loja');
  const order = (await (await request('/api/orders', 'POST', ana, cart, 'create-001')).json()).data;
  assert.equal((await request(`/api/orders/${order.id}`, 'GET', bruno)).status, 404);
  assert.equal((await request('/api/orders', 'POST', loja, cart, 'create-001')).status, 403);
  assert.equal((await request(`/api/orders/${order.id}/payments`, 'POST', loja, { method: 'PIX', amountCents: 2400 }, 'payment-001')).status, 403);
});
test('API: JSON inválido, limite de corpo, origem e cabeçalhos', async t => {
  const { request, session, base } = await setup(t); const ana = await session('ana');
  const malformed = await fetch(base + '/api/orders', { method: 'POST', headers: { Authorization: `Bearer ${ana}`, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const large = await request('/api/orders', 'POST', ana, { value: 'x'.repeat(18000) }, 'create-001');
  assert.equal(large.status, 413);
  const crossOrigin = await fetch(base + '/api/demo/session', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{"accountId":"admin"}' });
  assert.equal(crossOrigin.status, 403);
  // O fetch do Node substitui Host; usamos HTTP direto para enviar o cabeçalho real.
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(base + '/api/health', { headers: { Host: 'example.com' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  const page = await fetch(base); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(await page.text(), /Zuppty/);
  assert.equal((await request('/api/orders', 'POST', ana, cart)).status, 400);
});
