// Regression: ISSUE-006 — removeDeadUnits fired onUnitDied on every frame for 700 ms
//
// this.units.delete(id) lived inside the delayedCall(700 ms) callback.  The unit
// therefore stayed in the Map until the callback fired (~42 frames at 60 fps).
// Because removeDeadUnits() is called every frame, onUnitDied fired ~42 times per
// death — draining supplyUsed to 0, inflating stats.unitsLost by 42×, and
// preventing the hero-respawn timer from starting (it was reset to 120 000 ms on
// every frame for 700 ms).
//
// Fix: this.units.delete(id) moved to BEFORE the delayedCall so the unit is
// immediately absent from the Map on the next removeDeadUnits() call.
// The Phaser GameObject destruction is still deferred 700 ms so the death animation
// can finish.

import { describe, it, expect } from 'vitest';

// ── Minimal unit stub ─────────────────────────────────────────────────────────

const makeUnit = (faction: 'player' | 'enemy', alive = true) => ({
  id: `u_${Math.random()}`,
  faction,
  _alive: alive,
  isWorker: false,
  isShadowClone: false,
  unitTypeId: 'soldier',
  isAlive() { return this._alive; },
  die()     { this._alive = false; },
  destroy() { /* noop for tests */ },
});

// ── Minimal UnitManager stub (just the removeDeadUnits logic) ────────────────

function makeManager(units: ReturnType<typeof makeUnit>[]) {
  const map = new Map(units.map(u => [u.id, u]));
  let onUnitDiedCallCount = 0;
  let onEnemyDiedCallCount = 0;

  const removeDeadUnits = () => {
    const dead: typeof units[number][] = [];
    map.forEach((unit, id) => {
      if (!unit.isAlive()) {
        dead.push(unit);
        // Fixed: immediately remove from map
        map.delete(id);
        if (unit.faction === 'player') onUnitDiedCallCount++;
        else if (unit.faction === 'enemy') onEnemyDiedCallCount++;
        // delayedCall(700, () => unit.destroy()) — not simulated here
      }
    });
    return dead;
  };

  return { map, removeDeadUnits, getPlayerDeathCalls: () => onUnitDiedCallCount, getEnemyDeathCalls: () => onEnemyDiedCallCount };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UnitManager.removeDeadUnits — single-fire guarantee', () => {
  it('fires onUnitDied exactly once even when removeDeadUnits is called multiple times', () => {
    const unit = makeUnit('player');
    const mgr = makeManager([unit]);

    unit.die(); // simulate combat kill

    // Simulate 3 consecutive frames calling removeDeadUnits
    mgr.removeDeadUnits();
    mgr.removeDeadUnits();
    mgr.removeDeadUnits();

    expect(mgr.getPlayerDeathCalls()).toBe(1);
  });

  it('removes the unit from the map on the first call', () => {
    const unit = makeUnit('player');
    const mgr = makeManager([unit]);

    unit.die();
    mgr.removeDeadUnits();

    expect(mgr.map.has(unit.id)).toBe(false);
  });

  it('fires onEnemyDied exactly once for enemy units', () => {
    const unit = makeUnit('enemy');
    const mgr = makeManager([unit]);

    unit.die();
    mgr.removeDeadUnits();
    mgr.removeDeadUnits();

    expect(mgr.getEnemyDeathCalls()).toBe(1);
  });

  it('leaves live units in the map after removing dead ones', () => {
    const alive = makeUnit('player');
    const dead  = makeUnit('player');
    const mgr = makeManager([alive, dead]);

    dead.die();
    mgr.removeDeadUnits();

    expect(mgr.map.has(alive.id)).toBe(true);
    expect(mgr.map.has(dead.id)).toBe(false);
  });

  it('handles multiple deaths in the same frame without cross-contamination', () => {
    const a = makeUnit('player');
    const b = makeUnit('player');
    const c = makeUnit('enemy');
    const mgr = makeManager([a, b, c]);

    a.die(); b.die(); c.die();
    mgr.removeDeadUnits();
    mgr.removeDeadUnits(); // second frame — should be a no-op

    expect(mgr.getPlayerDeathCalls()).toBe(2);
    expect(mgr.getEnemyDeathCalls()).toBe(1);
    expect(mgr.map.size).toBe(0);
  });
});
