import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Orders } from './orders.ts';
import { createApp } from './server.ts';

const path = resolve(process.env.DB_PATH ?? 'data/orderflow.sqlite');
mkdirSync(dirname(path), { recursive: true });
const orders = new Orders(path);
const server = createApp(orders);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4317);
server.listen(port, host, () => console.log(`Zuppty OrderFlow: http://${host}:${port} (somente demonstração)`));
function stop() { server.close(() => { orders.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
