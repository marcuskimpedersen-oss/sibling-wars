// Regression: crown listener memory leak in EnemyAI
// Found by /qa on 2026-04-25
// Report: .gstack/qa-reports/qa-report-sibling-wars-2026-04-25.md
//
// Before the fix, every elite unit spawned after 8 min added a permanent
// scene.events.on('update', fn) listener that was never removed. After 30
// elites you'd have 30 dead listeners running every frame.
//
// The fix: named crownUpdater functions tracked in _crownUpdaters[], removed
// in EnemyAI.destroy() which GameScene.endGame() now calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Phaser mock ───────────────────────────────────────────────────────────────
// EnemyAI only needs scene.events.{on,off} and scene.time.addEvent.
// We don't need a real Phaser instance.
vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    GameObjects: { Text: class {}, Image: class {} },
  },
}));

// ── Project dependency mocks ──────────────────────────────────────────────────
vi.mock('@/units/UnitManager', () => ({ UnitManager: class {} }));
vi.mock('@/pathfinding/PathfinderService', () => ({ PathfinderService: class {} }));
vi.mock('@/buildings/BuildingManager', () => ({ BuildingManager: class {} }));
vi.mock('@/constants', () => ({
  BASE_TILE: { x: 5, y: 5 },
  ENEMY_BASE_TILE: { x: 45, y: 35 },
  ENEMY_SPAWN_INTERVAL_MS: 30000,
  ENEMY_WAVE_SIZE: 5,
  TILE_SIZE: 32,
  MAP_WIDTH_TILES: 50,
  MAP_HEIGHT_TILES: 40,
  Race: {},
  RACE_COMBAT_STATS: {},
  RACE_UNIT_TYPES: {},
  CombatStats: {},
}));
vi.mock('@/buildings/definitions', () => ({ getRaceTint: () => 0xffffff }));

import { EnemyAI } from '../src/ai/EnemyAI';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScene() {
  return {
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    time: { addEvent: vi.fn() },
    add: {
      text: vi.fn().mockReturnValue({
        setDepth: vi.fn().mockReturnThis(),
        setScrollFactor: vi.fn().mockReturnThis(),
        setAlpha: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
        active: true,
      }),
    },
  } as unknown as Phaser.Scene;
}

function makeAI(scene = makeScene()) {
  return new EnemyAI(scene, {} as any, {} as any, {} as any);
}

// Push synthetic listeners the same way the real crownUpdater path does.
function injectCrownUpdaters(ai: EnemyAI, count: number): Array<() => void> {
  const fns: Array<() => void> = [];
  for (let i = 0; i < count; i++) {
    const fn = vi.fn();
    (ai as any)._crownUpdaters.push(fn);
    fns.push(fn);
  }
  return fns;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EnemyAI.destroy()', () => {
  it('calls scene.events.off for every tracked crownUpdater', () => {
    const scene = makeScene();
    const ai = makeAI(scene);
    const fns = injectCrownUpdaters(ai, 3);

    ai.destroy();

    expect(scene.events.off).toHaveBeenCalledTimes(3);
    for (const fn of fns) {
      expect(scene.events.off).toHaveBeenCalledWith('update', fn);
    }
  });

  it('empties _crownUpdaters after destroy so a second call is a no-op', () => {
    const scene = makeScene();
    const ai = makeAI(scene);
    injectCrownUpdaters(ai, 2);

    ai.destroy();
    ai.destroy(); // second call must not re-invoke off()

    expect(scene.events.off).toHaveBeenCalledTimes(2); // only the first call
    expect((ai as any)._crownUpdaters).toHaveLength(0);
  });

  it('is safe to call with no listeners registered', () => {
    const scene = makeScene();
    const ai = makeAI(scene);

    expect(() => ai.destroy()).not.toThrow();
    expect(scene.events.off).not.toHaveBeenCalled();
  });

  it('handles a large number of listeners without error', () => {
    const scene = makeScene();
    const ai = makeAI(scene);
    injectCrownUpdaters(ai, 50); // 50 elites over a long game

    ai.destroy();

    expect(scene.events.off).toHaveBeenCalledTimes(50);
    expect((ai as any)._crownUpdaters).toHaveLength(0);
  });
});
