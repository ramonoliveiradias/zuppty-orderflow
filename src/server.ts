import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppError, catalog, fail, object } from './domain.ts';
import type { Actor } from './domain.ts';
import type { Orders } from './orders.ts';

export const accounts: (Actor & { name: string })[] = [
  { id: 'ana', role: 'CUSTOMER', name: 'Ana · cliente' },
  { id: 'bruno', role: 'CUSTOMER', name: 'Bruno · outro cliente' },
  { id: 'loja', role: 'STORE', name: 'Operação da loja' },
  { id: 'admin', role: 'ADMIN', name: 'Administrador' },
];
const files: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'Envie Content-Type: application/json.');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16384) fail(413, 'BODY_TOO_LARGE', 'O corpo excede 16 KB.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'INVALID_JSON', 'JSON inválido.'); }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function createApp(orders: Orders) {
  const sessions = new Map<string, { actor: Actor; expires: number }>();
  const attempts = new Map<string, { start: number; count: number }>();
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const hostname = new URL(`http://${req.headers.host ?? ''}`).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) fail(403, 'HOST_DENIED', 'Esta demonstração aceita apenas acesso local.');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method;
      if (method === 'GET' && files[url.pathname]) {
        const [file, type] = files[url.pathname]!;
        const data = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); res.end(data); return;
      }
      if (method === 'GET' && url.pathname === '/api/health') {
        orders.db.prepare('SELECT 1').get(); json(res, 200, { status: 'ok', mode: 'demo' }); return;
      }
      if (method === 'GET' && url.pathname === '/api/catalog') { json(res, 200, catalog); return; }
      if (method === 'GET' && url.pathname === '/api/demo/accounts') { json(res, 200, accounts); return; }

      // A demo não precisa aceitar comandos enviados por outra página aberta no navegador.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) fail(403, 'ORIGIN_DENIED', 'Origem não permitida.');
      if (method === 'POST' && url.pathname === '/api/demo/session') {
        const ip = req.socket.remoteAddress ?? 'local'; const now = Date.now();
        for (const [key, value] of attempts) if (now - value.start > 60000) attempts.delete(key);
        const attempt = attempts.get(ip) ?? { start: now, count: 0 };
        if (++attempt.count > 60) fail(429, 'RATE_LIMIT', 'Aguarde um minuto para trocar de conta.');
        attempts.set(ip, attempt);
        const input = object(await body(req));
        const actor = accounts.find(account => account.id === input.accountId);
        if (!actor) fail(400, 'INVALID_ACCOUNT', 'Escolha uma conta de demonstração.');
        for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
        if (sessions.size >= 1000) fail(503, 'SESSION_LIMIT', 'Limite de sessões da demonstração.');
        const token = randomUUID(); sessions.set(token, { actor, expires: now + 3600000 });
        json(res, 201, { token, actor, expiresIn: 3600 }); return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const session = token && sessions.get(token);
      if (!session || session.expires < Date.now()) fail(401, 'UNAUTHORIZED', 'Abra uma sessão de demonstração.');
      const actor = session.actor;
      if (url.pathname === '/api/orders' && method === 'GET') { json(res, 200, orders.list(actor)); return; }
      if (url.pathname === '/api/orders' && method === 'POST') {
        const result = orders.create(actor, await body(req), req.headers['idempotency-key']);
        json(res, result.replayed ? 200 : 201, result); return;
      }
      const match = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})(?:\/(payments|status))?$/);
      if (match) {
        const id = match[1]!;
        if (!match[2] && method === 'GET') { json(res, 200, orders.get(actor, id)); return; }
        if (match[2] === 'payments' && method === 'POST') {
          const result = orders.pay(actor, id, await body(req), req.headers['idempotency-key']);
          json(res, result.replayed ? 200 : 201, result); return;
        }
        if (match[2] === 'status' && method === 'PATCH') {
          json(res, 200, orders.transition(actor, id, await body(req))); return;
        }
      }
      fail(404, 'NOT_FOUND', 'Rota não encontrada.');
    } catch (error) {
      const known = error instanceof AppError;
      if (!known) console.error({ requestId, error });
      if (!res.headersSent) json(res, known ? error.status : 500, {
        error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Erro interno.', requestId },
      });
      else res.end();
    }
  });
}
