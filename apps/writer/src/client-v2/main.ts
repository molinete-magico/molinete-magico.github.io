import './styles.css';
import { BlockEditor } from '../client/block-editor';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Post, PostListItem, PostMeta, Project, ProjectListItem, ProjectDocument, ProjectDocumentKind, ProjectMeta, ProjectDocumentMeta, GitStatus } from '../shared/types';

type OpenItem = 'post' | 'project' | ProjectDocumentKind;
type Palette = 'site' | 'paper';
const $ = <T extends HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const app = $('#app')!;
const state: {
  posts: PostListItem[]; projects: ProjectListItem[]; currentPost: Post | null;
  currentProject: Project | null; currentDoc: ProjectDocument | null;
  kind: OpenItem | null; editor: BlockEditor | null; dirty: boolean; saving: boolean;
  palette: Palette; focus: boolean; preview: boolean; git: GitStatus | null; tags: string[];
} = {
  posts: [], projects: [], currentPost: null, currentProject: null, currentDoc: null,
  kind: null, editor: null, dirty: false, saving: false,
  palette: (localStorage.getItem('writer-v2-palette') as Palette) || 'site',
  focus: false, preview: false, git: null, tags: [],
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function slugDate(value: string): string {
  if (!value) return '';
  const parts = value.slice(0, 10).split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value;
}
async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(url, { method, headers, body: payload });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof result === 'object' && result && 'error' in result ? String(result.error) : String(result || response.statusText));
  return result as T;
}
function status(message: string, mode: 'ok' | 'warn' | 'error' = 'ok') {
  const node = $('#status-line');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = mode;
}
function bodyNow() { return state.editor?.getMarkdown() ?? ''; }
function activeId() {
  if (state.kind === 'post') return state.currentPost?.id ?? '';
  if (state.kind === 'project') return state.currentProject?.id ?? '';
  return state.currentDoc?.id ?? '';
}
function activeTitle() {
  if (state.kind === 'post') return state.currentPost?.file.title ?? '';
  if (state.kind === 'project') return state.currentProject?.file.title ?? '';
  return state.currentDoc?.file.title ?? '';
}
function markDirty() {
  state.dirty = true;
  status('Alterações não salvas', 'warn');
  persistRecovery();
  if (state.preview) renderPreview();
}
function persistRecovery() {
  if (!state.kind || !activeId()) return;
  const snapshot = {
    id: activeId(), kind: state.kind, projectId: state.currentDoc?.projectId ?? state.currentProject?.id ?? '',
    body: bodyNow(), title: ($('#doc-title') as HTMLInputElement | null)?.value ?? activeTitle(),
    timestamp: Date.now(),
  };
  try { localStorage.setItem('writer-v2-recovery', JSON.stringify(snapshot)); } catch { /* storage can be unavailable */ }
}
async function restoreRecoveryIfMatches() {
  const raw = localStorage.getItem('writer-v2-recovery');
  if (!raw || !state.kind) return;
  try {
    const recovery = JSON.parse(raw) as {id?: string; kind?: string; body?: string; title?: string; timestamp?: number};
    if (recovery.id !== activeId() || recovery.kind !== state.kind) return;
    const when = recovery.timestamp ? new Date(recovery.timestamp).toLocaleString('pt-BR') : 'recentemente';
    if (window.confirm('Encontramos uma recuperação local de ' + when + '. Restaurar o texto que ainda não havia sido salvo?')) {
      ($('#doc-title') as HTMLInputElement).value = recovery.title ?? activeTitle();
      state.editor?.setMarkdown(recovery.body ?? '');
      markDirty();
    } else localStorage.removeItem('writer-v2-recovery');
  } catch { localStorage.removeItem('writer-v2-recovery'); }
}
function clearRecovery() {
  const raw = localStorage.getItem('writer-v2-recovery');
  if (!raw) return;
  try {
    const recovery = JSON.parse(raw);
    if (recovery.id === activeId() && recovery.kind === state.kind) localStorage.removeItem('writer-v2-recovery');
  } catch { localStorage.removeItem('writer-v2-recovery'); }
}
function confirmLeave(): boolean {
  if (!state.dirty) return true;
  const leave = window.confirm('Há alterações não salvas. Sair deste documento e descartar as alterações feitas desde o último salvamento?');
  if (leave) {
    state.dirty = false;
    localStorage.removeItem('writer-v2-recovery');
  }
  return leave;
}
function renderShell() {
  app.innerHTML = '<header class="v2-topbar"><a class="brand" href="/v2" id="brand-home" aria-label="Voltar à biblioteca"><span class="brand-mark">M.</span><span>WRITER<span class="brand-sub"> / ATELIÊ DE ESCRITA</span></span></a><div class="topbar-tools"><span id="status-line" role="status" aria-live="polite">Conectando ao arquivo…</span><button class="icon-button" id="palette-toggle" type="button" title="Alternar paleta de escrita" aria-label="Alternar paleta de escrita">◐</button><button class="icon-button" id="focus-toggle" type="button" title="Modo foco" aria-label="Modo foco">⤢</button><button class="icon-button" id="settings-toggle" type="button" title="Configurações do Writer" aria-label="Configurações">⚙</button></div></header><main id="v2-main"></main><div id="dialog-root"></div>';
  document.documentElement.dataset.writerPalette = state.palette;
  $('#brand-home')!.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!confirmLeave()) return;
    showLibrary();
  });
  $('#palette-toggle')!.addEventListener('click', () => {
    state.palette = state.palette === 'site' ? 'paper' : 'site';
    localStorage.setItem('writer-v2-palette', state.palette);
    document.documentElement.dataset.writerPalette = state.palette;
    status(state.palette === 'paper' ? 'Paleta neutra para escrita' : 'Paleta original do site');
  });
  $('#focus-toggle')!.addEventListener('click', () => toggleFocus());
  $('#settings-toggle')!.addEventListener('click', () => showSettings());
}
async function loadCatalog() {
  const [posts, projects] = await Promise.all([
    api<PostListItem[]>('GET', '/api/posts'),
    api<ProjectListItem[]>('GET', '/api/projects'),
  ]);
  state.posts = posts;
  state.projects = projects;
}
function renderLibrary() {
  const main = $('#v2-main')!;
  main.innerHTML = '<section class="library-page"><div class="library-intro"><div><p class="eyebrow">ARQUIVO PESSOAL / WRITER</p><h1>Biblioteca</h1><p>Encontre uma ideia, retome um rascunho ou continue um projeto.</p></div><div class="library-actions"><button class="button button-primary" id="create-post">+ Novo post</button><button class="button" id="create-project">+ Novo projeto</button></div></div><div class="library-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="library-search" type="search" placeholder="Buscar posts, tags, projetos e documentos…" aria-label="Buscar na biblioteca"></label><div class="view-filters" role="group" aria-label="Filtrar conteúdo"><button class="filter-button active" data-filter="all" aria-pressed="true">Tudo</button><button class="filter-button" data-filter="draft" aria-pressed="false">Rascunhos</button><button class="filter-button" data-filter="published" aria-pressed="false">Publicados</button><button class="filter-button" data-filter="projects" aria-pressed="false">Projetos</button></div></div><div class="library-stats"><div><span>Posts</span><strong id="count-posts">0</strong></div><div><span>Rascunhos</span><strong id="count-drafts">0</strong></div><div><span>Projetos</span><strong id="count-projects">0</strong></div><div><span>Documentos</span><strong id="count-documents">0</strong></div></div><section class="library-section"><div class="section-heading"><h2 id="library-results-title">Todos os conteúdos</h2><label class="sort-label">Ordenar por <select id="library-sort"><option value="updated">Mais recentes</option><option value="title">Título</option><option value="date">Data de publicação</option></select></label></div><div id="library-results" class="library-results"></div></section><p class="library-note">Markdown continua sendo a fonte da verdade. A biblioteca organiza o conteúdo; a publicação continua sendo uma ação explícita.</p></section>';
  $('#create-post')!.addEventListener('click', createNewPost);
  $('#create-project')!.addEventListener('click', createNewProject);
  $('#library-search')!.addEventListener('input', renderLibraryResults);
  $('#library-sort')!.addEventListener('change', renderLibraryResults);
  $('#v2-main')!.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    $('#v2-main')!.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderLibraryResults();
  }));
  renderLibraryResults();
}
function renderLibraryResults() {
  const q = ($('#library-search') as HTMLInputElement).value.trim().toLowerCase();
  const filter = $('#v2-main .filter-button.active')?.dataset.filter ?? 'all';
  const sort = ($('#library-sort') as HTMLSelectElement).value;
  $('#count-posts')!.textContent = String(state.posts.length);
  $('#count-drafts')!.textContent = String(state.posts.filter((p) => p.draft).length);
  $('#count-projects')!.textContent = String(state.projects.length);
  $('#count-documents')!.textContent = String(state.projects.reduce((sum, p) => sum + p.documents.length, 0));
  const postRows = state.posts.filter((p) => {
    const matches = !q || [p.title, p.id, ...(p.tags ?? [])].join(' ').toLowerCase().includes(q);
    return matches && (filter === 'all' || (filter === 'draft' ? p.draft : filter === 'published' ? !p.draft : false));
  }).map((p) => ({ type: 'post' as const, id: p.id, title: p.title || p.id, detail: (p.draft ? 'RASCUNHO' : 'PUBLICADO') + ' · ' + (p.tags ?? []).join(', '), date: p.pubDate, sortDate: p.updatedDate || p.pubDate, draft: p.draft }));
  const projectRows = filter === 'draft' || filter === 'published' ? [] : state.projects.filter((p) => !q || [p.title, p.id, p.description, ...p.documents.map((d) => d.title)].join(' ').toLowerCase().includes(q)).map((p) => ({ type: 'project' as const, id: p.id, title: p.title, detail: (p.type === 'rpg' ? 'SISTEMA DE RPG' : 'HISTÓRIA') + ' · ' + p.documents.length + ' DOCUMENTOS · ' + (p.published ? 'PUBLICADO' : 'RASCUNHO'), date: '', sortDate: '', draft: !p.published }));
  const rows = [...postRows, ...projectRows].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'pt-BR') : sort === 'date' ? b.date.localeCompare(a.date) : b.sortDate.localeCompare(a.sortDate));
  const target = $('#library-results')!;
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state"><span class="empty-glyph">∅</span><h3>Nada por aqui ainda</h3><p>Tente outro termo ou crie um novo conteúdo.</p><button class="button button-primary" id="empty-create">Criar post</button></div>';
    $('#empty-create')!.addEventListener('click', createNewPost);
    return;
  }
  target.innerHTML = rows.map((row) => '<article class="library-row"><span class="row-mark ' + (row.draft ? 'is-draft' : 'is-published') + '" aria-hidden="true"></span><button class="row-open" type="button" data-kind="' + row.type + '" data-id="' + esc(row.id) + '"><span class="row-title">' + esc(row.title) + '</span><span class="row-detail">' + esc(row.detail) + '</span></button><span class="row-date">' + esc(slugDate(row.date)) + '</span><button class="row-menu" type="button" data-menu="' + row.type + '" data-id="' + esc(row.id) + '" aria-label="Ações para ' + esc(row.title) + '">···</button></article>').join('');
  target.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirmLeave()) return;
    try {
      if (button.dataset.kind === 'post') await openPost(button.dataset.id!);
      else await openProject(button.dataset.id!);
    } catch (err) { status((err as Error).message, 'error'); }
  }));
  target.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.menu === 'post') showPostMenu(button.dataset.id!);
    else showProjectMenu(button.dataset.id!);
  }));
}
function renderWorkspace() {
  const main = $('#v2-main')!;
  main.innerHTML = '<section class="workspace"><div class="workspace-bar"><button class="text-button" id="back-library">← Biblioteca</button><div class="crumbs"><span id="crumb-parent">POST</span><span>/</span><span id="crumb-title">Sem título</span></div><div class="workspace-actions"><button class="button" id="preview-toggle" aria-pressed="false">Prévia</button><button class="button" id="save-document">Salvar</button><button class="button button-primary" id="publish-document">Publicar</button></div></div><div class="workspace-layout"><aside class="document-sidebar" id="document-sidebar"><div class="sidebar-label">NAVEGAÇÃO</div><div id="document-tree"></div><div class="sidebar-actions" id="document-actions"></div></aside><section class="writing-stage"><div class="document-meta"><label class="title-field"><span class="eyebrow">TÍTULO DO DOCUMENTO</span><input id="doc-title" placeholder="Dê um nome a esta ideia" autocomplete="off"></label><div id="post-fields" class="metadata-grid"><label>Descrição<input id="meta-description" placeholder="Uma frase sobre o post"></label><label>Data de publicação<input id="meta-date" type="date"></label><label class="checkbox-field"><input id="meta-draft" type="checkbox"><span>Manter como rascunho</span></label><label>Tags <input id="meta-tags" placeholder="separe tags por vírgula"></label><div class="banner-tools"><label class="file-label">Banner <input id="post-banner-file" type="file" accept="image/*"></label><label>Enquadramento <input id="banner-position" type="range" min="0" max="100" value="50"></label><label>Exibição <select id="banner-fit"><option value="cover">Recortar</option><option value="fill">Imagem inteira</option></select></label><img id="post-banner-preview" class="banner-preview" alt="Prévia do banner do post" hidden></div></div><div id="project-fields" class="metadata-grid" hidden><label>Descrição<input id="project-description" placeholder="Sobre este projeto"></label><label>Tipo<select id="project-type"><option value="story">História</option><option value="rpg">Sistema de RPG</option></select></label><label>Ordem<input id="project-order" type="number" step="1"></label><label class="checkbox-field"><input id="project-published" type="checkbox"><span>Visível no site</span></label><label class="checkbox-field"><input id="project-homepage" type="checkbox"><span>Mostrar página inicial</span></label><label>Imagem de capa <input id="project-cover" placeholder="Caminho/URL da imagem"></label><label class="file-label">Enviar capa/banner <input id="project-cover-file" type="file" accept="image/*"></label><label>Posição do banner <input id="project-banner-position" type="range" min="0" max="100" value="50"></label><img id="project-banner-preview" class="banner-preview" alt="Prévia do banner do projeto" hidden></div><div id="document-fields" class="metadata-grid" hidden><label>Ordem<input id="document-order" type="number" step="1"></label><label class="checkbox-field"><input id="document-published" type="checkbox"><span>Capítulo publicado</span></label></div></div><div class="editor-label-row"><span class="eyebrow">EDITOR EM BLOCOS</span><span class="editor-hint">Digite / para inserir um bloco · Ctrl/⌘ + S para salvar</span></div><div id="block-host" class="block-host"></div><div id="slash-menu" class="slash-menu" hidden><button data-insert-block="h1">Título 1</button><button data-insert-block="h2">Título 2</button><button data-insert-block="h3">Título 3</button><button data-insert-block="blockquote">Citação</button><button data-insert-block="pre">Código</button><button data-insert-block="ul">Lista</button><button data-insert-block="hr">Divisor</button></div><section id="preview-pane" class="preview-pane" hidden><div class="sidebar-label">PRÉVIA PUBLICADA</div><article id="preview-content" class="prose"></article></section></section></div></section>';
  $('#back-library')!.addEventListener('click', () => { if (confirmLeave()) showLibrary(); });
  $('#save-document')!.addEventListener('click', () => void saveCurrent());
  $('#publish-document')!.addEventListener('click', () => void publishCurrent());
  $('#preview-toggle')!.addEventListener('click', () => {
    state.preview = !state.preview;
    $('#preview-pane')!.hidden = !state.preview;
    $('#preview-toggle')!.setAttribute('aria-pressed', String(state.preview));
    $('#preview-toggle')!.classList.toggle('is-active', state.preview);
    if (state.preview) renderPreview();
  });
  $('#doc-title')!.addEventListener('input', markDirty);
  ['meta-description','meta-date','meta-draft','meta-tags','banner-position','banner-fit','project-description','project-type','project-order','project-published','project-homepage','project-cover','document-order','document-published','project-banner-position'].forEach((id) => {
    const el = $('#' + id);
    el?.addEventListener('change', markDirty);
    el?.addEventListener('input', markDirty);
  });
  $('#post-banner-file')!.addEventListener('change', (event) => void uploadBanner(event));
  $('#project-cover-file')!.addEventListener('change', (event) => void uploadProjectCover(event));
  $('#document-actions')!.addEventListener('click', (event) => void handleDocumentAction(event));
  $('#document-tree')!.addEventListener('click', (event) => void handleTreeClick(event));
  $('#slash-menu')!.querySelectorAll<HTMLButtonElement>('[data-insert-block]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => insertBlock(button.dataset.insertBlock!));
  });
  const host = $('#block-host')!;
  state.editor = new BlockEditor(host, () => markDirty(), uploadInlineImage, resolveImageUrl);
  $('#block-host .block-editor-toolbar')?.classList.add('v2-block-toolbar');
  bindSlashMenu();
  document.documentElement.classList.toggle('writer-focus', state.focus);
  fillMetadata();
  renderDocumentTree();
  status('Documento aberto');
}
function fillMetadata() {
  const isPost = state.kind === 'post';
  const isProject = state.kind === 'project';
  $('#post-fields')!.toggleAttribute('hidden', !isPost);
  $('#project-fields')!.toggleAttribute('hidden', !isProject);
  $('#document-fields')!.toggleAttribute('hidden', !(state.kind === 'chapter' || state.kind === 'supplement' || state.kind === 'document'));
  const title = $('#doc-title') as HTMLInputElement;
  if (isPost && state.currentPost) {
    const p = state.currentPost;
    title.value = p.file.title; state.editor?.setMarkdown(p.body);
    ($('#meta-description') as HTMLInputElement).value = p.file.description ?? '';
    ($('#meta-date') as HTMLInputElement).value = p.file.pubDate.slice(0, 10);
    ($('#meta-draft') as HTMLInputElement).checked = p.file.draft;
    ($('#meta-tags') as HTMLInputElement).value = (p.file.tags ?? []).join(', ');
    ($('#banner-position') as HTMLInputElement).value = String(parseInt(p.file.bannerPosition ?? '50', 10));
    ($('#banner-fit') as HTMLSelectElement).value = p.file.bannerFit ?? 'cover';
    state.bannerAvailable = Boolean(p.file.bannerPosition || p.file.bannerFit);
    const bannerPreview = $('#post-banner-preview') as HTMLImageElement;
    bannerPreview.hidden = true;
    bannerPreview.onload = () => { state.bannerAvailable = true; bannerPreview.hidden = false; bannerPreview.style.objectPosition = 'center ' + (p.file.bannerPosition ?? '50%'); bannerPreview.style.objectFit = p.file.bannerFit ?? 'cover'; };
    bannerPreview.onerror = () => { if (!p.file.bannerPosition && !p.file.bannerFit) state.bannerAvailable = false; bannerPreview.hidden = true; };
    bannerPreview.src = '/api/post-banner?post=' + encodeURIComponent(p.id) + '&v=' + Date.now();
  } else if (isProject && state.currentProject) {
    const p = state.currentProject;
    title.value = p.file.title; state.editor?.setMarkdown(p.body);
    ($('#project-description') as HTMLInputElement).value = p.file.description ?? '';
    ($('#project-type') as HTMLSelectElement).value = p.file.type;
    ($('#project-order') as HTMLInputElement).value = String(p.file.order ?? 0);
    ($('#project-published') as HTMLInputElement).checked = Boolean(p.file.published);
    ($('#project-homepage') as HTMLInputElement).checked = Boolean(p.file.showHomepage);
    ($('#project-cover') as HTMLInputElement).value = p.file.cover ?? '';
    ($('#project-banner-position') as HTMLInputElement).value = String(parseInt(p.file.bannerPosition ?? '50', 10));
    const bannerPreview = $('#project-banner-preview') as HTMLImageElement;
    bannerPreview.hidden = !p.file.cover;
    if (p.file.cover) {
      const bannerName = p.file.cover.split('/').pop() || 'banner.webp';
      bannerPreview.src = '/api/project-image?project=' + encodeURIComponent(p.id) + '&name=' + encodeURIComponent(bannerName) + '&v=' + Date.now();
      bannerPreview.onload = () => { bannerPreview.hidden = false; bannerPreview.style.objectPosition = 'center ' + (p.file.bannerPosition ?? '50%'); };
      bannerPreview.onerror = () => { bannerPreview.hidden = true; };
    }
  } else if (state.currentDoc) {
    title.value = state.currentDoc.file.title; state.editor?.setMarkdown(state.currentDoc.body);
    ($('#document-order') as HTMLInputElement).value = String(state.currentDoc.file.order ?? 0);
    ($('#document-published') as HTMLInputElement).checked = Boolean(state.currentDoc.file.published);
  }
  state.dirty = false;
  status('Todas as alterações salvas');
}
async function openPost(id: string) {
  state.currentPost = await api<Post>('GET', '/api/post/' + encodeURIComponent(id));
  state.currentProject = null; state.currentDoc = null; state.kind = 'post'; state.preview = false;
  renderWorkspace(); $('#crumb-parent')!.textContent = 'POST'; $('#crumb-title')!.textContent = state.currentPost.file.title;
  state.editor?.setMarkdown(state.currentPost.body); await loadGitStatus(); await restoreRecoveryIfMatches();
}
async function openProject(id: string) {
  state.currentProject = await api<Project>('GET', '/api/project/' + encodeURIComponent(id));
  state.currentPost = null; state.currentDoc = null; state.kind = 'project'; state.preview = false;
  renderWorkspace(); $('#crumb-parent')!.textContent = 'PROJETO'; $('#crumb-title')!.textContent = state.currentProject.file.title;
  state.editor?.setMarkdown(state.currentProject.body); await loadGitStatus(); await restoreRecoveryIfMatches();
}
async function openProjectDocument(projectId: string, kind: ProjectDocumentKind, id: string) {
  const query = new URLSearchParams({ project: projectId, kind, id });
  state.currentProject = await api<Project>('GET', '/api/project/' + encodeURIComponent(projectId));
  state.currentDoc = await api<ProjectDocument>('GET', '/api/project-document?' + query.toString());
  state.currentPost = null; state.kind = kind; state.preview = false;
  renderWorkspace(); $('#crumb-parent')!.textContent = state.currentProject.file.title; $('#crumb-title')!.textContent = state.currentDoc.file.title;
  state.editor?.setMarkdown(state.currentDoc.body); await loadGitStatus(); await restoreRecoveryIfMatches();
}
function renderDocumentTree() {
  const tree = $('#document-tree')!;
  const actions = $('#document-actions')!;
  if (state.kind === 'post') {
    tree.innerHTML = '<p class="tree-note">Este post é um documento independente.</p>';
    actions.innerHTML = '<button class="text-button" id="duplicate-post">Duplicar post</button><button class="text-button danger-text" id="delete-post">Excluir post</button>';
    $('#duplicate-post')!.addEventListener('click', () => void duplicateCurrentPost());
    $('#delete-post')!.addEventListener('click', () => void deleteCurrentPost());
    return;
  }
  if (!state.currentProject) return;
  tree.innerHTML = '<button class="tree-item ' + (state.kind === 'project' ? 'selected' : '') + '" data-open-project="' + esc(state.currentProject.id) + '"><span>▣</span><span>' + esc(state.currentProject.file.title) + '</span></button>' +
    state.currentProject.documents.map((d) => '<button class="tree-item ' + (state.currentDoc?.id === d.id && state.currentDoc?.kind === d.kind ? 'selected' : '') + '" data-doc-kind="' + d.kind + '" data-doc-id="' + esc(d.id) + '"><span>' + (d.kind === 'chapter' ? '§' : d.kind === 'supplement' ? '＋' : '≡') + '</span><span>' + esc(d.title) + '</span></button>').join('');
  actions.innerHTML = '<button class="text-button" data-create-doc="chapter">+ Novo capítulo</button><button class="text-button" data-create-doc="supplement">+ Novo suplemento</button>';
}
async function handleTreeClick(event: Event) {
  const target = event.target as HTMLElement;
  const projectButton = target.closest<HTMLButtonElement>('[data-open-project]');
  const docButton = target.closest<HTMLButtonElement>('[data-doc-kind]');
  if (projectButton) {
    if (!confirmLeave()) return;
    await openProject(projectButton.dataset.openProject!);
  } else if (docButton) {
    if (!confirmLeave()) return;
    await openProjectDocument(state.currentProject!.id, docButton.dataset.docKind as ProjectDocumentKind, docButton.dataset.docId!);
  }
}
async function handleDocumentAction(event: Event) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-create-doc]');
  if (!button || !state.currentProject) return;
  const kind = button.dataset.createDoc as 'chapter' | 'supplement';
  const title = window.prompt(kind === 'chapter' ? 'Título do novo capítulo:' : 'Título do suplemento:', '');
  if (!title?.trim()) return;
  try {
    const doc = await api<ProjectDocument>('POST', '/api/project-document', { projectId: state.currentProject.id, kind, title: title.trim() });
    await loadCatalog();
    await openProjectDocument(state.currentProject.id, doc.kind, doc.id);
  } catch (err) { status((err as Error).message, 'error'); }
}
function bindSlashMenu() {
  const canvas = $('#block-host .block-editor-canvas');
  if (!canvas) return;
  canvas.addEventListener('keyup', (event) => {
    const selection = window.getSelection();
    const text = selection?.anchorNode?.textContent ?? '';
    const open = event.key === '/' && (selection?.anchorOffset === 1 || text.trim() === '/');
    $('#slash-menu')!.hidden = !open;
  });
}
function insertBlock(kind: string) {
  const canvas = $('#block-host .block-editor-canvas');
  if (!canvas) return;
  const selection = window.getSelection();
  if (selection?.isCollapsed && selection.anchorNode?.nodeType === Node.TEXT_NODE) {
    const node = selection.anchorNode as Text;
    const offset = selection.anchorOffset;
    if (node.data.slice(0, offset).endsWith('/')) {
      node.deleteData(offset - 1, 1);
      selection.collapse(node, offset - 1);
    }
  }
  canvas.focus();
  const commands: Record<string, string> = { h1: 'formatBlock', h2: 'formatBlock', h3: 'formatBlock', blockquote: 'formatBlock', pre: 'formatBlock', ul: 'insertUnorderedList' };
  if (kind === 'hr') document.execCommand('insertHTML', false, '<hr><p><br></p>');
  else if (kind === 'h1' || kind === 'h2' || kind === 'h3' || kind === 'blockquote' || kind === 'pre') document.execCommand(commands[kind], false, kind === 'blockquote' ? 'blockquote' : kind);
  else if (kind === 'ul') document.execCommand('insertUnorderedList', false);
  $('#slash-menu')!.hidden = true;
  state.editor?.focus();
  markDirty();
}
function renderPreview() {
  const pane = $('#preview-content');
  if (!pane) return;
  const raw = marked.parse(bodyNow(), { async: false });
  pane.innerHTML = DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw));
}
function currentPostMeta(): PostMeta {
  const original = state.currentPost?.file;
  const date = ($('#meta-date') as HTMLInputElement).value || new Date().toISOString().slice(0, 10);
  return {
    title: ($('#doc-title') as HTMLInputElement).value.trim() || 'Sem título',
    description: ($('#meta-description') as HTMLInputElement).value.trim(),
    pubDate: original && original.pubDate.slice(0, 10) === date ? original.pubDate : date,
    tags: ($('#meta-tags') as HTMLInputElement).value.split(',').map((tag) => tag.trim()).filter(Boolean),
    draft: ($('#meta-draft') as HTMLInputElement).checked,
    ...(state.bannerAvailable ? { bannerPosition: String(($('#banner-position') as HTMLInputElement).value) + '%' } : {}),
    ...((state.bannerAvailable && ($('#banner-fit') as HTMLSelectElement).value === 'fill') ? { bannerFit: 'fill' as const } : {}),
  };
}
async function saveCurrent(): Promise<boolean> {
  if (state.saving) { status('Salvamento em andamento…', 'warn'); return false; }
  if (!state.kind) return false;
  state.saving = true; status('Salvando…', 'warn');
  try {
    const title = ($('#doc-title') as HTMLInputElement).value.trim() || 'Sem título';
    const body = bodyNow();
    if (state.kind === 'post' && state.currentPost) {
      const file = currentPostMeta();
      state.currentPost = await api<Post>('POST', '/api/post/save', { id: state.currentPost.id, file, body, changeDate: file.pubDate !== state.currentPost.file.pubDate });
    } else if (state.kind === 'project' && state.currentProject) {
      const old = state.currentProject.file;
      const file: ProjectMeta = { ...old, title, description: ($('#project-description') as HTMLInputElement).value.trim(), type: ($('#project-type') as HTMLSelectElement).value === 'rpg' ? 'rpg' : 'story', order: Number(($('#project-order') as HTMLInputElement).value) || 0, published: ($('#project-published') as HTMLInputElement).checked, showHomepage: ($('#project-homepage') as HTMLInputElement).checked, cover: ($('#project-cover') as HTMLInputElement).value.trim() || undefined, ...((($('#project-cover') as HTMLInputElement).value.trim()) ? { bannerPosition: String(($('#project-banner-position') as HTMLInputElement).value) + '%' } : {}) };
      state.currentProject = await api<Project>('POST', '/api/project/save', { id: state.currentProject.id, file, body });
    } else if (state.currentDoc && state.currentProject) {
      const file: ProjectDocumentMeta = { ...state.currentDoc.file, title, order: Number(($('#document-order') as HTMLInputElement).value) || 0, published: ($('#document-published') as HTMLInputElement).checked };
      state.currentDoc = await api<ProjectDocument>('POST', '/api/project-document/save', { projectId: state.currentDoc.projectId, kind: state.currentDoc.kind, id: state.currentDoc.id, file, body });
    }
    state.dirty = false; clearRecovery(); await loadCatalog(); renderDocumentTree(); status('Salvo com sucesso');
    return true;
  } catch (err) { status((err as Error).message, 'error'); return false; }
  finally { state.saving = false; }
}
async function publishCurrent() {
  if (!(await saveCurrent())) return;
  try {
    if (state.kind === 'post' && state.currentPost) {
      const file = { ...currentPostMeta(), draft: false };
      ($('#meta-draft') as HTMLInputElement).checked = false;
      await api('POST', '/api/publish', { id: state.currentPost.id, file, body: bodyNow(), changeDate: file.pubDate !== state.currentPost.file.pubDate });
      state.currentPost.file = { ...state.currentPost.file, ...file };
    } else {
      const label = state.kind === 'project' ? 'project: ' + activeTitle() : 'project document: ' + activeTitle();
      await api('POST', '/api/git/commit', { message: label });
      await api('POST', '/api/git/push');
    }
    await loadCatalog(); await loadGitStatus(); status('Publicação concluída');
  } catch (err) { status((err as Error).message, 'error'); }
}
async function createNewPost() {
  const title = window.prompt('Título do novo post:', 'Sem título');
  if (!title?.trim()) return;
  try {
    const created = await api<Post>('POST', '/api/post', { title: title.trim() });
    await loadCatalog(); await openPost(created.id);
  } catch (err) { status((err as Error).message, 'error'); }
}
async function createNewProject() {
  const title = window.prompt('Nome do projeto:');
  if (!title?.trim()) return;
  const type = window.prompt('Tipo do projeto: rpg ou story', 'story')?.trim().toLowerCase() === 'rpg' ? 'rpg' : 'story';
  try {
    const project = await api<Project>('POST', '/api/project', { title: title.trim(), type });
    await loadCatalog(); await openProject(project.id);
  } catch (err) { status((err as Error).message, 'error'); }
}
async function prepareImageForUpload(file: File): Promise<File> {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) return file;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('Formato não suportado. Use JPG, PNG, WebP, AVIF ou GIF.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Não foi possível abrir a imagem para conversão WebP.'); }
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar a imagem.');
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Falha na conversão WebP.')), 'image/webp', .82));
    const base = file.name.replace(/\.[^.]+$/, '').normalize('NFC') || 'imagem';
    return new File([blob], base + '.webp', { type: 'image/webp', lastModified: Date.now() });
  } finally { bitmap.close(); }
}
async function uploadInlineImage(file: File) {
  const prepared = await prepareImageForUpload(file);
  const form = new FormData(); form.append('file', prepared);
  if (state.kind === 'post' && state.currentPost) {
    const image = await api<{name: string; alt: string}>('POST', '/api/post/' + encodeURIComponent(state.currentPost.id) + '/image', form);
    return image;
  }
  if (state.kind === 'project' && state.currentProject) {
    const image = await api<{name: string; alt: string}>('POST', '/api/project/' + encodeURIComponent(state.currentProject.id) + '/image', form);
    return image;
  }
  if (state.currentDoc && state.currentProject) {
    form.append('projectId', state.currentDoc.projectId); form.append('kind', state.currentDoc.kind); form.append('id', state.currentDoc.id);
    return await api<{name: string; alt: string}>('POST', '/api/project-document/image', form);
  }
  return null;
}
function resolveImageUrl(src: string) {
  if (!src || /^(?:[a-z]+:|\/\/|\/|#)/i.test(src)) return src;
  const name = src.split(/[?#]/, 1)[0].replace(/^\.\//, '');
  if (!name || name.includes('..') || name.includes('/')) return src;
  const q = 'name=' + encodeURIComponent(name);
  if (state.kind === 'post' && state.currentPost) return '/api/post-image?post=' + encodeURIComponent(state.currentPost.id) + '&' + q;
  if (state.kind === 'project' && state.currentProject) return '/api/project-image?project=' + encodeURIComponent(state.currentProject.id) + '&' + q;
  if (state.currentDoc) return '/api/project-document/image-file?project=' + encodeURIComponent(state.currentDoc.projectId) + '&kind=' + encodeURIComponent(state.currentDoc.kind) + '&id=' + encodeURIComponent(state.currentDoc.id) + '&' + q;
  return src;
}
async function uploadBanner(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !state.currentPost) return;
  try {
    const form = new FormData(); form.append('file', await prepareImageForUpload(file));
    await api('POST', '/api/post/' + encodeURIComponent(state.currentPost.id) + '/banner', form);
    state.bannerAvailable = true;
    const preview = $('#post-banner-preview') as HTMLImageElement;
    preview.src = '/api/post-banner?post=' + encodeURIComponent(state.currentPost.id) + '&v=' + Date.now(); preview.hidden = false;
    markDirty(); status('Banner enviado; salve para registrar o enquadramento');
  }
  catch (err) { status((err as Error).message, 'error'); }
  finally { input.value = ''; }
}
async function uploadProjectCover(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !state.currentProject) return;
  try {
    const form = new FormData(); form.append('file', await prepareImageForUpload(file));
    const result = await api<{cover: string}>('POST', '/api/project/' + encodeURIComponent(state.currentProject.id) + '/banner', form);
    ($('#project-cover') as HTMLInputElement).value = result.cover;
    const preview = $('#project-banner-preview') as HTMLImageElement;
    const name = result.cover.split('/').pop() || 'banner.webp';
    preview.src = '/api/project-image?project=' + encodeURIComponent(state.currentProject.id) + '&name=' + encodeURIComponent(name) + '&v=' + Date.now();
    preview.hidden = false; state.currentProject.file.bannerPosition = String(($('#project-banner-position') as HTMLInputElement).value) + '%';
    markDirty(); status('Banner do projeto enviado');
  } catch (err) { status((err as Error).message, 'error'); }
  finally { input.value = ''; }
}
async function duplicateCurrentPost() {
  if (!state.currentPost || !confirmLeave()) return;
  try { const post = await api<Post>('POST', '/api/post/duplicate', { id: state.currentPost.id }); await loadCatalog(); await openPost(post.id); }
  catch (err) { status((err as Error).message, 'error'); }
}
async function deleteCurrentPost() {
  if (!state.currentPost || !window.confirm('Excluir este post? Esta ação também tenta registrar e enviar a exclusão pelo Git.')) return;
  try { await api('POST', '/api/post/delete', { id: state.currentPost.id }); state.currentPost = null; state.kind = null; await loadCatalog(); showLibrary(); }
  catch (err) { status((err as Error).message, 'error'); }
}
function showPostMenu(id: string) {
  const choice = window.prompt('Ações: digite "duplicar" ou "excluir".');
  if (choice === 'duplicar') void (async () => { try { const p = await api<Post>('POST', '/api/post/duplicate', { id }); await loadCatalog(); await openPost(p.id); } catch (e) { status((e as Error).message, 'error'); } })();
  if (choice === 'excluir' && window.confirm('Excluir este post e enviar a alteração ao GitHub?')) void (async () => { try { await api('POST', '/api/post/delete', { id }); await loadCatalog(); showLibrary(); } catch (e) { status((e as Error).message, 'error'); } })();
}
async function showProjectMenu(id: string) {
  const choice = window.prompt('Ações do projeto: digite "abrir", "capítulo" ou "suplemento".');
  if (choice === 'abrir') { await openProject(id); return; }
  if (choice !== 'capítulo' && choice !== 'suplemento') return;
  try {
    const project = await api<Project>('GET', '/api/project/' + encodeURIComponent(id));
    const kind = choice === 'capítulo' ? 'chapter' : 'supplement';
    const title = window.prompt(kind === 'chapter' ? 'Título do capítulo:' : 'Título do suplemento:');
    if (!title?.trim()) return;
    const doc = await api<ProjectDocument>('POST', '/api/project-document', { projectId: id, kind, title: title.trim() });
    await loadCatalog();
    await openProjectDocument(project.id, doc.kind, doc.id);
  } catch (err) { status((err as Error).message, 'error'); }
}
function toggleFocus() {
  state.focus = !state.focus;
  document.documentElement.classList.toggle('writer-focus', state.focus);
  $('#focus-toggle')?.classList.toggle('is-active', state.focus);
  status(state.focus ? 'Modo foco ativado · Esc para sair' : 'Modo foco desativado');
}
async function loadGitStatus() {
  try {
    state.git = await api<GitStatus>('GET', '/api/git/status');
    const node = $('#status-line');
    if (node && !state.dirty) node.textContent = 'Git · ' + state.git.branch + ' · ' + (state.git.dirty.length ? state.git.dirty.length + ' arquivo(s) alterado(s)' : 'limpo');
  } catch { /* Git status is supplemental */ }
}
function showSettings() {
  const root = $('#dialog-root')!;
  root.innerHTML = '<div class="dialog-backdrop"><section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="dialog-heading"><h2 id="settings-title">Configurações do Writer</h2><button id="close-settings" class="icon-button" aria-label="Fechar">×</button></div><p>Estas ações operam no repositório local configurado para o Writer.</p><label>Diretório do repositório<input id="workspace-path" placeholder="/caminho/para/molinete-magico.github.io"></label><div class="settings-actions"><button class="button" id="set-workspace">Usar diretório</button><button class="button" id="git-pull">Atualizar do Git</button><button class="button" id="git-push">Enviar commits</button></div><p id="settings-status" role="status"></p></section></div>';
  $('#close-settings')!.addEventListener('click', () => root.replaceChildren());
  $('#set-workspace')!.addEventListener('click', async () => {
    const path = ($('#workspace-path') as HTMLInputElement).value.trim();
    if (!path) return;
    try { const result = await api<{root: string}>('POST', '/api/workspace', { path }); ($('#settings-status')!).textContent = 'Workspace: ' + result.root; await loadCatalog(); }
    catch (err) { ($('#settings-status')!).textContent = (err as Error).message; }
  });
  const commitButton = document.createElement('button');
  commitButton.className = 'button';
  commitButton.id = 'git-commit';
  commitButton.textContent = 'Criar commit local';
  $('.settings-actions')!.append(commitButton);
  commitButton.addEventListener('click', async () => {
    const message = window.prompt('Mensagem do commit:', 'writer: salvar alterações');
    if (!message?.trim()) return;
    try { await api('POST', '/api/git/commit', { message: message.trim() }); ($('#settings-status')!).textContent = 'Commit criado.'; await loadGitStatus(); }
    catch (err) { ($('#settings-status')!).textContent = (err as Error).message; }
  });
  $('#git-pull')!.addEventListener('click', async () => {
    if (!window.confirm('Buscar alterações remotas? Alterações locais não salvas podem entrar em conflito.')) return;
    try { await api('POST', '/api/git/pull', {}); await loadCatalog(); ($('#settings-status')!).textContent = 'Atualização concluída.'; await loadGitStatus(); }
    catch (err) { ($('#settings-status')!).textContent = (err as Error).message; }
  });
  $('#git-push')!.addEventListener('click', async () => {
    try { await api('POST', '/api/git/push', {}); ($('#settings-status')!).textContent = 'Push concluído.'; await loadGitStatus(); }
    catch (err) { ($('#settings-status')!).textContent = (err as Error).message; }
  });
}
function showLibrary() {
  state.editor = null; state.currentPost = null; state.currentProject = null; state.currentDoc = null; state.kind = null; state.preview = false;
  document.documentElement.classList.remove('writer-focus');
  void loadCatalog().then(() => { renderLibrary(); status('Biblioteca atualizada'); }).catch((err) => status((err as Error).message, 'error'));
}
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); void saveCurrent();
  }
  if (event.key === 'Escape' && state.focus) toggleFocus();
});
renderShell();
showLibrary();