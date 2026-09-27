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
import type { Post, PostListItem, GitStatus, PostMeta } from '../shared/types';

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
} = {
  posts: [],
  current: null,
  git: null,
  filter: '',
  dirty: { title: false, body: false, meta: false },
  savedAt: null,
  tagsDirty: false,
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
      <button id="btn-new" class="ghost">+ Novo</button>
      <span id="save-state" class="save-state" role="status"></span>
      <button id="btn-save" class="ghost" disabled>Salvar</button>
      <button id="btn-publish" class="primary" disabled>Publicar</button>
      <button id="btn-settings" class="ghost" title="Configurações">Config</button>
    </div>
  </header>

  <aside class="sidebar">
    <input id="search" type="search" placeholder="Pesquisar..." aria-label="Pesquisar posts" />
    <div id="git-panel" class="git-panel"></div>
    <ul id="post-list" class="post-list"></ul>
  </aside>

  <main id="editor" class="editor">
    <div class="empty" id="empty-state">
      <p>Selecione um post na lista ou crie um novo.</p>
    </div>
    <div class="editor-view" id="editor-view" hidden>
      <input id="field-title" class="title-input" type="text" placeholder="Título do post" aria-label="Título do post" />

      <div class="meta-row">
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

      <section id="banner-editor" class="banner-editor" hidden>
        <div class="banner-editor-head">
          <div>
            <strong>Banner</strong>
            <span id="banner-status" class="pane-hint">arraste a imagem para escolher o enquadramento</span>
          </div>
          <output id="banner-position-value">50%</output>
        </div>
        <div id="banner-crop" class="banner-crop" tabindex="0" aria-label="Enquadramento do banner">
          <div id="banner-crop-image" class="banner-crop-image"></div>
          <div class="banner-crop-fade" aria-hidden="true"></div>
        </div>
        <input id="field-banner-position" type="range" min="0" max="100" value="50" step="1" aria-label="Posição horizontal do banner" />
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

async function openPost(id: string) {
  state.current = await api<Post>('GET', `/api/post/${encodeURIComponent(id)}`);
  const p = state.current;

  fieldTitle.value = p.file.title;
  fieldDate.value = p.file.pubDate;
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
  bannerCropImage.style.backgroundPosition = String(numeric) + '% center';
}

async function loadBannerPreview(id: string) {
  bannerEditor.hidden = true;
  try {
    const res = await fetch('/api/post/' + encodeURIComponent(id) + '/banner');
    if (!res.ok) {
      bannerStatus.textContent = 'adicione uma imagem chamada banner.jpg, banner.png ou banner.webp';
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    bannerCropImage.style.backgroundImage = 'url("' + url + '")';
    bannerEditor.hidden = false;
    setBannerPosition(state.current?.file.bannerPosition ?? '50%');
  } catch {
    bannerStatus.textContent = 'não foi possível carregar o banner';
  }
}

let bannerDragging = false;
let bannerDragStartX = 0;
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
  bannerDragStartX = event.clientX;
  bannerDragStartPosition = Number(bannerPosition.value);
  bannerCrop.setPointerCapture(event.pointerId);
  bannerCrop.classList.add('dragging');
});

bannerCrop.addEventListener('pointermove', (event) => {
  if (!bannerDragging) return;
  const rect = bannerCrop.getBoundingClientRect();
  if (!rect.width) return;

  const deltaX = event.clientX - bannerDragStartX;
  if (Math.abs(deltaX) > 2) bannerDragMoved = true;

  // O valor salvo é exatamente o mesmo conceito usado pelo site:
  // 0% = extremo esquerdo, 50% = centro, 100% = extremo direito.
  // O sinal é invertido porque arrastar a imagem para a direita
  // revela uma região mais à esquerda da imagem.
  const delta = (deltaX / rect.width) * -100;
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
  if (!rect.width) return;
  const position = ((event.clientX - rect.left) / rect.width) * 100;
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
  return {
    title: fieldTitle.value.trim() || 'Sem título',
    description: fieldDescription.value.trim(),
    pubDate: fieldDate.value || todayClient(),
    tags: tags,
    draft: fieldDraft.checked,
    ...(bannerEditor.hidden ? {} : { bannerPosition: `${Math.round(Number(bannerPosition.value))}%` }),
  };
}

function todayClient() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

async function saveCurrent(): Promise<boolean> {
  if (!state.current) return false;
  const meta = currentMeta();
  try {
    await api('POST', '/api/post/save', {
      id: state.current.id,
      file: meta,
      body: currentBody(),
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
  if (!state.current) return;
  const meta = { ...currentMeta(), draft: false };
  fieldDraft.checked = false;
  setSaving('Publicando...');
  try {
    const res = await api<{ subject: string }>('POST', '/api/publish', {
      id: state.current.id,
      file: meta,
      body: currentBody(),
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
  const title = window.prompt('Título do novo post:')?.trim();
  if (!title) return;
  const post = await api<Post>('POST', '/api/post', { title });
  await loadList();
  await openPost(post.id);
});

$('#btn-save')!.addEventListener('click', () => saveCurrent());
$('#btn-publish')!.addEventListener('click', () => publishCurrent());
$('#btn-settings')!.addEventListener('click', () => openSettings());

// ------------------------------------------------------------------
// Ações por post (duplicar/excluir) — delegação de eventos
// ------------------------------------------------------------------
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
  renderList();
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

// ------------------------------------------------------------------
// Navegação segura + divisão redimensionável
// ------------------------------------------------------------------
function hasUnsavedChanges() {
  return Boolean(
    state.current &&
      (state.dirty.title || state.dirty.body || state.dirty.meta || state.tagsDirty),
  );
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
  const res = await fetch(`/api/post/${state.current.id}/image`, {
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
      if (state.current) await openPost(state.current.id);
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
  const hasDirty = state.dirty.title || state.dirty.body || state.dirty.meta;
  ($('#btn-save') as HTMLButtonElement).disabled = !(
    state.current && (hasDirty || state.tagsDirty)
  );
  ($('#btn-publish') as HTMLButtonElement).disabled =
    !state.current || !fieldTitle.value.trim();
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
  if (!state.current || !hasUnsavedChanges()) return;
  try {
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
    if (!s?.id || typeof s.body !== 'string') {
      localStorage.removeItem(LS_KEY);
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