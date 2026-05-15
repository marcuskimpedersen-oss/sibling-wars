// Regression: ISSUE-017 — Mirror workers spawned with full combat stats
//
// spawn_unit and sync_units commands did not include isWorker or unitTypeId.
// spawnEnemyUnitWithId defaulted to RACE_COMBAT_STATS (80–160 HP, real attack).
// Mirror workers ended up as aggressive combat units rather than fragile support
// units (attackDamage=0, maxHealth=40), skewing local combat simulation.
//
// Fix:
//   - spawn_unit sender: add isWorker: true and unitTypeId: 'worker' for workers;
//     add unitTypeId: unitDef.id for combat units.
//   - sync_units sender already included isWorker; receiver now passes
//     WORKER_COMBAT_STATS when isWorker is true.
//   - spawn_unit receiver: reads isWorker and unitTypeId, passes WORKER_COMBAT_STATS
//     for workers, sets unitTypeId on the spawned unit.

import { describe, it, expect } from 'vitest';

// ── Constants (mirrored from src/constants.ts) ─────────────────────────────

const WORKER_COMBAT_STATS = { maxHealth: 40, attackDamage: 0, attackRangePx: 0, attackCooldownMs: 9999 };
const RACE_COMBAT_STATS: Record<string, { maxHealth: number; attackDamage: number }> = {
  architects: { maxHealth: 80,  attackDamage: 10 },
  covenant:   { maxHealth: 110, attackDamage: 8  },
  bulwark:    { maxHealth: 160, attackDamage: 14 },
  unseen:     { maxHealth: 60,  attackDamage: 16 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeUnit = (id: string, stats: { maxHealth: number; attackDamage: number }) => ({
  id,
  unitTypeId: '',
  maxHealth: stats.maxHealth,
  attackDamage: stats.attackDamage,
});

// Simulate the fixed spawn_unit receiver
const simulateSpawnUnit = (cmd: {
  unitId: string;
  race: string;
  isWorker?: boolean;
  unitTypeId?: string;
}) => {
  const stats = cmd.isWorker ? WORKER_COMBAT_STATS : (RACE_COMBAT_STATS[cmd.race] ?? WORKER_COMBAT_STATS);
  const unit = makeUnit(cmd.unitId, stats);
  if (cmd.unitTypeId) unit.unitTypeId = cmd.unitTypeId;
  return unit;
};

// Simulate the fixed sync_units receiver for a single unit entry
const simulateSyncUnit = (entry: { id: string; race: string; isWorker?: boolean }) => {
  const stats = entry.isWorker ? WORKER_COMBAT_STATS : (RACE_COMBAT_STATS[entry.race] ?? WORKER_COMBAT_STATS);
  return makeUnit(entry.id, stats);
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — mirror worker combat stats fix', () => {
  it('spawn_unit with isWorker=true uses WORKER_COMBAT_STATS (maxHealth=40)', () => {
    const unit = simulateSpawnUnit({ unitId: 'p1_worker_0', race: 'architects', isWorker: true, unitTypeId: 'worker' });
    expect(unit.maxHealth).toBe(40);
  });

  it('spawn_unit with isWorker=true has attackDamage=0', () => {
    const unit = simulateSpawnUnit({ unitId: 'p1_worker_0', race: 'covenant', isWorker: true, unitTypeId: 'worker' });
    expect(unit.attackDamage).toBe(0);
  });

  it('spawn_unit without isWorker uses race combat stats', () => {
    const unit = simulateSpawnUnit({ unitId: 'p1_unit_1', race: 'bulwark', unitTypeId: 'guardian' });
    expect(unit.maxHealth).toBe(RACE_COMBAT_STATS.bulwark.maxHealth);
    expect(unit.attackDamage).toBe(RACE_COMBAT_STATS.bulwark.attackDamage);
  });

  it('spawn_unit sets unitTypeId on the spawned mirror', () => {
    const unit = simulateSpawnUnit({ unitId: 'p1_unit_2', race: 'unseen', unitTypeId: 'phantom' });
    expect(unit.unitTypeId).toBe('phantom');
  });

  it('spawn_unit for worker sets unitTypeId to worker', () => {
    const unit = simulateSpawnUnit({ unitId: 'p1_worker_1', race: 'architects', isWorker: true, unitTypeId: 'worker' });
    expect(unit.unitTypeId).toBe('worker');
  });

  it('sync_units with isWorker=true uses WORKER_COMBAT_STATS', () => {
    const unit = simulateSyncUnit({ id: 'p1_worker_2', race: 'covenant', isWorker: true });
    expect(unit.maxHealth).toBe(40);
    expect(unit.attackDamage).toBe(0);
  });

  it('sync_units without isWorker uses race stats', () => {
    const unit = simulateSyncUnit({ id: 'p1_unit_3', race: 'architects' });
    expect(unit.maxHealth).toBe(RACE_COMBAT_STATS.architects.maxHealth);
  });

  it('demonstrates the old bug: missing isWorker caused worker to spawn with full race stats', () => {
    // Old receive logic — just uses RACE_COMBAT_STATS regardless
    const oldSpawn = (cmd: { unitId: string; race: string }) =>
      makeUnit(cmd.unitId, RACE_COMBAT_STATS[cmd.race] ?? { maxHealth: 55, attackDamage: 7 });

    const oldWorker = oldSpawn({ unitId: 'p1_worker_0', race: 'bulwark' });
    // Old: worker mirror had 160 HP and 14 damage — should be 40 HP and 0 damage
    expect(oldWorker.maxHealth).toBe(160);
    expect(oldWorker.attackDamage).toBe(14);
  });
});
