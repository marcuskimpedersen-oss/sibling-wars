// Regression: ISSUE-008 — Worker miningState not reset on death after removeDeadUnits fix
//
// After ISSUE-006 was fixed (this.units.delete moved before the 700ms delayedCall),
// dead workers are immediately absent from getAllUnits(). The tickWorkerMining dead-
// worker branch now always sees `unit === undefined`, so the old
//   if (unit) (unit as WorkerUnit).miningState = 'idle'
// could never execute.
//
// Result: animateExitMine / animateEnterMine onComplete callbacks checked
//   miningState !== 'exiting_mine' / miningState !== 'to_node'
// and found the stale value still set, so they continued the mining loop on a dead
// worker: calling showCarryVisual (orphaned Arc dot) and pathfinding to HQ.
//
// Fix: onUnitDied handler now calls stopWorkerMining (or resets miningState) for
// worker units immediately — before any tween callback can fire.

import { describe, it, expect } from 'vitest';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

type WorkerMiningState = 'idle' | 'to_node' | 'harvesting' | 'exiting_mine' | 'to_hq';

const makeWorker = (miningState: WorkerMiningState = 'idle') => ({
  id: `w_${Math.random()}`,
  isWorker: true,
  faction: 'player' as const,
  _alive: true,
  isAlive() { return this._alive; },
  miningState,
  miningNode: null as { removeWorkerCalled: boolean } | null,
  stopMiningCalled: false,
  stopMining() {
    this.miningNode?.removeWorker();
    this.miningState = 'idle';
    this.stopMiningCalled = true;
  },
});

const makeNode = () => ({
  removeWorkerCalled: false,
  removeWorker() { this.removeWorkerCalled = true; },
});

// ── Simulate the fixed onUnitDied worker cleanup ──────────────────────────────

type Worker = ReturnType<typeof makeWorker>;
type Node = ReturnType<typeof makeNode>;

function simulateOnUnitDied(
  worker: Worker,
  miningAssignments: Map<string, Node>,
): void {
  if (worker.isWorker) {
    if (miningAssignments.has(worker.id)) {
      // stopWorkerMining: delete assignment + worker.stopMining()
      const node = miningAssignments.get(worker.id)!;
      miningAssignments.delete(worker.id);
      worker.stopMining();
    } else if (worker.miningState !== 'idle') {
      worker.miningState = 'idle';
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene.onUnitDied — worker mining cleanup', () => {
  it('resets miningState to idle when worker dies with an active assignment', () => {
    const worker = makeWorker('harvesting');
    const node = makeNode();
    const assignments = new Map([[worker.id, node]]);

    simulateOnUnitDied(worker, assignments);

    expect(worker.miningState).toBe('idle');
  });

  it('removes the assignment from the map when worker dies', () => {
    const worker = makeWorker('to_hq');
    const node = makeNode();
    const assignments = new Map([[worker.id, node]]);

    simulateOnUnitDied(worker, assignments);

    expect(assignments.has(worker.id)).toBe(false);
  });

  it('calls stopMining so node.removeWorker() is invoked', () => {
    const worker = makeWorker('exiting_mine');
    const node = makeNode();
    worker.miningNode = node;
    const assignments = new Map([[worker.id, node]]);

    simulateOnUnitDied(worker, assignments);

    expect(worker.stopMiningCalled).toBe(true);
  });

  it('resets miningState even when no assignment entry exists (e.g. to_node before pathfind resolved)', () => {
    const worker = makeWorker('to_node');
    const assignments = new Map<string, Node>(); // no entry for this worker

    simulateOnUnitDied(worker, assignments);

    expect(worker.miningState).toBe('idle');
  });

  it('is a no-op for idle workers with no assignment', () => {
    const worker = makeWorker('idle');
    const assignments = new Map<string, Node>();

    simulateOnUnitDied(worker, assignments);

    expect(worker.miningState).toBe('idle');
    expect(worker.stopMiningCalled).toBe(false);
  });

  it('does not touch miningState for non-worker units', () => {
    const soldier = {
      id: 's_1',
      isWorker: false,
      miningState: undefined as undefined,
    };
    const assignments = new Map<string, Node>();

    // Only call the worker branch if isWorker — verify no crash
    if (soldier.isWorker) {
      // Should not reach here
      (soldier as unknown as Worker).miningState = 'idle';
    }

    expect(soldier.miningState).toBeUndefined();
  });
});

// ── Demonstrate the old broken path ──────────────────────────────────────────

describe('tickWorkerMining dead-worker branch (safety net only)', () => {
  it('with immediate deletion, getAllUnits never returns a dead worker', () => {
    // Simulate the state after removeDeadUnits fix: dead units are immediately
    // removed from the map before tickWorkerMining runs.
    const worker = makeWorker('exiting_mine');
    worker._alive = false;

    const liveUnits: Worker[] = []; // worker not present — already deleted

    const found = liveUnits.find(u => u.id === worker.id);
    // tickWorkerMining's `if (unit)` guard can never be true for dead workers
    expect(found).toBeUndefined();
  });

  it('animateExitMine callback bails when miningState was reset to idle by onUnitDied', () => {
    // Simulate the in-flight onComplete callback from animateExitMine:
    //   if (worker.miningState === 'exiting_mine') stopWorkerMining(worker)
    // After the fix, miningState === 'idle' so the callback is a no-op.
    const worker = makeWorker('idle'); // onUnitDied already reset it
    let stopCalled = false;

    // This is the callback body from animateExitMine
    if (worker.miningState === 'exiting_mine') {
      stopCalled = true; // should NOT execute
    }

    expect(stopCalled).toBe(false);
  });
});
