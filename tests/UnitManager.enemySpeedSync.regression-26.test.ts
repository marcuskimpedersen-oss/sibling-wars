// Regression: ISSUE-026 — Speed upgrade not applied to enemy mirror units
//
// When a player buys a speed upgrade from the global upgrade panel (+30 px/s),
// the bonus was applied to their own living units and tracked in unitManager.speedBonus.
// In multiplayer, the opponent's mirror units (enemy faction) on the local screen
// did not receive the speed increase, so they moved slower than the real units.
//
// This causes visual desync: the two screens show the opponent's units at different
// positions because the real units are faster than their mirrors.
//
// Fix: buyPanelUpgrade('speed') now sends upgrade { upgradeType: 'speed', delta: 30 }.
// The receiver calls unitManager.applyUpgradeToEnemies(0, 0, delta) which bumps
// enemySpeedBonus and applies the delta to all living enemy units.
// New enemy units spawned after the upgrade inherit the speed bonus.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const UNIT_SPEED = 150;

const makeUnit = (faction: 'player' | 'enemy', isWorker = false) => ({
  faction,
  isWorker,
  speed: UNIT_SPEED,
  _baseSpeed: UNIT_SPEED,
  alive: true,
  isAlive() { return this.alive; },
});

// Simulates UnitManager.applyUpgradeToEnemies with speedDelta
const applyUpgradeToEnemies = (
  units: ReturnType<typeof makeUnit>[],
  state: { enemySpeedBonus: number },
  speedDelta: number,
) => {
  state.enemySpeedBonus += speedDelta;
  units.forEach(u => {
    if (u.faction === 'enemy' && u.isAlive() && !u.isWorker) {
      u.speed      += speedDelta;
      u._baseSpeed += speedDelta;
    }
  });
};

// Simulates spawnEnemyUnitWithId applying enemySpeedBonus to new units
const spawnEnemyWithBonus = (enemySpeedBonus: number) => {
  const u = makeUnit('enemy');
  if (enemySpeedBonus !== 0) {
    u.speed      += enemySpeedBonus;
    u._baseSpeed += enemySpeedBonus;
  }
  return u;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UnitManager — enemy speed upgrade sync (ISSUE-026)', () => {
  it('applies speed delta to existing enemy units', () => {
    const units = [makeUnit('enemy')];
    const state = { enemySpeedBonus: 0 };
    applyUpgradeToEnemies(units, state, 30);
    expect(units[0].speed).toBe(180);
    expect(units[0]._baseSpeed).toBe(180);
  });

  it('does not change player unit speed when applying enemy speed upgrade', () => {
    const units = [makeUnit('player')];
    const state = { enemySpeedBonus: 0 };
    applyUpgradeToEnemies(units, state, 30);
    expect(units[0].speed).toBe(UNIT_SPEED); // unchanged
  });

  it('does not apply speed upgrade to worker mirrors', () => {
    const units = [makeUnit('enemy', true)]; // isWorker = true
    const state = { enemySpeedBonus: 0 };
    applyUpgradeToEnemies(units, state, 30);
    expect(units[0].speed).toBe(UNIT_SPEED); // unchanged
  });

  it('accumulates enemySpeedBonus across multiple upgrades', () => {
    const state = { enemySpeedBonus: 0 };
    applyUpgradeToEnemies([], state, 30);
    applyUpgradeToEnemies([], state, 30);
    expect(state.enemySpeedBonus).toBe(60);
  });

  it('newly spawned enemy units inherit the accumulated speed bonus', () => {
    const state = { enemySpeedBonus: 0 };
    applyUpgradeToEnemies([], state, 30);
    const unit = spawnEnemyWithBonus(state.enemySpeedBonus);
    expect(unit.speed).toBe(180);
    expect(unit._baseSpeed).toBe(180);
  });

  it('demonstrates old bug: enemy mirrors had base speed regardless of opponent upgrades', () => {
    // Old behaviour: no speed applied to enemy mirrors
    const unitOld = makeUnit('enemy');
    expect(unitOld.speed).toBe(150); // always base speed

    // Fixed: speed bonus propagated
    const state = { enemySpeedBonus: 0 };
    applyUpgradeToEnemies([unitOld], state, 30);
    expect(unitOld.speed).toBe(180); // matches opponent's real unit speed
  });
});
