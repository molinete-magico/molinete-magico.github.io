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
    window.writerEditor.setMarkdown('alpha');
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
  expect(markdown).toBe('- Parent\n  - Child\n  - Second child\n- Sibling');
});

test('image Markdown survives editor load and serialization', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    window.writerEditor.setMarkdown('Before\n\n![mapa da área](/content/posts/demo/mapa-area.png)\n\nAfter');
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('Before\n\n![mapa da área](/content/posts/demo/mapa-area.png)\n\nAfter');
});


test('Enter splits a paragraph and Backspace at the start joins it again', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('alphabeta');
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('#markdown')).toHaveText('alpha\n\nbeta');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#markdown')).toHaveText('alpha beta');
});

test('block action menu converts a paragraph to a heading without losing its text', async ({ page }) => {
  await page.locator('.block-editor-canvas').evaluate((element) => {
    window.writerEditor.setMarkdown('Keep this heading text');
  });
  await page.getByRole('button', { name: 'Ações do bloco 1' }).click();
  await page.getByRole('menuitem', { name: 'Converter em título 2' }).click();
  await expect(page.locator('.block-editor-canvas h2')).toHaveText('Keep this heading text');
  await expect(page.locator('#markdown')).toHaveText('## Keep this heading text');
});

test('strikethrough keyboard shortcut serializes as Markdown', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('selected text');
    element.focus();
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Control+Shift+x');
  await expect(page.locator('#markdown')).toHaveText('~~selected~~ text');
});


test('Tab nests a list item under the previous item', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('- parent\n- child');
    const child = element.querySelectorAll('li')[1];
    const text = child.firstChild!;
    const range = document.createRange();
    range.setStart(text, text.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
  });
  await page.keyboard.press('Tab');
  await expect(canvas.locator('ul > li > ul > li')).toHaveText('child');
  await expect(page.locator('#markdown')).toHaveText('- parent\n  - child');
});


test('Shift+Tab moves a nested list item back to its parent list', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('- parent\n  - child\n- sibling');
    const child = element.querySelector('ul ul li')!;
    const text = child.firstChild!;
    const range = document.createRange();
    range.setStart(text, text.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
  });
  await page.keyboard.press('Shift+Tab');
  await expect(canvas.locator('ul > li')).toHaveCount(3);
  await expect(page.locator('#markdown')).toHaveText('- parent\n- child\n- sibling');
});


test('Alt+Shift+ArrowDown reorders a top-level block', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('first\n\nsecond');
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
  });
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(page.locator('#markdown')).toHaveText('second\n\nfirst');
});


test('rich paste preserves safe formatting and strips executable markup', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  const markdown = await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('before after');
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 12);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    const clipboard = new DataTransfer();
    clipboard.setData('text/html', '<p><strong>bold</strong> <a href="https://example.com">link</a><script>window.pastedScript = true</script></p>');
    clipboard.setData('text/plain', 'bold link');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toContain('**bold**');
  expect(markdown).toContain('[link](https://example.com)');
  expect(markdown).not.toContain('pastedScript');
});

test('table Tab moves between cells and adds a row at the end', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    window.writerEditor.setMarkdown('| A | B |\n| --- | --- |\n| C | D |');
    const cell = element.querySelector('tbody td')!;
    const range = document.createRange(); range.selectNodeContents(cell); range.collapse(true);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.focus();
  });
  await page.keyboard.press('Tab');
  await expect.poll(() => canvas.evaluate((element) => window.getSelection()?.anchorNode?.parentElement?.closest('td,th')?.textContent)).toBe('D');
  await expect(canvas.locator('tbody tr')).toHaveCount(1);
  await page.locator('.block-editor-canvas tbody td').last().evaluate((cell) => {
    const range = document.createRange(); range.selectNodeContents(cell); range.collapse(true);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('Tab');
  await expect(canvas.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('#markdown')).toContainText('| --- | --- |');
});

test('image size and alignment survive Markdown serialization', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    window.writerEditor.setMarkdown('![map](/media/map.png "width=320 align=center")');
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('![map](/media/map.png "width=320 align=center")');
});

test('multi-block selection can duplicate a contiguous range', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => window.writerEditor.setMarkdown('first\n\nsecond\n\nthird'));
  await page.locator('.block-editor-block-handle[data-block-index="0"]').click();
  await page.locator('.block-editor-block-handle[data-block-index="1"]').click({ modifiers: ['Shift'] });
  await page.getByRole('menuitem', { name: 'Duplicar seleção' }).click();
  await expect(page.locator('#markdown')).toHaveText('first\n\nsecond\n\nfirst\n\nsecond\n\nthird');
});

test('heading levels five and six survive Markdown serialization', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    element.innerHTML = '<h5>Heading five</h5><h6>Heading six</h6>';
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('##### Heading five\n\n###### Heading six');
});

test('code blocks use a longer fence when code contains triple backticks', async ({ page }) => {
  const markdown = await page.locator('.block-editor-canvas').evaluate((element) => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-js';
    code.textContent = 'const fence = ' + String.fromCharCode(96).repeat(3) + ';';
    pre.append(code);
    element.replaceChildren(pre);
    return window.writerEditor.getMarkdown();
  });
  expect(markdown).toBe('````js\nconst fence = ```;\n````');
});

test('block ranges can be selected and duplicated with the keyboard', async ({ page }) => {
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => window.writerEditor.setMarkdown('first\n\nsecond\n\nthird'));
  await page.locator('.block-editor-block-handle[data-block-index="1"]').focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.getByRole('menuitem', { name: 'Duplicar seleção' }).click();
  await expect(page.locator('#markdown')).toHaveText('first\n\nsecond\n\nthird\n\nsecond\n\nthird');
});
