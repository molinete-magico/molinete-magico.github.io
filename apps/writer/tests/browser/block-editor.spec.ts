import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('typing updates the Markdown output without splitting a paragraph', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    element.innerHTML = '<p>Hello</p>';
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, text.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(' world');
  await expect(page.locator('#markdown')).toHaveText('Hello world');
});

test('pasting multiline text preserves the selected insertion point and trailing text', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    element.innerHTML = '<p>start end tail</p>';
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 9);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'one\ntwo');
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: clipboard,
      bubbles: true,
      cancelable: true,
    }));
  });
  await expect(page.locator('#markdown')).toHaveText('start one  \ntwo tail');
  await expect(canvas).toContainText('start');
  await expect(canvas).toContainText('two');
});

test('consecutive inline nodes remain one paragraph in Markdown', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    element.innerHTML = 'alpha <strong>beta</strong> gamma';
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('alpha **beta** gamma');
});

test('ordered list serialization preserves an explicit zero start and item value', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    element.innerHTML = '<ol start="0"><li value="0">zero</li><li>one</li></ol>';
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('0. zero\n1. one');
});


test('undo and redo shortcuts restore the previous and next editor snapshots', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    element.innerHTML = '<p>alpha</p>';
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, text.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(' beta');
  await expect(page.locator('#markdown')).toHaveText('alpha beta');
  await page.waitForTimeout(450);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#markdown')).toHaveText('alpha');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#markdown')).toHaveText('alpha beta');
});

test('nested unordered lists serialize with stable indentation', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    element.innerHTML = '<ul><li>Parent<ul><li>Child</li><li>Second child</li></ul></li><li>Sibling</li></ul>';
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('- Parent\\n  - Child\\n  - Second child\\n- Sibling');
});

test('image Markdown survives editor load and serialization', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    window.writerEditor.setMarkdown('Before\\n\\n![mapa da área](/content/posts/demo/mapa-area.png)\\n\\nAfter');
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('Before\\n\\n![mapa da área](/content/posts/demo/mapa-area.png)\\n\\nAfter');
});
