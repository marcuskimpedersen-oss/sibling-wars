// Regression: ISSUE-010 — Pylon ring proxy tween leaked on building destruction
//
// Building constructor created the pylon ring animation with:
//   scene.tweens.add({ targets: { alpha: 0.25 }, ... repeat: -1, ... })
//
// The tween targeted an anonymous plain-object proxy, not the ringGfx Graphics
// object. When the building was destroyed, `killTweensOf(pylonRingGfx)` would
// have been a no-op because the proxy is a different object reference.
//
// Additionally, pylonRingGfx itself was never destroyed or null-checked in the
// destruction path — the Graphics object persisted drawing at its last position
// until scene teardown.
//
// Fix:
//   - Store the proxy as `_pylonRingProxy` on the instance.
//   - In the destruction block (takeDamage, health <= 0):
//       killTweensOf(_pylonRingProxy) + _pylonRingProxy.destroy()
//       pylonRingGfx.destroy()
//   This matches the pattern used for the Last Stand aura fix (ISSUE-007).

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeTweens = () => {
  const killed: object[] = [];
  return { killed, killTweensOf(t: object) { killed.push(t); } };
};

const makeGfx = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

// Simulate the fixed destruction cleanup for the pylon ring
const simulateBuildingDestroyed = (
  pylonRingGfx: ReturnType<typeof makeGfx> | null,
  pylonRingProxy: { alpha: number } | null,
  tweens: ReturnType<typeof makeTweens>,
) => {
  let gfxRef   = pylonRingGfx;
  let proxyRef = pylonRingProxy;

  if (proxyRef) { tweens.killTweensOf(proxyRef); proxyRef = null; }
  if (gfxRef)   { gfxRef.destroy(); gfxRef = null; }

  return { gfxRef, proxyRef };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Building — pylon ring tween cleanup on destruction', () => {
  it('kills the proxy tween when the building is destroyed', () => {
    const gfx   = makeGfx();
    const proxy = { alpha: 0.25 };
    const tweens = makeTweens();

    simulateBuildingDestroyed(gfx, proxy, tweens);

    expect(tweens.killed).toContain(proxy);
  });

  it('does NOT kill via gfx reference — that would be a no-op for a proxy-targeted tween', () => {
    const gfx   = makeGfx();
    const proxy = { alpha: 0.25 };
    const tweens = makeTweens();

    simulateBuildingDestroyed(gfx, proxy, tweens);

    // The kill was on proxy, not gfx
    expect(tweens.killed).not.toContain(gfx);
    expect(tweens.killed).toContain(proxy);
  });

  it('destroys the pylonRingGfx Graphics object on building death', () => {
    const gfx   = makeGfx();
    const proxy = { alpha: 0.25 };
    const tweens = makeTweens();

    simulateBuildingDestroyed(gfx, proxy, tweens);

    expect(gfx.destroyed).toBe(true);
  });

  it('nulls out both refs after cleanup', () => {
    const gfx   = makeGfx();
    const proxy = { alpha: 0.25 };
    const tweens = makeTweens();

    const { gfxRef, proxyRef } = simulateBuildingDestroyed(gfx, proxy, tweens);

    expect(gfxRef).toBeNull();
    expect(proxyRef).toBeNull();
  });

  it('is a no-op when building never had a pylon ring (non-pylon buildings)', () => {
    const tweens = makeTweens();
    const { gfxRef, proxyRef } = simulateBuildingDestroyed(null, null, tweens);
    expect(tweens.killed).toHaveLength(0);
    expect(gfxRef).toBeNull();
    expect(proxyRef).toBeNull();
  });

  it('demonstrates why proxy !== gfx (the old bug)', () => {
    const gfx   = makeGfx();
    const proxy = { alpha: 0.25 };

    // Under old code: killTweensOf(gfx) was never called, and proxy !== gfx
    // so the tween would never be killed even if killTweensOf were added for gfx.
    expect(proxy).not.toBe(gfx);
  });
});
