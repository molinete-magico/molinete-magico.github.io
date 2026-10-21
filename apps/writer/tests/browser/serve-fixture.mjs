import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '../../.browser-test/fixture.js');
await build({
  entryPoints: [resolve(here, 'fixture.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
});

const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Writer browser tests</title></head>
<body><script src="/fixture.js"></script></body>
</html>`;

createServer(async (request, response) => {
  if (request.url === '/fixture.js') {
    try {
      const script = await readFile(bundlePath);
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(script);
    } catch {
      response.writeHead(500);
      response.end('Fixture bundle unavailable');
    }
    return;
  }
  if (request.url === '/' || request.url?.startsWith('/?')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  response.writeHead(404);
  response.end('Not found');
}).listen(4178, '127.0.0.1', () => {
  console.log('Writer browser fixture listening on http://127.0.0.1:4178');
});
