// Sirve dist/ con diagnóstico a 127.0.0.1 y guarda lo que informe el Safari real.
const http = require('http'), fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const report = path.join(out, 'report.jsonl');
fs.writeFileSync(report, '');
http.createServer((q, r) => {
  const url = new URL(q.url, 'http://127.0.0.1');
  if (q.method === 'POST') {
    const parts = [];
    q.on('data', (d) => parts.push(d));
    q.on('end', () => {
      const body = Buffer.concat(parts).toString();
      if (url.pathname === '/log') fs.appendFileSync(report, body + '\n');
      if (url.pathname === '/shot') fs.writeFileSync(path.join(out, url.searchParams.get('name').replace(/\W/g, '') + '.png'), Buffer.from(body.split(',')[1], 'base64'));
      r.end('ok');
    });
    return;
  }
  if (url.pathname !== '/') { r.statusCode = 404; r.end(); return; }
  const html = fs.readFileSync(path.join(__dirname, '../../dist/index.html'), 'utf8').replace('<head>', () => `<head><script>${fs.readFileSync(path.join(__dirname, 'instrument.js'), 'utf8')}</script>`);
  r.setHeader('content-type', 'text/html; charset=utf-8'); r.setHeader('cache-control', 'no-store');
  r.end(html);
}).listen(4188, '127.0.0.1', () => console.log('Abre http://127.0.0.1:4188/ en Safari'));
