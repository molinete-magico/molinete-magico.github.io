// Interface do Writer (cliente, roda no navegador local).
//
// O frontend é TypeScript puro compilado com esbuild — sem framework.
// CodeMirror cuida do editor e `marked` + DOMPurify do preview.
// Quando você salva/publica, o código chama a API local (Hono),
// que escreve os arquivos Markdown e executa o Git.

import './styles.css';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Prec } from '@codemirror/state';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Post, PostListItem, GitStatus, PostMeta, Project, ProjectListItem, ProjectDocument, ProjectDocumentKind, ProjectMeta, ProjectDocumentMeta } from '../shared/types';

// ------------------------------------------------------------------
// Estado global da aplicação.
// ------------------------------------------------------------------
const state: {
  posts: PostListItem[];
  current: Post | null;
  git: GitStatus | null;
  filter: string;
  dirty: { title: boolean; body: boolean; meta: boolean };
  savedAt: Date | null;
  tagsDirty: boolean;
  bannerAvailable: boolean;
  projectMode: boolean;
  projects: ProjectListItem[];
  currentProject: Project | null;
  currentProjectDoc: ProjectDocument | null;
  projectItemKind: 'project' | ProjectDocumentKind;
} = {
  posts: [],
  current: null,
  git: null,
  filter: '',
  dirty: { title: false, body: false, meta: false },
  savedAt: null,
  tagsDirty: false,
  bannerAvailable: false,
  projectMode: false,
  projects: [],
  currentProject: null,
  currentProjectDoc: null,
  projectItemKind: 'project',
};

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);

function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error ?? `Falha ${method} ${url}`);
  }
  return data as T;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------
// Renderização da interface (DOM puro)
// ------------------------------------------------------------------
const app = $('#app')!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <strong>Writer</strong>
      <span class="git-badge" id="git-badge">…</span>
    </div>
    <div class="actions">
      <button id="btn-mode" class="ghost" aria-pressed="false">Projetos</button>
      <button id="btn-new" class="ghost">+ Novo post</button>
      <span id="save-state" class="save-state" role="status"></span>
      <button id="btn-save" class="ghost" disabled>Salvar</button>
      <button id="btn-publish" class="primary" disabled>Publicar</button>
      <button id="btn-settings" class="ghost" title="Configurações">Config</button>
    </div>
  </header>

  <aside class="sidebar">
    <input id="search" type="search" placeholder="Pesquisar posts..." aria-label="Pesquisar conteúdo" />
    <div id="project-actions" class="project-actions" hidden>
      <button id="btn-new-chapter" class="ghost tiny">+ capítulo</button>
      <button id="btn-new-supplement" class="ghost tiny">+ complemento</button>
    </div>
    <div id="git-panel" class="git-panel"></div>
    <ul id="post-list" class="post-list"></ul>
    <ul id="project-list" class="post-list project-list" hidden></ul>
  </aside>

  <main id="editor" class="editor">
    <div class="empty" id="empty-state">
      <p>Selecione um post na lista ou crie um novo.</p>
    </div>
    <div class="editor-view" id="editor-view" hidden>
      <input id="field-title" class="title-input" type="text" placeholder="Título do post" aria-label="Título do post" />

      <div id="post-meta" class="meta-row">
        <label>Data
          <input id="field-date" type="date" />
        </label>
        <label class="draft-check">
          <input id="field-draft" type="checkbox" /> Rascunho
        </label>
        <input id="field-tags" type="text" placeholder="Adicionar tag e teclar Enter" aria-label="Adicionar tag" />
        <ul id="tag-chips" class="tag-chips"></ul>
      </div>

      <textarea id="field-description" placeholder="Descrição curta (usada nos cards e SEO)" rows="2" aria-label="Descrição"></textarea>

      <div id="post-banner-actions" class="post-banner-actions">
        <button id="btn-post-banner" class="ghost tiny" type="button">Adicionar banner</button>
        <input id="file-post-banner" type="file" accept="image/jpeg,image/png,image/webp" hidden />
        <span class="pane-hint">banner.jpg / .png / .webp — salvo junto ao post</span>
      </div>

      <section id="project-meta" class="project-meta" hidden>
        <div class="project-fields">
          <label>Tipo
            <select id="field-project-type">
              <option value="story">História</option>
              <option value="rpg">RPG</option>
            </select>
          </label>
          <label class="project-check"><input id="field-project-published" type="checkbox" /> Projeto publicado</label>
          <label class="project-check"><input id="field-project-homepage" type="checkbox" /> Exibir documento principal na entrada</label>
          <label>Ordem <input id="field-project-order" type="number" min="0" step="1" /></label>
          <label class="project-cover-field">Caminho da capa <input id="field-project-cover" type="text" placeholder="/projects/meu-projeto/banner.jpg" /></label>
          <button id="btn-project-banner" class="ghost tiny" type="button">Adicionar banner</button>
          <input id="file-project-banner" type="file" accept="image/*" hidden />
        </div>
        <p class="pane-hint">Os arquivos permanecem em content/projects/ e são publicados pelo Git.</p>
      </section>

      <section id="project-doc-meta" class="project-meta" hidden>
        <div class="project-fields">
          <label class="project-check"><input id="field-doc-published" type="checkbox" /> Documento publicado</label>
          <label>Ordem <input id="field-doc-order" type="number" min="0" step="1" /></label>
        </div>
        <p id="project-doc-path" class="pane-hint"></p>
      </section>

      <section id="banner-editor" class="banner-editor" hidden>
        <div class="banner-editor-head">
          <div>
            <strong>Banner</strong>
            <span id="banner-status" class="pane-hint">arraste a imagem para escolher o enquadramento</span>
          </div>
          <output id="banner-position-value">50%</output>
        </div>
        <div id="banner-crop" class="banner-crop" tabindex="0" aria-label="Enquadramento do banner">
          <img id="banner-crop-image" class="banner-crop-image" alt="" draggable="false" />
          <div class="banner-crop-fade" aria-hidden="true"></div>
        </div>
        <input id="field-banner-position" type="range" min="0" max="100" value="50" step="1" aria-label="Posição vertical do banner" />
      </section>

      <div class="split">
        <div class="pane">
          <div class="pane-label">
            <span>Escrita</span>
            <button id="btn-image" class="ghost tiny">+ imagem</button>
          </div>
          <input id="file-image" type="file" accept="image/*" hidden />
          <div id="cm-host" class="cm-host"></div>
        </div>
        <div id="split-divider" class="split-divider" role="separator" aria-orientation="vertical" aria-label="Redimensionar escrita e preview" tabindex="0"></div>
        <div class="pane">
          <div class="pane-label">
            <span>Preview</span>
            <span class="pane-hint">arraste a divisão</span>
          </div>
          <article id="preview" class="preview prose"></article>
        </div>
      </div>
    </div>
  </main>
`;

// ---------------------------------------------------------------
// CodeMirror: editor Markdown
// ---------------------------------------------------------------
let cmView: EditorView | null = null;

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '14px', lineHeight: '1.7' },
    '.cm-content': { maxWidth: 'none', padding: '12px 16px' },
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
  },
  { dark: true },
);

function currentBody(): string {
  return cmView?.state.doc.toString() ?? '';
}

function createEditor(initialDoc: string, onChange: (doc: string) => void) {
  // `basicSetup` já inclui undo/redo, seleção, busca, numeração etc.
  const cm = new EditorView({
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        // Atalhos de Markdown: Ctrl+B, Ctrl+I, Ctrl+K, etc.
        keymap.of(markdownKeymap),
        // Highlighting de sintaxe Markdown + linguagens para blocos de código
        markdown({ codeLanguages: languages }),
        // Ctrl+S salva direto podem evitar depender dos botões
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                saveCurrent();
                return true;
              },
            },
          ]),
        ),
        keymap.of(defaultKeymap),
        editorTheme,
        // Sincroniza o conteúdo digitado no editor com o estado da app
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            state.dirty.body = true;
            onChange(u.state.doc.toString());
            scheduleAutosave();
            setSaved(false, 'Alterações não salvas');
          }
        }),
      ],
    }),
    parent: $('#cm-host')!,
  });
  return cm;
}

// ------------------------------------------------------------------
// Preview Markdown (marked + sanitização DOMPurify)
// ------------------------------------------------------------------
const preview = $('#preview')!;

marked.setOptions({ gfm: true, breaks: true });

function renderPreview() {
  const raw = marked.parse(currentBody() || '*Escreva algo…*');
  preview.innerHTML = DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw));
}

const renderPreviewDebounced = debounce(renderPreview, 250);

// ------------------------------------------------------------------
// Lista de posts
// ------------------------------------------------------------------
const postList = $('#post-list')!;
const projectList = $('#project-list')!;
const projectActions = $('#project-actions')!;
const postMeta = $('#post-meta')!;
const projectMetaPanel = $('#project-meta')!;
const projectDocMetaPanel = $('#project-doc-meta')!;
const fieldProjectType = $('#field-project-type') as HTMLSelectElement;
const fieldProjectPublished = $('#field-project-published') as HTMLInputElement;
const fieldProjectHomepage = $('#field-project-homepage') as HTMLInputElement;
const fieldProjectOrder = $('#field-project-order') as HTMLInputElement;
const fieldProjectCover = $('#field-project-cover') as HTMLInputElement;
const postBannerActions = $('#post-banner-actions')!;
const btnPostBanner = $('#btn-post-banner') as HTMLButtonElement;
const filePostBanner = $('#file-post-banner') as HTMLInputElement;
const btnProjectBanner = $('#btn-project-banner') as HTMLButtonElement;
const fileProjectBanner = $('#file-project-banner') as HTMLInputElement;
const fieldDocPublished = $('#field-doc-published') as HTMLInputElement;
const fieldDocOrder = $('#field-doc-order') as HTMLInputElement;
const projectDocPath = $('#project-doc-path')!;
const search = $('#search')! as HTMLInputElement;
const fieldTitle = $('#field-title') as HTMLInputElement;
const fieldDate = $('#field-date') as HTMLInputElement;
const fieldDraft = $('#field-draft') as HTMLInputElement;
const fieldDescription = $('#field-description') as HTMLTextAreaElement;
const bannerEditor = $('#banner-editor')!;
const bannerCrop = $('#banner-crop')!;
const bannerCropImage = $('#banner-crop-image')!;
const bannerPosition = $('#field-banner-position') as HTMLInputElement;
const bannerPositionValue = $('#banner-position-value')!;
const bannerStatus = $('#banner-status')!;
const fieldTags = $('#field-tags') as HTMLInputElement;
const emptyState = $('#empty-state')!;
const editorView = $('#editor-view')!;
const tagChips = $('#tag-chips')!;
const saveState = $('#save-state')!;

function renderList() {
  const q = state.filter.trim().toLowerCase();
  const items = state.posts.filter((p) => {
    if (!q) return true;
    return [p.title, p.id, ...(p.tags ?? [])].join(' ').toLowerCase().includes(q);
  });

  postList.innerHTML = items
    .map(
      (p) => `
      <li class="post-item">
        <button class="post-open" data-id="${escapeHtml(p.id)}">
          <span class="dot ${p.draft ? 'draft' : 'pub'}" title="${p.draft ? 'Rascunho' : 'Publicado'}"></span>
          <span class="post-title">${escapeHtml(p.title || p.id)}</span>
          <span class="post-date">${formatDate(p.pubDate)}</span>
        </button>
        <span class="post-actions">
          <button data-act="dup" data-id="${escapeHtml(p.id)}" title="Duplicar">⧉</button>
          <button data-act="del" data-id="${escapeHtml(p.id)}" title="Excluir">×</button>
        </span>
      </li>`,
    )
    .join('');
}

async function loadList() {
  try {
    state.posts = await api<PostListItem[]>('GET', '/api/posts');
  } catch {
    state.posts = [];
  }
  renderList();
}


function renderProjectList() {
  const q = state.filter.trim().toLowerCase();
  const projects = state.projects.filter((project) =>
    !q || [project.title, project.id, project.description].join(' ').toLowerCase().includes(q) ||
      project.documents.some((doc) => [doc.title, doc.path].join(' ').toLowerCase().includes(q)),
  );
  projectList.innerHTML = projects.map((project) => {
    const selectedProject = state.currentProject?.id === project.id && state.projectItemKind === 'project';
    const docs = project.documents.map((doc) => {
      const selected = state.currentProject?.id === project.id &&
        state.currentProjectDoc?.kind === doc.kind && state.currentProjectDoc?.id === doc.id;
      const kindLabel = doc.kind === 'document' ? 'Entrada' : doc.kind === 'chapter' ? 'Capítulo' : 'Complemento';
      return `<li class="project-doc-item ${selected ? 'active' : ''}">
        <button class="project-doc-open" data-project-id="${escapeHtml(project.id)}" data-doc-kind="${doc.kind}" data-doc-id="${escapeHtml(doc.id)}">
          <span class="project-doc-kind">${kindLabel}</span>
          <span class="project-doc-title">${escapeHtml(doc.title)}</span>
          <span class="project-doc-state">${doc.published ? 'publicado' : 'rascunho'}</span>
        </button>
      </li>`;
    }).join('');
    return `<li class="project-item ${selectedProject ? 'active' : ''}">
      <button class="project-open" data-project-id="${escapeHtml(project.id)}">
        <span class="dot ${project.published ? 'pub' : 'draft'}" title="${project.published ? 'Publicado' : 'Rascunho'}"></span>
        <span class="post-title">${escapeHtml(project.title)}</span>
        <span class="post-date">${project.type === 'rpg' ? 'RPG' : 'HISTÓRIA'}</span>
      </button>
      <ul class="project-doc-list">${docs}</ul>
    </li>`;
  }).join('');
}

async function loadProjects() {
  try {
    state.projects = await api<ProjectListItem[]>('GET', '/api/projects');
  } catch (err) {
    state.projects = [];
    setSaved(false, (err as Error).message);
  }
  renderProjectList();
}

function setProjectEditorVisibility(kind: 'project' | ProjectDocumentKind) {
  postMeta.hidden = true;
  postBannerActions.hidden = true;
  $('#field-description')!.toggleAttribute('hidden', kind !== 'project');
  projectMetaPanel.hidden = kind !== 'project';
  projectDocMetaPanel.hidden = kind === 'project';
  bannerEditor.hidden = true;
  $('#btn-image')!.toggleAttribute('hidden', true);
  projectActions.hidden = false;
}

async function openProject(id: string) {
  const project = await api<Project>('GET', `/api/project/${encodeURIComponent(id)}`);
  state.currentProject = project;
  state.currentProjectDoc = null;
  state.projectItemKind = 'project';
  fieldTitle.value = project.file.title;
  fieldDescription.value = project.file.description;
  fieldProjectType.value = project.file.type;
  fieldProjectPublished.checked = project.file.published;
  fieldProjectHomepage.checked = project.file.showHomepage;
  fieldProjectOrder.value = String(project.file.order);
  fieldProjectCover.value = project.file.cover ?? '';
  projectDocPath.textContent = project.path;
  setProjectEditorVisibility('project');
  if (cmView) cmView.destroy();
  cmView = createEditor(project.body, () => renderPreviewDebounced());
  renderPreview();
  state.dirty = { title: false, body: false, meta: false };
  state.tagsDirty = false;
  renderProjectList();
  emptyState.hidden = true;
  editorView.hidden = false;
  setSaved(true);
  fieldTitle.focus();
}

async function openProjectDocument(projectId: string, kind: ProjectDocumentKind, id: string) {
  let project = state.currentProject;
  if (!project || project.id !== projectId) {
    project = await api<Project>('GET', `/api/project/${encodeURIComponent(projectId)}`);
    state.currentProject = project;
  }
  const params = new URLSearchParams({ project: projectId, kind, id });
  const doc = await api<ProjectDocument>('GET', `/api/project-document?${params.toString()}`);
  state.currentProjectDoc = doc;
  state.projectItemKind = kind;
  fieldTitle.value = doc.file.title;
  fieldDocPublished.checked = doc.file.published;
  fieldDocOrder.value = String(doc.file.order);
  projectDocPath.textContent = doc.path;
  setProjectEditorVisibility(kind);
  if (cmView) cmView.destroy();
  cmView = createEditor(doc.body, () => renderPreviewDebounced());
  renderPreview();
  state.dirty = { title: false, body: false, meta: false };
  state.tagsDirty = false;
  renderProjectList();
  emptyState.hidden = true;
  editorView.hidden = false;
  setSaved(true);
  fieldTitle.focus();
}

async function saveProjectCurrent(): Promise<boolean> {
  try {
    if (state.projectItemKind === 'project') {
      if (!state.currentProject) return false;
      const file: ProjectMeta = {
        ...state.currentProject.file,
        title: fieldTitle.value.trim() || state.currentProject.id,
        description: fieldDescription.value.trim(),
        type: fieldProjectType.value === 'rpg' ? 'rpg' : 'story',
        published: fieldProjectPublished.checked,
        showHomepage: fieldProjectHomepage.checked,
        order: Number(fieldProjectOrder.value) || 0,
        ...(fieldProjectCover.value.trim() ? { cover: fieldProjectCover.value.trim() } : { cover: undefined }),
      };
      state.currentProject = await api<Project>('POST', '/api/project/save', {
        id: state.currentProject.id, file, body: currentBody(),
      });
    } else {
      if (!state.currentProjectDoc) return false;
      const file: ProjectDocumentMeta = {
        ...state.currentProjectDoc.file,
        title: fieldTitle.value.trim() || state.currentProjectDoc.id,
        published: fieldDocPublished.checked,
        order: Number(fieldDocOrder.value) || 0,
      };
      state.currentProjectDoc = await api<ProjectDocument>('POST', '/api/project-document/save', {
        projectId: state.currentProjectDoc.projectId,
        kind: state.currentProjectDoc.kind,
        id: state.currentProjectDoc.id,
        file,
        body: currentBody(),
      });
    }
    state.dirty = { title: false, body: false, meta: false };
    await loadProjects();
    setSaved(true);
    return true;
  } catch (err) {
    setSaved(false, (err as Error).message);
    return false;
  }
}

async function publishProjectCurrent() {
  // Salva exatamente o estado escolhido no editor, inclusive published=false.
  if (!(await saveProjectCurrent())) return;
  setSaving('Publicando alterações do projeto...');
  try {
    const currentId = state.currentProject?.id;
    const currentDoc = state.currentProjectDoc;
    const label = state.projectItemKind === 'project'
      ? `project: ${state.currentProject?.file.title ?? currentId}`
      : `project document: ${currentDoc?.file.title ?? currentDoc?.id}`;
    const isPublished = state.projectItemKind === 'project'
      ? Boolean(state.currentProject?.file.published)
      : Boolean(state.currentProjectDoc?.file.published);
    await api('POST', '/api/git/commit', { message: label });
    await api('POST', '/api/git/push');
    await loadProjects();
    await refreshGit();
    setSaved(true, `${isPublished ? 'Publicado' : 'Ocultado'} ✓ ${label}`);
  } catch (err) {
    setSaved(false, (err as Error).message);
  }
}

async function openPost(id: string) {
  state.current = await api<Post>('GET', `/api/post/${encodeURIComponent(id)}`);
  postMeta.hidden = false;
  postBannerActions.hidden = false;
  projectMetaPanel.hidden = true;
  projectDocMetaPanel.hidden = true;
  $('#field-description')!.hidden = false;
  $('#btn-image')!.hidden = false;
  projectActions.hidden = true;
  const p = state.current;

  fieldTitle.value = p.file.title;
  fieldDate.value = p.file.pubDate.slice(0, 10);
  fieldDraft.checked = p.file.draft;
  fieldDescription.value = p.file.description;
  setBannerPosition(p.file.bannerPosition ?? '50%');
  await loadBannerPreview(p.id);
  tags = p.file.tags ?? [];
  state.tagsDirty = false;
  renderTags();
  renderList();

  // Recria o editor com o conteúdo do post (mais simples do que
  // gerenciar a troca de documento dentro do CodeMirror).
  if (cmView) cmView.destroy();
  cmView = createEditor(p.body, () => {
    renderPreviewDebounced();
  });
  renderPreview();
  state.dirty = { title: false, body: false, meta: false };
  setSaved(true);

  emptyState.hidden = true;
  editorView.hidden = false;
  fieldTitle.focus();
}

function setBannerPosition(value: string) {
  const numeric = Math.max(0, Math.min(100, Number.parseFloat(value) || 50));
  bannerPosition.value = String(Math.round(numeric));
  bannerPositionValue.textContent = String(Math.round(numeric)) + '%';

  // O enquadramento do banner é vertical: 0% = topo, 50% = centro,
  // 100% = base. Mantemos a imagem inteira na largura do preview e
  // usamos o excesso vertical para calcular o deslocamento.
  const image = bannerCropImage as HTMLImageElement;
  const cropWidth = bannerCrop.clientWidth;
  const cropHeight = bannerCrop.clientHeight;

  if (!image.naturalWidth || !image.naturalHeight || !cropWidth || !cropHeight) {
    image.style.width = '';
    image.style.height = '';
    image.style.transform = 'translate3d(0, 0, 0)';
    return;
  }

  const scale = cropWidth / image.naturalWidth;
  const renderedWidth = cropWidth;
  const renderedHeight = image.naturalHeight * scale;
  const overflowY = Math.max(0, renderedHeight - cropHeight);
  const offsetY = overflowY * (numeric / 100);

  image.style.width = renderedWidth + 'px';
  image.style.height = renderedHeight + 'px';
  image.style.transform = 'translate3d(0, ' + (-offsetY) + 'px, 0)';
}
async function loadBannerPreview(id: string) {
  state.bannerAvailable = false;
  bannerEditor.hidden = true;
  (bannerCropImage as HTMLImageElement).removeAttribute('src');
  bannerCropImage.style.transform = 'translate3d(0, 0, 0)';
  bannerStatus.textContent = 'procurando banner...';

  try {
    const res = await fetch('/api/post-banner?post=' + encodeURIComponent(id), {
      cache: 'no-store',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      bannerStatus.textContent =
        data.error ?? 'adicione uma imagem chamada banner.jpg, banner.png ou banner.webp';
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const image = bannerCropImage as HTMLImageElement;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível carregar o banner.'));
      image.src = url;
    });

    state.bannerAvailable = true;
    bannerEditor.hidden = false;
    bannerStatus.textContent = 'arraste a imagem ou use a barra para escolher o enquadramento';
    setBannerPosition(state.current?.file.bannerPosition ?? '50%');
  } catch {
    bannerStatus.textContent = 'não foi possível carregar o banner';
  }
}

let bannerDragging = false;
let bannerDragStartY = 0;
let bannerDragStartPosition = 50;
let bannerDragMoved = false;

function finishBannerDrag(event?: PointerEvent) {
  if (!bannerDragging) return;
  bannerDragging = false;
  if (event && bannerCrop.hasPointerCapture(event.pointerId)) {
    bannerCrop.releasePointerCapture(event.pointerId);
  }
  bannerCrop.classList.remove('dragging');
  state.dirty.meta = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
}

bannerCrop.addEventListener('pointerdown', (event) => {
  if (bannerEditor.hidden || event.button !== 0) return;
  event.preventDefault();
  bannerDragging = true;
  bannerDragMoved = false;
  bannerDragStartY = event.clientY;
  bannerDragStartPosition = Number(bannerPosition.value);
  bannerCrop.setPointerCapture(event.pointerId);
  bannerCrop.classList.add('dragging');
});

bannerCrop.addEventListener('pointermove', (event) => {
  if (!bannerDragging) return;
  const rect = bannerCrop.getBoundingClientRect();
  if (!rect.height) return;

  const deltaY = event.clientY - bannerDragStartY;
  if (Math.abs(deltaY) > 2) bannerDragMoved = true;

  // O enquadramento é vertical: arrastar para baixo revela regiões
  // mais próximas do topo; arrastar para cima revela regiões mais baixas.
  const delta = (deltaY / rect.height) * 100;
  setBannerPosition(String(Math.max(0, Math.min(100, bannerDragStartPosition + delta))));
});

bannerCrop.addEventListener('pointerup', (event) => {
  finishBannerDrag(event);
});

bannerCrop.addEventListener('pointercancel', (event) => {
  finishBannerDrag(event);
});

bannerCrop.addEventListener('lostpointercapture', () => {
  if (bannerDragging) finishBannerDrag();
});

// Um clique simples também posiciona o foco, sem exigir arrastar.
bannerCrop.addEventListener('click', (event) => {
  if (bannerDragging || bannerDragMoved) return;
  const rect = bannerCrop.getBoundingClientRect();
  if (!rect.height) return;
  const position = ((event.clientY - rect.top) / rect.height) * 100;
  setBannerPosition(String(Math.max(0, Math.min(100, position))));
  state.dirty.meta = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
});

bannerPosition.addEventListener('input', () => {
  setBannerPosition(bannerPosition.value);
  state.dirty.meta = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
});

function currentMeta(): PostMeta {
  const original = state.current?.file.pubDate ?? '';
  const chosen = fieldDate.value || todayClient();
  // O campo de data só mostra o dia (YYYY-MM-DD). Se o usuário não
  // alterou a data, mantemos o pubDate original do arquivo intacto —
  // editar um post nunca deve mudar quando ele foi publicado.
  const keepOriginal = Boolean(state.current) && original.slice(0, 10) === chosen;
  return {
    title: fieldTitle.value.trim() || 'Sem título',
    description: fieldDescription.value.trim(),
    pubDate: keepOriginal ? original : chosen,
    tags: tags,
    draft: fieldDraft.checked,
    ...(state.bannerAvailable
      ? { bannerPosition: `${Math.round(Number(bannerPosition.value))}%` }
      : {}),
  };
}

function todayClient() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

async function saveCurrent(): Promise<boolean> {
  if (state.projectMode) return saveProjectCurrent();
  if (!state.current) return false;
  const meta = currentMeta();
  try {
    await api('POST', '/api/post/save', {
      id: state.current.id,
      file: meta,
      body: currentBody(),
      // Só mudamos a data se o usuário editou o campo de data. O servidor
      // ignora a data enviada quando isso é false, então até um cliente
      // velho/equivocado não avança a data de publicação.
      changeDate: meta.pubDate !== state.current.file.pubDate,
    });
    state.dirty = { title: false, body: false, meta: false };
    state.tagsDirty = false;
    clearAutosave();
    setSaved(true);
    await loadList();
    return true;
  } catch (err) {
    setSaved(false, (err as Error).message);
    return false;
  }
}

// ------------------------------------------------------------------
// Publicar (compensa no site: salva, commit e push ao GitHub)
// ------------------------------------------------------------------
async function publishCurrent() {
  if (state.projectMode) return publishProjectCurrent();
  if (!state.current) return;
  const meta = { ...currentMeta(), draft: false };
  fieldDraft.checked = false;
  setSaving('Publicando...');
  try {
    const res = await api<{ subject: string }>('POST', '/api/publish', {
      id: state.current.id,
      file: meta,
      body: currentBody(),
      changeDate: meta.pubDate !== state.current.file.pubDate,
    });
    setSaved(true, `Publicado ✓ ${res.subject}`);
    clearAutosave();
    await loadList();
    await refreshGit();
  } catch (err) {
    setSaved(false, (err as Error).message);
    setSaving('');
  }
}

// ------------------------------------------------------------------
// Tags
// ------------------------------------------------------------------
let tags: string[] = [];

function renderTags() {
  tagChips.innerHTML = tags
    .map(
      (t) => `<li class="chip">${escapeHtml(t)}
        <button data-rm="${escapeHtml(t)}" aria-label="Remover tag ${escapeHtml(t)}">×</button></li>`,
    )
    .join('');
}

fieldTags.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const t = fieldTags.value.trim().replace(/,/, '');
  if (t && !tags.includes(t)) {
    tags.push(t);
    renderTags();
    state.tagsDirty = true;
    scheduleAutosave();
    setSaved(false, 'Alterações não salvas');
  }
  fieldTags.value = '';
});

tagChips.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-rm]') as HTMLElement | null;
  if (!btn) return;
  const label = btn.getAttribute('data-rm');
  tags = tags.filter((t) => t !== label);
  state.tagsDirty = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
  renderTags();
});

// ------------------------------------------------------------------
// Modal simples (confirmação)
// ------------------------------------------------------------------
function modal(title: string, body: string) {
  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-x" aria-label="Fechar">×</button></div>
      <div class="modal-body">
        ${body}
      </div>
    </div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.querySelector('.modal-x')?.addEventListener('click', close);
  const firstInput = root.querySelector('input, select, button');
  if (firstInput instanceof HTMLElement) setTimeout(() => firstInput.focus(), 0);
  return { root, close };
}

// ------------------------------------------------------------------
// Botões principais
// ------------------------------------------------------------------
$('#btn-new')!.addEventListener('click', async () => {
  if (!(await confirmNavigation())) return;
  const title = window.prompt(state.projectMode ? 'Nome do novo projeto:' : 'Título do novo post:')?.trim();
  if (!title) return;
  if (state.projectMode) {
    const typeInput = window.prompt('Tipo do projeto: digite "rpg" ou "story".', 'story')?.trim().toLowerCase();
    const project = await api<Project>('POST', '/api/project', { title, type: typeInput === 'rpg' ? 'rpg' : 'story' });
    await loadProjects();
    await openProject(project.id);
    return;
  }
  const post = await api<Post>('POST', '/api/post', { title });
  await loadList();
  await openPost(post.id);
});

$('#btn-mode')!.addEventListener('click', async () => {
  if (!(await confirmNavigation())) return;
  state.projectMode = !state.projectMode;
  const modeButton = $('#btn-mode') as HTMLButtonElement;
  modeButton.textContent = state.projectMode ? 'Posts' : 'Projetos';
  modeButton.setAttribute('aria-pressed', String(state.projectMode));
  ($('#btn-new') as HTMLButtonElement).textContent = state.projectMode ? '+ Novo projeto' : '+ Novo post';
  postList.hidden = state.projectMode;
  projectList.hidden = !state.projectMode;
  projectActions.hidden = !state.projectMode;
  search.placeholder = state.projectMode ? 'Pesquisar projetos e documentos...' : 'Pesquisar posts...';
  search.value = '';
  state.filter = '';
  if (state.projectMode) {
    emptyState.hidden = false;
    editorView.hidden = true;
    await loadProjects();
    if (state.currentProject) await openProject(state.currentProject.id);
  } else {
    projectMetaPanel.hidden = true;
    projectDocMetaPanel.hidden = true;
    if (state.current) await openPost(state.current.id);
    else {
      emptyState.hidden = false;
      editorView.hidden = true;
    }
    await loadList();
  }
  setSaved(true, state.projectMode ? 'Área de projetos' : 'Área de posts');
});

$('#btn-new-chapter')!.addEventListener('click', async () => {
  if (!(await confirmNavigation())) return;
  if (!state.currentProject) {
    setSaved(false, 'Selecione um projeto antes de criar um capítulo.');
    return;
  }
  const title = window.prompt('Título do novo capítulo:')?.trim();
  if (!title) return;
  try {
    const doc = await api<ProjectDocument>('POST', '/api/project-document', {
      projectId: state.currentProject.id, kind: 'chapter', title,
    });
    await loadProjects();
    await openProjectDocument(doc.projectId, doc.kind, doc.id);
  } catch (err) {
    setSaved(false, (err as Error).message);
  }
});

$('#btn-new-supplement')!.addEventListener('click', async () => {
  if (!(await confirmNavigation())) return;
  if (!state.currentProject) {
    setSaved(false, 'Selecione um projeto antes de criar um complemento.');
    return;
  }
  const title = window.prompt('Título do material complementar:')?.trim();
  if (!title) return;
  try {
    const doc = await api<ProjectDocument>('POST', '/api/project-document', {
      projectId: state.currentProject.id, kind: 'supplement', title,
    });
    await loadProjects();
    await openProjectDocument(doc.projectId, doc.kind, doc.id);
  } catch (err) {
    setSaved(false, (err as Error).message);
  }
});

$('#btn-save')!.addEventListener('click', () => saveCurrent());
$('#btn-publish')!.addEventListener('click', () => publishCurrent());
$('#btn-settings')!.addEventListener('click', () => openSettings());

// ------------------------------------------------------------------
// Ações por post (duplicar/excluir) — delegação de eventos
// ------------------------------------------------------------------
projectList.addEventListener('click', async (e) => {
  const target = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!target) return;
  if (!(await confirmNavigation())) return;
  const projectId = target.getAttribute('data-project-id');
  if (!projectId) return;
  const kind = target.getAttribute('data-doc-kind') as ProjectDocumentKind | null;
  const id = target.getAttribute('data-doc-id');
  try {
    if (kind && id) await openProjectDocument(projectId, kind, id);
    else await openProject(projectId);
  } catch (err) {
    setSaved(false, (err as Error).message);
  }
});

postList.addEventListener('click', async (e) => {
  const openBtn = (e.target as HTMLElement).closest('.post-open') as HTMLElement | null;
  if (openBtn) {
    if (!(await confirmNavigation())) return;
    return openPost(openBtn.getAttribute('data-id')!);
  }

  const act = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!act) return;
  const id = act.getAttribute('data-id')!;

  if (act.getAttribute('data-act') === 'dup') {
    if (!(await confirmNavigation())) return;
    const copy = await api<Post>('POST', '/api/post/duplicate', { id });
    await loadList();
    await openPost(copy.id);
  } else if (act.getAttribute('data-act') === 'del') {
    if (state.current?.id === id && !(await confirmNavigation())) return;
    if (!window.confirm(`Excluir "${id}"? O arquivo (e as imagens da pasta) serão removidos — não dá para desfazer.`)) return;
    try {
      await api('POST', '/api/post/delete', { id });
      if (state.current?.id === id) {
        emptyState.hidden = false;
        editorView.hidden = true;
        state.current = null;
      }
      await loadList();
    } catch (err) {
      setSaved(false, (err as Error).message);
    }
  }
});

search.addEventListener('input', () => {
  state.filter = search.value;
  if (state.projectMode) renderProjectList();
  else renderList();
});

// Marca os campos de metadados como sujos ao editar
fieldTitle.addEventListener('input', () => {
  state.dirty.title = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
});
fieldDate.addEventListener('input', () => {
  state.dirty.meta = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
});
fieldDraft.addEventListener('change', () => {
  state.dirty.meta = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
});
fieldDescription.addEventListener('input', () => {
  state.dirty.meta = true;
  scheduleAutosave();
  setSaved(false, 'Alterações não salvas');
});

[fieldProjectType, fieldProjectPublished, fieldProjectHomepage, fieldProjectOrder, fieldProjectCover, fieldDocPublished, fieldDocOrder].forEach((field) => {
  field.addEventListener('input', () => {
    if (field === fieldProjectPublished || field === fieldDocPublished) {
      ($('#btn-publish') as HTMLButtonElement).textContent =
        (state.projectItemKind === 'project' ? fieldProjectPublished.checked : fieldDocPublished.checked)
          ? 'Publicar'
          : 'Salvar e ocultar';
    }
    state.dirty.meta = true;
    scheduleAutosave();
    setSaved(false, 'Alterações não salvas');
  });
  field.addEventListener('change', () => {
    state.dirty.meta = true;
    scheduleAutosave();
    setSaved(false, 'Alterações não salvas');
  });
});

// ------------------------------------------------------------------
// Navegação segura + divisão redimensionável
// ------------------------------------------------------------------
function hasUnsavedChanges() {
  const dirty = state.dirty.title || state.dirty.body || state.dirty.meta || state.tagsDirty;
  return state.projectMode
    ? Boolean((state.currentProject || state.currentProjectDoc) && dirty)
    : Boolean(state.current && dirty);
}

async function confirmNavigation(): Promise<boolean> {
  if (!hasUnsavedChanges()) return true;
  const saveFirst = window.confirm(
    'Há alterações não salvas neste post.\n\nOK = salvar e continuar\nCancelar = permanecer no post',
  );
  if (!saveFirst) return false;
  return saveCurrent();
}

const split = $('.split')!;
const splitDivider = $('#split-divider')!;
let splitRatio = 60;

function applySplitRatio() {
  split.style.setProperty('--editor-pane', `${splitRatio}%`);
  splitDivider.setAttribute('aria-valuenow', String(splitRatio));
}

function updateSplitFromPointer(clientX: number) {
  const rect = split.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = ((clientX - rect.left) / rect.width) * 100;
  splitRatio = Math.max(45, Math.min(75, Math.round(ratio)));
  applySplitRatio();
}

splitDivider.addEventListener('pointerdown', (event) => {
  if (window.matchMedia('(max-width: 780px)').matches) return;
  splitDivider.setPointerCapture(event.pointerId);
  splitDivider.classList.add('dragging');
});

splitDivider.addEventListener('pointermove', (event) => {
  if (!splitDivider.hasPointerCapture(event.pointerId)) return;
  updateSplitFromPointer(event.clientX);
});

splitDivider.addEventListener('pointerup', (event) => {
  splitDivider.releasePointerCapture(event.pointerId);
  splitDivider.classList.remove('dragging');
});

splitDivider.addEventListener('dblclick', () => {
  splitRatio = 60;
  applySplitRatio();
});

splitDivider.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    splitRatio = Math.max(45, splitRatio - 5);
    applySplitRatio();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    splitRatio = Math.min(75, splitRatio + 5);
    applySplitRatio();
  } else if (event.key === 'Home') {
    event.preventDefault();
    splitRatio = 45;
    applySplitRatio();
  } else if (event.key === 'End') {
    event.preventDefault();
    splitRatio = 75;
    applySplitRatio();
  }
});

applySplitRatio();

// ------------------------------------------------------------------
// Imagens
// ------------------------------------------------------------------
$('#btn-image')!.addEventListener('click', () => {
  $('#file-image')!.click();
});

$('#file-image')!.addEventListener('change', async (e) => {
  if (!state.current) return;
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/post/${encodeURIComponent(state.current.id)}/image`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok) return setSaved(false, data.error);
  // Insere a referência no Markdown na posição do cursor.
  const snippet = `![${data.alt ?? file.name}](${data.name})`;
  cmView?.dispatch({ changes: { from: cmView.state.selection.main.from, insert: snippet }, selection: { anchor: cmView.state.selection.main.from + snippet.length } });
  (e.target as HTMLInputElement).value = '';
  setSaved(false, '');
});

// ------------------------------------------------------------------
// Painel Git
// ------------------------------------------------------------------
btnPostBanner.addEventListener('click', () => {
  if (!state.current || state.projectMode) {
    setSaved(false, 'Abra um post antes de adicionar um banner.');
    return;
  }
  filePostBanner.click();
});

filePostBanner.addEventListener('change', async () => {
  const file = filePostBanner.files?.[0];
  const post = state.current;
  if (!file || !post || state.projectMode) return;

  const form = new FormData();
  form.append('file', file);
  setSaved(false, 'Enviando banner...');
  try {
    const response = await fetch(`/api/post/${encodeURIComponent(post.id)}/banner`, {
      method: 'POST',
      body: form,
    });
    const data = await response.json() as { name?: string; error?: string };
    if (!response.ok || !data.name) throw new Error(data.error ?? 'Não foi possível enviar o banner.');

    await loadBannerPreview(post.id);
    if (!state.bannerAvailable) throw new Error('O banner foi enviado, mas não foi possível carregá-lo no preview.');
    state.dirty.meta = true;
    const saved = await saveCurrent();
    if (saved) setSaved(true, 'Banner adicionado e salvo');
  } catch (err) {
    setSaved(false, (err as Error).message);
  } finally {
    filePostBanner.value = '';
  }
});

btnProjectBanner.addEventListener('click', () => {
  if (!state.currentProject || state.projectItemKind !== 'project') {
    setSaved(false, 'Abra um projeto antes de adicionar um banner.');
    return;
  }
  fileProjectBanner.click();
});

fileProjectBanner.addEventListener('change', async () => {
  const file = fileProjectBanner.files?.[0];
  const project = state.currentProject;
  if (!file || !project || state.projectItemKind !== 'project') return;

  const form = new FormData();
  form.append('file', file);
  setSaved(false, 'Enviando banner...');
  try {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/banner`, {
      method: 'POST',
      body: form,
    });
    const data = await response.json() as { cover?: string; error?: string };
    if (!response.ok || !data.cover) throw new Error(data.error ?? 'Não foi possível enviar o banner.');

    fieldProjectCover.value = data.cover;
    state.dirty.meta = true;
    const saved = await saveProjectCurrent();
    if (saved) setSaved(true, 'Banner adicionado');
  } catch (err) {
    setSaved(false, (err as Error).message);
  } finally {
    fileProjectBanner.value = '';
  }
});

const gitBadge = $('#git-badge')!;
const gitPanel = $('#git-panel')!;

async function refreshGit() {
  try {
    state.git = await api<GitStatus>('GET', '/api/git/status');
  } catch {
    state.git = null;
  }
  const g = state.git;

  if (!g) {
    gitBadge.textContent = 'git';
    gitPanel.innerHTML = '<p class="git-note">Repositório não encontrado.</p>';
    return;
  }

  const clean = g.dirty.length === 0;
  gitBadge.textContent = `git: ${g.branch}`;
  gitBadge.className = `git-badge ${clean ? 'ok' : 'dirty'}`;

  gitPanel.innerHTML = `
    <div class="row ${clean ? 'ok' : 'dirty'}">
      <span>${clean ? '✓ sincronizado' : `${g.dirty.length} alteração(ões) local(ais)`}</span>
    </div>
    ${g.behind > 0 ? `<div class="row warn">→ ${g.behind} commit(s) para puxar</div>` : ''}
    ${g.ahead > 0 ? `<div class="row warn">↑ ${g.ahead} commit(s) não enviados</div>` : ''}
    ${
      g.lastCommit
        ? `<div class="row muted" title="${g.lastCommit.subject}">
             último: ${formatDate(g.lastCommit.date.slice(0, 10))} · ${g.lastCommit.hash}
           </div>`
        : ''
    }
    <div class="row-buttons">
      <button id="btn-pull" class="ghost tiny">Puxar</button>
    </div>`;

  $('#btn-pull')?.addEventListener('click', async () => {
    if (!(await confirmNavigation())) return;
    try {
      await api('POST', '/api/git/pull');
      await refreshGit();
      await loadList();
      if (state.projectMode) {
        await loadProjects();
        if (state.currentProject) {
          if (state.currentProjectDoc) await openProjectDocument(state.currentProject.id, state.currentProjectDoc.kind, state.currentProjectDoc.id);
          else await openProject(state.currentProject.id);
        }
      } else if (state.current) await openPost(state.current.id);
    } catch (err) {
      setSaved(false, (err as Error).message);
    }
  });
}

// ------------------------------------------------------------------
// Estado "Salvo"
// ------------------------------------------------------------------
function setSaved(ok: boolean, message?: string) {
  state.savedAt = ok ? new Date() : null;
  saveState.textContent = ok
    ? message ?? `Salvo ✓ ${state.savedAt?.toLocaleTimeString() ?? ''}`
    : `${message ?? 'Alterações não salvas'} •`;
  saveState.className = ok ? 'save-state ok' : 'save-state err';
  const hasDirty = state.dirty.title || state.dirty.body || state.dirty.meta || state.tagsDirty;
  const hasActiveDocument = state.projectMode
    ? Boolean(state.currentProject && (state.projectItemKind === 'project' || state.currentProjectDoc))
    : Boolean(state.current);
  ($('#btn-save') as HTMLButtonElement).disabled = !(hasActiveDocument && hasDirty);
  ($('#btn-publish') as HTMLButtonElement).disabled = !hasActiveDocument || !fieldTitle.value.trim();
}

function setSaving(msg: string) {
  if (!msg) return;
  saveState.textContent = msg;
  saveState.className = 'save-state err';
}

// ------------------------------------------------------------------
// Autosave local (localStorage) — proteje contra fechamento acidental
// ------------------------------------------------------------------
const LS_KEY = 'writer:unsaved';
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(writeAutosave, 900);
}

function writeAutosave() {
  if (!hasUnsavedChanges()) return;
  try {
    if (state.projectMode && state.currentProject) {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: 'project',
        projectId: state.currentProject.id,
        itemKind: state.projectItemKind,
        docKind: state.currentProjectDoc?.kind,
        docId: state.currentProjectDoc?.id,
        title: fieldTitle.value,
        description: fieldDescription.value,
        projectType: fieldProjectType.value,
        projectPublished: fieldProjectPublished.checked,
        projectHomepage: fieldProjectHomepage.checked,
        projectOrder: fieldProjectOrder.value,
        projectCover: fieldProjectCover.value,
        docPublished: fieldDocPublished.checked,
        docOrder: fieldDocOrder.value,
        body: currentBody(),
        updatedAt: Date.now(),
      }));
      return;
    }
    if (!state.current) return;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        id: state.current.id,
        title: fieldTitle.value,
        date: fieldDate.value,
        draft: fieldDraft.checked,
        description: fieldDescription.value,
        tags,
        body: currentBody(),
        bannerPosition: state.bannerAvailable ? `${Math.round(Number(bannerPosition.value))}%` : undefined,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    /* armazenamento indisponível — seguimos normalmente */
  }
}

function clearAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  localStorage.removeItem(LS_KEY);
}

function persistRecovery() {
  if (hasUnsavedChanges()) writeAutosave();
}

window.addEventListener('pagehide', persistRecovery);

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistRecovery();
});

window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedChanges()) return;
  writeAutosave();
  event.preventDefault();
  event.returnValue = '';
});

function restoreAutosave() {
  const saved = localStorage.getItem(LS_KEY);
  if (!saved) {
    renderPreviewDebounced();
    return;
  }
  try {
    const s = JSON.parse(saved);
    if ((!s?.id && !(s?.mode === 'project' && s?.projectId)) || typeof s.body !== 'string') {
      localStorage.removeItem(LS_KEY);
      return;
    }

    if (s?.mode === 'project' && typeof s.projectId === 'string' && typeof s.body === 'string') {
      const restoreProject = async () => {
        state.projectMode = true;
        ($('#btn-mode') as HTMLButtonElement).textContent = 'Posts';
        ($('#btn-mode') as HTMLButtonElement).setAttribute('aria-pressed', 'true');
        ($('#btn-new') as HTMLButtonElement).textContent = '+ Novo projeto';
        postList.hidden = true;
        projectList.hidden = false;
        projectActions.hidden = false;
        search.placeholder = 'Pesquisar projetos e documentos...';
        if (s.itemKind === 'project') await openProject(s.projectId);
        else await openProjectDocument(s.projectId, s.docKind as ProjectDocumentKind, String(s.docId ?? 'document'));
        fieldTitle.value = s.title ?? '';
        fieldDescription.value = s.description ?? '';
        fieldProjectType.value = s.projectType ?? 'story';
        fieldProjectPublished.checked = Boolean(s.projectPublished);
        fieldProjectHomepage.checked = s.projectHomepage !== false;
        fieldProjectOrder.value = String(s.projectOrder ?? 0);
        fieldProjectCover.value = s.projectCover ?? '';
        fieldDocPublished.checked = Boolean(s.docPublished);
        fieldDocOrder.value = String(s.docOrder ?? 0);
        cmView?.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: s.body } });
        renderPreview();
        state.dirty = { title: true, body: true, meta: true };
        setSaved(false, 'Recuperação automática de projeto — ainda não salvo');
      };
      void restoreProject().catch(() => localStorage.removeItem(LS_KEY));
      return;
    }

    // Reabre o post e aplica o conteúdo não salvo por cima.
    openPost(s.id)
      .then(() => {
        fieldTitle.value = s.title ?? '';
        fieldDate.value = s.date ?? '';
        fieldDraft.checked = s.draft ?? true;
        fieldDescription.value = s.description ?? '';
        tags = s.tags ?? [];
        renderTags();
        cmView?.dispatch({
          changes: { from: 0, to: cmView.state.doc.length, insert: s.body },
        });
        renderPreview();
        if (typeof s.bannerPosition === 'string' && state.bannerAvailable) {
          setBannerPosition(s.bannerPosition);
        }
        state.dirty = { title: true, body: true, meta: true };
        state.tagsDirty = true;
        setSaved(false, 'Recuperado automaticamente — ainda não salvo');
      })
      .catch(() => localStorage.removeItem(LS_KEY));
  } catch {
    localStorage.removeItem(LS_KEY);
  }
}

// ------------------------------------------------------------------
// Configurações (pasta de trabalho)
// ------------------------------------------------------------------
async function openSettings() {
  let rootText = '';
  try {
    const s = await api<{ workspace: { root: string } }>('GET', '/api/settings');
    rootText = s.workspace.root;
  } catch {
    /* servidor indisponível */
  }
  const { root, close } = modal(
    'Configurações',
    `
    <section class="set-group">
      <h3>Pasta de trabalho</h3>
      <code id="set-workspace" class="set-workspace">${escapeHtml(rootText)}</code>
      <p class="git-note">A pasta que contém a sua pasta <code>content/</code> com os posts.</p>
      <div class="modal-msg" id="set-msg" role="alert"></div>
      <div class="modal-actions">
        <button class="ghost" id="set-workspace-choose">Trocar pasta</button>
      </div>
    </section>`,
  );
  const setMsg = $('#set-msg', root)!;

  $('#set-workspace-choose', root)?.addEventListener('click', async () => {
    if (!(await confirmNavigation())) return;
    const path = window.prompt('Caminho da nova pasta do arquivo (a que tem a pasta content/):', rootText);
    if (!path) return;
    try {
      const r = await api<{ ok: boolean; root?: string; error?: string }>('POST', '/api/workspace', {
        path,
      });
      if (!r.ok || !r.root) {
        setMsg.textContent = r.error ?? 'Não foi possível trocar a pasta.';
        setMsg.className = 'modal-msg';
        return;
      }
      $('#set-workspace', root)!.textContent = r.root;
      setMsg.textContent = 'Pasta de trabalho trocada. Puxando listagem...';
      setMsg.className = 'modal-msg ok';
      await loadList();
      await refreshGit();
    } catch (err) {
      setMsg.textContent = (err as Error).message;
      setMsg.className = 'modal-msg';
    }
  });

  void close;
}

// ------------------------------------------------------------------
// Inicialização / retomada
// ------------------------------------------------------------------
async function resume() {
  state.tagsDirty = false;
  await Promise.all([loadList(), refreshGit()]);
  restoreAutosave();
}

// Atualiza os contadores do Git periodicamente.
setInterval(refreshGit, 20000);
resume();