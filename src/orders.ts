import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { fail, normalizeItems, nextStatuses, object } from './domain.ts';
import type { Actor, Fulfillment, Item, Status } from './domain.ts';

export type Order = {
  id: string; customerId: string; fulfillment: Fulfillment; status: Status;
  items: Item[]; totalCents: number; paid: boolean; version: number; createdAt: string;
};
type Payment = { id: string; orderId: string; amountCents: number; method: string; createdAt: string };
type Result<T> = { data: T; replayed: boolean };

export class Orders {
  db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (
        actor_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
        hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor_id, operation, key));
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id),
        actor_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  private read(id: string): Order {
    const row = this.db.prepare('SELECT document FROM orders WHERE id=?').get(id);
    if (!row) fail(404, 'NOT_FOUND', 'Pedido não encontrado.');
    return JSON.parse(row.document as string) as Order;
  }
  private allowed(actor: Actor, order: Order) {
    if (actor.role === 'CUSTOMER' && order.customerId !== actor.id) fail(404, 'NOT_FOUND', 'Pedido não encontrado.');
  }
  private save(order: Order) {
    this.db.prepare('UPDATE orders SET document=? WHERE id=?').run(JSON.stringify(order), order.id);
  }
  private event(actor: Actor, id: string, kind: string, detail: string) {
    this.db.prepare('INSERT INTO events(order_id,actor_id,kind,detail,created_at) VALUES(?,?,?,?,?)')
      .run(id, actor.id, kind, detail, new Date().toISOString());
  }
  private transaction<T>(work: () => T): T {
    // A reserva de escrita vem antes da leitura: duas conexões não aprovam o mesmo estado.
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private once<T>(actor: Actor, operation: string, key: unknown, input: unknown, work: () => T): Result<T> {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{8,100}$/.test(key)) {
      fail(400, 'INVALID_KEY', 'Envie Idempotency-Key com 8 a 100 caracteres.');
    }
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT hash,response FROM requests WHERE actor_id=? AND operation=? AND key=?')
        .get(actor.id, operation, key);
      if (previous) {
        if (previous.hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outros dados.');
        return { data: JSON.parse(previous.response as string) as T, replayed: true };
      }
      const data = work();
      // O efeito e sua resposta são gravados juntos; uma queda não deixa uma chave sem resultado.
      this.db.prepare('INSERT INTO requests(actor_id,operation,key,hash,response) VALUES(?,?,?,?,?)')
        .run(actor.id, operation, key, hash, JSON.stringify(data));
      return { data, replayed: false };
    });
  }
  list(actor: Actor): Order[] {
    const rows = actor.role === 'CUSTOMER'
      ? this.db.prepare('SELECT document FROM orders WHERE customer_id=? ORDER BY rowid DESC LIMIT 100').all(actor.id)
      : this.db.prepare('SELECT document FROM orders ORDER BY rowid DESC LIMIT 100').all();
    return rows.map(row => JSON.parse(row.document as string) as Order);
  }
  get(actor: Actor, id: string) {
    const order = this.read(id); this.allowed(actor, order);
    const payment = this.db.prepare('SELECT document FROM payments WHERE order_id=?').get(id);
    const events = this.db.prepare('SELECT actor_id AS actorId, kind, detail, created_at AS createdAt FROM events WHERE order_id=? ORDER BY sequence').all(id);
    return { ...order, payment: payment ? JSON.parse(payment.document as string) as Payment : null,
      events, nextStatuses: nextStatuses(order.status, order.fulfillment) };
  }
  create(actor: Actor, raw: unknown, key: unknown): Result<Order> {
    if (actor.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Entre como cliente para fazer um pedido.');
    const input = object(raw);
    if (input.fulfillment !== 'DELIVERY' && input.fulfillment !== 'PICKUP') fail(400, 'INVALID_FULFILLMENT', 'Escolha entrega ou retirada.');
    const items = normalizeItems(input.items);
    const fulfillment = input.fulfillment;
    return this.once(actor, 'create-order', key, { items, fulfillment }, () => {
      const order: Order = { id: randomUUID(), customerId: actor.id, fulfillment, items,
        totalCents: items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0),
        status: 'PENDING', paid: false, version: 1, createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO orders VALUES(?,?,?)').run(order.id, actor.id, JSON.stringify(order));
      this.event(actor, order.id, 'CREATED', 'Pedido recebido');
      return order;
    });
  }
  pay(actor: Actor, id: string, raw: unknown, key: unknown): Result<Payment> {
    const input = object(raw);
    if (input.method !== 'PIX' && input.method !== 'CARD') fail(400, 'INVALID_METHOD', 'Use PIX ou CARD.');
    if (!Number.isSafeInteger(input.amountCents) || (input.amountCents as number) <= 0) fail(400, 'INVALID_AMOUNT', 'Informe um valor inteiro em centavos.');
    const canonical = { method: input.method, amountCents: input.amountCents };
    // Permissão é conferida mesmo no replay de uma operação concluída.
    const existing = this.read(id); this.allowed(actor, existing);
    if (actor.role === 'STORE') fail(403, 'FORBIDDEN', 'A loja não pode simular pagamentos.');
    return this.once(actor, `pay:${id}`, key, canonical, () => {
      const order = this.read(id);
      if (order.status !== 'PENDING' || order.paid) fail(409, 'NOT_PAYABLE', 'Este pedido não pode receber outro pagamento.');
      if (order.totalCents !== input.amountCents) fail(422, 'AMOUNT_MISMATCH', 'O pagamento deve corresponder ao total do pedido.');
      const payment: Payment = { id: randomUUID(), orderId: id, method: input.method as string,
        amountCents: order.totalCents, createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO payments VALUES(?,?,?)').run(payment.id, id, JSON.stringify(payment));
      order.paid = true; order.version++; this.save(order);
      this.event(actor, id, 'PAYMENT_APPROVED', 'Pagamento simulado aprovado');
      return payment;
    });
  }
  transition(actor: Actor, id: string, raw: unknown): Order {
    const input = object(raw);
    if (!Number.isSafeInteger(input.version) || (input.version as number) < 1) fail(400, 'INVALID_VERSION', 'Informe a versão atual do pedido.');
    return this.transaction(() => {
      const order = this.read(id); this.allowed(actor, order);
      if (actor.role === 'CUSTOMER') fail(403, 'FORBIDDEN', 'Somente a operação altera etapas do pedido.');
      if (order.version !== input.version) fail(409, 'STALE_VERSION', 'O pedido mudou. Atualize antes de tentar novamente.');
      if (!nextStatuses(order.status, order.fulfillment).includes(input.status as Status)) fail(409, 'INVALID_TRANSITION', 'Esta mudança de etapa não é permitida.');
      if (input.status === 'CONFIRMED' && !order.paid) fail(409, 'PAYMENT_REQUIRED', 'Aguarde o pagamento para confirmar.');
      if (input.status === 'CANCELLED' && order.paid) fail(409, 'REFUND_REQUIRED', 'Pedido pago exige estorno. Esse fluxo está fora desta demonstração.');
      order.status = input.status as Status; order.version++; this.save(order);
      this.event(actor, id, 'STATUS_CHANGED', order.status);
      return order;
    });
  }
}
