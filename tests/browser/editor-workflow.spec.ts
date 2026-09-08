import { expect, test } from '@playwright/test';

test('adds a text clip, restores it with redo, and persists it after reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay')).toBeHidden();

  await page.getByRole('tab', { name: 'テキスト' }).click();
  await page.getByRole('button', { name: 'テキストを追加' }).click();
  await expect(page.locator('.timeline-clip.clip-text')).toHaveCount(1);

  await page.getByTitle('元に戻す（⌘ Z）').click();
  await expect(page.locator('.timeline-clip.clip-text')).toHaveCount(0);
  await page.getByTitle('やり直す（⌘ Shift Z）').click();
  await expect(page.locator('.timeline-clip.clip-text')).toHaveCount(1);

  await expect(page.locator('.save-status')).toContainText(
    'この端末に保存済み',
  );
  await page.reload();
  await expect(page.locator('.boot-overlay')).toBeHidden();
  await expect(page.locator('.timeline-clip.clip-text')).toHaveCount(1);
});

test('supports undo and redo keyboard shortcuts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay')).toBeHidden();
  await page.getByRole('tab', { name: 'テキスト' }).click();
  await page.getByRole('button', { name: 'テキストを追加' }).click();

  await page.keyboard.press('Meta+z');
  await expect(page.locator('.timeline-clip.clip-text')).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.locator('.timeline-clip.clip-text')).toHaveCount(1);
});

test('adds and applies a non-destructive puppet pin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay')).toBeHidden();
  await page.getByRole('tab', { name: 'テキスト' }).click();
  await page.getByRole('button', { name: 'テキストを追加' }).click();

  await page.getByRole('button', { name: 'パペット変形', exact: true }).click();
  await expect(page.locator('.puppet-toolbar')).toBeVisible();
  await page.locator('.puppet-overlay').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.puppet-pin')).toHaveCount(1);
  await page.getByRole('button', { name: '適用' }).click();
  await expect(page.locator('.puppet-toolbar')).toHaveCount(0);
});

test('loads the history dialog only when it is opened', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay')).toBeHidden();

  await page.getByRole('button', { name: '履歴' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('編集履歴');
  await expect(
    dialog.getByRole('button', { name: 'スナップショット' }),
  ).toBeVisible();
});
