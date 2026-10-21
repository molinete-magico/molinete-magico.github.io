import { expect, test } from '@playwright/test';

async function openTestPost(page: import('@playwright/test').Page) {
  await page.goto('/v2');
  const post = page.locator('[data-kind="post"][data-id="e2e-post"]');
  await expect(post).toBeVisible();
  await post.click();
  await expect(page.locator('.block-editor-canvas')).toBeVisible();
}

async function placeCaretAtEnd(page: import('@playwright/test').Page) {
  await page.locator('.block-editor-canvas').evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

test('recovers unsaved edits after reload and reopening the same post', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await openTestPost(page);
  await placeCaretAtEnd(page);
  await page.keyboard.type(' recuperação local');
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('writer-v2-recovery');
    return Boolean(raw && JSON.parse(raw).body?.includes('recuperação local'));
  }, { timeout: 5000 });

  await page.reload();
  await expect(page.locator('[data-kind="post"][data-id="e2e-post"]')).toBeVisible();
  await page.locator('[data-kind="post"][data-id="e2e-post"]').click();
  await expect(page.locator('.block-editor-canvas')).toContainText('recuperação local');
  await expect(page.locator('#status-line')).toContainText('não salvas');
});

test('edits made during a pending save remain dirty and can be saved afterward', async ({ page }) => {
  await openTestPost(page);
  const canvas = page.locator('.block-editor-canvas');
  let releaseFirstSave!: () => void;
  let announceFirstSave!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  const firstSaveStarted = new Promise<void>((resolve) => { announceFirstSave = resolve; });
  let delayFirstSave = true;

  await page.route('**/api/post/save', async (route) => {
    if (delayFirstSave) {
      delayFirstSave = false;
      announceFirstSave();
      await gate;
    }
    await route.continue();
  });

  await page.locator('#save-document').click();
  await firstSaveStarted;
  await placeCaretAtEnd(page);
  await page.keyboard.type(' editado durante o salvamento');
  releaseFirstSave();

  await expect(page.locator('#status-line')).toContainText('edições mais recentes ainda não salvas', { timeout: 10_000 });
  await page.unroute('**/api/post/save');
  await page.locator('#save-document').click();
  await expect(page.locator('#status-line')).toContainText('Salvo com sucesso', { timeout: 10_000 });

  await expect.poll(async () => {
    const response = await page.request.get('/api/post/e2e-post');
    const post = await response.json() as { body: string };
    return post.body;
  }).toContain('editado durante o salvamento');
});


test('updates writing statistics and builds a clickable heading outline', async ({ page }) => {
  await openTestPost(page);
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    element.innerHTML = '<h1>Introduction</h1><h2>First chapter</h2><p>Four words are here</p>';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'test' }));
  });
  await expect(page.locator('#word-count')).toContainText('7 palavras');
  await expect(page.locator('#character-count')).not.toBeEmpty();
  await expect(page.locator('#heading-outline .heading-outline-item')).toHaveCount(2);
  await expect(page.locator('#heading-outline')).toContainText('Introduction');
  await page.locator('#outline-toggle').click();
  await page.locator('#heading-outline .heading-outline-item').nth(1).click();
  await expect(canvas.locator('h2').first()).toBeFocused();
});

test('word goal is remembered and displays progress', async ({ page }) => {
  await openTestPost(page);
  const goal = page.locator('#word-goal');
  await goal.fill('100');
  await expect(page.locator('#goal-progress')).toContainText('%');
  await page.reload();
  await expect(page.locator('[data-kind="post"][data-id="e2e-post"]')).toBeVisible();
  await page.locator('[data-kind="post"][data-id="e2e-post"]').click();
  await expect(page.locator('#word-goal')).toHaveValue('100');
});

test('selection toolbar appears for selected text and formats it as Markdown', async ({ page }) => {
  await openTestPost(page);
  const canvas = page.locator('.block-editor-canvas');
  await canvas.evaluate((element) => {
    element.innerHTML = '<p>selected text</p>';
    const text = element.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const toolbar = page.getByRole('toolbar', { name: 'Formatação da seleção' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Negrito' }).click();
  await expect.poll(() => canvas.evaluate((element) => (window as any).writerEditor?.getMarkdown?.() ?? element.innerHTML)).toContain('strong');
});
