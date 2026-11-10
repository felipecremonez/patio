import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openOperations, fail } from './operations.mjs';
import { seed } from './demo.mjs';

const files = {
  '/':['index.html','text/html; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8'],
  '/mark.svg':['mark.svg','image/svg+xml']
};
const send = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('Envie os dados em JSON.', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn:false })) {
    size += chunk.length;
    if (size > 65_536) { req.resume(); throw fail('Formulário muito grande.', 413); }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail('Formulário inválido.'); }
}
export function createPatio({ path, demo = false }) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive:true, mode:0o700 });
  const ops = openOperations(path);
  if (demo) seed(ops);
  const assets = Object.fromEntries(Object.entries(files).map(([route, [name, type]]) => [
    route, [readFileSync(new URL('./public/' + name, import.meta.url)), type]
  ]));
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!demo && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || '')) {
        throw fail('Use o endereço local exibido no terminal.', 403);
      }
      const route = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && Object.hasOwn(assets, route)) {
        const [content, type] = assets[route];
        res.writeHead(200, { 'Content-Type':type });
        return res.end(content);
      }
      if (req.method === 'GET' && route === '/api/state') return send(res, 200, { ...ops.snapshot(), demo });
      if (req.method === 'POST' && /^\/api\/[a-zA-Z]+$/.test(route)) {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin &&
          req.headers['sec-fetch-site'] !== 'same-origin' && req.headers.origin !== 'http://' + req.headers.host)) {
          throw fail('Origem não permitida.', 403);
        }
        const id = ops.execute(route.slice(5), await readJSON(req), req.headers['x-request-id']);
        return send(res, 200, { id, state:{ ...ops.snapshot(), demo } });
      }
      return send(res, 404, { error:'Página não encontrada.' });
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.destroyed) send(res, error.status ?? 500, { error:error.status ? error.message : 'Não foi possível concluir a operação.' });
    }
  });
  server.on('close', () => ops.db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (flag) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
  const demo = process.argv.includes('--demo');
  const path = demo ? 'data/demo.sqlite' : process.env.PATIO_DB || 'data/patio.sqlite';
  const port = Number(arg('--port') || process.env.PORT || 3000);
  const host = demo ? arg('--host') || '127.0.0.1' : '127.0.0.1';
  createPatio({ path, demo }).listen(port, host, () => console.log(`Pátio · http://${host}:${port}`));
}
