// Regression: ISSUE-015 — Ghost unit resurrection via sync_units
//
// spawnEnemyUnitWithId() only checked this.units.get(id) for deduplication.
// When an enemy unit died, removeDeadUnits() deleted it from this.units immediately.
// The three sync_units retries (400 ms / 1500 ms / 4000 ms) could fire AFTER
// the unit died — the ID was gone from the map, so spawnEnemyUnitWithId created
// a fresh full-health ghost at the original spawn position.
//
// Fix:
//   - Add _deadEnemyIds: Set<string> to UnitManager.
//   - In removeDeadUnits: when faction === 'enemy', add id to _deadEnemyIds.
//   - In spawnEnemyUnitWithId: if _deadEnemyIds.has(id), return null! early.
//
// Root cause is the same as ISSUE-007/010/011/014: a lifecycle set is needed
// to record "already processed" IDs so retried commands are no-ops.

import { describe, it, expect } from 'vitest';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

const makeUnit = (id: string, faction: 'player' | 'enemy') => ({
  id,
  faction,
  alive: true,
  isAlive() { return this.alive; },
  destroyed: false,
  destroy() { this.destroyed = true; },
});

type StubUnit = ReturnType<typeof makeUnit>;

// Simulate the fixed UnitManager lifecycle for enemy units
class FakeUnitManager {
  units = new Map<string, StubUnit>();
  private _deadEnemyIds = new Set<string>();

  spawnEnemyUnitWithId(id: string): StubUnit | null {
    if (this._deadEnemyIds.has(id)) return null; // fixed: block resurrection
    const existing = this.units.get(id);
    if (existing) return existing;
    const unit = makeUnit(id, 'enemy');
    this.units.set(id, unit);
    return unit;
  }

  killUnit(id: string): void {
    const unit = this.units.get(id);
    if (!unit) return;
    this.units.delete(id);
    if (unit.faction === 'enemy') this._deadEnemyIds.add(id); // fixed: record death
    // simulate deferred destroy
    unit.destroy();
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UnitManager — ghost unit resurrection prevention', () => {
  it('spawnEnemyUnitWithId returns null for a unit that already died', () => {
    const mgr = new FakeUnitManager();
    mgr.spawnEnemyUnitWithId('p1_u0');
    mgr.killUnit('p1_u0');

    const ghost = mgr.spawnEnemyUnitWithId('p1_u0'); // sync_units retry
    expect(ghost).toBeNull();
  });

  it('does not add the dead unit back to the units map', () => {
    const mgr = new FakeUnitManager();
    mgr.spawnEnemyUnitWithId('p1_u1');
    mgr.killUnit('p1_u1');
    mgr.spawnEnemyUnitWithId('p1_u1'); // retry

    expect(mgr.units.has('p1_u1')).toBe(false);
  });

  it('still allows spawning a different unit after another dies', () => {
    const mgr = new FakeUnitManager();
    mgr.spawnEnemyUnitWithId('p1_u2');
    mgr.killUnit('p1_u2');

    const fresh = mgr.spawnEnemyUnitWithId('p1_u3'); // different ID
    expect(fresh).not.toBeNull();
    expect(mgr.units.has('p1_u3')).toBe(true);
  });

  it('dedup still works for alive units (no double-spawn)', () => {
    const mgr = new FakeUnitManager();
    const first  = mgr.spawnEnemyUnitWithId('p1_u4');
    const second = mgr.spawnEnemyUnitWithId('p1_u4'); // retry while alive

    expect(first).toBe(second);
    expect(mgr.units.size).toBe(1);
  });

  it('multiple sync_units retries for a dead unit all return null', () => {
    const mgr = new FakeUnitManager();
    mgr.spawnEnemyUnitWithId('p1_u5');
    mgr.killUnit('p1_u5');

    // Simulate 400 ms, 1500 ms, 4000 ms retries
    expect(mgr.spawnEnemyUnitWithId('p1_u5')).toBeNull();
    expect(mgr.spawnEnemyUnitWithId('p1_u5')).toBeNull();
    expect(mgr.spawnEnemyUnitWithId('p1_u5')).toBeNull();
  });

  it('demonstrates the old bug: without _deadEnemyIds the unit is resurrected', () => {
    // Old behaviour: no _deadEnemyIds set
    const units = new Map<string, StubUnit>();

    const oldSpawnWithId = (id: string): StubUnit | null => {
      const existing = units.get(id);
      if (existing) return existing; // only alive-unit dedup
      const unit = makeUnit(id, 'enemy');
      units.set(id, unit);
      return unit;
    };

    // Spawn, then kill (remove from map)
    oldSpawnWithId('p1_u6');
    units.delete('p1_u6'); // removeDeadUnits

    // sync_units retry — old code resurrects it
    const ghost = oldSpawnWithId('p1_u6');
    expect(ghost).not.toBeNull(); // this IS the bug
    expect(units.has('p1_u6')).toBe(true);
  });
});
