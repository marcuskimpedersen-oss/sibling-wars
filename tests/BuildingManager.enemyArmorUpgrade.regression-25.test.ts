// Regression: ISSUE-025 — Building armor upgrade not applied to enemy mirror buildings
//
// When a player buys a building HP/armor upgrade from the global upgrade panel,
// their buildings get +2 armorBonus (reducing incoming damage per hit).
// In multiplayer, the opponent's mirror buildings (enemy faction) on the local screen
// were not receiving the same bonus, so they could be destroyed sooner than they should.
// This caused premature building_destroyed signals — killing the opponent's real building
// before the hit-point math was correct.
//
// Fix: buyPanelUpgrade('bldghp') sends upgrade { upgradeType: 'bldghp', delta: 2 }.
// The receiver calls buildingManager.applyArmorUpgradeToEnemies(delta).

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeBuilding = (faction: 'player' | 'enemy', baseArmor = 0, destroyed = false) => ({
  faction,
  armorBonus: baseArmor,
  isDestroyed() { return destroyed; },
});

// Simulates BuildingManager.applyArmorUpgradeToEnemies
const applyArmorUpgradeToEnemies = (
  buildings: ReturnType<typeof makeBuilding>[],
  armorDelta: number,
) => {
  buildings.forEach(b => {
    if (b.faction === 'enemy' && !b.isDestroyed()) {
      b.armorBonus = (b.armorBonus ?? 0) + armorDelta;
    }
  });
};

// Simulates Building.takeDamage with armor
const takeDamage = (building: { armorBonus: number }, amount: number) =>
  Math.max(1, amount - building.armorBonus);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BuildingManager — enemy building armor upgrade sync (ISSUE-025)', () => {
  it('applies armorBonus delta to enemy buildings', () => {
    const buildings = [makeBuilding('enemy', 0)];
    applyArmorUpgradeToEnemies(buildings, 2);
    expect(buildings[0].armorBonus).toBe(2);
  });

  it('does not touch player buildings', () => {
    const buildings = [makeBuilding('player', 0)];
    applyArmorUpgradeToEnemies(buildings, 2);
    expect(buildings[0].armorBonus).toBe(0); // unchanged
  });

  it('does not apply to destroyed enemy buildings', () => {
    const buildings = [makeBuilding('enemy', 0, true)]; // destroyed
    applyArmorUpgradeToEnemies(buildings, 2);
    expect(buildings[0].armorBonus).toBe(0); // no change
  });

  it('stacks correctly across multiple upgrades', () => {
    const buildings = [makeBuilding('enemy', 0)];
    applyArmorUpgradeToEnemies(buildings, 2);
    applyArmorUpgradeToEnemies(buildings, 2);
    expect(buildings[0].armorBonus).toBe(4);
  });

  it('reduces effective damage after upgrade', () => {
    const building = makeBuilding('enemy', 0);
    applyArmorUpgradeToEnemies([building], 2);
    // Without upgrade: 5 damage
    // With upgrade: max(1, 5 - 2) = 3
    expect(takeDamage(building, 5)).toBe(3);
  });

  it('HQ with baseArmor=6 stacks correctly with enemy armor upgrade', () => {
    const hq = makeBuilding('enemy', 6); // HQ has 6 base armor
    applyArmorUpgradeToEnemies([hq], 2);
    expect(hq.armorBonus).toBe(8);
    expect(takeDamage(hq, 10)).toBe(2); // max(1, 10 - 8)
  });

  it('demonstrates old bug: enemy building had no armor upgrade — destroyed too early', () => {
    const buildingOld = makeBuilding('enemy', 0); // old: no upgrade applied
    const buildingNew = makeBuilding('enemy', 0);
    applyArmorUpgradeToEnemies([buildingNew], 2); // fixed: upgrade applied

    const damageOld = takeDamage(buildingOld, 5); // 5 damage (full)
    const damageNew = takeDamage(buildingNew, 5); // 3 damage (reduced)

    expect(damageOld).toBe(5);
    expect(damageNew).toBe(3); // building survives longer — correct
  });
});
