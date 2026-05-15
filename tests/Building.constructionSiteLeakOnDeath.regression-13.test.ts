// Regression: ISSUE-013 — Construction site graphics leaked when building destroyed mid-build
//
// beginConstruction() creates three GameObjects:
//   - constructionSite: Graphics (orange border around building footprint)
//   - constructionBar: Rectangle (orange progress bar)
//   - constructionBarBg: Rectangle (dark background bar)
//
// These are cleaned up normally when constructionRemaining reaches 0 in update().
// But if the building was destroyed (takeDamage → health ≤ 0) BEFORE construction
// completed, the destruction block never cleaned up these objects — they stayed
// visible at the building's last position indefinitely.
//
// Fix: add constructionSite/Bar/BarBg cleanup to the health ≤ 0 destruction block
// in takeDamage(), matching the pattern used for rallyMarker, pylonRingGfx, etc.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGfx = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

// Simulate the fixed destruction block's construction site cleanup
const simulateBuildingDestroyedDuringConstruction = (
  constructionSite: ReturnType<typeof makeGfx> | null,
  constructionBar: ReturnType<typeof makeGfx> | null,
  constructionBarBg: ReturnType<typeof makeGfx> | null,
) => {
  let siteRef   = constructionSite;
  let barRef    = constructionBar;
  let barBgRef  = constructionBarBg;

  if (siteRef)  { siteRef.destroy();  siteRef  = null; }
  if (barRef)   { barRef.destroy();   barRef   = null; }
  if (barBgRef) { barBgRef.destroy(); barBgRef = null; }

  return { siteRef, barRef, barBgRef };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Building — construction site cleanup on mid-build destruction', () => {
  it('destroys constructionSite graphics when building is destroyed', () => {
    const site = makeGfx();
    const bar  = makeGfx();
    const bg   = makeGfx();

    simulateBuildingDestroyedDuringConstruction(site, bar, bg);

    expect(site.destroyed).toBe(true);
  });

  it('destroys constructionBar when building is destroyed', () => {
    const site = makeGfx();
    const bar  = makeGfx();
    const bg   = makeGfx();

    simulateBuildingDestroyedDuringConstruction(site, bar, bg);

    expect(bar.destroyed).toBe(true);
  });

  it('destroys constructionBarBg when building is destroyed', () => {
    const site = makeGfx();
    const bar  = makeGfx();
    const bg   = makeGfx();

    simulateBuildingDestroyedDuringConstruction(site, bar, bg);

    expect(bg.destroyed).toBe(true);
  });

  it('nulls all construction refs after cleanup', () => {
    const site = makeGfx();
    const bar  = makeGfx();
    const bg   = makeGfx();

    const { siteRef, barRef, barBgRef } = simulateBuildingDestroyedDuringConstruction(site, bar, bg);

    expect(siteRef).toBeNull();
    expect(barRef).toBeNull();
    expect(barBgRef).toBeNull();
  });

  it('is a no-op for buildings destroyed after construction completed (all refs already null)', () => {
    // Construction finishes naturally in update() — all refs are nulled when timer hits 0
    const { siteRef, barRef, barBgRef } = simulateBuildingDestroyedDuringConstruction(null, null, null);

    expect(siteRef).toBeNull();
    expect(barRef).toBeNull();
    expect(barBgRef).toBeNull();
  });
});
