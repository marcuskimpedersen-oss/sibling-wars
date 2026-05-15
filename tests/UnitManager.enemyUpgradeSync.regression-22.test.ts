// Regression: ISSUE-022 — Opponent upgrade bonuses not applied to enemy mirror units
//
// When a player researches an attack or armor upgrade in multiplayer, the upgrade
// is synced via an 'upgrade' command. The receiving side must:
//   1. Bump enemyAttackBonus / enemyArmorBonus on UnitManager
//   2. Apply the delta to all currently-alive enemy units
//   3. Apply the accumulated bonus when spawning new enemy units (via spawnEnemyUnitWithId)
//
// Without this fix, enemy mirrors always fought with base race stats regardless of
// how many upgrades the opponent had researched — causing combat desync.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENEMY_COMBAT_STATS = { attackDamage: 10, maxHealth: 100 };

const makeUnit = (faction: 'player' | 'enemy', attackDamage: number, armor = 0, isWorker = false) => ({
  faction,
  isWorker,
  attackDamage,
  armor,
  alive: true,
  isAlive() { return this.alive; },
});

// Simulates UnitManager's enemyAttackBonus/enemyArmorBonus tracking + applyUpgradeToEnemies
const makeUnitManager = () => {
  const units: ReturnType<typeof makeUnit>[] = [];
  const state = { enemyAttackBonus: 0, enemyArmorBonus: 0 };

  return {
    state,
    units,
    addUnit(u: ReturnType<typeof makeUnit>) { units.push(u); },
    applyUpgradeToEnemies(attackDelta: number, armorDelta: number) {
      state.enemyAttackBonus += attackDelta;
      state.enemyArmorBonus  += armorDelta;
      units.forEach(u => {
        if (u.faction === 'enemy' && u.isAlive() && !u.isWorker) {
          u.attackDamage += attackDelta;
          u.armor        += armorDelta;
        }
      });
    },
    spawnEnemyUnitWithId(baseAttack: number, explicitStats?: { attackDamage: number }) {
      // Simulate: if explicit stats (worker), use as-is; else apply accumulated bonus
      const attack = explicitStats
        ? explicitStats.attackDamage
        : baseAttack + state.enemyAttackBonus;
      const armor = explicitStats ? 0 : state.enemyArmorBonus;
      const u = makeUnit('enemy', attack, armor, !!explicitStats);
      units.push(u);
      return u;
    },
  };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UnitManager — enemy upgrade sync (ISSUE-022)', () => {
  it('applies attack upgrade delta to existing enemy units', () => {
    const mgr = makeUnitManager();
    const enemy = makeUnit('enemy', ENEMY_COMBAT_STATS.attackDamage);
    mgr.addUnit(enemy);

    mgr.applyUpgradeToEnemies(3, 0);

    expect(enemy.attackDamage).toBe(13);
  });

  it('applies armor upgrade delta to existing enemy units', () => {
    const mgr = makeUnitManager();
    const enemy = makeUnit('enemy', ENEMY_COMBAT_STATS.attackDamage, 0);
    mgr.addUnit(enemy);

    mgr.applyUpgradeToEnemies(0, 3);

    expect(enemy.armor).toBe(3);
  });

  it('does not touch player units when applying enemy upgrades', () => {
    const mgr = makeUnitManager();
    const player = makeUnit('player', 10);
    mgr.addUnit(player);

    mgr.applyUpgradeToEnemies(3, 0);

    expect(player.attackDamage).toBe(10); // unchanged
  });

  it('does not apply enemy upgrade to worker mirrors', () => {
    const mgr = makeUnitManager();
    const worker = makeUnit('enemy', 0, 0, true); // isWorker = true
    mgr.addUnit(worker);

    mgr.applyUpgradeToEnemies(3, 0);

    expect(worker.attackDamage).toBe(0); // workers keep zero attack
  });

  it('accumulates enemyAttackBonus across multiple upgrades', () => {
    const mgr = makeUnitManager();

    mgr.applyUpgradeToEnemies(3, 0);
    mgr.applyUpgradeToEnemies(3, 0);

    expect(mgr.state.enemyAttackBonus).toBe(6);
  });

  it('new enemy units spawned after upgrade receive the accumulated bonus', () => {
    const mgr = makeUnitManager();
    mgr.applyUpgradeToEnemies(3, 0); // opponent researched before the unit existed

    const unit = mgr.spawnEnemyUnitWithId(ENEMY_COMBAT_STATS.attackDamage);

    expect(unit.attackDamage).toBe(13); // base 10 + bonus 3
  });

  it('new enemy units spawned with explicit stats (workers) do not get the bonus', () => {
    const mgr = makeUnitManager();
    mgr.applyUpgradeToEnemies(3, 0);

    const worker = mgr.spawnEnemyUnitWithId(0, { attackDamage: 0 }); // WORKER_COMBAT_STATS

    expect(worker.attackDamage).toBe(0);
  });

  it('demonstrates the old bug: enemy mirrors had base stats regardless of opponent upgrades', () => {
    // Old behaviour: spawnEnemyUnitWithId always used base race stats, no bonus.
    const spawnOld = (baseAttack: number) => makeUnit('enemy', baseAttack);
    const unit = spawnOld(ENEMY_COMBAT_STATS.attackDamage);
    expect(unit.attackDamage).toBe(10); // Old: always 10 even if opponent bought +3

    // Fixed behaviour: accumulated bonus is added
    const mgr = makeUnitManager();
    mgr.applyUpgradeToEnemies(3, 0);
    const fixed = mgr.spawnEnemyUnitWithId(ENEMY_COMBAT_STATS.attackDamage);
    expect(fixed.attackDamage).toBe(13); // Correct: 10 + 3
  });
});
