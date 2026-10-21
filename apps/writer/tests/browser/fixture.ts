import { BlockEditor } from '../../src/client/block-editor.js';

declare global {
  interface Window {
    writerEditor: BlockEditor;
    writerChanges: string[];
  }
}

document.body.innerHTML = `
  <main>
    <h1>Writer browser test fixture</h1>
    <div id="editor-host"></div>
    <output id="markdown" aria-label="Markdown output"></output>
  </main>
`;

window.writerChanges = [];
window.writerEditor = new BlockEditor(
  document.querySelector<HTMLElement>('#editor-host')!,
  (markdown) => {
    window.writerChanges.push(markdown);
    document.querySelector<HTMLOutputElement>('#markdown')!.textContent = markdown;
  },
);
window.writerEditor.setMarkdown('Initial text');
