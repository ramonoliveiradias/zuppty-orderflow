const $ = id => document.getElementById(id);
const money = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const labels = { PENDING: 'Recebido', CONFIRMED: 'Confirmado', PREPARING: 'Em preparo', READY: 'Pronto', OUT_FOR_DELIVERY: 'Saiu para entrega', DELIVERED: 'Entregue', CANCELLED: 'Cancelado' };
let token = '', actor, products = [], selected, current, busy = false, sessionGeneration = 0;
const paymentKeys = new Map();
let pendingOrder;

function notice(message, error = false) { $('notice').hidden = false; $('notice').className = error ? 'error' : ''; $('notice').textContent = message; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error.message} (${data.error.code})`);
  return data;
}
function element(tag, text, className) {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el;
}
function button(text, action, className = 'secondary') {
  const el = element('button', text, className); el.type = 'button'; el.addEventListener('click', () => run(action)); return el;
}
async function run(action) {
  if (busy) return; busy = true; $('account').disabled = true;
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { busy = false; $('account').disabled = false; }
}
function cart() { return products.map(p => ({ productId: p.id, quantity: Number($(`quantity-${p.id}`).value) })).filter(item => item.quantity > 0); }
function updateTotal() {
  $('total').textContent = money(cart().reduce((sum, item) => sum + products.find(p => p.id === item.productId).priceCents * item.quantity, 0));
  $('create').disabled = actor?.role !== 'CUSTOMER' || cart().length === 0;
}
function renderCatalog() {
  $('catalog').replaceChildren();
  for (const product of products) {
    const row = element('div', undefined, 'product'); const info = element('div');
    info.append(element('h3', product.name), element('p', product.description), element('strong', money(product.priceCents)));
    const input = element('input'); input.type = 'number'; input.min = '0'; input.max = '20'; input.step = '1'; input.value = product.id === 'burger' ? '1' : '0'; input.id = `quantity-${product.id}`; input.setAttribute('aria-label', `Quantidade de ${product.name}`); input.addEventListener('input', updateTotal);
    row.append(info, input); $('catalog').append(row);
  }
  updateTotal();
}
async function list() {
  const generation = sessionGeneration;
  const orders = await api('/api/orders');
  if (generation !== sessionGeneration) return;
  $('orders').replaceChildren();
  if (!orders.length) $('orders').append(element('p', actor.role === 'CUSTOMER' ? 'Nenhum pedido desta conta. Comece pelo cardápio.' : 'A loja ainda não recebeu pedidos.', 'small muted'));
  for (const order of orders) {
    const card = button('', async () => { selected = order.id; await list(); }, `order-card${selected === order.id ? ' selected' : ''}`);
    card.setAttribute('aria-label', `Ver pedido ${order.id.slice(0, 8)}`);
    const top = element('div', undefined, 'order-top'); top.append(element('strong', `#${order.id.slice(0, 8)}`), element('strong', money(order.totalCents)));
    card.append(top, element('p', `${order.fulfillment === 'PICKUP' ? 'Retirada' : 'Entrega'} · ${order.items.reduce((sum, i) => sum + i.quantity, 0)} item(ns)`), element('span', labels[order.status], 'badge'));
    $('orders').append(card);
  }
  if (selected) {
    current = await api(`/api/orders/${selected}`);
    if (generation === sessionGeneration) renderDetail();
  }
}
function renderDetail() {
  const order = current; const root = $('detail'); root.replaceChildren();
  const top = element('div', undefined, 'detail-meta'); top.append(element('span', `#${order.id.slice(0, 8)}`, 'detail-id'), element('span', labels[order.status], 'badge'));
  root.append(top, element('p', `${order.fulfillment === 'PICKUP' ? 'Retirada na loja' : 'Entrega'} · versão ${order.version}`, 'detail-sub'));
  const items = element('ul', undefined, 'items');
  for (const item of order.items) { const li = element('li'); li.append(element('span', `${item.quantity} × ${item.name}`), element('strong', money(item.quantity * item.unitPriceCents))); items.append(li); }
  const total = element('div', undefined, 'detail-total'); total.append(element('span', 'Total do pedido'), element('strong', money(order.totalCents))); root.append(items, total);
  const box = element('div', undefined, 'payment-box');
  box.append(element('p', order.paid ? 'Pagamento simulado aprovado.' : order.status === 'CANCELLED' ? 'Pedido cancelado. Não pode receber pagamento.' : 'A confirmação da loja depende do pagamento.'));
  if (order.payment) box.append(element('p', `Transação: ${order.payment.id}`, 'payment-id'));
  const canPay = actor.role === 'CUSTOMER' || actor.role === 'ADMIN';
  if (canPay && !order.paid && order.status === 'PENDING') box.append(button('Simular pagamento PIX', () => pay(order), 'primary'));
  if (canPay && order.paid && paymentKeys.has(`${actor.id}:${order.id}`)) box.append(button('Repetir a mesma requisição', () => pay(order)));
  root.append(box);
  if (actor.role !== 'CUSTOMER') {
    const actions = element('div', undefined, 'actions');
    for (const status of order.nextStatuses) {
      const b = button(status === 'CANCELLED' ? 'Cancelar pedido' : `Avançar: ${labels[status]}`, async () => {
        await api(`/api/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, version: order.version }) });
        notice('Etapa atualizada.'); await list();
      });
      b.disabled = (status === 'CONFIRMED' && !order.paid) || (status === 'CANCELLED' && order.paid);
      if (status === 'CANCELLED' && order.paid) b.title = 'O estorno de pedidos pagos está fora desta demonstração.';
      actions.append(b);
    }
    root.append(actions);
    if (order.paid && order.nextStatuses.includes('CANCELLED')) root.append(element('p', 'Cancelamento de pedido pago exige estorno, fora do escopo desta demo.', 'small muted'));
  }
  root.append(element('h3', 'HISTÓRICO DO PEDIDO', 'history-title'));
  const history = element('ol', undefined, 'timeline');
  for (const event of order.events) { const li = element('li', labels[event.detail] ?? event.detail); li.append(element('small', `${new Date(event.createdAt).toLocaleTimeString('pt-BR')} · ${event.actorId}`)); history.append(li); }
  root.append(history);
}
async function pay(order) {
  const mapKey = `${actor.id}:${order.id}`;
  if (!paymentKeys.has(mapKey)) paymentKeys.set(mapKey, crypto.randomUUID());
  const result = await api(`/api/orders/${order.id}/payments`, { method: 'POST', headers: { 'Idempotency-Key': paymentKeys.get(mapKey) }, body: JSON.stringify({ method: 'PIX', amountCents: order.totalCents }) });
  notice(result.replayed ? `Requisição repetida: a transação ${result.data.id.slice(0, 8)} foi reaproveitada. Nenhum pagamento novo.` : 'Pagamento simulado aprovado. Troque para a loja para confirmar o pedido.');
  await list();
}
async function login() {
  $('notice').hidden = true;
  let result;
  try {
    result = await api('/api/demo/session', { method: 'POST', body: JSON.stringify({ accountId: $('account').value }) });
  } catch (error) {
    // A conta exibida precisa continuar sendo a dona da sessão ativa.
    $('account').value = actor?.id ?? '';
    throw error;
  }
  sessionGeneration++; selected = null; current = null; pendingOrder = null;
  token = result.token; actor = result.actor;
  $('scope').textContent = actor.role === 'CUSTOMER' ? 'Somente os pedidos deste cliente.' : 'Últimos 100 pedidos recebidos pela loja.';
  $('role-hint').textContent = actor.role === 'CUSTOMER' ? 'Crie pedidos e simule pagamentos. Outros clientes não podem acessar seus pedidos.' : 'Acompanhe pedidos e avance as etapas permitidas pela API.';
  $('detail').replaceChildren(element('p', 'Selecione um pedido para acompanhar.', 'empty'));
  for (const product of products) $(`quantity-${product.id}`).disabled = actor.role !== 'CUSTOMER';
  updateTotal(); await list();
}
$('checkout').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const payload = { items: cart(), fulfillment: new FormData($('checkout')).get('fulfillment') };
    const signature = JSON.stringify(payload);
    // Em erro de rede, mantemos a chave para não criar outro pedido no próximo clique.
    if (!pendingOrder || pendingOrder.signature !== signature) pendingOrder = { signature, key: crypto.randomUUID() };
    const result = await api('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': pendingOrder.key }, body: signature });
    selected = result.data.id; pendingOrder = null; notice('Pedido recebido. Agora você pode simular o pagamento.'); await list();
  });
});
$('account').addEventListener('change', () => run(login));
$('refresh').addEventListener('click', () => run(list));
run(async () => {
  const [catalog, accounts] = await Promise.all([api('/api/catalog'), api('/api/demo/accounts')]);
  products = catalog; renderCatalog(); $('account').replaceChildren();
  for (const account of accounts) { const option = element('option', account.name); option.value = account.id; $('account').append(option); }
  await login();
});
