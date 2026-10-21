import { marked } from 'marked';
import DOMPurify from 'dompurify';

type FormatCommand =
  | 'bold'
  | 'italic'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'formatBlock'
  | 'removeFormat'
  | 'undo'
  | 'redo';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\\/g, '\\\\').replace(/([*_{}()#+\-.!|>])/g, '\\$1').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/`/g, '\\`');
  }
  if (!(node instanceof HTMLElement)) return '';
  const children = Array.from(node.childNodes).map(inlineMarkdown).join('');
  switch (node.tagName) {
    case 'STRONG':
    case 'B': return `**${children}**`;
    case 'EM':
    case 'I': return `*${children}*`;
    case 'DEL':
    case 'S': return `~~${children}~~`;
    case 'CODE': {
      const content = node.textContent ?? '';
      const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
      const delimiter = '`'.repeat(longestRun + 1);
      const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
      return `${delimiter}${padding}${content}${padding}${delimiter}`;
    }
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      return href ? `[${children}](${href.replace(/\)/g, '%29')})` : children;
    }
    case 'IMG': {
      const src = node.getAttribute('data-markdown-src') ?? node.getAttribute('src') ?? '';
      const alt = (node.getAttribute('alt') ?? '').replace(/\]/g, '\\]');
      return src ? `![${alt}](${src.replace(/\)/g, '%29')})` : '';
    }
    case 'BR': return '  \n';
    default: return children;
  }
}

function listMarkdown(list: HTMLElement, depth = 0): string {
  const ordered = list.tagName === 'OL';
  return Array.from(list.children)
    .filter((child) => child.tagName === 'LI')
    .map((li, index) => {
      const content = Array.from(li.childNodes)
        .filter((child) => !(child instanceof HTMLElement && ['UL', 'OL'].includes(child.tagName)))
        .map(inlineMarkdown)
        .join('')
        .trim();
      const marker = ordered ? `${index + 1}.` : '-';
      const nested = Array.from(li.children)
        .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
        .map((child) => listMarkdown(child as HTMLElement, depth + 1))
        .join('\n');
      return `${'  '.repeat(depth)}${marker} ${content}${nested ? `\n${nested}` : ''}`;
    })
    .join('\n');
}

function tableMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children)
      .filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
      .map((cell) => inlineMarkdown(cell).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()),
  ).filter((row) => row.length > 0);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  const lines = normalized.map((row) => `| ${row.join(' | ')} |`);
  const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return [lines[0], separator, ...lines.slice(1)].join('\n');
}

function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').trim();
  if (!(node instanceof HTMLElement)) return '';
  const children = Array.from(node.childNodes).map(blockMarkdown);
  const inline = Array.from(node.childNodes).map(inlineMarkdown).join('');
  switch (node.tagName) {
    case 'H1': return `# ${inline}`;
    case 'H2': return `## ${inline}`;
    case 'H3': return `### ${inline}`;
    case 'H4': return `#### ${inline}`;
    case 'P': return inline;
    case 'DIV': {
      const hasBlockChildren = Array.from(node.children).some((child) =>
        ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR'].includes(child.tagName),
      );
      return hasBlockChildren
        ? Array.from(node.childNodes).map(blockMarkdown).filter(Boolean).join('\n\n')
        : inline;
    }
    case 'UL':
    case 'OL': return listMarkdown(node);
    case 'LI': return `- ${inline}`;
    case 'TABLE': return tableMarkdown(node);
    case 'BLOCKQUOTE': return children.join('\n\n').split('\n').map((line) => `> ${line}`).join('\n');
    case 'PRE': {
      const code = node.querySelector('code');
      const language = code?.className.match(/language-([\w+-]+)/)?.[1] ?? '';
      return '\u0060\u0060\u0060' + language + '\n' + (code?.textContent ?? node.textContent ?? '').replace(/\n+$/, '') + '\n' + '\u0060\u0060\u0060';
    }
    case 'HR': return '---';
    case 'IMG': return inlineMarkdown(node);
    default: return children.filter(Boolean).join('\n\n') || inline;
  }
}

type BlockEditorHistorySnapshot = {
  html: string;
  anchorPath: number[];
  anchorOffset: number;
  focusPath: number[];
  focusOffset: number;
};

export interface UploadedImage {
  name: string;
  alt: string;
}

export class BlockEditor {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLDivElement;
  private readonly onChange: (markdown: string) => void;
  private readonly onUploadImage?: (file: File) => Promise<UploadedImage | null>;
  private readonly resolveImageUrl?: (src: string) => string;
  private imageRange: Range | null = null;
  private savedRange: Range | null = null;
  private blockControls: HTMLDivElement;
  private blockMenu: HTMLDivElement;
  private draggedBlockIndex = -1;
  private hoveredBlockIndex = -1;
  private history: BlockEditorHistorySnapshot[] = [];
  private historyIndex = -1;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private composing = false;

  constructor(host: HTMLElement, onChange: (markdown: string) => void, onUploadImage?: (file: File) => Promise<UploadedImage | null>, resolveImageUrl?: (src: string) => string) {
    this.root = host;
    this.onChange = onChange;
    this.onUploadImage = onUploadImage;
    this.resolveImageUrl = resolveImageUrl;
    this.root.innerHTML = `
      <div class="block-editor-toolbar" role="toolbar" aria-label="Formatação do documento">
        <button type="button" data-command="bold" title="Negrito (Ctrl+B)"><strong>B</strong></button>
        <button type="button" data-command="italic" title="Itálico (Ctrl+I)"><em>I</em></button>
        <select data-block-type aria-label="Tipo de bloco">
          <option value="p">Parágrafo</option>
          <option value="h1">Título 1</option>
          <option value="h2">Título 2</option>
          <option value="h3">Título 3</option>
          <option value="blockquote">Citação</option>
          <option value="pre">Código</option>
        </select>
        <button type="button" data-command="insertUnorderedList" title="Lista com marcadores">• Lista</button>
        <button type="button" data-command="insertOrderedList" title="Lista numerada">1. Lista</button>
        <button type="button" data-action="link" title="Inserir link">Link</button>
        <button type="button" data-action="image" title="Inserir imagem por URL">URL</button>
        <button type="button" data-action="upload-image" title="Enviar imagem do computador">+ Imagem</button>
        <input type="file" data-image-file accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden />
        <button type="button" data-action="hr" title="Inserir divisor">Divisor</button>
      </div>
      <div class="block-editor-canvas" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Documento" spellcheck="true"></div>
    `;
    this.canvas = this.root.querySelector<HTMLDivElement>('.block-editor-canvas')!;
    this.root.classList.add('block-editor-enhanced');
    this.root.style.position = 'relative';
    this.blockControls = document.createElement('div');
    this.blockControls.className = 'block-editor-block-controls';
    this.blockControls.setAttribute('aria-label', 'Controles dos blocos');
    this.blockMenu = document.createElement('div');
    this.blockMenu.className = 'block-editor-block-menu';
    this.blockMenu.hidden = true;
    this.blockMenu.setAttribute('role', 'menu');
    this.root.append(this.blockControls, this.blockMenu);
    this.canvas.addEventListener('keyup', () => { this.rememberSelection(); this.refreshBlockControls(); });
    this.canvas.addEventListener('mouseup', () => this.rememberSelection());
    this.canvas.addEventListener('pointerover', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      let block = target;
      while (block && block.parentElement !== this.canvas) block = block.parentElement;
      const index = block ? this.topLevelBlocks().indexOf(block) : -1;
      this.hoveredBlockIndex = index;
      this.blockControls.querySelectorAll<HTMLButtonElement>('[data-block-index]').forEach((handle) => {
        handle.classList.toggle('is-visible', Number(handle.dataset.blockIndex) === index);
      });
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoveredBlockIndex = -1;
      this.blockControls.querySelectorAll('.block-editor-block-handle').forEach((handle) => handle.classList.remove('is-visible'));
    });
    this.canvas.addEventListener('scroll', () => this.refreshBlockControls(), { passive: true });
    this.canvas.addEventListener('compositionstart', () => { this.composing = true; });
    this.canvas.addEventListener('compositionend', () => {
      this.composing = false;
      this.emitChange();
    });
    this.canvas.addEventListener('input', () => {
      if (!this.composing) {
        this.handleInlineMarkdownShortcut();
        this.emitChange();
      }
    });
    // Cola texto simples para evitar estilos externos e manter a posição do cursor.
    // Cada quebra vira <br>; isso evita inserir parágrafos dentro de outros parágrafos
    // e preserva linhas em branco sem criar uma árvore DOM inválida.
    this.canvas.addEventListener('paste', (event: ClipboardEvent) => {
      if (this.composing) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const text = clipboard.getData('text/plain');
      if (!text) return;

      event.preventDefault();
      const normalized = text.replace(/\r\n?/g, '\n');
      const selection = window.getSelection();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !this.canvas.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(this.canvas);
        range.collapse(false);
      }

      this.flushHistory();
      range.deleteContents();
      let current = range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement;
      while (current && current.parentElement !== this.canvas) current = current.parentElement;
      const canSplitParagraph = current && /^(P|H1|H2|H3|H4)$/.test(current.tagName);

      const makeTextFragment = (value: string): DocumentFragment => {
        const fragment = document.createDocumentFragment();
        value.split('\n').forEach((line, index) => {
          if (index > 0) fragment.append(document.createElement('br'));
          if (line) fragment.append(document.createTextNode(line));
        });
        if (!fragment.childNodes.length) fragment.append(document.createElement('br'));
        return fragment;
      };

      if (canSplitParagraph && normalized.includes('\n')) {
        const block = current!;
        const trailingRange = document.createRange();
        trailingRange.setStart(range.startContainer, range.startOffset);
        trailingRange.setEnd(block, block.childNodes.length);
        const trailing = trailingRange.extractContents();
        const paragraphs = normalized.split(/\n{2,}/);
        let insertionPoint = block;
        paragraphs.forEach((paragraphText, index) => {
          if (index === 0) {
            const fragment = makeTextFragment(paragraphText);
            const lastNode = fragment.lastChild!;
            range.insertNode(fragment);
            range.setStartAfter(lastNode);
          } else {
            const paragraph = document.createElement('p');
            const fragment = makeTextFragment(paragraphText);
            const lastNode = fragment.lastChild!;
            paragraph.append(fragment);
            insertionPoint.after(paragraph);
            insertionPoint = paragraph;
            range.setStartAfter(lastNode);
          }
        });
        insertionPoint.append(trailing);
      } else {
        const fragment = makeTextFragment(normalized);
        const lastNode = fragment.lastChild!;
        range.insertNode(fragment);
        range.setStartAfter(lastNode);
      }
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.emitChange();
    });
    this.canvas.addEventListener('keydown', (event) => this.handleMarkdownShortcut(event));
    this.root.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const command = button.dataset.command as FormatCommand;
        this.flushHistory();
        this.restoreSelection();
        this.canvas.focus();
        document.execCommand(command, false);
        this.emitChange();
      });
    });
    const blockType = this.root.querySelector<HTMLSelectElement>('[data-block-type]')!;
    blockType.addEventListener('change', () => {
      this.flushHistory();
      this.restoreSelection();
      this.canvas.focus();
      const value = blockType.value;
      document.execCommand('formatBlock', false, value);
      if (value === 'pre') {
        const selection = window.getSelection();
        const current = selection?.anchorNode?.parentElement?.closest('pre');
        if (current && !current.querySelector('code')) {
          const code = document.createElement('code');
          while (current.firstChild) code.append(current.firstChild);
          current.append(code);
        }
      }
      this.emitChange();
    });
    this.root.querySelector('[data-action="link"]')!.addEventListener('mousedown', (event) => event.preventDefault());
    this.root.querySelector('[data-action="link"]')!.addEventListener('click', () => {
      this.rememberSelection();
      const url = window.prompt('URL do link');
      if (!url) return;
      this.flushHistory();
      this.restoreSelection();
      this.canvas.focus();
      document.execCommand('createLink', false, url);
      this.emitChange();
    });
    this.root.querySelector('[data-action="image"]')!.addEventListener('mousedown', (event) => event.preventDefault());
    this.root.querySelector('[data-action="image"]')!.addEventListener('click', () => {
      this.rememberSelection();
      const url = window.prompt('URL ou caminho da imagem');
      if (!url) return;
      const alt = window.prompt('Texto alternativo (opcional)') ?? '';
      this.flushHistory();
      this.restoreSelection();
      this.canvas.focus();
      document.execCommand('insertHTML', false, `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`);
      this.emitChange();
    });
    const imageUploadButton = this.root.querySelector<HTMLButtonElement>('[data-action="upload-image"]')!;
    const imageFileInput = this.root.querySelector<HTMLInputElement>('[data-image-file]')!;
    imageUploadButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const selection = window.getSelection();
      this.imageRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      if (this.imageRange) this.savedRange = this.imageRange.cloneRange();
    });
    imageUploadButton.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', async () => {
      const file = imageFileInput.files?.[0];
      imageFileInput.value = '';
      if (!file || !this.onUploadImage) return;
      if (!file.type.startsWith('image/') || file.size === 0 || file.size > 15 * 1024 * 1024) return;
      try {
        const uploaded = await this.onUploadImage(file);
        if (uploaded) this.insertUploadedImage(uploaded);
      } catch {
        // O callback do Writer comunica erros na barra de estado.
      }
    });
    this.root.querySelector('[data-action="hr"]')!.addEventListener('mousedown', (event) => event.preventDefault());
    this.root.querySelector('[data-action="hr"]')!.addEventListener('click', () => {
      this.flushHistory();
      this.restoreSelection();
      this.canvas.focus();
      document.execCommand('insertHTML', false, '<hr><p><br></p>');
      this.emitChange();
    });
    this.blockControls.addEventListener('click', (event) => this.handleBlockControlClick(event));
    this.blockControls.addEventListener('dragstart', (event) => {
      const handle = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-block-index]');
      if (!handle || !event.dataTransfer) return;
      this.draggedBlockIndex = Number(handle.dataset.blockIndex);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-writer-block', String(this.draggedBlockIndex));
    });
    this.blockControls.addEventListener('dragend', () => {
      this.draggedBlockIndex = -1;
      this.canvas.querySelectorAll('.block-drop-before, .block-drop-after').forEach((node) => node.classList.remove('block-drop-before', 'block-drop-after'));
    });
    this.canvas.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('application/x-writer-block')) return;
      const target = this.topLevelBlockFrom(event.target);
      if (!target || !this.canvas.contains(target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.canvas.querySelectorAll('.block-drop-before, .block-drop-after').forEach((node) => node.classList.remove('block-drop-before', 'block-drop-after'));
      const rect = target.getBoundingClientRect();
      target.classList.add(event.clientY < rect.top + rect.height / 2 ? 'block-drop-before' : 'block-drop-after');
    });
    this.canvas.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.types.includes('application/x-writer-block')) return;
      const target = this.topLevelBlockFrom(event.target);
      const blocks = this.topLevelBlocks();
      const from = this.draggedBlockIndex;
      const to = target ? blocks.indexOf(target) : -1;
      if (from < 0 || to < 0 || from === to) return;
      event.preventDefault();
      this.flushHistory();
      const moving = blocks[from];
      const rect = blocks[to].getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      if (after) blocks[to].after(moving);
      else this.canvas.insertBefore(moving, blocks[to]);
      this.draggedBlockIndex = -1;
      this.canvas.querySelectorAll('.block-drop-before, .block-drop-after').forEach((node) => node.classList.remove('block-drop-before', 'block-drop-after'));
      this.emitChange();
    });
    this.blockMenu.addEventListener('click', (event) => this.handleBlockMenuClick(event));
    this.root.addEventListener('click', (event) => {
      if (!this.blockMenu.hidden && !this.blockMenu.contains(event.target as Node) && !this.blockControls.contains(event.target as Node)) this.closeBlockMenu();
    });
  }

  private nodePath(node: Node): number[] {
    const path: number[] = [];
    let current: Node = node;
    while (current !== this.canvas) {
      const parent = current.parentNode;
      if (!parent) return [];
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current) as number);
      current = parent;
    }
    return path;
  }

  private nodeAtPath(path: number[]): Node | null {
    let current: Node = this.canvas;
    for (const index of path) {
      const next = current.childNodes[index];
      if (!next) return null;
      current = next;
    }
    return current;
  }

  private captureHistorySnapshot(): BlockEditorHistorySnapshot {
    const selection = window.getSelection();
    const liveSelectionInside = Boolean(selection?.anchorNode && selection.focusNode &&
      this.canvas.contains(selection.anchorNode) && this.canvas.contains(selection.focusNode));
    const fallbackRange = this.savedRange && this.canvas.contains(this.savedRange.commonAncestorContainer)
      ? this.savedRange
      : null;
    const anchor = liveSelectionInside ? selection!.anchorNode! : fallbackRange?.startContainer ?? this.canvas;
    const focus = liveSelectionInside ? selection!.focusNode! : fallbackRange?.endContainer ?? anchor;
    return {
      html: this.canvas.innerHTML,
      anchorPath: this.nodePath(anchor),
      anchorOffset: liveSelectionInside ? selection!.anchorOffset : fallbackRange?.startOffset ?? this.canvas.childNodes.length,
      focusPath: this.nodePath(focus),
      focusOffset: liveSelectionInside ? selection!.focusOffset : fallbackRange?.endOffset ?? this.canvas.childNodes.length,
    };
  }

  private commitHistorySnapshot(): void {
    const snapshot = this.captureHistorySnapshot();
    const current = this.history[this.historyIndex];
    if (current?.html === snapshot.html) {
      this.history[this.historyIndex] = snapshot;
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  private flushHistory(): void {
    if (this.historyTimer) {
      clearTimeout(this.historyTimer);
      this.historyTimer = null;
    }
    this.commitHistorySnapshot();
  }

  private scheduleHistorySnapshot(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null;
      this.commitHistorySnapshot();
    }, 350);
  }

  private resetHistory(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.history = [this.captureHistorySnapshot()];
    this.historyIndex = 0;
  }

  private restoreHistory(direction: 'undo' | 'redo'): void {
    this.flushHistory();
    const nextIndex = direction === 'undo' ? this.historyIndex - 1 : this.historyIndex + 1;
    if (nextIndex < 0 || nextIndex >= this.history.length) return;
    this.historyIndex = nextIndex;
    const snapshot = this.history[nextIndex];
    this.canvas.innerHTML = snapshot.html;
    this.canvas.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      const markdownSrc = image.dataset.markdownSrc ?? image.getAttribute('src') ?? '';
      image.dataset.markdownSrc = markdownSrc;
      if (this.resolveImageUrl) image.src = this.resolveImageUrl(markdownSrc);
    });
    const anchor = this.nodeAtPath(snapshot.anchorPath) ?? this.canvas;
    const focus = this.nodeAtPath(snapshot.focusPath) ?? anchor;
    const selection = window.getSelection();
    if (selection) {
      const anchorOffset = Math.min(snapshot.anchorOffset, anchor.nodeType === Node.TEXT_NODE ? (anchor.textContent ?? '').length : anchor.childNodes.length);
      const focusOffset = Math.min(snapshot.focusOffset, focus.nodeType === Node.TEXT_NODE ? (focus.textContent ?? '').length : focus.childNodes.length);
      selection.removeAllRanges();
      try {
        selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
      } catch {
        const range = document.createRange();
        range.setStart(anchor, anchorOffset);
        range.collapse(true);
        selection.addRange(range);
      }
    }
    this.closeBlockMenu();
    this.rememberSelection();
    this.refreshBlockControls();
    this.onChange(this.getMarkdown());
  }

  private rememberSelection(): void {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (this.canvas.contains(range.commonAncestorContainer)) this.savedRange = range.cloneRange();
  }

  private restoreSelection(): boolean {
    const selection = window.getSelection();
    if (!selection || !this.savedRange || !this.canvas.contains(this.savedRange.commonAncestorContainer)) return false;
    this.canvas.focus();
    selection.removeAllRanges();
    selection.addRange(this.savedRange);
    return true;
  }

  private topLevelBlocks(): HTMLElement[] {
    return Array.from(this.canvas.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  }

  private topLevelBlockFrom(target: EventTarget | null): HTMLElement | null {
    let element = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
    while (element && element.parentElement !== this.canvas) element = element.parentElement;
    return element;
  }

  private refreshBlockControls(): void {
    if (!this.blockControls || !this.canvas.isConnected) return;
    this.blockControls.replaceChildren();
    const rootRect = this.root.getBoundingClientRect();
    this.topLevelBlocks().forEach((block, index) => {
      const rect = block.getBoundingClientRect();
      if (rect.height === 0 && !block.textContent?.trim()) return;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.draggable = true;
      handle.className = 'block-editor-block-handle';
      handle.textContent = '⋮⋮';
      handle.title = 'Ações do bloco';
      handle.setAttribute('aria-label', `Ações do bloco ${index + 1}`);
      handle.dataset.blockIndex = String(index);
      handle.classList.toggle('is-visible', index === this.hoveredBlockIndex);
      handle.style.top = `${rect.top - rootRect.top + this.root.scrollTop + Math.min(8, rect.height / 2)}px`;
      this.blockControls.append(handle);
    });
    if (!this.blockMenu.hidden) {
      const index = Number(this.blockMenu.dataset.blockIndex);
      if (Number.isInteger(index) && index >= 0 && index < this.topLevelBlocks().length) {
        const block = this.topLevelBlocks()[index];
        const rect = block.getBoundingClientRect();
        this.blockMenu.style.top = `${rect.top - rootRect.top + this.root.scrollTop + 24}px`;
      } else {
        this.closeBlockMenu();
      }
    }
  }

  private handleBlockControlClick(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-block-index]');
    if (!button) return;
    const index = Number(button.dataset.blockIndex);
    const blocks = this.topLevelBlocks();
    if (!Number.isInteger(index) || !blocks[index]) return;
    this.blockMenu.dataset.blockIndex = String(index);
    this.blockMenu.innerHTML = [
      '<button type="button" role="menuitem" data-block-action="up">Mover para cima</button>',
      '<button type="button" role="menuitem" data-block-action="down">Mover para baixo</button>',
      '<button type="button" role="menuitem" data-block-action="duplicate">Duplicar bloco</button>',
      '<button type="button" role="menuitem" data-block-action="delete">Excluir bloco</button>',
    ].join('');
    this.blockMenu.style.top = `${Number.parseFloat(button.style.top) + 24}px`;
    this.blockMenu.hidden = false;
    this.blockMenu.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private handleBlockMenuClick(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-block-action]');
    if (!button) return;
    const index = Number(this.blockMenu.dataset.blockIndex);
    const blocks = this.topLevelBlocks();
    const block = blocks[index];
    if (!block) return;
    this.flushHistory();
    const action = button.dataset.blockAction;
    if (action === 'up' && index > 0) {
      this.canvas.insertBefore(block, blocks[index - 1]);
      this.focusBlock(block, false);
    } else if (action === 'down' && index < blocks.length - 1) {
      this.canvas.insertBefore(blocks[index + 1], block);
      this.focusBlock(block, false);
    } else if (action === 'duplicate') {
      const copy = block.cloneNode(true) as HTMLElement;
      block.after(copy);
      this.focusBlock(copy, true);
    } else if (action === 'delete') {
      block.remove();
      if (!this.canvas.children.length) {
        const paragraph = document.createElement('p');
        paragraph.append(document.createElement('br'));
        this.canvas.append(paragraph);
        this.focusBlock(paragraph, true);
      } else {
        const next = this.canvas.children[Math.min(index, this.canvas.children.length - 1)] as HTMLElement;
        this.focusBlock(next, true);
      }
    }
    this.closeBlockMenu();
    this.emitChange();
  }

  private focusBlock(block: HTMLElement, atStart: boolean): void {
    this.canvas.focus();
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(atStart);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    this.savedRange = range.cloneRange();
  }

  private closeBlockMenu(): void {
    this.blockMenu.hidden = true;
    this.blockMenu.replaceChildren();
  }

  setMarkdown(markdown: string): void {
    const html = marked.parse(markdown || '', { async: false });
    const sanitized = DOMPurify.sanitize(typeof html === 'string' ? html : String(html));
    this.canvas.innerHTML = sanitized || '<p><br></p>';
    this.canvas.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      const markdownSrc = image.getAttribute('src') ?? '';
      image.dataset.markdownSrc = markdownSrc;
      if (this.resolveImageUrl) image.src = this.resolveImageUrl(markdownSrc);
    });
    this.refreshBlockControls();
    this.resetHistory();
  }

  getMarkdown(): string {
    // contenteditable can leave inline nodes directly under the canvas (for example
    // after pasting text or pressing Enter in different browsers). Treat consecutive
    // inline nodes as one paragraph instead of accidentally separating every word.
    const output: string[] = [];
    let inlineNodes: Node[] = [];
    const blockTags = new Set([
      'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR',
    ]);
    const flushInline = () => {
      if (inlineNodes.length === 0) return;
      const paragraph = inlineNodes.map(inlineMarkdown).join('');
      if (paragraph.trim()) output.push(paragraph);
      inlineNodes = [];
    };

    for (const node of Array.from(this.canvas.childNodes)) {
      if (node instanceof HTMLElement && blockTags.has(node.tagName)) {
        flushInline();
        const markdown = blockMarkdown(node);
        if (markdown.trim()) output.push(markdown);
      } else {
        inlineNodes.push(node);
      }
    }
    flushInline();
    return output.join('\n\n').replace(/^\n+|\n+$/g, '');
  }

  insertBlock(kind: string, removeSlashCommand = false): void {
    this.flushHistory();
    this.restoreSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      const end = document.createRange();
      end.selectNodeContents(this.canvas);
      end.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(end);
    }

    let anchor = selection?.anchorNode ?? null;
    if (removeSlashCommand && anchor?.nodeType === Node.TEXT_NODE && selection) {
      const text = anchor as Text;
      const before = text.data.slice(0, selection.anchorOffset);
      const match = /(?:^|\s)(\/[a-z]*)$/i.exec(before);
      if (match) {
        const start = selection.anchorOffset - match[1].length;
        text.deleteData(start, match[1].length);
        selection.collapse(text, start);
        anchor = text;
      }
    }

    let current = anchor instanceof HTMLElement ? anchor : anchor?.parentElement ?? null;
    const activeListItem = current?.closest('li');
    if (activeListItem && this.canvas.contains(activeListItem)) {
      current = activeListItem;
    } else {
      while (current && current.parentElement !== this.canvas) current = current.parentElement;
    }
    if (!current || current === this.canvas) {
      current = document.createElement('p');
      current.append(document.createElement('br'));
      this.canvas.append(current);
    }

    // Slash commands inside a list must operate on the current item, not replace
    // the entire UL/OL and destroy the neighboring items.
    if (current.tagName === 'LI') {
      const item = current;
      const list = item.parentElement;
      if (list && (list.tagName === 'UL' || list.tagName === 'OL')) {
        if (kind === 'ul' || kind === 'ol') {
          const nestedList = document.createElement(kind);
          const nestedItem = document.createElement('li');
          while (item.firstChild) nestedItem.append(item.firstChild);
          if (!nestedItem.hasChildNodes()) nestedItem.append(document.createElement('br'));
          nestedList.append(nestedItem);
          item.append(nestedList);
          this.focusBlock(nestedItem, false);
          this.closeBlockMenu();
          this.refreshBlockControls();
          this.emitChange();
          return;
        }

        const items = Array.from(list.children).filter((child): child is HTMLElement => child.tagName === 'LI');
        const itemIndex = items.indexOf(item);
        const makeList = () => {
          const copy = document.createElement(list.tagName.toLowerCase());
          Array.from(list.attributes).forEach((attribute) => copy.setAttribute(attribute.name, attribute.value));
          return copy;
        };
        const beforeItems = items.slice(0, itemIndex);
        const afterItems = items.slice(itemIndex + 1);
        const beforeList = beforeItems.length ? makeList() : null;
        const afterList = afterItems.length ? makeList() : null;
        beforeItems.forEach((entry) => beforeList!.append(entry));
        afterItems.forEach((entry) => afterList!.append(entry));
        if (afterList && list.tagName === 'OL') {
          const originalStart = Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1;
          afterList.setAttribute('start', String(originalStart + itemIndex + 1));
        }

        const replacement: HTMLElement[] = [];
        if (beforeList) replacement.push(beforeList);
        let focusTarget: HTMLElement;
        if (kind === 'hr') {
          const paragraph = document.createElement('p');
          while (item.firstChild) paragraph.append(item.firstChild);
          if (!paragraph.hasChildNodes()) paragraph.append(document.createElement('br'));
          const divider = document.createElement('hr');
          const afterParagraph = document.createElement('p');
          afterParagraph.append(document.createElement('br'));
          replacement.push(paragraph, divider, afterParagraph);
          focusTarget = afterParagraph;
        } else if (kind === 'blockquote') {
          const quote = document.createElement('blockquote');
          const paragraph = document.createElement('p');
          while (item.firstChild) paragraph.append(item.firstChild);
          if (!paragraph.hasChildNodes()) paragraph.append(document.createElement('br'));
          quote.append(paragraph);
          replacement.push(quote);
          focusTarget = paragraph;
        } else if (kind === 'pre') {
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.textContent = item.textContent ?? '';
          if (!code.textContent) code.append(document.createElement('br'));
          pre.append(code);
          replacement.push(pre);
          focusTarget = code;
        } else if (/^h[1-3]$/.test(kind) || kind === 'p') {
          const block = document.createElement(kind);
          while (item.firstChild) block.append(item.firstChild);
          if (!block.hasChildNodes()) block.append(document.createElement('br'));
          replacement.push(block);
          focusTarget = block;
        } else {
          return;
        }
        if (afterList) replacement.push(afterList);
        list.replaceWith(...replacement);
        this.focusBlock(focusTarget, false);
        this.closeBlockMenu();
        this.refreshBlockControls();
        this.emitChange();
        return;
      }
    }

    if (kind === 'hr') {
      const divider = document.createElement('hr');
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      current.after(divider, paragraph);
      this.focusBlock(paragraph, true);
    } else if (kind === 'ul' || kind === 'ol') {
      const list = document.createElement(kind);
      const item = document.createElement('li');
      while (current.firstChild) item.append(current.firstChild);
      if (!item.hasChildNodes()) item.append(document.createElement('br'));
      list.append(item);
      current.replaceWith(list);
      this.focusBlock(item, false);
    } else if (kind === 'blockquote') {
      const quote = document.createElement('blockquote');
      const paragraph = document.createElement('p');
      while (current.firstChild) paragraph.append(current.firstChild);
      if (!paragraph.hasChildNodes()) paragraph.append(document.createElement('br'));
      quote.append(paragraph);
      current.replaceWith(quote);
      this.focusBlock(paragraph, false);
    } else if (kind === 'pre') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = current.textContent ?? '';
      if (!code.textContent) code.append(document.createElement('br'));
      pre.append(code);
      current.replaceWith(pre);
      this.focusBlock(code, false);
    } else if (/^h[1-3]$/.test(kind) || kind === 'p') {
      const block = document.createElement(kind);
      while (current.firstChild) block.append(current.firstChild);
      if (!block.hasChildNodes()) block.append(document.createElement('br'));
      current.replaceWith(block);
      this.focusBlock(block, false);
    } else {
      return;
    }

    this.closeBlockMenu();
    this.refreshBlockControls();
    this.emitChange();
  }

  focus(): void {
    this.canvas.focus();
  }

  private handleMarkdownShortcut(event: KeyboardEvent): void {
    if (this.composing) return;
    const selection = window.getSelection();

    // Alt/Option + Shift + Arrow moves the current top-level block without requiring drag-and-drop.
    if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && selection?.anchorNode) {
      const node = selection.anchorNode;
      let block = node instanceof HTMLElement ? node : node.parentElement;
      while (block && block.parentElement !== this.canvas) block = block.parentElement;
      const blocks = this.topLevelBlocks();
      const index = block ? blocks.indexOf(block) : -1;
      const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
      if (index >= 0 && targetIndex >= 0 && targetIndex < blocks.length) {
        event.preventDefault();
        this.flushHistory();
        if (event.key === 'ArrowUp') this.canvas.insertBefore(blocks[index], blocks[targetIndex]);
        else this.canvas.insertBefore(blocks[targetIndex], blocks[index]);
        this.emitChange();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.restoreHistory(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.restoreHistory('redo');
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Backspace' && selection?.isCollapsed && selection.anchorNode) {
      const node = selection.anchorNode;
      let current = node instanceof HTMLElement ? node : node.parentElement;
      while (current && current.parentElement !== this.canvas) current = current.parentElement;
      const blocks = this.topLevelBlocks();
      const index = current ? blocks.indexOf(current) : -1;
      const supported = (element: HTMLElement | undefined) => Boolean(element && /^(P|H1|H2|H3|H4)$/.test(element.tagName));
      if (index > 0 && current && supported(current) && supported(blocks[index - 1])) {
        const beforeCaret = document.createRange();
        beforeCaret.selectNodeContents(current);
        beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset);
        if (beforeCaret.toString().length === 0) {
          event.preventDefault();
          this.flushHistory();
          const previous = blocks[index - 1];
          const isEmpty = !(current.textContent ?? '').trim() && !current.querySelector('img, table, hr');
          if (isEmpty) {
            current.remove();
            this.focusBlock(previous, false);
          } else {
            if ((previous.textContent ?? '').trim() && (current.textContent ?? '').trim()) previous.append(document.createTextNode(' '));
            while (current.firstChild) previous.append(current.firstChild);
            current.remove();
            this.focusBlock(previous, false);
          }
          this.emitChange();
          return;
        }
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && selection?.isCollapsed && selection.anchorNode) {
      const anchor = selection.anchorNode;
      const currentBlock = (anchor instanceof HTMLElement ? anchor : anchor.parentElement)
        ?.closest('p, div, h1, h2, h3, h4, li, pre');
      const isEmpty = !(currentBlock?.textContent ?? '').trim() &&
        !(currentBlock?.querySelector('img, table, ul, ol, hr') );
      if (currentBlock && isEmpty && this.canvas.contains(currentBlock)) {
        const listItem = currentBlock.closest('li');
        const list = listItem?.parentElement;
        const isHeading = /^H[1-4]$/.test(currentBlock.tagName);
        const isEmptyCode = currentBlock.tagName === 'PRE';
        if (listItem && list && (list.tagName === 'UL' || list.tagName === 'OL')) {
          event.preventDefault();
          this.flushHistory();
          const paragraph = document.createElement('p');
          paragraph.append(document.createElement('br'));
          if (list.children.length > 1) {
            listItem.remove();
            list.after(paragraph);
          } else {
            list.replaceWith(paragraph);
          }
          this.focusBlock(paragraph, true);
          this.emitChange();
          return;
        }
        if (isHeading || isEmptyCode) {
          event.preventDefault();
          this.flushHistory();
          const paragraph = document.createElement('p');
          paragraph.append(document.createElement('br'));
          currentBlock.replaceWith(paragraph);
          this.focusBlock(paragraph, true);
          this.emitChange();
          return;
        }
      }
      const quote = currentBlock?.closest('blockquote');
      if (currentBlock && quote && this.canvas.contains(quote) && !(currentBlock.textContent ?? '').trim()) {
        event.preventDefault();
        this.flushHistory();
        const paragraph = document.createElement('p');
        paragraph.append(document.createElement('br'));
        const hasEarlierQuoteContent = Array.from(quote.childNodes).some((node) => {
          if (node === currentBlock) return false;
          if ((node.textContent ?? '').trim().length > 0) return true;
          // Empty-text elements can still contain meaningful content, such as images.
          return node instanceof HTMLElement &&
            (node.matches('img, table, pre, ul, ol, hr') ||
              Boolean(node.querySelector('img, table, pre, ul, ol, hr')));
        });
        if (hasEarlierQuoteContent) {
          currentBlock.remove();
          quote.after(paragraph);
        } else {
          quote.replaceWith(paragraph);
        }
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        this.emitChange();
        return;
      }
    }

    if (event.key !== ' ' && event.key !== 'Enter') return;
    if (!selection?.isCollapsed || !selection.anchorNode) return;
    const anchor = selection.anchorNode;
    const block = (anchor instanceof HTMLElement ? anchor : anchor.parentElement)
      ?.closest('p, div, h1, h2, h3, h4');
    if (!block || block === this.canvas || !this.canvas.contains(block)) return;

    // Only convert a command when the caret is at the end of a plain, otherwise empty block.
    const text = block.textContent ?? '';
    const atEnd = anchor.nodeType === Node.TEXT_NODE
      ? selection.anchorOffset === (anchor.textContent ?? '').length
      : selection.anchorOffset === anchor.childNodes.length;
    if (!atEnd || text !== text.trim()) return;

    const heading = /^(#{1,3})$/.exec(text);
    const unordered = /^[-+*]$/.test(text);
    const ordered = /^1\.$/.test(text);
    const quote = text === '>';
    const codeFence = text === '```';

    if (event.key === ' ' && !heading && !unordered && !ordered && !quote) return;
    if (event.key === 'Enter' && !codeFence) return;
    if (event.key === ' ' && codeFence) return;

    event.preventDefault();
    let target: HTMLElement;

    if (heading) {
      this.flushHistory();
      target = document.createElement(`h${heading[1].length}`);
      block.replaceWith(target);
    } else if (unordered || ordered) {
      this.flushHistory();
      const list = document.createElement(ordered ? 'ol' : 'ul');
      const item = document.createElement('li');
      item.append(document.createElement('br'));
      list.append(item);
      block.replaceWith(list);
      target = item;
    } else if (quote) {
      this.flushHistory();
      const quoteBlock = document.createElement('blockquote');
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      quoteBlock.append(paragraph);
      block.replaceWith(quoteBlock);
      target = paragraph;
    } else {
      this.flushHistory();
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.append(document.createElement('br'));
      pre.append(code);
      block.replaceWith(pre);
      target = code;
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    this.emitChange();
  }

  private insertUploadedImage(uploaded: UploadedImage): void {
    this.flushHistory();
    const image = document.createElement('img');
    image.dataset.markdownSrc = uploaded.name;
    image.src = this.resolveImageUrl ? this.resolveImageUrl(uploaded.name) : uploaded.name;
    image.alt = uploaded.alt || '';
    image.loading = 'lazy';
    const selection = window.getSelection();
    let range = this.imageRange;
    if (!range || !this.canvas.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(this.canvas);
      range.collapse(false);
    }
    this.canvas.focus();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.deleteContents();
    if (range.startContainer === this.canvas) {
      const paragraph = document.createElement('p');
      paragraph.append(image);
      range.insertNode(paragraph);
      range.setStartAfter(paragraph);
    } else {
      range.insertNode(image);
      range.setStartAfter(image);
    }
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    this.imageRange = null;
    this.emitChange();
  }

  private handleInlineMarkdownShortcut(): void {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!selection?.isCollapsed || !anchor || anchor.nodeType !== Node.TEXT_NODE) return;

    const textNode = anchor as Text;
    const offset = selection.anchorOffset;
    const beforeCaret = textNode.data.slice(0, offset);
    const bold = /(\*\*|__)(\S(?:.*?\S)?)\1$/.exec(beforeCaret);
    const italic = /\*([^*\n]+)\*$/.exec(beforeCaret);
    const match = bold ?? italic;
    if (!match) return;

    const marker = bold ? match[1] : '*';
    const start = offset - match[0].length;
    const contentStart = start + marker.length;
    const contentEnd = offset - marker.length;
    if (contentEnd <= contentStart) return;

    const element = document.createElement(bold ? 'strong' : 'em');
    element.textContent = textNode.data.slice(contentStart, contentEnd);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, offset);
    range.deleteContents();
    range.insertNode(element);
    range.setStartAfter(element);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private emitChange(): void {
    this.rememberSelection();
    this.refreshBlockControls();
    this.scheduleHistorySnapshot();
    this.onChange(this.getMarkdown());
  }
}
