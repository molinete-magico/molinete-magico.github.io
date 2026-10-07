// Servidor local do Writer.
//
// Um app Hono enxuto que expõe:
//   - A interface (HTML/JS/CSS) em /  (cliente servido do disco)
//   - Uma API JSON que manipula content/ e executa Git
//
// Tudo roda na sua máquina; o Git é delegado ao Git CLI do sistema, que
// usa as credenciais já configuradas pelo usuário (SSH, gh auth,
// credential helper...). O Writer nunca armazena tokens de terceiros.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import path from 'node:path';
import { readFileSync, existsSync, readFile } from 'node:fs';
import {
  listPosts,
  readPost,
  readPostBanner,
  createPost,
  savePost,
  deletePost,
  duplicatePost,
  saveImage,
} from './content.ts';
import { gitStatus, commit, push, canPush, pull } from './git.ts';
import type { PostMeta } from '../shared/types.ts';
import { PORT, repoRoot, contentRoot, clientDir, setRepoRoot } from './fs.ts';

function clientAsset(filename: string, contentType: string) {
  const file = path.join(clientDir(), filename);
  if (!existsSync(file)) {
    throw new Error(
      `Cliente não compilado (falta ${file}). Rode \`npm run build:client\` no apps/writer.`,
    );
  }
  return new Response(readFileSync(file), {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

const app = new Hono();
app.use('*', cors());

// --- Página e estáticos -------------------------------------------------

function shellHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Meu Writer</title>
  <link rel="stylesheet" href="/client.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/client.js"></script>
  <script>
    // Pequenos aprimoramentos de interface que não precisam participar
    // do bundle principal do editor.
    window.addEventListener('DOMContentLoaded', () => {
      const toolbar = document.createElement('div');
      toolbar.className = 'editor-toolbar';
      toolbar.innerHTML = [
        '<span class="toolbar-label">FORMATAÇÃO</span>',
        '<button type="button" data-md="bold" title="Negrito (Ctrl+B)"><b>B</b></button>',
        '<button type="button" data-md="italic" title="Itálico (Ctrl+I)"><i>I</i></button>',
        '<button type="button" data-md="heading" title="Título">H</button>',
        '<button type="button" data-md="list" title="Lista">•</button>',
        '<button type="button" data-md="quote" title="Citação">❯</button>',
        '<button type="button" data-md="code" title="Código">&lt;/&gt;</button>',
        '<span class="toolbar-spacer"></span>',
        '<span class="toolbar-hint">Ctrl+S salva</span>',
      ].join('');

      const paneLabel = document.querySelector('.pane-label');
      if (paneLabel) paneLabel.after(toolbar);

      const sendShortcut = (key) => {
        const editor = document.querySelector('.cm-content');
        if (!editor) return;
        editor.focus();
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }));
      };

      toolbar.querySelectorAll('[data-md]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-md');
          if (action === 'bold') sendShortcut('b');
          else if (action === 'italic') sendShortcut('i');
          else if (action === 'heading') sendShortcut('1');
          else if (action === 'list') sendShortcut('l');
          else if (action === 'quote') sendShortcut('q');
          else if (action === 'code') sendShortcut(String.fromCharCode(96));
        });
      });
    });
  </script>
</body>
</html>`;
}

app.get('/', (c) => c.html(shellHtml()));
app.get('/client.js', (c) => {
  try {
    return clientAsset('main.js', 'text/javascript');
  } catch (err) {
    return c.text((err as Error).message, 500);
  }
});
app.get('/client.css', (c) => {
  try {
    return clientAsset('main.css', 'text/css');
  } catch (err) {
    return c.text((err as Error).message, 500);
  }
});

// --- Configuração -------------------------------------------------------

app.get('/api/settings', (c) =>
  c.json({ workspace: { root: repoRoot(), contentRoot: contentRoot() } }),
);

app.post('/api/workspace', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { path?: unknown };
    let target = typeof body.path === 'string' ? body.path : '';
    if (!target) {
      const pick = (globalThis as Record<string, unknown>).__writerWorkspacePicker;
      if (typeof pick === 'function') {
        target = String(await (pick as () => Promise<unknown>)());
      }
    }
    if (!target) return c.json({ ok: false, error: 'Nenhuma pasta informada.' }, 400);
    const root = setRepoRoot(target);
    const persist = (globalThis as Record<string, unknown>).__writerWorkspacePersist;
    if (typeof persist === 'function') {
      await (persist as (value: string) => unknown)(root);
    }
    return c.json({ ok: true, root, contentRoot: contentRoot() });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 400);
  }
});

// --- Conteúdo -------------------------------------------------------------

app.get('/api/posts', async (c) => c.json(await listPosts()));

app.get('/api/post/:id', async (c) => {
  try {
    return c.json(await readPost(c.req.param('id')));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});


// O id vai por query string para não depender do encoding de ':' ou
// outros caracteres presentes no slug gerado pelo Writer.
app.get('/api/post-banner', async (c) => {
  try {
    const id = c.req.query('post');
    if (!id) return c.json({ error: 'Post não informado.' }, 400);

    const banner = await readPostBanner(id);

    return new Response(new Uint8Array(banner.buffer), {
      status: 200,
      headers: {
        'Content-Type': banner.contentType,
        'Cache-Control': 'no-store',
        'X-Writer-Banner': banner.name,
      },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.post('/api/post', async (c) => {
  const { title } = await c.req.json();
  return c.json(await createPost(String(title ?? 'Sem título')), 201);
});

app.post('/api/post/save', async (c) => {
  const { id, file, body, changeDate } = await c.req.json();
  try {
    return c.json(await savePost(id, file, body, Boolean(changeDate)));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post('/api/post/delete', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return c.json({ error: 'Nenhum post informado.' }, 400);
  try {
    await deletePost(id);
    const subject = await commit(`post: delete ${id}`);
    await push();
    return c.json({ ok: true, subject });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

app.post('/api/post/duplicate', async (c) => {
  const { id } = await c.req.json();
  return c.json(await duplicatePost(String(id)), 201);
});

app.post('/api/post/:id/image', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'Nenhuma imagem enviada' }, 400);
  const name = await saveImage(
    c.req.param('id'),
    file.name,
    Buffer.from(await file.arrayBuffer()),
  );
  return c.json({ name, alt: path.basename(name, path.extname(name)) }, 201);
});

// --- Git ------------------------------------------------------------------

app.get('/api/git/status', async (c) => c.json(await gitStatus()));

app.post('/api/git/commit', async (c) => {
  try {
    const { message } = await c.req.json();
    const subject = await commit(typeof message === 'string' ? message : '');
    return c.json({ ok: true, subject });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

app.post('/api/git/push', async (c) => {
  try {
    return c.json({ ok: true, output: await push() });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 501);
  }
});

app.post('/api/git/pull', async (c) => {
  try {
    return c.json({ ok: true, output: await pull() });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 501);
  }
});

app.post('/api/git/check', async (c) => c.json(await canPush()));

// --- Publicação -----------------------------------------------------------

app.post('/api/publish', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: unknown;
    file?: unknown;
    body?: unknown;
    changeDate?: unknown;
  };
  const id = typeof body.id === 'string' ? body.id : '';
  try {
    await savePost(
      id,
      {
        ...(body.file as Record<string, unknown>),
        draft: false,
      } as unknown as PostMeta,
      String(body.body ?? ''),
      Boolean(body.changeDate),
    );
    const file = (body.file as { title?: unknown }) ?? {};
    const subject = await commit(`post: ${String(file.title ?? id)}`);
    await push();
    return c.json({ ok: true, subject });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export { app };

export async function startWriterServer(
  opts: { port?: number; repoRoot?: string } = {},
) {
  if (opts.repoRoot) setRepoRoot(opts.repoRoot);
  const port = opts.port ?? PORT;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`\n  ✍  Writer rodando em http://localhost:${info.port}`);
    console.log(`  Conteúdo: ${contentRoot()}\n`);
  });
  return server;
}

export default app;