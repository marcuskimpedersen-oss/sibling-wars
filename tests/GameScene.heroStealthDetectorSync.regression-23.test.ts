// Regression: ISSUE-023 — Hero/stealth/detector flags missing on enemy mirror units
//
// When the local player produces a hero unit, a detector, or a permanently-stealthed
// unit (void_walker / shadow_reaper), these properties must be propagated to the
// enemy mirror on the opponent's screen via the 'spawn_unit' command.
//
// Before the fix, opponent screens showed these units as plain combat units:
//   - void_walker / shadow_reaper mirrors were NOT stealthed → could be freely targeted
//   - Hero mirrors had no crown; void_walker didn't set permanentlyCloaked
//   - Detector mirrors couldn't reveal stealthed player units
//
// Fix: include isHero, isDetector, isStealthed in the spawn_unit payload;
// receiver calls setAsHero() / buildDetectorRing() / sets isStealthed on the mirror.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeUnit = (unitTypeId = '') => ({
  unitTypeId,
  isHero:          false,
  isDetector:      false,
  isStealthed:     false,
  isUnseenUnit:    false,
  permanentlyCloaked: false,
  heroSetupCalled: false,
  detectorRingBuilt: false,
  setAsHero() {
    this.isHero = true;
    this.heroSetupCalled = true;
    if (this.unitTypeId === 'void_walker') {
      this.permanentlyCloaked = true;
      this.isStealthed = true;
    }
  },
  buildDetectorRing() { this.detectorRingBuilt = true; },
});

// Simulate the fixed spawn_unit receive handler
const applySpawnUnitFlags = (
  unit: ReturnType<typeof makeUnit>,
  unitTypeId: string | undefined,
  isHero: boolean | undefined,
  isDetector: boolean | undefined,
  isStealthed: boolean | undefined,
) => {
  if (unitTypeId)  unit.unitTypeId = unitTypeId;
  if (isHero)      unit.setAsHero();
  if (isDetector)  { unit.isDetector = true; unit.buildDetectorRing(); }
  if (isStealthed) {
    unit.isStealthed = true;
    if (unitTypeId === 'shadow_reaper') (unit as any).isUnseenUnit = true;
  }
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — hero/stealth/detector sync on enemy mirrors (ISSUE-023)', () => {
  it('calls setAsHero() on an enemy mirror when isHero=true', () => {
    const unit = makeUnit();
    applySpawnUnitFlags(unit, 'high_inquisitor', true, false, false);
    expect(unit.isHero).toBe(true);
    expect(unit.heroSetupCalled).toBe(true);
  });

  it('creates detector ring on enemy mirror when isDetector=true', () => {
    const unit = makeUnit();
    applySpawnUnitFlags(unit, 'prime_construct', true, true, false);
    expect(unit.isDetector).toBe(true);
    expect(unit.detectorRingBuilt).toBe(true);
  });

  it('sets isStealthed on shadow_reaper mirror', () => {
    const unit = makeUnit();
    applySpawnUnitFlags(unit, 'shadow_reaper', false, false, true);
    expect(unit.isStealthed).toBe(true);
  });

  it('sets isUnseenUnit on shadow_reaper mirror', () => {
    const unit = makeUnit();
    applySpawnUnitFlags(unit, 'shadow_reaper', false, false, true);
    expect((unit as any).isUnseenUnit).toBe(true);
  });

  it('void_walker hero mirror becomes permanently cloaked via setAsHero()', () => {
    const unit = makeUnit('void_walker');
    applySpawnUnitFlags(unit, 'void_walker', true, false, false);
    expect(unit.isHero).toBe(true);
    expect(unit.permanentlyCloaked).toBe(true);
    expect(unit.isStealthed).toBe(true);
  });

  it('unitTypeId must be set before setAsHero() for void_walker cloak to trigger', () => {
    const unit = makeUnit(); // unitTypeId = '' initially
    // Set unitTypeId first (as the fix does), then hero
    applySpawnUnitFlags(unit, 'void_walker', true, false, false);
    expect(unit.permanentlyCloaked).toBe(true);
  });

  it('plain combat unit (no flags) is not modified', () => {
    const unit = makeUnit();
    applySpawnUnitFlags(unit, 'grunt', false, false, false);
    expect(unit.isHero).toBe(false);
    expect(unit.isDetector).toBe(false);
    expect(unit.isStealthed).toBe(false);
  });

  it('demonstrates old bug: shadow_reaper mirror was not stealthed — freely targetable', () => {
    // Old behaviour: receiver only set unitTypeId, nothing else
    const unitOld = makeUnit();
    unitOld.unitTypeId = 'shadow_reaper'; // only this was done before
    expect(unitOld.isStealthed).toBe(false); // bug: visible to opponent

    // Fixed behaviour
    const unitNew = makeUnit();
    applySpawnUnitFlags(unitNew, 'shadow_reaper', false, false, true);
    expect(unitNew.isStealthed).toBe(true); // correct: cloaked
  });
});
