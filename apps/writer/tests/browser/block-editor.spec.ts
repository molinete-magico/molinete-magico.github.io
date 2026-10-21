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
