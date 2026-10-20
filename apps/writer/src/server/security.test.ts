import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { postsRoot } from './fs.ts';
import { app } from './index.ts';
import { parseFrontmatter, resolvePostFile } from './content.ts';

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


test('Writer parses YAML front matter and preserves the Markdown body', () => {
  const parsed = parseFrontmatter('---\ntitle: Cinzas do Vale\ntags:\n  - rpg\n  - sum\npublished: true\n---\n\n# Capítulo\n');
  assert.equal(parsed.data.title, 'Cinzas do Vale');
  assert.deepEqual(parsed.data.tags, ['rpg', 'sum']);
  assert.equal(parsed.data.published, true);
  assert.equal(parsed.content, '\n# Capítulo\n');
});

test('Writer leaves Markdown without front matter untouched', () => {
  const parsed = parseFrontmatter('# Apenas Markdown\n\nTexto.');
  assert.deepEqual(parsed.data, {});
  assert.equal(parsed.content, '# Apenas Markdown\n\nTexto.');
});

test('Writer rejects malformed YAML front matter instead of silently discarding it', () => {
  assert.throws(() => parseFrontmatter('---\ntitle: [sem fechamento\n---\nCorpo'), /unexpected|flow collection|expected/i);
});
