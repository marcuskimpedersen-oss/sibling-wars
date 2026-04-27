import type { Page } from '@playwright/test';

/** Wait for Phaser to initialise and the MenuScene to be running. */
export async function waitForMenu(page: Page) {
  await page.waitForFunction(() => {
    const g = (window as any).__PHASER_GAME;
    return g?.scene?.keys?.MenuScene?.sys?.isActive?.();
  }, { timeout: 15000 });
}

/**
 * Skip the menu entirely and boot straight into a GameScene.
 * Waits until window.__SIBLING_WARS is live (i.e. create() has finished).
 */
export async function startGame(page: Page, opts: {
  race?: string;
  enemyRace?: string;
  difficulty?: string;
  winCondition?: string;
} = {}) {
  await waitForMenu(page);
  await page.evaluate((o) => {
    const g = (window as any).__PHASER_GAME;
    g.scene.start('GameScene', {
      race:         o.race         ?? 'architects',
      enemyRace:    o.enemyRace    ?? 'covenant',
      difficulty:   o.difficulty   ?? 'normal',
      winCondition: o.winCondition ?? 'hq',
    });
  }, opts);
  await page.waitForFunction(() => !!(window as any).__SIBLING_WARS, { timeout: 15000 });
}

/** Shorthand to read live game state. */
export function gameState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__SIBLING_WARS;
    return {
      gold:            g.gold,
      gameOver:        g.gameOver,
      waveCount:       g.waveCount,
      playerUnitCount: g.playerUnitCount,
      enemyUnitCount:  g.enemyUnitCount,
      eliteGameTimerMs: g.eliteGameTimerMs,
    };
  });
}
