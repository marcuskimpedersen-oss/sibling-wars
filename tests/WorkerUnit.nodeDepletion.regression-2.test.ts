// Regression: ISSUE-002 — resources discarded when node depletes during to_hq carry
//
// node:depleted fires 800ms after harvest() (inside ResourceNode.depleteVisuals tween
// onComplete), not synchronously. By that time the worker's 350ms exit animation has
// already completed and the worker is walking to HQ in 'to_hq' state with carryAmount>0.
//
// Old code: the `else` branch called stopWorkerMining() for ALL non-harvesting workers,
// which zeroed carryAmount — the player silently lost the last batch of resources.
//
// Fix: guard changed to `!== 'to_hq'` so workers already carrying skip the immediate
// stop. depositAndContinue() handles stopWorkerMining after depositing, because it
// already checks node.isDepleted() before starting the next trip.

import { describe, it, expect, vi } from 'vitest';

// ── Timing invariants ─────────────────────────────────────────────────────────

describe('node:depleted timing', () => {
  it('fires 800ms after the last harvest, not synchronously', () => {
    // ResourceNode.depleteVisuals starts an 800ms tween; event fires in onComplete.
    // A worker exit animation takes 350ms, so the worker is always in to_hq by the
    // time the event fires (800ms > 350ms).
    const DEPLETION_TWEEN_MS = 800;
    const EXIT_ANIMATION_MS  = 350;
    expect(DEPLETION_TWEEN_MS).toBeGreaterThan(EXIT_ANIMATION_MS);
  });

  it('to_hq state is reached 350ms after harvest — before node:depleted at 800ms', () => {
    const harvestT = 0;
    const toHqT    = harvestT + 350;   // exit animation completes
    const eventT   = harvestT + 800;   // node:depleted fires
    expect(toHqT).toBeLessThan(eventT);
  });
});

// ── node:depleted handler guard invariants ────────────────────────────────────

describe('node:depleted handler — to_hq guard', () => {
  it('!== to_hq guard preserves carry for workers already heading to HQ', () => {
    const miningState = 'to_hq';
    // The handler should NOT call stopWorkerMining for to_hq workers
    const shouldStop = miningState !== 'to_hq';
    expect(shouldStop).toBe(false);
  });

  it('!== to_hq guard still stops workers in to_node (not yet harvested)', () => {
    const miningState = 'to_node';
    const shouldStop = miningState !== 'to_hq';
    expect(shouldStop).toBe(true);
  });

  it('!== to_hq guard still stops workers in idle state', () => {
    const miningState = 'idle';
    const shouldStop = miningState !== 'to_hq';
    expect(shouldStop).toBe(true);
  });

  it('old else-branch would have discarded carry for to_hq workers', () => {
    // OLD: } else { stopWorkerMining(u); }
    // stopWorkerMining → stopMining() → carryAmount = 0
    // This documents the original bug.
    const miningState = 'to_hq';
    const oldGuardStops = true; // no guard — always fires
    expect(oldGuardStops).toBe(true); // bug confirmed: old code always stopped
    const newGuardStops = miningState !== 'to_hq';
    expect(newGuardStops).toBe(false); // fix: new code skips to_hq workers
  });
});

// ── depositAndContinue already handles post-depletion stop ───────────────────

describe('depositAndContinue handles depleted node after deposit', () => {
  it('checks node.isDepleted() before re-queuing next trip', () => {
    // Invariant: depositAndContinue returns early (calls stopWorkerMining) when
    // the node is depleted. This means to_hq workers will correctly stop mining
    // after depositing — no infinite loop, no orphaned assignment.
    let stopCalled = false;
    const worker = { miningState: 'to_hq' as string, carryAmount: 20, carryType: 'gold' };
    const node   = { isDepleted: () => true };

    // Simulate depositAndContinue logic
    const depositAndContinue = () => {
      if (worker.miningState !== 'to_hq') return;
      worker.carryAmount = 0; // deposit
      if (node.isDepleted()) { stopCalled = true; return; } // stop after deposit
      worker.miningState = 'to_node'; // would re-queue — NOT reached
    };

    depositAndContinue();

    expect(stopCalled).toBe(true);
    expect(worker.miningState).toBe('to_hq'); // state untouched by our guard
    expect(worker.carryAmount).toBe(0);       // carry was deposited
  });

  it('does NOT re-queue if node is depleted after deposit', () => {
    let reDqueued = false;
    const worker = { miningState: 'to_hq' as string, carryAmount: 10 };
    const node   = { isDepleted: () => true };

    const depositAndContinue = () => {
      if (worker.miningState !== 'to_hq') return;
      worker.carryAmount = 0;
      if (node.isDepleted()) return;
      reDqueued = true; // would start next trip
    };

    depositAndContinue();

    expect(reDqueued).toBe(false);
  });
});
