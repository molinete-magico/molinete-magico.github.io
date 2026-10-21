import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { postsRoot, projectsRoot, repoRoot, setRepoRoot } from './fs.ts';
import { app } from './index.ts';
import { parseFrontmatter, readPostImage, readProjectDocument, resolvePostFile, saveImage } from './content.ts';

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
    await fs.writeFile(path.join(outside, 'index.md'), '---\ntitle: outside\n---\n');
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


test('Writer rejects image folders that are symlinks outside the posts root', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-image-audit-'));
  const id = `.writer-image-audit-${process.pid}`;
  const flatPost = path.join(postsRoot(), `${id}.md`);
  const linkedFolder = path.join(postsRoot(), id);
  try {
    await fs.writeFile(path.join(outside, 'secret.png'), 'not-an-image');
    await fs.writeFile(flatPost, '---\ntitle: test\n---\nbody\n');
    await fs.symlink(outside, linkedFolder, 'dir');
    await assert.rejects(
      readPostImage(id, 'secret.png'),
      /fora da pasta de conteúdo permitida/,
    );
  } finally {
    await fs.rm(linkedFolder, { recursive: true, force: true });
    await fs.rm(flatPost, { force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('Writer does not move a post into a symlinked image folder outside content', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-upload-audit-'));
  const id = `writer-upload-audit-${process.pid}`;
  const flatPost = path.join(postsRoot(), `${id}.md`);
  const linkedFolder = path.join(postsRoot(), id);
  try {
    await fs.writeFile(flatPost, '---\ntitle: test\n---\nbody\n');
    await fs.symlink(outside, linkedFolder, 'dir');
    await assert.rejects(
      saveImage(id, 'upload.png', Buffer.from('not-an-image')),
      /fora da pasta de conteúdo permitida/,
    );
    await fs.access(flatPost);
    await assert.rejects(fs.access(path.join(outside, 'index.md')));
  } finally {
    await fs.rm(linkedFolder, { recursive: true, force: true });
    await fs.rm(flatPost, { force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('Writer rejects project documents that are symlinks outside projects', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-document-audit-'));
  const id = `writer-document-audit-${process.pid}`;
  const projectFolder = path.join(projectsRoot(), id);
  try {
    await fs.mkdir(projectFolder, { recursive: true });
    await fs.writeFile(path.join(projectFolder, 'project.md'), '---\ntitle: test\ntype: story\n---\n');
    await fs.writeFile(path.join(outside, 'document.md'), 'secret');
    await fs.symlink(path.join(outside, 'document.md'), path.join(projectFolder, 'document.md'));
    await assert.rejects(
      readProjectDocument(id, 'document', 'document'),
      /fora da pasta de conteúdo permitida/,
    );
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
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


test('Writer save API round-trips long Markdown in an isolated workspace', async () => {
  const originalRoot = repoRoot();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-save-roundtrip-'));
  const postFolder = path.join(workspace, 'content', 'posts', 'roundtrip-test');
  await fs.mkdir(postFolder, { recursive: true });
  await fs.mkdir(path.join(workspace, 'content', 'projects'), { recursive: true });
  await fs.writeFile(path.join(postFolder, 'index.md'), [
    '---',
    'title: Original title',
    'description: Original description',
    'pubDate: "2020-04-05"',
    'tags:',
    '  - original',
    'draft: true',
    '---',
    '',
    'Conteúdo original.',
    '',
  ].join('\n'), 'utf-8');

  const longBody = Array.from({ length: 80 }, (_, index) => [
    '## Seção ' + (index + 1),
    '',
    'Texto longo com acentuação (ação, história), referência [' + (index + 1) + '] e **ênfase**.',
    '',
    '```ts',
    'const section' + (index + 1) + ' = "preservar exatamente";',
    '```',
  ].join('\n')).join('\n\n');

  try {
    setRepoRoot(workspace);
    const saveResponse = await app.request('/api/post/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'roundtrip-test',
        file: {
          title: 'Round-trip test',
          description: 'Conteúdo de teste',
          pubDate: '2099-12-31',
          tags: ['teste', 'markdown'],
          draft: true,
        },
        body: longBody,
        changeDate: false,
      }),
    });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json() as { body: string; file: { pubDate: string; title: string } };
    assert.equal(saved.body, longBody);
    assert.equal(saved.file.title, 'Round-trip test');
    assert.equal(saved.file.pubDate, '2020-04-05');

    const reloadResponse = await app.request('/api/post/roundtrip-test');
    assert.equal(reloadResponse.status, 200);
    const reloaded = await reloadResponse.json() as { body: string; file: { pubDate: string } };
    assert.equal(reloaded.body, longBody);
    assert.equal(reloaded.file.pubDate, '2020-04-05');

    const diskContent = await fs.readFile(path.join(postFolder, 'index.md'), 'utf-8');
    assert.ok(diskContent.includes('const section80 = "preservar exatamente";'));
  } finally {
    setRepoRoot(originalRoot);
    await fs.rm(workspace, { recursive: true, force: true });
  }
});


test('Writer image upload API persists an image and returns a stable filename', async () => {
  const originalRoot = repoRoot();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-image-roundtrip-'));
  const postFolder = path.join(workspace, 'content', 'posts', 'image-roundtrip');
  await fs.mkdir(postFolder, { recursive: true });
  await fs.mkdir(path.join(workspace, 'content', 'projects'), { recursive: true });
  await fs.writeFile(path.join(postFolder, 'index.md'), [
    '---', 'title: Image round-trip', 'description: Test', 'pubDate: "2020-04-05"', 'draft: true', '---', '', 'Post de teste', '',
  ].join('\\n'), 'utf-8');
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

  try {
    setRepoRoot(workspace);
    const form = new FormData();
    form.set('file', new File([imageBytes], 'mapa-área.png', { type: 'image/png' }));
    const response = await app.request('/api/post/image-roundtrip/image', { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const result = await response.json() as { name: string; alt: string };
    assert.equal(result.name, 'mapa-area.png');
    assert.equal(result.alt, 'mapa-area');

    const savedBytes = await fs.readFile(path.join(postFolder, result.name));
    assert.deepEqual(savedBytes, imageBytes);
    const readResponse = await app.request('/api/post-image?post=image-roundtrip&name=mapa-area.png');
    assert.equal(readResponse.status, 200);
    assert.equal(readResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await readResponse.arrayBuffer()), imageBytes);
  } finally {
    setRepoRoot(originalRoot);
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
