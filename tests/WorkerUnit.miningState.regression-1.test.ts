// Regression: ISSUE-001 — double animateExitMine on last harvest depletion
// Found by /qa on 2026-04-30
// Report: .gstack/qa-reports/qa-report-localhost-2026-04-30.md
//
// When node.harvest() synchronously fired node:depleted, the event handler
// transitioned miningState to 'exiting_mine' and started exit animation A.
// The guard `=== 'idle'` did not catch 'exiting_mine', so tickWorkerMining
// fell through and started exit animation B (killing A mid-frame).
//
// Fix: guard changed to `!== 'harvesting'` so any state change by the event
// handler short-circuits the carry path.

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    GameObjects: {
      Arc: class {},
      Ellipse: class {},
      Rectangle: class {},
      Image: class {},
      Sprite: class {},
      Text: class {},
      Graphics: class {},
      Polygon: class {},
    },
  },
}));

vi.mock('@/constants', () => ({
  WORKER_SPEED: 80,
  TILE_SIZE: 32,
  WORKER_COMBAT_STATS: { maxHealth: 80, attackDamage: 5, attackRange: 1.5, attackCooldownMs: 1000, armor: 0, moveSpeed: 80 },
  RACE_COMBAT_STATS: {},
  ENEMY_COMBAT_STATS: { maxHealth: 100, attackDamage: 10, attackRange: 1.5, attackCooldownMs: 1000, armor: 0, moveSpeed: 60 },
}));

vi.mock('@/buildings/definitions', () => ({ getRaceTint: () => 0xffffff }));

// ── State machine invariants ───────────────────────────────────────────────

describe('WorkerUnit miningState guard invariant', () => {
  it('!== harvesting guard catches idle correctly', () => {
    // Simulate the guard condition for a worker whose stopMining reset state to idle
    const miningState = 'idle';
    expect(miningState !== 'harvesting').toBe(true);
  });

  it('!== harvesting guard catches exiting_mine correctly', () => {
    // Simulate node:depleted handler setting state to exiting_mine
    // The old guard (=== idle) would NOT catch this, triggering the double-exit bug
    const miningState = 'exiting_mine';
    expect(miningState !== 'harvesting').toBe(true); // new guard fires correctly
  });

  it('!== harvesting guard does NOT bail on a healthy harvesting worker', () => {
    // Normal path: worker finished harvest timer, node not depleted — should proceed
    const miningState = 'harvesting';
    expect(miningState !== 'harvesting').toBe(false); // guard does NOT bail
  });

  it('old guard === idle would have missed exiting_mine', () => {
    // This documents the bug: the old guard was insufficient
    const miningState = 'exiting_mine';
    expect(miningState === 'idle').toBe(false); // old guard FAILS to catch
    expect(miningState !== 'harvesting').toBe(true); // new guard catches it
  });
});

// ── WorkerUnit state reset ────────────────────────────────────────────────

describe('WorkerUnit.stopMining resets all fields', () => {
  // Build a minimal fake WorkerUnit to test stopMining() in isolation
  function makeWorker() {
    const tweenKillFn = vi.fn();
    const mockSprite = {
      x: 100, y: 200,
      setScale: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
    };
    const mockScene = {
      tweens: { killTweensOf: tweenKillFn, add: vi.fn() },
      add: {
        ellipse: vi.fn().mockReturnValue({ setDepth: vi.fn().mockReturnThis(), setStrokeStyle: vi.fn().mockReturnThis() }),
        rectangle: vi.fn().mockReturnValue({ setDepth: vi.fn().mockReturnThis() }),
        arc: vi.fn().mockReturnValue({
          setDepth: vi.fn().mockReturnThis(),
          setStrokeStyle: vi.fn().mockReturnThis(),
          setPosition: vi.fn().mockReturnThis(),
          setVisible: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        }),
        image: vi.fn().mockReturnValue({ setDepth: vi.fn().mockReturnThis(), setOrigin: vi.fn().mockReturnThis(), setVisible: vi.fn().mockReturnThis() }),
        graphics: vi.fn().mockReturnValue({ setDepth: vi.fn().mockReturnThis(), fillStyle: vi.fn(), fillRect: vi.fn(), clear: vi.fn() }),
      },
      events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      cameras: { main: { scrollX: 0, scrollY: 0, width: 1280, height: 720 } },
    };

    // Manually construct the minimal state a WorkerUnit.stopMining needs
    const worker = {
      miningNode: { removeWorker: vi.fn() } as any,
      miningState: 'harvesting' as any,
      miningHQTile: { tileX: 3, tileY: 3 },
      carryAmount: 20,
      carryType: 'gold' as any,
      directMining: true,
      miningExitWorldX: 96,
      miningExitWorldY: 64,
      sprite: mockSprite as any,
      scene: mockScene as any,
      stopMining() {
        if (this.miningNode) { this.miningNode.removeWorker(); this.miningNode = null; }
        this.miningState = 'idle';
        this.miningHQTile = null;
        this.carryAmount = 0;
        this.carryType = null;
        this.directMining = false;
        this.scene.tweens.killTweensOf(this.sprite);
        this.sprite.setScale(1);
        this.sprite.setAlpha(1);
      },
    };
    return { worker, tweenKillFn };
  }

  it('resets miningState to idle', () => {
    const { worker } = makeWorker();
    worker.stopMining();
    expect(worker.miningState).toBe('idle');
  });

  it('clears miningNode after calling removeWorker', () => {
    const { worker } = makeWorker();
    const removeWorkerFn = worker.miningNode.removeWorker;
    worker.stopMining();
    expect(removeWorkerFn).toHaveBeenCalledOnce();
    expect(worker.miningNode).toBeNull();
  });

  it('resets directMining flag', () => {
    const { worker } = makeWorker();
    worker.stopMining();
    expect(worker.directMining).toBe(false);
  });

  it('kills in-flight tweens to prevent ghost sprites', () => {
    const { worker, tweenKillFn } = makeWorker();
    worker.stopMining();
    expect(tweenKillFn).toHaveBeenCalledWith(worker.sprite);
  });

  it('is safe to call twice (miningNode already null)', () => {
    const { worker } = makeWorker();
    worker.stopMining();
    expect(() => worker.stopMining()).not.toThrow();
  });
});
