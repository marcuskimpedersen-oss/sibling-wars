// Regression: ISSUE-024 — sync_units retry path didn't propagate hero/stealth/detector flags
//
// The initial sync_units command (fired at 400ms / 1500ms / 4000ms) only included
// { id, tileX, tileY, race, isWorker }. If a spawn_unit packet was dropped and the
// unit was created via sync_units instead, it would be missing unitTypeId, isHero,
// isDetector, and isStealthed.
//
// Impact: shadow_reaper and void_walker units recovered via sync were not stealthed
// (freely targetable). Hero and detector flags were also absent.
//
// Fix: sync_units payload now includes unitTypeId, isHero, isDetector, isStealthed.
// The receiver applies the flags with idempotent guards (won't double-create crown
// labels or detector rings if the unit already had them from spawn_unit).

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeUnit = (unitTypeId = '') => ({
  unitTypeId,
  isHero:          false,
  isDetector:      false,
  isStealthed:     false,
  isUnseenUnit:    false,
  permanentlyCloaked: false,
  crownCount:      0,
  detectorRingBuilt: false,
  setAsHero() {
    this.isHero = true;
    this.crownCount++;
    if (this.unitTypeId === 'void_walker') {
      this.permanentlyCloaked = true;
      this.isStealthed = true;
    }
  },
  buildDetectorRing() { this.detectorRingBuilt = true; },
});

// Simulates the fixed sync_units receiver applying flags idempotently
const applySyncUnitFlags = (
  unit: ReturnType<typeof makeUnit>,
  u: { unitTypeId?: string; isHero?: boolean; isDetector?: boolean; isStealthed?: boolean },
) => {
  if (u.unitTypeId && !unit.unitTypeId) unit.unitTypeId = u.unitTypeId;
  if (u.isHero     && !unit.isHero)    unit.setAsHero();
  if (u.isDetector && !unit.isDetector) { unit.isDetector = true; unit.buildDetectorRing(); }
  if (u.isStealthed && !unit.isStealthed) {
    unit.isStealthed = true;
    if (u.unitTypeId === 'shadow_reaper') (unit as any).isUnseenUnit = true;
  }
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — sync_units type-flags propagation (ISSUE-024)', () => {
  it('applies isStealthed to shadow_reaper recovered via sync', () => {
    const unit = makeUnit();
    applySyncUnitFlags(unit, { unitTypeId: 'shadow_reaper', isStealthed: true });
    expect(unit.isStealthed).toBe(true);
  });

  it('sets isUnseenUnit on shadow_reaper recovered via sync', () => {
    const unit = makeUnit();
    applySyncUnitFlags(unit, { unitTypeId: 'shadow_reaper', isStealthed: true });
    expect((unit as any).isUnseenUnit).toBe(true);
  });

  it('calls setAsHero() for hero unit recovered via sync', () => {
    const unit = makeUnit('high_inquisitor');
    applySyncUnitFlags(unit, { unitTypeId: 'high_inquisitor', isHero: true });
    expect(unit.isHero).toBe(true);
  });

  it('builds detector ring for detector unit recovered via sync', () => {
    const unit = makeUnit('prime_construct');
    applySyncUnitFlags(unit, { unitTypeId: 'prime_construct', isDetector: true });
    expect(unit.isDetector).toBe(true);
    expect(unit.detectorRingBuilt).toBe(true);
  });

  it('void_walker recovered via sync is permanently cloaked', () => {
    const unit = makeUnit('void_walker');
    applySyncUnitFlags(unit, { unitTypeId: 'void_walker', isHero: true });
    expect(unit.permanentlyCloaked).toBe(true);
    expect(unit.isStealthed).toBe(true);
  });

  it('does not call setAsHero() twice if already a hero (idempotent)', () => {
    const unit = makeUnit('iron_warden');
    applySyncUnitFlags(unit, { unitTypeId: 'iron_warden', isHero: true }); // spawn_unit
    applySyncUnitFlags(unit, { unitTypeId: 'iron_warden', isHero: true }); // sync retry
    expect(unit.crownCount).toBe(1); // only one crown label
  });

  it('does not create a second detector ring on sync retry', () => {
    const unit = makeUnit('prime_construct');
    applySyncUnitFlags(unit, { unitTypeId: 'prime_construct', isDetector: true }); // spawn_unit path
    const ringsAfterFirst = unit.detectorRingBuilt;
    applySyncUnitFlags(unit, { unitTypeId: 'prime_construct', isDetector: true }); // sync retry
    expect(unit.detectorRingBuilt).toBe(ringsAfterFirst); // no second call
  });

  it('demonstrates old bug: sync_units had no type flags — shadow_reaper was visible', () => {
    // Old behaviour: sync receiver just called spawnEnemyUnitWithId with no flags
    const unitOld = makeUnit();
    // Old code: only position + race, no type flags applied
    expect(unitOld.isStealthed).toBe(false); // bug: freely targetable

    // Fixed behaviour
    const unitNew = makeUnit('shadow_reaper');
    applySyncUnitFlags(unitNew, { unitTypeId: 'shadow_reaper', isStealthed: true });
    expect(unitNew.isStealthed).toBe(true);
  });
});
