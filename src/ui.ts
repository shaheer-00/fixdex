// Fixdex UI server v0.2
// Serves web/ui.html + JSON API. Single /api/state payload, mutation endpoints.
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FixdexDB } from './db.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dir, '..', 'web', 'ui.html');
const db = new FixdexDB();
const PORT = Number(process.env.FIXDEX_PORT || 4747);

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(existsSync(HTML) ? readFileSync(HTML, 'utf8') : 'ui.html not found');
      return;
    }
    if (method === 'GET' && path === '/api/state') return sendJson(res, 200, db.state());
    if (method === 'GET' && path === '/api/export') return sendJson(res, 200, db.list({}));
    if (method === 'GET' && path === '/api/counts') return sendJson(res, 200, db.counts());
    if (method === 'GET' && path === '/api/search') {
      const q = url.searchParams.get('q') || '';
      return sendJson(res, 200, { rows: db.search(q) });
    }
    if (method === 'GET' && path === '/api/config') {
      return sendJson(res, 200, { tokenCost: db.tokenCost() });
    }

    const entryMatch = path.match(/^\/api\/entry\/(\d+)$/);
    if (method === 'GET' && entryMatch) {
      const e = db.get(Number(entryMatch[1]));
      return e ? sendJson(res, 200, e) : sendJson(res, 404, { error: 'not found' });
    }

    const fbMatch = path.match(/^\/api\/feedback\/(\d+)\/(up|down)$/);
    if (method === 'POST' && fbMatch) {
      db.feedback(Number(fbMatch[1]), fbMatch[2] === 'up');
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && path === '/api/merge') {
      const b = await readBody(req);
      const ok = db.merge(Number(b.from), Number(b.to));
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 400, { error: 'merge failed' });
    }

    if (method === 'POST' && path === '/api/delete') {
      const b = await readBody(req);
      const ok = db.remove(Number(b.id));
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'not found' });
    }

    if (method === 'POST' && path === '/api/update') {
      const b = await readBody(req);
      const ok = db.update(Number(b.id), b);
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 400, { error: 'nothing to update' });
    }

    if (method === 'POST' && path === '/api/save') {
      const b = await readBody(req);
      const e = db.save(b);
      return sendJson(res, 200, { id: e.id });
    }

    if (method === 'POST' && path === '/api/import') {
      const b = await readBody(req);
      const rows = Array.isArray(b.entries) ? b.entries : [];
      let n = 0;
      for (const r of rows) {
        try { db.save(r); n++; } catch { /* skip bad rows */ }
      }
      return sendJson(res, 200, { ok: true, imported: n });
    }

    if (method === 'POST' && path === '/api/prune') {
      const n = db.prune();
      return sendJson(res, 200, { ok: true, pruned: n });
    }

    if (method === 'POST' && path === '/api/config') {
      const b = await readBody(req);
      if (b.tokenCost != null) db.setConfig('token_cost', String(Number(b.tokenCost) || 150));
      return sendJson(res, 200, { ok: true, tokenCost: db.tokenCost() });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e: any) {
    sendJson(res, 500, { error: e?.message || 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Fixdex UI → http://localhost:${PORT}`);
});