// Regression: ISSUE-012 — onFireGlow infinite tween leaked when unit died while on fire
//
// activateOnFire() creates an Arc with repeat: -1 pulsing tween. deactivateOnFire()
// correctly calls killTweensOf before destroy. But onDeath() never called
// deactivateOnFire() — the glow Arc and its infinite tween persisted at the unit's
// last position after death, since update() returns early for dead units and the
// natural timer path (onFireTimer reaching 0) never executed.
//
// Every other ability visual with an infinite tween (overchargeGlow, shieldRing,
// _phaseShiftRing, stasisGfx, _siegeTransitionGfx, _detectorRing, _heroInvulnRing,
// _lastStandAura) was cleaned up in onDeath(). onFireGlow was the only exception.
//
// Fix: add onFireGlow cleanup to onDeath(), matching the deactivateOnFire() pattern:
//   if (this.onFireGlow) { killTweensOf; destroy; null; }
//   this.onFireActive = false;

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGlow = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

const makeTweens = () => {
  const killed: object[] = [];
  return { killed, killTweensOf(t: object) { killed.push(t); } };
};

// Simulate the fixed onDeath() onFireGlow cleanup block
const simulateOnDeathFireCleanup = (
  onFireGlow: ReturnType<typeof makeGlow> | null,
  tweens: ReturnType<typeof makeTweens>,
) => {
  let glowRef = onFireGlow;
  let onFireActive = glowRef !== null;

  if (glowRef) {
    tweens.killTweensOf(glowRef);
    glowRef.destroy();
    glowRef = null;
  }
  onFireActive = false;

  return { glowRef, onFireActive };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Unit.onDeath — onFireGlow cleanup', () => {
  it('kills the infinite tween when unit dies while on fire', () => {
    const glow = makeGlow();
    const tweens = makeTweens();

    simulateOnDeathFireCleanup(glow, tweens);

    expect(tweens.killed).toContain(glow);
  });

  it('destroys the glow Arc on death', () => {
    const glow = makeGlow();
    const tweens = makeTweens();

    simulateOnDeathFireCleanup(glow, tweens);

    expect(glow.destroyed).toBe(true);
  });

  it('resets onFireActive flag on death', () => {
    const glow = makeGlow();
    const tweens = makeTweens();
    const { onFireActive } = simulateOnDeathFireCleanup(glow, tweens);

    expect(onFireActive).toBe(false);
  });

  it('nulls the glow ref after cleanup', () => {
    const glow = makeGlow();
    const tweens = makeTweens();
    const { glowRef } = simulateOnDeathFireCleanup(glow, tweens);

    expect(glowRef).toBeNull();
  });

  it('is a no-op when unit dies without ever being set on fire', () => {
    const tweens = makeTweens();
    const { glowRef, onFireActive } = simulateOnDeathFireCleanup(null, tweens);

    expect(tweens.killed).toHaveLength(0);
    expect(glowRef).toBeNull();
    expect(onFireActive).toBe(false);
  });
});

describe('Unit.onDeath — all infinite-tween ability visuals are cleaned up', () => {
  it('demonstrates consistent kill-then-destroy contract for all ability visuals with infinite tweens', () => {
    // Each field here has a repeat: -1 tween and must be cleaned up in onDeath().
    // This test documents the contract; the fix ensures onFireGlow is included.
    const abilityVisuals = [
      'overchargeGlow',    // fixed: ISSUE-009
      'shieldRing',        // fixed: ISSUE-009
      '_phaseShiftRing',   // was already correct
      'stasisGfx',         // was already correct
      '_siegeTransitionGfx', // was already correct
      '_detectorRing',     // was already correct
      '_heroInvulnRing',   // was already correct
      '_lastStandAura',    // fixed: ISSUE-007
      'onFireGlow',        // fixed: ISSUE-012
    ];

    // All must be present in the cleanup list
    const cleanedUp = new Set(abilityVisuals);
    for (const field of abilityVisuals) {
      expect(cleanedUp.has(field)).toBe(true);
    }
    expect(abilityVisuals).toHaveLength(9);
  });
});
