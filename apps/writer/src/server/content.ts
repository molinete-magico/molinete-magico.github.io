// Operações de leitura/escrita no conteúdo Markdown.
//
// Estas funções conversam diretamente com a pasta content/ do
// monorepo — NÃO há banco de dados. O Git é quem fecha o ciclo:
// aqui apenas manipulamos arquivos de texto.

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { contentRoot, postsRoot, projectsRoot, repoRoot } from './fs.ts';
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

// ------------------------------------------------------------------
// Projetos e documentos Markdown
// ------------------------------------------------------------------

export type ProjectKind = 'rpg' | 'story';
export type ProjectDocumentKind = 'document' | 'chapter' | 'supplement';

export interface ProjectMeta {
  title: string;
  type: ProjectKind;
  description: string;
  cover?: string;
  bannerPosition?: string;
  published: boolean;
  showHomepage: boolean;
  order: number;
  [key: string]: unknown;
}

export interface ProjectDocumentMeta {
  title: string;
  published: boolean;
  order: number;
  [key: string]: unknown;
}

export interface ProjectDocumentListItem {
  id: string;
  kind: ProjectDocumentKind;
  title: string;
  published: boolean;
  order: number;
  path: string;
}

export interface ProjectListItem {
  id: string;
  title: string;
  type: ProjectKind;
  description: string;
  published: boolean;
  cover?: string;
  documents: ProjectDocumentListItem[];
}

export interface Project {
  id: string;
  path: string;
  body: string;
  file: ProjectMeta;
  documents: ProjectDocumentListItem[];
}

export interface ProjectDocument {
  projectId: string;
  id: string;
  kind: ProjectDocumentKind;
  path: string;
  body: string;
  file: ProjectDocumentMeta;
}

function safeSegment(value: string, label: string): string {
  const segment = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(segment)) {
    throw new Error(`Identificador de ${label} inválido.`);
  }
  return segment;
}

async function projectFile(id: string): Promise<string> {
  const slug = safeSegment(id, 'projeto');
  const file = path.join(projectsRoot(), slug, 'project.md');
  if (!(await exists(file))) throw new Error(`Projeto não encontrado: ${slug}`);
  return file;
}

function parseMarkdownFile(text: string): { body: string; data: Record<string, unknown> } {
  const parsed = matter(text, MATTER_OPTIONS);
  return { body: parsed.content.trim(), data: parsed.data as Record<string, unknown> };
}

function renderContentFile(meta: Record<string, unknown>, body: string): string {
  return `---\n${yaml.dump(meta, { lineWidth: 90 }).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function projectMeta(data: Record<string, unknown>, id: string): ProjectMeta {
  const type = data.type === 'rpg' ? 'rpg' : 'story';
  return {
    ...data,
    title: stringOr(data.title, id),
    type,
    description: typeof data.description === 'string' ? data.description : '',
    published: typeof data.published === 'boolean' ? data.published : false,
    showHomepage: typeof data.showHomepage === 'boolean' ? data.showHomepage : true,
    order: typeof data.order === 'number' ? data.order : 0,
    ...(typeof data.cover === 'string' ? { cover: data.cover } : {}),
    ...(typeof data.bannerPosition === 'string' ? { bannerPosition: data.bannerPosition } : {}),
  };
}

function documentLocation(projectId: string, kind: ProjectDocumentKind, id = ''): string {
  const project = safeSegment(projectId, 'projeto');
  const base = path.join(projectsRoot(), project);
  if (kind === 'document') {
    if (id && id !== 'document') throw new Error('Identificador inválido para o documento principal.');
    return path.join(base, 'document.md');
  }
  const slug = safeSegment(id, 'documento');
  const folder = kind === 'chapter' ? 'chapters' : 'supplements';
  return path.join(base, folder, `${slug}.md`);
}

function documentMeta(data: Record<string, unknown>, id: string): ProjectDocumentMeta {
  return {
    ...data,
    title: stringOr(data.title, id || 'Documento principal'),
    published: typeof data.published === 'boolean' ? data.published : true,
    order: typeof data.order === 'number' ? data.order : 0,
  };
}

async function listProjectDocuments(projectId: string): Promise<ProjectDocumentListItem[]> {
  const base = path.join(projectsRoot(), safeSegment(projectId, 'projeto'));
  const result: ProjectDocumentListItem[] = [];
  const readOne = async (file: string, kind: ProjectDocumentKind, id: string) => {
    if (!(await exists(file))) return;
    const parsed = parseMarkdownFile(await fs.readFile(file, 'utf-8'));
    const meta = documentMeta(parsed.data, id);
    result.push({
      id: kind === 'document' ? 'document' : id,
      kind,
      title: meta.title,
      published: meta.published,
      order: meta.order,
      path: path.relative(contentRoot(), file).split(path.sep).join('/'),
    });
  };

  await readOne(path.join(base, 'document.md'), 'document', 'document');
  for (const [folder, kind] of [['chapters', 'chapter'], ['supplements', 'supplement']] as const) {
    const dir = path.join(base, folder);
    if (!(await exists(dir))) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const id = entry.name.slice(0, -3);
      await readOne(path.join(dir, entry.name), kind, id);
    }
  }
  return result.sort((a, b) => {
    const group = (kind: ProjectDocumentKind) => kind === 'document' ? 0 : kind === 'chapter' ? 1 : 2;
    return group(a.kind) - group(b.kind) || a.order - b.order || a.title.localeCompare(b.title, 'pt-BR');
  });
}

export async function listProjects(): Promise<ProjectListItem[]> {
  await fs.mkdir(projectsRoot(), { recursive: true });
  const entries = await fs.readdir(projectsRoot(), { withFileTypes: true });
  const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const id = entry.name;
    const file = path.join(projectsRoot(), id, 'project.md');
    if (!(await exists(file))) return null;
    const parsed = parseMarkdownFile(await fs.readFile(file, 'utf-8'));
    const meta = projectMeta(parsed.data, id);
    return {
      id,
      title: meta.title,
      type: meta.type,
      description: meta.description,
      published: meta.published,
      ...(meta.cover ? { cover: meta.cover } : {}),
      documents: await listProjectDocuments(id),
    } satisfies ProjectListItem;
  }));
  return projects.filter((project): project is ProjectListItem => project !== null)
    .sort((a, b) => Number(b.published) - Number(a.published) || a.title.localeCompare(b.title, 'pt-BR'));
}

export async function readProject(id: string): Promise<Project> {
  const filePath = await projectFile(id);
  const parsed = parseMarkdownFile(await fs.readFile(filePath, 'utf-8'));
  return {
    id,
    path: path.relative(contentRoot(), filePath).split(path.sep).join('/'),
    body: parsed.body,
    file: projectMeta(parsed.data, id),
    documents: await listProjectDocuments(id),
  };
}

export async function createProject(title: string, type: ProjectKind = 'story'): Promise<Project> {
  const cleanTitle = title.trim() || 'Novo projeto';
  const base = slugify(cleanTitle) || 'novo-projeto';
  let id = base;
  let suffix = 2;
  while (await exists(path.join(projectsRoot(), id))) {
    id = `${base}-${suffix++}`;
  }
  const dir = path.join(projectsRoot(), id);
  await fs.mkdir(path.join(dir, 'chapters'), { recursive: true });
  await fs.mkdir(path.join(dir, 'supplements'), { recursive: true });
  const meta: ProjectMeta = {
    title: cleanTitle,
    type,
    description: '',
    published: false,
    showHomepage: true,
    order: 0,
  };
  await fs.writeFile(path.join(dir, 'project.md'), renderContentFile(meta, ''), 'utf-8');
  await fs.writeFile(
    path.join(dir, 'document.md'),
    renderContentFile({ title: 'Documento principal', published: true }, ''),
    'utf-8',
  );
  return readProject(id);
}

export async function saveProject(
  id: string,
  file: ProjectMeta,
  body: string,
): Promise<Project> {
  const filePath = await projectFile(id);
  const existing = parseMarkdownFile(await fs.readFile(filePath, 'utf-8'));
  const next: ProjectMeta = {
    ...existing.data,
    ...file,
    title: file.title.trim() || id,
    type: file.type === 'rpg' ? 'rpg' : 'story',
    description: file.description ?? '',
    published: Boolean(file.published),
    showHomepage: Boolean(file.showHomepage),
    order: Number.isFinite(file.order) ? file.order : 0,
  };
  if (typeof next.cover !== 'string' || !next.cover.trim()) delete next.cover;
  if (typeof next.bannerPosition !== 'string' || !next.bannerPosition.trim()) delete next.bannerPosition;
  await fs.writeFile(filePath, renderContentFile(next, body), 'utf-8');
  return readProject(id);
}

export async function saveProjectBanner(
  projectId: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  await projectFile(projectId);
  const slug = safeSegment(projectId, 'projeto');
  const extension = path.extname(filename).toLowerCase();
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
  if (!allowedExtensions.has(extension)) {
    throw new Error('Formato de imagem inválido. Use JPG, PNG, WEBP, GIF ou AVIF.');
  }
  if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
    throw new Error('A imagem deve ter até 15 MB.');
  }

  const name = `banner${extension}`;
  const contentDir = path.join(projectsRoot(), slug);
  const publicDir = path.join(repoRoot(), 'apps', 'blog', 'public', 'projects', slug);
  await fs.mkdir(contentDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(contentDir, name), buffer),
    fs.writeFile(path.join(publicDir, name), buffer),
  ]);

  return `/projects/${slug}/${name}`;
}

export async function readProjectDocument(
  projectId: string,
  kind: ProjectDocumentKind,
  id = 'document',
): Promise<ProjectDocument> {
  await projectFile(projectId);
  const filePath = documentLocation(projectId, kind, id);
  if (!(await exists(filePath))) throw new Error('Documento não encontrado.');
  const parsed = parseMarkdownFile(await fs.readFile(filePath, 'utf-8'));
  return {
    projectId,
    id: kind === 'document' ? 'document' : id,
    kind,
    path: path.relative(contentRoot(), filePath).split(path.sep).join('/'),
    body: parsed.body,
    file: documentMeta(parsed.data, id),
  };
}

export async function createProjectDocument(
  projectId: string,
  kind: Exclude<ProjectDocumentKind, 'document'>,
  title: string,
): Promise<ProjectDocument> {
  await projectFile(projectId);
  const base = slugify(title) || (kind === 'chapter' ? 'novo-capitulo' : 'novo-complemento');
  const folder = path.join(projectsRoot(), safeSegment(projectId, 'projeto'), kind === 'chapter' ? 'chapters' : 'supplements');
  await fs.mkdir(folder, { recursive: true });
  let id = base;
  let suffix = 2;
  while (await exists(path.join(folder, `${id}.md`))) id = `${base}-${suffix++}`;
  const meta: ProjectDocumentMeta = {
    title: title.trim() || (kind === 'chapter' ? 'Novo capítulo' : 'Novo complemento'),
    published: false,
    order: 0,
  };
  const filePath = path.join(folder, `${id}.md`);
  await fs.writeFile(filePath, renderContentFile(meta, ''), 'utf-8');
  return readProjectDocument(projectId, kind, id);
}

export async function saveProjectDocument(
  projectId: string,
  kind: ProjectDocumentKind,
  id: string,
  file: ProjectDocumentMeta,
  body: string,
): Promise<ProjectDocument> {
  const filePath = documentLocation(projectId, kind, id);
  if (!(await exists(filePath))) throw new Error('Documento não encontrado.');
  const existing = parseMarkdownFile(await fs.readFile(filePath, 'utf-8'));
  const next: ProjectDocumentMeta = {
    ...existing.data,
    ...file,
    title: file.title.trim() || id,
    published: Boolean(file.published),
    order: Number.isFinite(file.order) ? file.order : 0,
  };
  await fs.writeFile(filePath, renderContentFile(next, body), 'utf-8');
  return readProjectDocument(projectId, kind, id);
}
