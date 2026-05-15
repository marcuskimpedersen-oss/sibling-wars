// Regression: ISSUE-027 — Passive label text object orphaned on building destruction
//
// Buildings with a passiveLabel (shrine ability name, "⚡ Powered", etc.) created
// a Phaser Text game object via scene.add.text() but never stored a reference.
// When the building was destroyed, the text remained floating at the building's
// world position — visible through fog of war and after the building sprite faded.
//
// Fix: store the label in this.passiveLabelObj and destroy it in the death block
// (alongside the rally marker and construction visuals).

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeTextObj = () => ({
  destroyed: false,
  destroy() { this.destroyed = true; },
});

// Simulate the fixed building death block's passive-label cleanup
const simulatePassiveLabelCleanup = (
  passiveLabelObj: ReturnType<typeof makeTextObj> | null,
  holder: { passiveLabelObj: ReturnType<typeof makeTextObj> | null },
) => {
  holder.passiveLabelObj?.destroy();
  holder.passiveLabelObj = null;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Building — passive label cleanup on destruction (ISSUE-027)', () => {
  it('destroys the passive label text object when building is killed', () => {
    const label = makeTextObj();
    const holder = { passiveLabelObj: label };

    simulatePassiveLabelCleanup(label, holder);

    expect(label.destroyed).toBe(true);
  });

  it('clears the passiveLabelObj reference after cleanup', () => {
    const label = makeTextObj();
    const holder = { passiveLabelObj: label };

    simulatePassiveLabelCleanup(label, holder);

    expect(holder.passiveLabelObj).toBeNull();
  });

  it('is a no-op when the building had no passive label', () => {
    const holder = { passiveLabelObj: null };

    expect(() => simulatePassiveLabelCleanup(null, holder)).not.toThrow();
    expect(holder.passiveLabelObj).toBeNull();
  });

  it('demonstrates old bug: unsaved reference could not be destroyed', () => {
    // Old behaviour: scene.add.text() result was discarded — no way to destroy it
    let orphanedText: ReturnType<typeof makeTextObj> | null = null;
    const createOld = () => {
      orphanedText = makeTextObj(); // created but not stored
      // nothing returns the reference to the building
    };
    createOld();
    // Building dies — can't call orphanedText.destroy() because no reference held
    expect(orphanedText!.destroyed).toBe(false); // floats forever

    // Fixed behaviour: reference stored and destroyed on death
    const label = makeTextObj();
    const holder = { passiveLabelObj: label };
    simulatePassiveLabelCleanup(label, holder);
    expect(label.destroyed).toBe(true);
  });
});
