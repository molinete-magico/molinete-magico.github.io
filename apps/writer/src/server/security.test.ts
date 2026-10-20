import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './index.ts';
import { resolvePostFile } from './content.ts';

test('Writer rejects API requests from a foreign browser origin', async () => {
  const response = await app.request('/api/posts', {
    headers: { origin: 'https://attacker.example', host: 'localhost:4322' },
  });
  assert.equal(response.status, 403);
});

test('Writer rejects malformed and traversal post identifiers', async () => {
  for (const id of ['../README.md', '..', '.', 'nested/post', 'nested\\\\post', '/etc/passwd', '\\0']) {
    await assert.rejects(resolvePostFile(id), /Identificador de post inválido/);
  }
});

test('Writer keeps normal legacy-style post identifiers as a valid input shape', async () => {
  await assert.rejects(resolvePostFile('legacy-post_2024'), /Post não encontrado/);
});
