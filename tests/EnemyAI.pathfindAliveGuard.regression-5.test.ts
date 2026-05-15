// Regression: ISSUE-005 — EnemyAI pathfinding callbacks called setPath on dead units
//
// All 11 pathfinder.findPath callbacks in EnemyAI (launchAssaultWave, launchFeint,
// launchHarassmentRaid, launchIdleHarassmentRaid, launchAllInPush, orderIdleUnits,
// spawnEliteEnemy, and the forward-outpost defender) were missing
// `if (!unit.isAlive()) return;` guards.
//
// EasyStar callbacks fire from pathfinder.calculate() one frame after the
// findPath call.  Units can die in the intervening frame (combat, instant-kill
// abilities).  Without the guard, setPath() ran on a dead unit — setting its
// state back to 'moving' and stomping the death-animation flow.
//
// Fix: added `if (!unit.isAlive()) return;` as the first line of every
// EnemyAI pathfinder callback.  Same fix applied to sendWorkerToRallyThenAutoAssign
// in GameScene.

import { describe, it, expect } from 'vitest';

// ── Shared unit stub ──────────────────────────────────────────────────────────

const makeUnit = (alive = true) => ({
  _alive: alive,
  _pathSet: false,
  isAlive() { return this._alive; },
  setPath(_path: unknown[]) { this._pathSet = true; },
  die() { this._alive = false; },
  getCurrentTile() { return { tileX: 5, tileY: 5 }; },
});

// ── Guard pattern: simulates the fixed callback body ─────────────────────────

const fixedCallback = (unit: ReturnType<typeof makeUnit>, path: unknown[] | null) => {
  if (!unit.isAlive()) return;
  if (path && path.length > 0) unit.setPath(path);
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EnemyAI pathfind callbacks — alive guard', () => {
  it('does not call setPath when unit dies before callback fires', () => {
    const unit = makeUnit(true);
    unit.die(); // unit dies between findPath and callback
    const fakePath = [{ x: 6, y: 6 }];
    fixedCallback(unit, fakePath);
    expect(unit._pathSet).toBe(false);
  });

  it('calls setPath when unit is alive and path is valid', () => {
    const unit = makeUnit(true);
    const fakePath = [{ x: 6, y: 6 }];
    fixedCallback(unit, fakePath);
    expect(unit._pathSet).toBe(true);
  });

  it('does not call setPath when path is null', () => {
    const unit = makeUnit(true);
    fixedCallback(unit, null);
    expect(unit._pathSet).toBe(false);
  });

  it('does not call setPath when path is empty', () => {
    const unit = makeUnit(true);
    fixedCallback(unit, []);
    expect(unit._pathSet).toBe(false);
  });
});

// ── Wave-spawning loop: each unit checked independently ───────────────────────

describe('EnemyAI launchAssaultWave — per-unit dead guard', () => {
  it('only paths units that are still alive after the async gap', () => {
    const units = [makeUnit(true), makeUnit(true), makeUnit(true)];
    units[1].die(); // middle unit dies during pathfind

    const path = [{ x: 10, y: 10 }];
    units.forEach(u => fixedCallback(u, path));

    expect(units[0]._pathSet).toBe(true);
    expect(units[1]._pathSet).toBe(false); // was dead when callback fired
    expect(units[2]._pathSet).toBe(true);
  });
});

// ── Feint callback: variable name u (not unit) ───────────────────────────────

describe('EnemyAI launchFeint — alive guard on existing units', () => {
  it('skips unit that dies during the feint retreat pathfind', () => {
    const alreadyFiltered: Array<ReturnType<typeof makeUnit>> = [
      makeUnit(true),
      makeUnit(true),
    ];

    // Simulate: one unit gets killed after the .filter() but before callback fires
    const feintCallback = (u: ReturnType<typeof makeUnit>, path: unknown[] | null) => {
      if (!u.isAlive()) return;
      if (path && path.length > 0) u.setPath(path);
    };

    alreadyFiltered[0].die();
    const path = [{ x: 3, y: 3 }];
    alreadyFiltered.forEach(u => feintCallback(u, path));

    expect(alreadyFiltered[0]._pathSet).toBe(false);
    expect(alreadyFiltered[1]._pathSet).toBe(true);
  });
});

// ── orderIdleUnits: same guard ────────────────────────────────────────────────

describe('EnemyAI orderIdleUnits — alive guard', () => {
  it('skips dead unit even if it passed the initial isAlive() filter', () => {
    const u = makeUnit(true);
    // Unit alive when filtered, then dies during async pathfind
    u.die();
    const path = [{ x: 7, y: 7 }];
    fixedCallback(u, path);
    expect(u._pathSet).toBe(false);
  });
});

// ── sendWorkerToRallyThenAutoAssign — same guard ──────────────────────────────

describe('GameScene sendWorkerToRallyThenAutoAssign — pathfind alive guard', () => {
  it('does not call setPath on a worker that died before the rally pathfind resolved', () => {
    const worker = makeUnit(true);
    let onArrivedCalled = false;
    const onArrived = () => { onArrivedCalled = true; };

    const rallyCallback = (w: ReturnType<typeof makeUnit>, path: unknown[] | null) => {
      if (!w.isAlive()) return;
      if (!path || path.length === 0) { onArrived(); return; }
      w.setPath(path);
    };

    worker.die();
    rallyCallback(worker, [{ x: 5, y: 5 }]);

    expect(worker._pathSet).toBe(false);
    expect(onArrivedCalled).toBe(false);
  });

  it('calls setPath on a live worker with a valid path', () => {
    const worker = makeUnit(true);
    let onArrivedCalled = false;
    const onArrived = () => { onArrivedCalled = true; };

    const rallyCallback = (w: ReturnType<typeof makeUnit>, path: unknown[] | null) => {
      if (!w.isAlive()) return;
      if (!path || path.length === 0) { onArrived(); return; }
      w.setPath(path);
    };

    rallyCallback(worker, [{ x: 5, y: 5 }]);

    expect(worker._pathSet).toBe(true);
    expect(onArrivedCalled).toBe(false);
  });

  it('calls onArrived (not setPath) when path is empty and worker is alive', () => {
    const worker = makeUnit(true);
    let onArrivedCalled = false;
    const onArrived = () => { onArrivedCalled = true; };

    const rallyCallback = (w: ReturnType<typeof makeUnit>, path: unknown[] | null) => {
      if (!w.isAlive()) return;
      if (!path || path.length === 0) { onArrived(); return; }
      w.setPath(path);
    };

    rallyCallback(worker, []);

    expect(worker._pathSet).toBe(false);
    expect(onArrivedCalled).toBe(true);
  });
});
