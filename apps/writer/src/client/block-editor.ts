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
    return (node.textContent ?? '').replace(/\\/g, '\\\\').replace(/([*_\[\]\\])/g, '\\$1');
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
    case 'CODE': return `\u0060${(node.textContent ?? '').replace(/\u0060/g, '\\u0060')}\u0060`;
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      return href ? `[${children}](${href.replace(/\)/g, '%29')})` : children;
    }
    case 'IMG': {
      const src = node.getAttribute('src') ?? '';
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
  const inline = Array.from(node.childNodes).map(inlineMarkdown).join('').trim();
  switch (node.tagName) {
    case 'H1': return `# ${inline}`;
    case 'H2': return `## ${inline}`;
    case 'H3': return `### ${inline}`;
    case 'H4': return `#### ${inline}`;
    case 'P':
    case 'DIV': return inline;
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

export class BlockEditor {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLDivElement;
  private readonly onChange: (markdown: string) => void;
  private composing = false;

  constructor(host: HTMLElement, onChange: (markdown: string) => void) {
    this.root = host;
    this.onChange = onChange;
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
        <button type="button" data-action="image" title="Inserir imagem por URL">Imagem</button>
        <button type="button" data-action="hr" title="Inserir divisor">Divisor</button>
      </div>
      <div class="block-editor-canvas" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Documento" spellcheck="true"></div>
    `;
    this.canvas = this.root.querySelector<HTMLDivElement>('.block-editor-canvas')!;
    this.canvas.addEventListener('compositionstart', () => { this.composing = true; });
    this.canvas.addEventListener('compositionend', () => {
      this.composing = false;
      this.emitChange();
    });
    this.canvas.addEventListener('input', () => {
      if (!this.composing) this.emitChange();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const command = button.dataset.command as FormatCommand;
        this.canvas.focus();
        document.execCommand(command, false);
        this.emitChange();
      });
    });
    const blockType = this.root.querySelector<HTMLSelectElement>('[data-block-type]')!;
    blockType.addEventListener('change', () => {
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
      const url = window.prompt('URL do link');
      if (!url) return;
      this.canvas.focus();
      document.execCommand('createLink', false, url);
      this.emitChange();
    });
    this.root.querySelector('[data-action="image"]')!.addEventListener('mousedown', (event) => event.preventDefault());
    this.root.querySelector('[data-action="image"]')!.addEventListener('click', () => {
      const url = window.prompt('URL ou caminho da imagem');
      if (!url) return;
      const alt = window.prompt('Texto alternativo (opcional)') ?? '';
      this.canvas.focus();
      document.execCommand('insertHTML', false, `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`);
      this.emitChange();
    });
    this.root.querySelector('[data-action="hr"]')!.addEventListener('mousedown', (event) => event.preventDefault());
    this.root.querySelector('[data-action="hr"]')!.addEventListener('click', () => {
      this.canvas.focus();
      document.execCommand('insertHTML', false, '<hr><p><br></p>');
      this.emitChange();
    });
  }

  setMarkdown(markdown: string): void {
    const html = marked.parse(markdown || '', { async: false });
    this.canvas.innerHTML = DOMPurify.sanitize(typeof html === 'string' ? html : String(html));
  }

  getMarkdown(): string {
    return Array.from(this.canvas.childNodes).map(blockMarkdown).filter((part) => part.length > 0).join('\n\n').trim();
  }

  focus(): void {
    this.canvas.focus();
  }

  private emitChange(): void {
    this.onChange(this.getMarkdown());
  }
}
