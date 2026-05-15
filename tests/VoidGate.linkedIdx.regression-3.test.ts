// Regression: ISSUE-003 — void gate partner unlink broken after first gate is destroyed
//
// registerVoidGate() captures `myIdx = this._voidGates.length` at registration time.
// When an earlier gate is later destroyed and spliced out, all subsequent indices shift
// down by 1 — but `myIdx` in the closure is frozen at the original value.
//
// Concrete scenario:
//   1. Register A → myIdx_A=0, _voidGates=[A]
//   2. Register B → myIdx_B=1, B.linkedIdx=0 (A), A.linkedIdx=1 (B)
//   3. Destroy A → splice(indexOf(A)=0): array=[B], re-index B.linkedIdx: 0→null ✓
//   4. Register C → myIdx_C=1, C.linkedIdx=0 (B), B.linkedIdx=1 (C)
//   5. Destroy B → OLD: find(g.linkedIdx === myIdx_B=1) fails because C.linkedIdx=0
//                  FIX: idx=indexOf(B)=0 first, then find(g.linkedIdx===0) finds C ✓
//
// Fix: move indexOf(entry) before the partner search and use `idx` (the real current
// index) instead of the stale closure variable `myIdx`.

import { describe, it, expect } from 'vitest';

// ── Minimal void gate list model ──────────────────────────────────────────────

type Gate = { linkedIdx: number | null; label: string };

function makeGateList() {
  const gates: Gate[] = [];

  function register(): Gate {
    const entry: Gate = { linkedIdx: null, label: 'Unlinked' };
    const orphanIdx = gates.findIndex(g => g.linkedIdx === null);
    gates.push(entry);
    if (orphanIdx !== -1) {
      gates[orphanIdx].linkedIdx = gates.length - 1;
      entry.linkedIdx = orphanIdx;
      gates[orphanIdx].label = 'Gate A';
      entry.label = 'Gate B';
    }
    return entry;
  }

  function destroy_OLD(entry: Gate, capturedMyIdx: number) {
    // OLD buggy code: uses stale capturedMyIdx for partner search
    const partner = gates.find(g => g.linkedIdx === capturedMyIdx);
    if (partner) { partner.linkedIdx = null; partner.label = 'Unlinked'; }
    const idx = gates.indexOf(entry);
    if (idx !== -1) gates.splice(idx, 1);
    gates.forEach(g => {
      if (g.linkedIdx !== null && g.linkedIdx >= idx) {
        g.linkedIdx = Math.max(0, g.linkedIdx - 1);
      }
    });
  }

  function destroy_NEW(entry: Gate) {
    // FIXED: find real index first, then use it for partner search
    const idx = gates.indexOf(entry);
    if (idx !== -1) gates.splice(idx, 1);
    const partner = idx !== -1 ? gates.find(g => g.linkedIdx === idx) : null;
    if (partner) { partner.linkedIdx = null; partner.label = 'Unlinked'; }
    gates.forEach(g => {
      if (g.linkedIdx !== null && g.linkedIdx >= idx) {
        g.linkedIdx = Math.max(0, g.linkedIdx - 1);
      }
    });
  }

  return { gates, register, destroy_OLD, destroy_NEW };
}

// ── Bug scenario: destroy B after [A←→B], then pair B←→C, then destroy B ─────

describe('VoidGate stale myIdx — partner unlink after index shift', () => {
  it('OLD code leaves partner self-linked after two destroys', () => {
    const { gates, register, destroy_OLD } = makeGateList();

    const A = register(); // myIdx_A=0 at registration
    const B = register(); // myIdx_B=1 at registration; links A↔B

    expect(A.linkedIdx).toBe(1);
    expect(B.linkedIdx).toBe(0);

    // Destroy A using stale myIdx_A=0
    destroy_OLD(A, 0);
    // After destroy: [B], B.linkedIdx=null
    expect(gates).toHaveLength(1);
    expect(gates[0].linkedIdx).toBeNull();

    const C = register(); // pairs with orphan B; B.linkedIdx=1, C.linkedIdx=0
    expect(B.linkedIdx).toBe(1);
    expect(C.linkedIdx).toBe(0);

    // Destroy B using stale myIdx_B=1
    // B is now at index 0, but myIdx_B=1 — old code searches linkedIdx===1, finds nobody
    destroy_OLD(B, 1); // BUG: capturedMyIdx=1, but C.linkedIdx=0

    // OLD BUG: C was never unlinked — it still has linkedIdx=0, pointing to itself
    expect(gates).toHaveLength(1);
    expect(gates[0]).toBe(C);
    expect(C.linkedIdx).toBe(0); // self-linked: bug confirmed
  });

  it('NEW code correctly unlinks C when B is destroyed after index shift', () => {
    const { gates, register, destroy_NEW } = makeGateList();

    const A = register();
    const B = register(); // A↔B linked

    destroy_NEW(A); // removes A, B.linkedIdx → null

    const C = register(); // pairs with orphan B; B.linkedIdx=1, C.linkedIdx=0
    expect(B.linkedIdx).toBe(1);
    expect(C.linkedIdx).toBe(0);

    destroy_NEW(B); // B is at index 0; idx=0; C.linkedIdx===0 → found

    expect(gates).toHaveLength(1);
    expect(gates[0]).toBe(C);
    expect(C.linkedIdx).toBeNull(); // correctly unlinked ✓
    expect(C.label).toBe('Unlinked');
  });
});

// ── Simple case: first gate destroyed, no index shift ─────────────────────────

describe('VoidGate destroy — no index shift (first pair only)', () => {
  it('destroying first gate of a pair unlinks both with new code', () => {
    const { gates, register, destroy_NEW } = makeGateList();
    const A = register();
    const B = register();

    destroy_NEW(A);

    expect(gates).toHaveLength(1);
    expect(gates[0]).toBe(B);
    expect(B.linkedIdx).toBeNull();
  });

  it('destroying second gate of a pair unlinks both with new code', () => {
    const { gates, register, destroy_NEW } = makeGateList();
    const A = register();
    const B = register();

    destroy_NEW(B);

    expect(gates).toHaveLength(1);
    expect(gates[0]).toBe(A);
    expect(A.linkedIdx).toBeNull();
  });
});

// ── Three pairs: destroy middle gate, verify re-index ─────────────────────────

describe('VoidGate re-index after middle gate destroyed', () => {
  it('re-indexes surviving gates correctly after middle entry removed', () => {
    const { gates, register, destroy_NEW } = makeGateList();

    // Register 6 gates → 3 pairs: 0↔1, 2↔3, 4↔5
    const g0 = register();
    const g1 = register();
    const g2 = register();
    const g3 = register();
    const g4 = register();
    const g5 = register();

    expect(g0.linkedIdx).toBe(1);
    expect(g1.linkedIdx).toBe(0);
    expect(g2.linkedIdx).toBe(3);
    expect(g3.linkedIdx).toBe(2);
    expect(g4.linkedIdx).toBe(5);
    expect(g5.linkedIdx).toBe(4);

    // Destroy g2 (index 2): unlinks g3; g4 (was 4→now 3), g5 (was 5→now 4)
    destroy_NEW(g2);

    expect(gates).toHaveLength(5);
    expect(g3.linkedIdx).toBeNull(); // partner was unlinked
    expect(g4.linkedIdx).toBe(4);   // was 5, decremented to 4
    expect(g5.linkedIdx).toBe(3);   // was 4, decremented to 3
    expect(g0.linkedIdx).toBe(1);   // unchanged (index 0, below splice point)
    expect(g1.linkedIdx).toBe(0);   // unchanged
  });
});

// ── Orphan gate (no partner) can be destroyed safely ─────────────────────────

describe('VoidGate destroy — orphan (no partner)', () => {
  it('destroying an unlinked orphan does not throw or corrupt list', () => {
    const { gates, register, destroy_NEW } = makeGateList();
    const A = register(); // no orphan to pair with → stays unlinked

    expect(A.linkedIdx).toBeNull();
    expect(() => destroy_NEW(A)).not.toThrow();
    expect(gates).toHaveLength(0);
  });
});
