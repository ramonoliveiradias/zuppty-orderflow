import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orders } from '../src/orders.ts';

for (const sameKey of [true, false]) {
  test(`conexões independentes: pagamento concorrente com ${sameKey ? 'a mesma chave' : 'chaves diferentes'}`, { timeout: 15000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orderflow-race-')); const path = join(dir, 'db.sqlite');
    const orders = new Orders(path); const workers: Worker[] = [];
    try {
      const order = orders.create({ id: 'ana', role: 'CUSTOMER' }, { fulfillment: 'DELIVERY', items: [{ productId: 'burger', quantity: 1 }] }, 'create-001').data;
      for (let i = 0; i < 4; i++) workers.push(new Worker(new URL('./payment-worker.ts', import.meta.url), { workerData: { path, id: order.id, key: sameKey ? 'payment-shared' : `payment-${i}` } }));
      await Promise.all(workers.map(worker => once(worker, 'message')));
      const results = workers.map(worker => once(worker, 'message'));
      workers.forEach(worker => worker.postMessage('go'));
      const values = (await Promise.all(results)).map(([value]) => value);
      const successes = values.filter(value => value.result);
      assert.equal(successes.length, sameKey ? 4 : 1);
      assert.equal(new Set(successes.map(value => value.result.data.id)).size, 1);
      assert.equal(orders.get({ id: 'ana', role: 'CUSTOMER' }, order.id).events.filter(e => e.kind === 'PAYMENT_APPROVED').length, 1);
      if (sameKey) assert.equal(successes.filter(value => value.result.replayed).length, 3);
    } finally {
      await Promise.all(workers.map(worker => worker.terminate())); orders.close(); rmSync(dir, { recursive: true, force: true });
    }
  });
}
