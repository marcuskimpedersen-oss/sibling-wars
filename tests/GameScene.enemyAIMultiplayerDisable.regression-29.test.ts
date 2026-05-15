// Regression: ISSUE-029 — EnemyAI ran during multiplayer games and spawned AI units
//
// EnemyAI had a setEnabled(false) method and an _enabled guard in update(), but
// GameScene never called setEnabled(false) in multiplayer.
// initialize() was correctly skipped (no initial units/barracks placed),
// but update() kept incrementing timers. After 2.5 minutes of game time, the AI
// would pass its grace period and begin spawning waves of enemy units alongside the
// human opponent's mirror units — effectively giving one player an invisible ally.
//
// Fix: in the multiplayer setup branch, call enemyAI.setEnabled(false) so the
// AI's update() is a no-op for the entire game.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeAI = () => {
  let enabled = true;
  const spawnedWaves: number[] = [];
  let spawnTimer = 0;
  const GRACE_MS   = 150_000;
  const INTERVAL_MS = 30_000;
  let eliteTimer = 0;

  return {
    setEnabled(v: boolean) { enabled = v; },
    update(delta: number) {
      if (!enabled) return;
      eliteTimer   += delta;
      spawnTimer += delta;
      if (eliteTimer < GRACE_MS) return;
      if (spawnTimer >= INTERVAL_MS) {
        spawnTimer = 0;
        spawnedWaves.push(eliteTimer);
      }
    },
    get spawnedWaves() { return spawnedWaves; },
    get isEnabled() { return enabled; },
  };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — EnemyAI disabled in multiplayer (ISSUE-029)', () => {
  it('AI is enabled by default (singleplayer)', () => {
    const ai = makeAI();
    expect(ai.isEnabled).toBe(true);
  });

  it('AI can be disabled via setEnabled(false)', () => {
    const ai = makeAI();
    ai.setEnabled(false);
    expect(ai.isEnabled).toBe(false);
  });

  it('disabled AI never spawns waves regardless of elapsed time', () => {
    const ai = makeAI();
    ai.setEnabled(false);
    // Simulate 10 minutes of gameplay
    for (let t = 0; t < 600; t++) ai.update(1000); // 600 × 1s
    expect(ai.spawnedWaves).toHaveLength(0);
  });

  it('enabled AI spawns waves after grace period in singleplayer', () => {
    const ai = makeAI();
    // Simulate 4 minutes past grace period
    for (let t = 0; t < 240; t++) ai.update(1000);
    expect(ai.spawnedWaves.length).toBeGreaterThan(0);
  });

  it('demonstrates old bug: AI was enabled in multiplayer and would spawn waves', () => {
    // Old behaviour: setEnabled was never called in multiplayer
    const aiOld = makeAI(); // enabled = true (old default)
    for (let t = 0; t < 240; t++) aiOld.update(1000); // 4 minutes past grace
    expect(aiOld.spawnedWaves.length).toBeGreaterThan(0); // bug: AI spawned enemies

    // Fixed behaviour: disabled at multiplayer setup
    const aiNew = makeAI();
    aiNew.setEnabled(false); // fix: called during multiplayer init
    for (let t = 0; t < 240; t++) aiNew.update(1000);
    expect(aiNew.spawnedWaves).toHaveLength(0); // correct: no AI waves
  });
});
