import { Unit } from './Unit';
import Phaser from 'phaser';
import { WORKER_SPEED, WORKER_COMBAT_STATS } from '@/constants';
import { ResourceNode } from '@/economy/ResourceNode';

export type WorkerMiningState = 'idle' | 'to_node' | 'harvesting' | 'to_hq';

/**
 * Worker unit — select to open build menu, click to place buildings.
 * Can also be assigned to a resource node for a carry-and-return mining loop.
 */
export class WorkerUnit extends Unit {
  override readonly isWorker = true;

  // ── Auto-mining loop ──────────────────────────────────────────────────────
  miningState: WorkerMiningState = 'idle';
  miningNode: ResourceNode | null = null;
  /** HQ deposit tile — set by GameScene on assignment */
  miningHQTile: { tileX: number; tileY: number } | null = null;
  carryAmount: number = 0;
  carryType: 'gold' | 'juice' | null = null;
  harvestTimer: number = 0;
  readonly HARVEST_DURATION_MS = 2200;
  readonly CARRY_CAPACITY = 20;

  private carryDot: Phaser.GameObjects.Arc | null = null;

  constructor(
    scene: Phaser.Scene,
    tileX: number,
    tileY: number,
    id: string
  ) {
    super(scene, tileX, tileY, id, 'worker', 'player', WORKER_COMBAT_STATS);
    this.speed = WORKER_SPEED;
  }

  /** Begin the carry-loop. Called by GameScene after first path is issued. */
  startMining(node: ResourceNode, hqTileX: number, hqTileY: number): void {
    this.miningNode = node;
    this.miningHQTile = { tileX: hqTileX, tileY: hqTileY };
    this.miningState = 'to_node';
  }

  /** Cancel mining (player moved worker manually, or node depleted, or worker died). */
  stopMining(): void {
    if (this.miningNode) {
      this.miningNode.removeWorker();
      this.miningNode = null;
    }
    this.miningState = 'idle';
    this.miningHQTile = null;
    this.carryAmount = 0;
    this.carryType = null;
    this.hideCarryVisual();
  }

  /** Show gold/juice carry dot above the worker's head. */
  showCarryVisual(type: 'gold' | 'juice'): void {
    this.hideCarryVisual();
    const colour = type === 'gold' ? 0xffd700 : 0xcc88ff;
    this.carryDot = this.scene.add.arc(this.sprite.x, this.sprite.y - 22, 5, 0, 360, false, colour, 0.95)
      .setDepth(16)
      .setStrokeStyle(1, 0xffffff, 0.6);
    // Gentle bob
    this.scene.tweens.add({
      targets: this.carryDot,
      y: this.carryDot.y - 3,
      duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  hideCarryVisual(): void {
    if (this.carryDot) {
      this.scene.tweens.killTweensOf(this.carryDot);
      this.carryDot.destroy();
      this.carryDot = null;
    }
  }

  override update(delta: number): void {
    super.update(delta);
    // Sync carry-dot position with sprite
    if (this.carryDot) {
      this.carryDot.setPosition(this.sprite.x, this.sprite.y - 22);
      this.carryDot.setVisible(this.sprite.visible && this.fogVisible);
    }
  }

  override destroy(): void {
    this.hideCarryVisual();
    super.destroy();
  }
}
