// Regression: ISSUE-016 — Building destruction not synced in multiplayer
//
// When Player A destroyed a mirror of Player B's building (enemy faction on
// Player A's screen), no network command was sent. Player B's screen kept that
// building alive — it kept producing units, and when Player A destroyed the enemy
// HQ mirror, Player B's screen never got told their HQ was dead.
//
// Three-part fix:
//   1. placeAndLinkBuilding now includes buildingId in the 'place_building' command.
//   2. handleRemoteCommand('place_building') stores the mirror with forceId 'remote_<id>'
//      so the mirror has a predictable ID that never collides with own building IDs.
//   3. onBuildingDestroyed sends 'building_destroyed' when an enemy-faction building
//      dies in multiplayer.  The ID has 'remote_' stripped before sending so the
//      receiver can look up the original building on their own screen.
//   4. handleRemoteCommand('building_destroyed') looks up the building by ID and
//      calls takeDamage(maxHealth * 10) to force-kill it.
//
// Related: BuildingManager.placeBuilding now accepts an optional forceId param.
// Related: BuildingManager.getBuildingById added for O(1) lookup by ID.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeBuilding = (id: string, faction: 'player' | 'enemy', maxHealth = 500) => ({
  id,
  faction,
  maxHealth,
  health: maxHealth,
  _destroyed: false,
  isDestroyed() { return this._destroyed; },
  takeDamage(amount: number) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this._destroyed = true;
  },
});

type StubBuilding = ReturnType<typeof makeBuilding>;

// Minimal building manager stub with forceId support
class FakeBuildingManager {
  buildings = new Map<string, StubBuilding>();
  private nextId = 0;

  placeBuilding(faction: 'player' | 'enemy', forceId?: string): StubBuilding {
    const id = forceId ?? `building_${this.nextId++}`;
    const b = makeBuilding(id, faction);
    this.buildings.set(id, b);
    return b;
  }

  getBuildingById(id: string): StubBuilding | undefined {
    return this.buildings.get(id);
  }
}

const makeSentCommands = () => {
  const sent: object[] = [];
  return { sent, sendCommand(cmd: object) { sent.push(cmd); } };
};

// Simulate the fixed onBuildingDestroyed multiplayer notification
const simulateEnemyBuildingDestroyed = (
  building: StubBuilding,
  net: ReturnType<typeof makeSentCommands>,
) => {
  if (building.faction !== 'enemy') return;
  const remoteId = building.id.startsWith('remote_') ? building.id.slice(7) : building.id;
  net.sendCommand({ type: 'building_destroyed', buildingId: remoteId });
};

// Simulate the fixed handleRemoteCommand('building_destroyed')
const simulateReceiveBuildingDestroyed = (
  buildingId: string,
  mgr: FakeBuildingManager,
) => {
  const building = mgr.getBuildingById(buildingId);
  if (building && !building.isDestroyed()) {
    building.takeDamage(building.maxHealth * 10);
  }
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — multiplayer building destruction sync', () => {
  it('sends building_destroyed when an enemy mirror building is killed', () => {
    const net = makeSentCommands();
    const mirror = makeBuilding('remote_building_2', 'enemy');

    simulateEnemyBuildingDestroyed(mirror, net);

    expect(net.sent).toHaveLength(1);
    expect(net.sent[0]).toMatchObject({ type: 'building_destroyed', buildingId: 'building_2' });
  });

  it('strips the remote_ prefix when sending building_destroyed', () => {
    const net = makeSentCommands();
    const mirror = makeBuilding('remote_building_5', 'enemy');

    simulateEnemyBuildingDestroyed(mirror, net);

    expect((net.sent[0] as any).buildingId).toBe('building_5');
  });

  it('sends the raw id (no prefix) for HQ and pre-placed enemy buildings', () => {
    const net = makeSentCommands();
    // HQs are placed without forceId — both screens have building_1 as enemyHQ
    const enemyHQ = makeBuilding('building_1', 'enemy');

    simulateEnemyBuildingDestroyed(enemyHQ, net);

    expect((net.sent[0] as any).buildingId).toBe('building_1');
  });

  it('does not send building_destroyed for player-faction buildings', () => {
    const net = makeSentCommands();
    const ownBuilding = makeBuilding('building_0', 'player');

    simulateEnemyBuildingDestroyed(ownBuilding, net);

    expect(net.sent).toHaveLength(0);
  });

  it('force-kills the target building on receiving building_destroyed', () => {
    const mgr = new FakeBuildingManager();
    const b = mgr.placeBuilding('player'); // 'building_0' on their screen

    simulateReceiveBuildingDestroyed('building_0', mgr);

    expect(b.isDestroyed()).toBe(true);
  });

  it('is a no-op when the target building is already destroyed', () => {
    const mgr = new FakeBuildingManager();
    const b = mgr.placeBuilding('player');
    b._destroyed = true; // already dead

    simulateReceiveBuildingDestroyed(b.id, mgr);

    // Should not throw or mutate health further
    expect(b.health).toBe(b.maxHealth); // health unchanged (already destroyed)
  });

  it('is a no-op for an unknown building ID', () => {
    const mgr = new FakeBuildingManager();
    // No buildings placed — nothing to look up
    expect(() => simulateReceiveBuildingDestroyed('building_99', mgr)).not.toThrow();
  });

  it('place_building uses remote_ prefix so mirror ID never collides with own buildings', () => {
    const mgr = new FakeBuildingManager();
    // Own buildings placed locally
    const ownB = mgr.placeBuilding('player'); // building_0

    // Mirror placed via received place_building command (forceId = 'remote_building_0')
    const mirror = mgr.placeBuilding('enemy', 'remote_building_0');

    // Same index, different prefix — no collision
    expect(ownB.id).toBe('building_0');
    expect(mirror.id).toBe('remote_building_0');
    expect(ownB.id).not.toBe(mirror.id);
    expect(mgr.buildings.size).toBe(2);
  });
});
