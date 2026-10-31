import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStatuses, totalFromCatalog } from '../src/domain.ts';

test('entrega precisa sair da loja; retirada não passa por transporte', () => {
  assert.deepEqual(nextStatuses('READY', 'DELIVERY'), ['OUT_FOR_DELIVERY', 'CANCELLED']);
  assert.deepEqual(nextStatuses('READY', 'PICKUP'), ['DELIVERED', 'CANCELLED']);
  assert.deepEqual(nextStatuses('DELIVERED', 'DELIVERY'), []);
});

test('preço vem do catálogo, em centavos, e não do navegador', () => {
  assert.equal(totalFromCatalog([{ productId: 'burger', quantity: 2, priceCents: 1 }]), 4800);
});

test('rejeita quantidade fracionada, produto inexistente e carrinho vazio', () => {
  for (const items of [[], [{ productId: 'burger', quantity: 1.5 }], [{ productId: 'fake', quantity: 1 }]]) {
    assert.throws(() => totalFromCatalog(items));
  }
});
