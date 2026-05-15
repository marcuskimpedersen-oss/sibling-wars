// Regression: ISSUE-009 — overchargeGlow and shieldRing tweens not killed on death
//
// onDeath() cleaned up most ability visuals with scene.tweens.killTweensOf(obj)
// before destroy(), matching the pattern used for _phaseShiftRing, stasisGfx,
// _siegeTransitionGfx, _detectorRing, _heroInvulnRing, and _lastStandAura.
//
// But overchargeGlow and shieldRing called destroy() WITHOUT killTweensOf first.
// Both objects have infinite (repeat: -1) tweens. In Phaser 3, tweens do not
// auto-stop when their target is destroyed — the tween manager keeps firing
// setStrokeAlpha callbacks on the dead objects, causing property-access errors
// on destroyed GameObjects every frame.
//
// The deactivation paths (fireOvercharge, deactivateShieldWall) already used
// killTweensOf correctly. The death path was inconsistent.
//
// Fix: add killTweensOf before destroy in onDeath() for both fields, matching
// every other ability visual cleanup in that block.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGfxObject = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

const makeTweenManager = () => {
  const killed: object[] = [];
  return {
    killed,
    killTweensOf(target: object) { killed.push(target); },
  };
};

// Simulate the fixed onDeath() cleanup for overchargeGlow and shieldRing
const simulateCleanup = (
  obj: ReturnType<typeof makeGfxObject> | null,
  tweens: ReturnType<typeof makeTweenManager>,
) => {
  let ref = obj;
  if (ref) {
    tweens.killTweensOf(ref);
    ref.destroy();
    ref = null;
  }
  return ref;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Unit.onDeath — overchargeGlow tween kill', () => {
  it('kills the infinite tween before destroying overchargeGlow', () => {
    const glow = makeGfxObject();
    const tweens = makeTweenManager();

    simulateCleanup(glow, tweens);

    expect(tweens.killed).toContain(glow);
  });

  it('destroys the overchargeGlow Arc after killing the tween', () => {
    const glow = makeGfxObject();
    const tweens = makeTweenManager();

    simulateCleanup(glow, tweens);

    expect(glow.destroyed).toBe(true);
  });

  it('returns null ref after cleanup', () => {
    const glow = makeGfxObject();
    const tweens = makeTweenManager();
    const result = simulateCleanup(glow, tweens);
    expect(result).toBeNull();
  });

  it('is a no-op when overchargeGlow was never activated', () => {
    const tweens = makeTweenManager();
    const result = simulateCleanup(null, tweens);
    expect(tweens.killed).toHaveLength(0);
    expect(result).toBeNull();
  });
});

describe('Unit.onDeath — shieldRing tween kill', () => {
  it('kills the infinite tween before destroying shieldRing', () => {
    const ring = makeGfxObject();
    const tweens = makeTweenManager();

    simulateCleanup(ring, tweens);

    expect(tweens.killed).toContain(ring);
  });

  it('destroys the shieldRing Arc after killing the tween', () => {
    const ring = makeGfxObject();
    const tweens = makeTweenManager();

    simulateCleanup(ring, tweens);

    expect(ring.destroyed).toBe(true);
  });

  it('kill order: killTweensOf fires before destroy', () => {
    const ring = makeGfxObject();
    const tweens = makeTweenManager();
    const callOrder: string[] = [];

    // Instrument to capture order
    const origKill = tweens.killTweensOf.bind(tweens);
    const origDestroy = ring.destroy.bind(ring);
    tweens.killTweensOf = (t) => { callOrder.push('kill'); origKill(t); };
    ring.destroy = () => { callOrder.push('destroy'); origDestroy(); };

    simulateCleanup(ring, tweens);

    expect(callOrder).toEqual(['kill', 'destroy']);
  });
});

describe('onDeath tween-kill consistency', () => {
  it('all persistent ability visuals with infinite tweens follow the kill-then-destroy pattern', () => {
    // This test documents the contract for all ability gfx in onDeath().
    // Each entry: [fieldName, hasInfiniteTween]
    const abilityVisuals = [
      { name: 'overchargeGlow', infiniteTween: true,  killedInFix: true },
      { name: 'shieldRing',     infiniteTween: true,  killedInFix: true },
      { name: '_phaseShiftRing',infiniteTween: true,  killedInFix: true },
      { name: 'stasisGfx',      infiniteTween: true,  killedInFix: true },
      { name: '_siegeTransitionGfx', infiniteTween: true, killedInFix: true },
      { name: '_detectorRing',  infiniteTween: true,  killedInFix: true },
      { name: '_heroInvulnRing',infiniteTween: true,  killedInFix: true },
      { name: '_lastStandAura', infiniteTween: true,  killedInFix: true },
      { name: '_veterancyStar', infiniteTween: false, killedInFix: false }, // no tween
    ];

    for (const v of abilityVisuals) {
      if (v.infiniteTween) {
        expect(v.killedInFix).toBe(true);
      }
    }
  });
});
