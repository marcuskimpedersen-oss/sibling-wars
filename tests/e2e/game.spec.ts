import { test, expect } from '@playwright/test';
import { startGame, waitForMenu, gameState } from './helpers';

// ── Smoke ──────────────────────────────────────────────────────────────────────

test('page loads without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await waitForMenu(page);

  expect(errors).toHaveLength(0);
});

test('Phaser canvas is visible', async ({ page }) => {
  await page.goto('/');
  await waitForMenu(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
});

// ── Menu ───────────────────────────────────────────────────────────────────────

test('menu shows all four race cards', async ({ page }) => {
  await page.goto('/');
  await waitForMenu(page);

  const labels = await page.evaluate(() => {
    const menu = (window as any).__PHASER_GAME.scene.keys.MenuScene;
    // Collect all Text objects whose content matches a sibling name
    return menu.children.list
      .filter((c: any) => c.type === 'Text')
      .map((c: any) => c.text as string);
  });

  expect(labels.join(' ')).toContain('Huw');
  expect(labels.join(' ')).toContain('Jonty');
  expect(labels.join(' ')).toContain('Finn');
  expect(labels.join(' ')).toContain('Marcus');
});

// ── Boot into GameScene ────────────────────────────────────────────────────────

test('game boots without errors for each race', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  for (const race of ['architects', 'covenant', 'bulwark', 'unseen']) {
    await page.goto('/');
    await startGame(page, { race });
    const state = await gameState(page);
    expect(state.gameOver).toBe(false);
    expect(errors).toHaveLength(0);
  }
});

// ── Economy ────────────────────────────────────────────────────────────────────

test('gold starts above zero and addGold() increases it correctly', async ({ page }) => {
  await page.goto('/');
  await startGame(page);

  const before = await page.evaluate(() => (window as any).__SIBLING_WARS.gold);
  expect(before).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => (window as any).__SIBLING_WARS.addGold(500));
  const after = await page.evaluate(() => (window as any).__SIBLING_WARS.gold);
  expect(after).toBe(before + 500);
});

// ── Units ──────────────────────────────────────────────────────────────────────

test('player starts with at least one unit', async ({ page }) => {
  await page.goto('/');
  await startGame(page);
  const state = await gameState(page);
  expect(state.playerUnitCount).toBeGreaterThan(0);
});

test('enemy spawns units over time', async ({ page }) => {
  await page.goto('/');
  await startGame(page);

  // Trigger a wave immediately via the debug hook
  await page.evaluate(() => (window as any).__SIBLING_WARS.triggerWave());
  // Give Phaser a few frames to process
  await page.waitForTimeout(500);

  const state = await gameState(page);
  expect(state.enemyUnitCount).toBeGreaterThan(0);
});

// ── Elite timer ────────────────────────────────────────────────────────────────

test('eliteGameTimerMs can be fast-forwarded past the 8-minute gate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await startGame(page);

  // Jump to just past the 8-minute elite trigger
  await page.evaluate(() => { (window as any).__SIBLING_WARS.eliteGameTimerMs = 481000; });

  // Let the AI tick a few frames so it can react to the new timer
  await page.waitForTimeout(1000);

  expect(errors).toHaveLength(0);
  const state = await gameState(page);
  expect(state.gameOver).toBe(false); // game should still be running
});

// ── Game-over ──────────────────────────────────────────────────────────────────

test('endGame(false) triggers defeat state', async ({ page }) => {
  await page.goto('/');
  await startGame(page);

  await page.evaluate(() => (window as any).__SIBLING_WARS.endGame(false));
  await page.waitForTimeout(300);

  const state = await gameState(page);
  expect(state.gameOver).toBe(true);
});

test('endGame(true) triggers victory state', async ({ page }) => {
  await page.goto('/');
  await startGame(page);

  await page.evaluate(() => (window as any).__SIBLING_WARS.endGame(true));
  await page.waitForTimeout(300);

  const state = await gameState(page);
  expect(state.gameOver).toBe(true);
});

// ── Difficulty ─────────────────────────────────────────────────────────────────

test('hard difficulty boots without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await startGame(page, { difficulty: 'hard' });

  expect(errors).toHaveLength(0);
  const state = await gameState(page);
  expect(state.gameOver).toBe(false);
});

test('easy difficulty boots without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await startGame(page, { difficulty: 'easy' });

  expect(errors).toHaveLength(0);
});
