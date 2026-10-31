export type Status = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type Fulfillment = 'DELIVERY' | 'PICKUP';
export type Actor = { id: string; role: 'CUSTOMER' | 'STORE' | 'ADMIN' };
export type Item = { productId: string; name: string; quantity: number; unitPriceCents: number };

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_INPUT', 'Envie um objeto JSON.');
  return value as Record<string, unknown>;
}
export const catalog = [
  { id: 'burger', name: 'Hambúrguer da casa', description: 'Pão, carne, queijo e molho da casa.', priceCents: 2400 },
  { id: 'fries', name: 'Batata rústica', description: 'Porção individual com alecrim.', priceCents: 1200 },
  { id: 'juice', name: 'Suco de maracujá', description: 'Copo de 400 ml.', priceCents: 800 },
] as const;

export function normalizeItems(input: unknown): Item[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) fail(400, 'INVALID_ITEMS', 'Escolha de 1 a 10 produtos.');
  const seen = new Set<string>();
  return input.map(raw => {
    const row = object(raw);
    const product = catalog.find(p => p.id === row.productId);
    if (!product) fail(400, 'UNKNOWN_PRODUCT', 'Produto não encontrado.');
    if (seen.has(product.id)) fail(400, 'DUPLICATE_PRODUCT', 'Agrupe a quantidade do mesmo produto.');
    seen.add(product.id);
    if (!Number.isInteger(row.quantity) || (row.quantity as number) < 1 || (row.quantity as number) > 20) {
      fail(400, 'INVALID_QUANTITY', 'Quantidade deve ser um inteiro entre 1 e 20.');
    }
    return { productId: product.id, name: product.name, quantity: row.quantity as number, unitPriceCents: product.priceCents };
  }).sort((a, b) => a.productId.localeCompare(b.productId));
}
export function totalFromCatalog(input: unknown): number {
  return normalizeItems(input).reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
}
export function nextStatuses(status: string, fulfillment: string): Status[] {
  switch (status) {
    case 'PENDING': return ['CONFIRMED', 'CANCELLED'];
    case 'CONFIRMED': return ['PREPARING', 'CANCELLED'];
    case 'PREPARING': return ['READY', 'CANCELLED'];
    case 'READY': return [fulfillment === 'PICKUP' ? 'DELIVERED' : 'OUT_FOR_DELIVERY', 'CANCELLED'];
    case 'OUT_FOR_DELIVERY': return ['DELIVERED'];
    default: return [];
  }
}
