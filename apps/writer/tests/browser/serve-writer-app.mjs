import { build } from 'esbuild';
import { serve } from '@hono/node-server';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../src/server/index.ts';
import { setRepoRoot } from '../../src/server/fs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = await mkdtemp(resolve(tmpdir(), 'writer-e2e-workspace-'));
const postFolder = resolve(workspace, 'content/posts/e2e-post');
const projectFolder = resolve(workspace, 'content/projects');
const clientOut = resolve(workspace, 'apps/writer/dist/client/v2');

await mkdir(postFolder, { recursive: true });
await mkdir(projectFolder, { recursive: true });
await writeFile(resolve(postFolder, 'index.md'), [
  '---',
  'title: E2E Draft',
  'description: Documento temporário para testes',
  'pubDate: "2026-01-02"',
  'tags:',
  '  - e2e',
  'draft: true',
  '---',
  '',
  'Texto original.',
  '',
].join('\n'), 'utf8');

await build({
  entryPoints: [resolve(here, '../../src/client-v2/main.ts')],
  outdir: clientOut,
  entryNames: 'main',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});

setRepoRoot(workspace);
const port = 4323;
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  process.stdout.write('Writer E2E server ready on http://127.0.0.1:' + port + '/v2\n');
});

async function cleanup() {
  server.close(async () => {
    await rm(workspace, { recursive: true, force: true });
    process.exit(0);
  });
}
process.once('SIGINT', cleanup);
process.once('SIGTERM', cleanup);
