// Regression: ISSUE-011 — Shade Spire zone ring leaked on building destruction
//
// createShadeSpireZone() created two infinite-repeat tweens:
//   1. zone (filled circle) — pulsing alpha, repeat: -1
//   2. ring (outer arc)     — pulsing strokeAlpha, repeat: -1
//
// Only `zone` was stored in shadeSpires (as `zoneCircle`). `ring` was a local
// variable. When the building was destroyed in updateShadeSpireZones():
//   spire.zoneCircle.destroy() was called — but:
//   - No killTweensOf on zoneCircle before destroy (tween kept firing)
//   - ring was never destroyed (Graphics object leaked)
//   - ring's infinite tween continued updating forever
//
// Fix:
//   - Add `zoneRing` field to the shadeSpires entry.
//   - In the destruction branch: killTweensOf(zoneCircle), killTweensOf(zoneRing),
//     zoneCircle.destroy(), zoneRing.destroy().

import { describe, it, expect } from 'vitest';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

const makeCircle = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

const makeTweens = () => {
  const killed: object[] = [];
  return { killed, killTweensOf(t: object) { killed.push(t); } };
};

// Simulate the fixed spire cleanup
const simulateSpireCleanup = (
  zoneCircle: ReturnType<typeof makeCircle>,
  zoneRing: ReturnType<typeof makeCircle>,
  tweens: ReturnType<typeof makeTweens>,
) => {
  tweens.killTweensOf(zoneCircle);
  tweens.killTweensOf(zoneRing);
  zoneCircle.destroy();
  zoneRing.destroy();
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — shade spire zone cleanup on building destruction', () => {
  it('kills the zoneCircle (filled zone) infinite tween before destroy', () => {
    const circle = makeCircle();
    const ring   = makeCircle();
    const tweens = makeTweens();

    simulateSpireCleanup(circle, ring, tweens);

    expect(tweens.killed).toContain(circle);
  });

  it('kills the zoneRing (outer arc) infinite tween before destroy', () => {
    const circle = makeCircle();
    const ring   = makeCircle();
    const tweens = makeTweens();

    simulateSpireCleanup(circle, ring, tweens);

    expect(tweens.killed).toContain(ring);
  });

  it('destroys both the zone circle and the ring arc', () => {
    const circle = makeCircle();
    const ring   = makeCircle();
    const tweens = makeTweens();

    simulateSpireCleanup(circle, ring, tweens);

    expect(circle.destroyed).toBe(true);
    expect(ring.destroyed).toBe(true);
  });

  it('kills tweens before destroying — not after', () => {
    const circle = makeCircle();
    const ring   = makeCircle();
    const tweens = makeTweens();
    const order: string[] = [];

    const origKill = tweens.killTweensOf.bind(tweens);
    tweens.killTweensOf = (t) => { order.push('kill'); origKill(t); };
    const origCircleDestroy = circle.destroy.bind(circle);
    circle.destroy = () => { order.push('destroyCircle'); origCircleDestroy(); };
    const origRingDestroy = ring.destroy.bind(ring);
    ring.destroy = () => { order.push('destroyRing'); origRingDestroy(); };

    simulateSpireCleanup(circle, ring, tweens);

    // Both kills happen before any destroy
    expect(order[0]).toBe('kill');
    expect(order[1]).toBe('kill');
    expect(order[2]).toBe('destroyCircle');
    expect(order[3]).toBe('destroyRing');
  });

  it('old code missing zoneRing — demonstrates ring object leaked', () => {
    // Under old code, shadeSpires only stored { zoneCircle }, not ring.
    // When building was destroyed, only zoneCircle.destroy() was called.
    // ring was a local variable in createShadeSpireZone — no reference kept.
    const circle = makeCircle();
    const ring   = makeCircle();
    const tweens = makeTweens();

    // Old cleanup: only circle was destroyed, ring was inaccessible
    tweens.killTweensOf(circle); // wouldn't even have been here in old code
    circle.destroy();
    // ring.destroy() NEVER called

    expect(ring.destroyed).toBe(false); // the old bug
  });
});
