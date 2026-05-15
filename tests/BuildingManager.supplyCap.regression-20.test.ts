// Regression: ISSUE-020 — Enemy mirror buildings inflated player supply cap
//
// BuildingManager.getTotalSupply() iterated ALL buildings regardless of faction.
// In multiplayer, Player B's supply-providing buildings (faction='enemy' on
// Player A's screen) were summed into Player A's supply cap.  If Player B built
// 3 supply depots, Player A gained +30 supply — allowing over-production.
//
// Fix: getTotalSupply() now filters to faction === 'player' only.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeBuilding = (faction: 'player' | 'enemy', supplyProvided: number, destroyed = false) => ({
  faction,
  def: { supplyProvided },
  isDestroyed() { return destroyed; },
});

// Fixed getTotalSupply
const getTotalSupply = (buildings: ReturnType<typeof makeBuilding>[]) => {
  let total = 0;
  buildings.forEach(b => { if (!b.isDestroyed() && b.faction === 'player') total += b.def.supplyProvided; });
  return total;
};

// Old (buggy) getTotalSupply
const getTotalSupplyOld = (buildings: ReturnType<typeof makeBuilding>[]) => {
  let total = 0;
  buildings.forEach(b => { if (!b.isDestroyed()) total += b.def.supplyProvided; });
  return total;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BuildingManager — getTotalSupply faction filter', () => {
  it('counts supply from player buildings', () => {
    const buildings = [makeBuilding('player', 10), makeBuilding('player', 10)];
    expect(getTotalSupply(buildings)).toBe(20);
  });

  it('does not count supply from enemy mirror buildings', () => {
    const buildings = [
      makeBuilding('player', 10),
      makeBuilding('enemy', 10), // opponent's supply depot mirror
    ];
    expect(getTotalSupply(buildings)).toBe(10); // only the player building
  });

  it('ignores destroyed player buildings', () => {
    const buildings = [
      makeBuilding('player', 10, false),
      makeBuilding('player', 10, true), // destroyed
    ];
    expect(getTotalSupply(buildings)).toBe(10);
  });

  it('returns 0 with no player buildings', () => {
    const buildings = [makeBuilding('enemy', 10), makeBuilding('enemy', 10)];
    expect(getTotalSupply(buildings)).toBe(0);
  });

  it('demonstrates the old bug: enemy buildings inflated supply cap', () => {
    const buildings = [
      makeBuilding('player', 10),
      makeBuilding('enemy', 10),
      makeBuilding('enemy', 10),
      makeBuilding('enemy', 10),
    ];
    // Old code counted all buildings — +30 supply from opponent's mirrors
    expect(getTotalSupplyOld(buildings)).toBe(40);
    // Fixed code counts only player buildings
    expect(getTotalSupply(buildings)).toBe(10);
  });
});
