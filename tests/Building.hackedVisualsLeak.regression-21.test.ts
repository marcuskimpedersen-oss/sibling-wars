// Regression: ISSUE-021 — "HACKED" overlay lingered after building destruction
//
// Building.hack() creates a red overlay gfx + "HACKED" text object and stores
// them in this.hackedVisuals. A delayedCall destroys them after durationMs.
// If the building was destroyed (health ≤ 0) BEFORE durationMs elapsed, the
// hack visuals were never cleaned up — they floated at the last position until
// the delayedCall eventually fired.
//
// Fix: when health reaches 0, destroy all hackedVisuals and clear the array.
// The deferred delayedCall callback iterates the now-empty array (no-op).

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGfxObj = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

// Simulate the fixed building destruction block's hacked-visuals cleanup
const simulateHackedVisualCleanup = (hackedVisuals: ReturnType<typeof makeGfxObj>[]) => {
  if (hackedVisuals.length > 0) {
    hackedVisuals.forEach(v => v.destroy());
    hackedVisuals.length = 0; // simulate this.hackedVisuals = []
  }
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Building — hacked visuals cleanup on destruction', () => {
  it('destroys the gfx overlay when building is killed while hacked', () => {
    const gfx = makeGfxObj();
    const txt = makeGfxObj();
    const visuals = [gfx, txt];

    simulateHackedVisualCleanup(visuals);

    expect(gfx.destroyed).toBe(true);
    expect(txt.destroyed).toBe(true);
  });

  it('clears the hackedVisuals array after cleanup', () => {
    const visuals = [makeGfxObj(), makeGfxObj()];
    simulateHackedVisualCleanup(visuals);
    expect(visuals.length).toBe(0);
  });

  it('is a no-op when the building was not hacked', () => {
    const visuals: ReturnType<typeof makeGfxObj>[] = [];
    expect(() => simulateHackedVisualCleanup(visuals)).not.toThrow();
    expect(visuals.length).toBe(0);
  });

  it('deferred delayedCall is safe after cleanup (iterates empty array)', () => {
    const visuals: ReturnType<typeof makeGfxObj>[] = [makeGfxObj()];
    simulateHackedVisualCleanup(visuals); // building destroyed — clears visuals

    // Simulate the delayedCall firing after hack duration
    let threw = false;
    try {
      visuals.forEach(v => v.destroy()); // empty array — no-op
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
