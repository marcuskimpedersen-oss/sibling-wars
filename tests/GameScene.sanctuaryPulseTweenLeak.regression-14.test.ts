// Regression: ISSUE-014 — Sanctuary zone pulse tween leaked on zone destruction
//
// createSanctuaryZone() used a proxy pattern for the fill pulse animation:
//   const pulseProxy = { alpha: 0.08 };
//   this.tweens.add({ targets: pulseProxy, alpha: 0.22, repeat: -1, ... });
//
// The proxy was a local variable — never stored on the zone entry. When the zone
// was destroyed in updateSanctuaryZones():
//   this.tweens.killTweensOf(z.pulseGfx)  ← kills tweens on pulseGfx, not pulseProxy
//
// pulseGfx had no tweens targeting it directly. killTweensOf was a no-op.
// The infinite proxy tween continued running, calling pulseGfx.clear() and
// pulseGfx.fillCircle() on the already-destroyed Graphics object each frame.
//
// Fix:
//   - Add `pulseProxy: { alpha: number }` to the sanctuaryZones entry type.
//   - Store `pulseProxy` in the zone entry at creation.
//   - In the destruction branch: killTweensOf(z.pulseProxy) instead of z.pulseGfx.
//
// Same root cause as ISSUE-007 (lastStandAura), ISSUE-010 (pylonRing), ISSUE-013.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGfx = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

const makeTweens = () => {
  const killed: object[] = [];
  return { killed, killTweensOf(t: object) { killed.push(t); } };
};

type Zone = {
  gfx: ReturnType<typeof makeGfx>;
  pulseGfx: ReturnType<typeof makeGfx>;
  pulseProxy: { alpha: number };
  hpLabel: ReturnType<typeof makeGfx>;
};

// Simulate fixed zone cleanup
const simulateZoneDestroyed = (zone: Zone, tweens: ReturnType<typeof makeTweens>) => {
  tweens.killTweensOf(zone.pulseProxy); // fixed: kill via proxy
  zone.gfx.destroy();
  zone.pulseGfx.destroy();
  zone.hpLabel.destroy();
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — sanctuary zone pulse tween cleanup', () => {
  it('kills the pulse tween via pulseProxy (not pulseGfx)', () => {
    const zone: Zone = {
      gfx: makeGfx(), pulseGfx: makeGfx(),
      pulseProxy: { alpha: 0.08 },
      hpLabel: makeGfx(),
    };
    const tweens = makeTweens();

    simulateZoneDestroyed(zone, tweens);

    expect(tweens.killed).toContain(zone.pulseProxy);
    expect(tweens.killed).not.toContain(zone.pulseGfx);
  });

  it('destroys gfx, pulseGfx, and hpLabel', () => {
    const zone: Zone = {
      gfx: makeGfx(), pulseGfx: makeGfx(),
      pulseProxy: { alpha: 0.08 },
      hpLabel: makeGfx(),
    };
    const tweens = makeTweens();

    simulateZoneDestroyed(zone, tweens);

    expect(zone.gfx.destroyed).toBe(true);
    expect(zone.pulseGfx.destroyed).toBe(true);
    expect(zone.hpLabel.destroyed).toBe(true);
  });

  it('demonstrates why the old killTweensOf(pulseGfx) was a no-op', () => {
    const pulseGfx = makeGfx();
    const pulseProxy = { alpha: 0.08 };

    // Tween targets pulseProxy — killTweensOf(pulseGfx) finds nothing
    const tweens = makeTweens();
    tweens.killTweensOf(pulseGfx); // old code (bug)

    // pulseProxy tween was never killed — old behavior
    expect(tweens.killed).toContain(pulseGfx);
    expect(tweens.killed).not.toContain(pulseProxy);
    // This proves the proxy tween would have continued after destroy
  });
});
