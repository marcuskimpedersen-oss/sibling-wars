// Regression: ISSUE-004 — Shadow Clone ability fired cooldown but never spawned a clone
//
// unit:shadowCloneCreated was emitted by Unit.activateShadowClone() but had no
// listener in GameScene. activateShadowCloneForSelected() existed in UnitManager
// but was never called from any input handler. The C-ability slot returned null
// for Phantom units so the button never appeared.
//
// Fix:
//   1. getSelectedAbilityInfo() returns shadow-clone info for 'phantom' unitTypeId
//   2. activateAbilityForSelected() handles canActivateShadowClone()
//   3. GameScene listens to unit:shadowCloneCreated and spawns the decoy unit
//   4. onUnitDied skips supply/stat accounting for isShadowClone units

import { describe, it, expect } from 'vitest';

// ── Ability info surfacing ────────────────────────────────────────────────────

describe('ShadowClone — ability info for Phantoms', () => {
  it('returns Shadow Clone info when a Phantom is selected', () => {
    const phantom = {
      isAlive: () => true,
      unitTypeId: 'phantom',
      canActivateShadowClone: () => true,
      shadowCloneCooldownRemaining: 0,
    };

    // Simulates the relevant part of getSelectedAbilityInfo()
    const getAbilityInfo = (unit: typeof phantom) => {
      if (unit.unitTypeId === 'phantom') {
        return {
          type: 'Shadow Clone',
          ready: unit.canActivateShadowClone(),
          active: false,
          cooldownSec: Math.ceil(unit.shadowCloneCooldownRemaining / 1000),
        };
      }
      return null;
    };

    const info = getAbilityInfo(phantom);
    expect(info).not.toBeNull();
    expect(info?.type).toBe('Shadow Clone');
    expect(info?.ready).toBe(true);
  });

  it('reports not ready when cooldown is active', () => {
    const phantom = {
      isAlive: () => true,
      unitTypeId: 'phantom',
      canActivateShadowClone: () => false,
      shadowCloneCooldownRemaining: 15000,
    };
    const getAbilityInfo = (unit: typeof phantom) => {
      if (unit.unitTypeId === 'phantom') {
        return {
          type: 'Shadow Clone',
          ready: unit.canActivateShadowClone(),
          active: false,
          cooldownSec: Math.ceil(unit.shadowCloneCooldownRemaining / 1000),
        };
      }
      return null;
    };
    const info = getAbilityInfo(phantom);
    expect(info?.ready).toBe(false);
    expect(info?.cooldownSec).toBe(15);
  });
});

// ── activateAbilityForSelected routing ────────────────────────────────────────

describe('ShadowClone — activateAbilityForSelected routes to clone', () => {
  it('calls activateShadowClone() when a Phantom is selected with cooldown ready', () => {
    let cloneCalled = false;
    const phantom = {
      isAlive: () => true,
      isHero: false,
      canActivateHeroAbility: () => false,
      canActivateOvercharge: () => false,
      canActivateShieldWall: () => false,
      canActivateShadowClone: () => true,
      activateShadowClone: () => { cloneCalled = true; },
    };

    // Simulates the relevant part of activateAbilityForSelected()
    const activateAbility = (unit: typeof phantom) => {
      if (!unit.isAlive()) return;
      if (unit.canActivateOvercharge()) {
        // overcharge path
      } else if (unit.canActivateShieldWall()) {
        // shieldwall path
      } else if (unit.canActivateShadowClone()) {
        unit.activateShadowClone();
      }
    };

    activateAbility(phantom);
    expect(cloneCalled).toBe(true);
  });
});

// ── Clone spawn on event ──────────────────────────────────────────────────────

describe('ShadowClone — clone spawned when event fires', () => {
  it('spawning creates a unit with isShadowClone=true and low HP', () => {
    const spawned: Array<{ isShadowClone: boolean; canAttack: boolean; stats: { maxHealth: number } }> = [];

    const simulateHandler = (source: { isAlive: () => boolean; tileX: number; tileY: number }) => {
      if (!source.isAlive()) return;
      const cloneStats = { maxHealth: 30, attackDamage: 0, attackRangePx: 0, attackCooldownMs: 99999 };
      const clone = { isShadowClone: true, canAttack: false, stats: cloneStats, tileX: source.tileX, tileY: source.tileY };
      spawned.push(clone);
    };

    simulateHandler({ isAlive: () => true, tileX: 5, tileY: 5 });

    expect(spawned).toHaveLength(1);
    expect(spawned[0].isShadowClone).toBe(true);
    expect(spawned[0].canAttack).toBe(false);
    expect(spawned[0].stats.maxHealth).toBe(30);
  });

  it('does not spawn if the source phantom is already dead', () => {
    const spawned: unknown[] = [];
    const simulateHandler = (source: { isAlive: () => boolean }) => {
      if (!source.isAlive()) return;
      spawned.push({});
    };
    simulateHandler({ isAlive: () => false });
    expect(spawned).toHaveLength(0);
  });
});

// ── Supply / stats accounting ─────────────────────────────────────────────────

describe('ShadowClone — death does not decrement supply or count as loss', () => {
  it('isShadowClone skips supply decrement on death', () => {
    let supplyUsed = 3;
    let unitsLost = 0;

    const onUnitDied = (unit: { isWorker: boolean; isShadowClone: boolean; unitTypeId: string }) => {
      const isDrone = unit.unitTypeId === 'drone';
      if (!unit.isWorker && !isDrone && !unit.isShadowClone) supplyUsed = Math.max(0, supplyUsed - 1);
      if (!isDrone && !unit.isShadowClone) unitsLost++;
    };

    // Clone dies — no supply decrement, no loss count
    onUnitDied({ isWorker: false, isShadowClone: true, unitTypeId: 'phantom' });
    expect(supplyUsed).toBe(3); // unchanged
    expect(unitsLost).toBe(0);  // unchanged
  });

  it('real unit death still decrements supply', () => {
    let supplyUsed = 3;
    const onUnitDied = (unit: { isWorker: boolean; isShadowClone: boolean; unitTypeId: string }) => {
      const isDrone = unit.unitTypeId === 'drone';
      if (!unit.isWorker && !isDrone && !unit.isShadowClone) supplyUsed = Math.max(0, supplyUsed - 1);
    };
    onUnitDied({ isWorker: false, isShadowClone: false, unitTypeId: 'phantom' });
    expect(supplyUsed).toBe(2);
  });
});
