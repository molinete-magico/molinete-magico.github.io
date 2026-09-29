// Operações de leitura/escrita no conteúdo Markdown.
//
// Estas funções conversam diretamente com a pasta content/ do
// monorepo — NÃO há banco de dados. O Git é quem fecha o ciclo:
// aqui apenas manipulamos arquivos de texto.

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { contentRoot, postsRoot } from './fs.ts';
import type { Post, PostListItem, PostMeta } from '../shared/types.ts';

// O gray-matter traz um parse YAML baseado em `safeLoad` (removido no
// js-yaml 4+). Passamos nossos próprios engines para usar `load`/`dump`.
const MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (input: string) => (yaml.load(input) as object) ?? {},
      stringify: (data: object) => yaml.dump(data),
    },
  },
};

// Converte um título em um slug seguro para nome de arquivo/pasta.
// Ex.: "Como comecei meu arquivo pessoal" -> "como-comecei-meu-arquivo-pessoal"
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60);
}

// Gera a data atual em YYYY-MM-DD. Usada quando uma data não é
// obrigatória (updatedDate, fallback).
export function todayDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Gera o instante de criação de um post como YYYY-MM-DDTHH:mm:ssZ.
// Usamos a hora do relógio local rotulada como UTC: assim o dia exibido
// no site (formatado em UTC) é exatamente o dia local em que o post foi
// feito, e posts publicados no mesmo dia ordenam por hora.
export function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}T${hh}:${min}:${ss}Z`;
}

// Gera a data/hora atual no formato ISO local (YYYY-MM-DDTHH:mm:ss).
// Usado apenas para gerar slugs únicos de novos posts.
export function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

// Um post pode existir de duas formas:
//   content/posts/<slug>.md                (sem imagens)
//   content/posts/<slug>/index.md          (post-pasta, com imagens junto)
// Esta função resolve qual dos dois caminhos existe (ou lança erro).
export async function resolvePostFile(id: string): Promise<string> {
  const asFile = path.join(postsRoot(), `${id}.md`);
  const asFolder = path.join(postsRoot(), id, 'index.md');
  if (await exists(asFile)) return asFile;
  if (await exists(asFolder)) return asFolder;
  throw new Error(`Post não encontrado: ${id}`);
}

/**
 * Resolve o banner usando o mesmo arquivo que identifica o post.
 * Assim não existe uma segunda lógica de caminho para o banner.
 */
export async function readPostBanner(id: string): Promise<{
  buffer: Buffer;
  contentType: string;
  name: string;
}> {
  const postFile = await resolvePostFile(id);
  const folder = path.dirname(postFile);
  const names = ['banner.webp', 'banner.png', 'banner.jpg', 'banner.jpeg'];

  for (const name of names) {
    const filePath = path.join(folder, name);
    if (await exists(filePath)) {
      const contentType =
        name.endsWith('.webp')
          ? 'image/webp'
          : name.endsWith('.png')
            ? 'image/png'
            : 'image/jpeg';

      return {
        buffer: await fs.readFile(filePath),
        contentType,
        name,
      };
    }
  }

  throw new Error('Este post não possui banner.');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Converte um PostMeta (objeto TS) em texto YAML.
// Campos vazios são omitidos para manter os arquivos limpos.
// O js-yaml aplica aspas automaticamente quando o valor exige.
function serializeMeta(meta: PostMeta): string {
  const clean = {
    title: meta.title,
    description: meta.description,
    pubDate: meta.pubDate,
    tags: (meta.tags ?? []).length > 0 ? meta.tags : undefined,
    draft: meta.draft,
    ...(meta.updatedDate ? { updatedDate: meta.updatedDate } : {}),
    ...(meta.bannerPosition ? { bannerPosition: meta.bannerPosition } : {}),
  };
  return yaml.dump(clean, { lineWidth: 90 }).trimEnd();
}

// Lista todos os posts, ordenados do mais recente para o mais antigo.
export async function listPosts(): Promise<PostListItem[]> {
  const slugs = (await fs.readdir(postsRoot())).map((name) => {
    // Se é uma pasta (post com imagens), o nome já é o slug.
    if (name.endsWith('.md')) return name.slice(0, -3);
    return name;
  });

  const items = await Promise.all(
    slugs.map(async (id) => {
      const raw = await readPostFile(id);
      return {
        id,
        title: raw.meta.title,
        pubDate: raw.meta.pubDate,
        draft: raw.meta.draft,
        tags: raw.meta.tags,
        updatedDate: raw.meta.updatedDate,
      };
    }),
  );

  return items.sort((a, b) =>
    String(b.pubDate).localeCompare(String(a.pubDate)),
  );
}

// Lê um post e devolve frontmatter + corpo Markdown.
export async function readPost(id: string): Promise<Post> {
  const filePath = await resolvePostFile(id);
  const raw = await readPostFile(id);
  return {
    id,
    path: path.relative(contentRoot(), filePath),
    body: raw.body,
    file: raw.meta,
  };
}

async function readPostFile(id: string): Promise<{ body: string; meta: PostMeta }> {
  const filePath = await resolvePostFile(id);
  const text = await fs.readFile(filePath, 'utf-8');

  // `gray-matter` separa o frontmatter (bloco --- ---) do conteúdo.
  const parsed = matter(text, MATTER_OPTIONS);
  const data = parsed.data as Record<string, unknown>;

  const meta: PostMeta = {
    title: stringOr(data.title, 'Sem título'),
    description: stringOr(data.description, ''),
    pubDate: stringOr(data.pubDate, todayDate()),
    tags: Array.isArray(data.tags)
      ? data.tags.map((t) => String(t))
      : [],
    draft: typeof data.draft === 'boolean' ? data.draft : true,
    ...(data.updatedDate
      ? { updatedDate: String(data.updatedDate).slice(0, 10) }
      : {}),
    ...(data.bannerPosition
      ? { bannerPosition: String(data.bannerPosition) }
      : {}),
  };

  return { body: parsed.content.trim(), meta };
}

// Cria um novo post como pasta (index.md), permitindo adicionar
// imagens na mesma pasta depois. Nasce como rascunho.
export async function createPost(title: string): Promise<Post> {
  const base = slugify(title) || 'sem-titulo';
  // Garante slugs únicos: adiciona -2, -3... se já existir.
  let slug = `${today()}-${base}`;
  let n = 2;
  while (true) {
    try {
      await resolvePostFile(slug);
      slug = `${today()}-${base}-${n}`;
      n += 1;
    } catch {
      break; // não existe — podemos usar
    }
  }

  const dir = path.join(postsRoot(), slug);
  await fs.mkdir(dir, { recursive: true });

  const meta: PostMeta = {
    title,
    description: '',
    pubDate: todayStamp(),
    tags: [],
    draft: true,
  };

  await fs.writeFile(
    path.join(dir, 'index.md'),
    renderMarkdown(meta, ''),
    'utf-8',
  );

  return readPost(slug);
}

// Salva um post existente (ou cria se o arquivo sumiu).
//
// A data de publicação só muda quando o usuário EDITA o campo de data
// no escritor (`changeDate`). Publicar ou salvar conteúdo NUNCA avança
// o pubDate, mesmo que o cliente mande a data "de hoje" por engano:
// se `changeDate` é falso, mantemos a data que já está no arquivo.
// Isso vale para qualquer versão do cliente — a garantia mora no servidor.
export async function savePost(
  id: string,
  file: PostMeta,
  body: string,
  changeDate = false,
): Promise<Post> {
  const filePath = await resolvePostFile(id);
  const existing = await readPost(id);
  const meta: PostMeta = {
    ...file,
    pubDate: changeDate && file.pubDate ? file.pubDate : existing.file.pubDate,
    updatedDate: file.draft ? file.updatedDate : todayDate(),
  };
  await fs.writeFile(filePath, renderMarkdown(meta, body), 'utf-8');
  return readPost(id);
}

// Compõe o texto final do arquivo: frontmatter + corpo.
function renderMarkdown(meta: PostMeta, body: string): string {
  return `---\n${serializeMeta(meta)}\n---\n\n${body.trim()}\n`;
}

// Exclui o post (arquivo ou pasta inteira, incluindo imagens).
export async function deletePost(id: string): Promise<void> {
  const filePath = await resolvePostFile(id);
  const asFolder = path.join(postsRoot(), id);
  if (await exists(asFolder)) {
    await fs.rm(asFolder, { recursive: true, force: true });
  } else {
    await fs.rm(filePath, { force: true });
  }
}

// Duplica um post: cria uma cópia com data de hoje e "(cópia)" no título.
export async function duplicatePost(id: string): Promise<Post> {
  const source = await readPost(id);
  const parts = source.file.title.split(' ');
  if (parts[parts.length - 1] === '(cópia)') parts.pop();
  const newTitle = `${parts.join(' ')} (cópia)`;
  const fresh = await createPost(newTitle);
  return savePost(fresh.id, { ...fresh.file, title: newTitle }, source.body);
}

// Guarda uma imagem dentro da pasta do post e devolve o nome do arquivo.
export async function saveImage(postId: string, filename: string, buffer: Buffer): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const folder = path.join(postsRoot(), postId);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, safe), buffer);
  return safe;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v : fallback;
}