import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { postsRoot } from './fs.ts';
import { app } from './index.ts';
import { resolvePostFile } from './content.ts';

test('Writer rejects API requests from a foreign browser origin', async () => {
  const response = await app.request('/api/posts', {
    headers: { origin: 'https://attacker.example', host: 'localhost:4322' },
  });
  assert.equal(response.status, 403);
});

test('Writer rejects malformed and traversal post identifiers', async () => {
  for (const id of ['../README.md', '..', '.', 'nested/post', 'nested\\\\post', '/etc/passwd', String.fromCharCode(0)]) {
    await assert.rejects(resolvePostFile(id), /Identificador de post inválido/);
  }
});

test('Writer keeps normal legacy-style post identifiers as a valid input shape', async () => {
  await assert.rejects(resolvePostFile('legacy-post_2024'), /Post não encontrado/);
});

test('Writer rejects a post symlink that resolves outside the posts directory', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-path-audit-'));
  const id = `.writer-audit-${process.pid}`;
  const link = path.join(postsRoot(), id);
  try {
    await fs.writeFile(path.join(outside, 'index.md'), '---\\ntitle: outside\\n---\\n');
    await fs.symlink(outside, link, 'dir');
    await assert.rejects(
      resolvePostFile(id),
      /fora da pasta de conteúdo permitida/,
    );
  } finally {
    await fs.rm(link, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
