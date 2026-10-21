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
