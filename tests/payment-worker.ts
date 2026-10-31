import { parentPort, workerData } from 'node:worker_threads';
import { Orders } from '../src/orders.ts';
const orders = new Orders(workerData.path);
parentPort!.postMessage({ ready: true });
parentPort!.once('message', () => {
  try {
    const result = orders.pay({ id: 'ana', role: 'CUSTOMER' }, workerData.id, { method: 'PIX', amountCents: 2400 }, workerData.key);
    parentPort!.postMessage({ result });
  } catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { orders.close(); parentPort!.close(); }
});
