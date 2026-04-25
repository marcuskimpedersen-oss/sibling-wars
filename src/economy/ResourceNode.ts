import Phaser from 'phaser';
import { TILE_SIZE } from '@/constants';

export type ResourceType = 'gold' | 'juice';

export class ResourceNode {
  readonly tileX: number;
  readonly tileY: number;
  readonly type: ResourceType;

  readonly MAX_WORKERS = 3;
  private workerCount: number = 0;

  private sprite: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private workerLabel: Phaser.GameObjects.Text;
  private depletionBarBg: Phaser.GameObjects.Rectangle;
  private depletionBar: Phaser.GameObjects.Rectangle;
  private scene: Phaser.Scene;
  private amount: number;
  private initialAmount: number;
  private _warningIcon: Phaser.GameObjects.Text | null = null;
  private _warningShown = false;

  constructor(
    scene: Phaser.Scene,
    tileX: number,
    tileY: number,
    amount: number,
    type: ResourceType = 'gold'
  ) {
    this.scene = scene;
    this.tileX = tileX;
    this.tileY = tileY;
    this.type = type;
    this.amount = amount;
    this.initialAmount = amount;

    const worldX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const worldY = tileY * TILE_SIZE + TILE_SIZE / 2;

    this.sprite = scene.add.image(worldX, worldY, type);
    this.sprite.setDepth(5);
    this.sprite.setInteractive();
    this.sprite.on(
      'pointerdown',
      (_pointer: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        scene.events.emit('node:clicked', this);
      }
    );

    const colour = type === 'gold' ? '#ffd700' : '#cc88ff';
    this.label = scene.add.text(worldX, worldY - 20, `${amount}`, {
      fontSize: '10px',
      color: colour,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    // Saturation indicator — shown below the resource amount
    this.workerLabel = scene.add.text(worldX, worldY + 18, '', {
      fontSize: '9px',
      color: '#aaccee',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // Resource depletion bar — shown above the node, narrows as resources are consumed
    const BAR_W = 26;
    const BAR_H = 3;
    const barColor = type === 'gold' ? 0xffd700 : 0xcc88ff;
    this.depletionBarBg = scene.add.rectangle(worldX, worldY - 30, BAR_W, BAR_H, 0x222222, 0.85)
      .setDepth(12);
    this.depletionBar = scene.add.rectangle(worldX - BAR_W / 2, worldY - 30, BAR_W, BAR_H, barColor, 0.9)
      .setOrigin(0, 0.5).setDepth(13);

    // Pulsing scale animation — makes nodes visually alive
    scene.tweens.add({
      targets: this.sprite,
      scaleX: { from: 0.92, to: 1.08 },
      scaleY: { from: 0.92, to: 1.08 },
      duration: 1400 + Math.random() * 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Sparkle particles for gold nodes
    if (type === 'gold') {
      scene.time.addEvent({
        delay: 1000 + Math.random() * 800,
        loop: true,
        callback: () => {
          if (this.isDepleted()) return;
          const sx = worldX + (Math.random() - 0.5) * 24;
          const sy = worldY + (Math.random() - 0.5) * 20;
          const spark = scene.add.circle(sx, sy, 1.5, 0xffd700, 1).setDepth(12);
          scene.tweens.add({
            targets: spark, y: sy - 18, alpha: 0,
            duration: 700, ease: 'Power1',
            onComplete: () => spark.destroy(),
          });
        },
      });
    }

    // Bubble particles for juice nodes
    if (type === 'juice') {
      scene.time.addEvent({
        delay: 800 + Math.random() * 600,
        loop: true,
        callback: () => {
          if (this.isDepleted()) return;
          const sx = worldX + (Math.random() - 0.5) * 16;
          const sy = worldY + (Math.random() - 0.5) * 14;
          const bubble = scene.add.circle(sx, sy, 2, 0xcc88ff, 0.8).setDepth(12);
          scene.tweens.add({
            targets: bubble, y: sy - 14, alpha: 0, scaleX: 1.5, scaleY: 1.5,
            duration: 600, ease: 'Sine.easeOut',
            onComplete: () => bubble.destroy(),
          });
        },
      });
    }
  }

  // ── Worker saturation ──────────────────────────────────────────────────────

  /** Returns false if this node is already at max workers. */
  addWorker(): boolean {
    if (this.workerCount >= this.MAX_WORKERS) return false;
    this.workerCount++;
    this.updateWorkerLabel();
    return true;
  }

  removeWorker(): void {
    this.workerCount = Math.max(0, this.workerCount - 1);
    this.updateWorkerLabel();
  }

  getWorkerCount(): number { return this.workerCount; }
  isSaturated(): boolean { return this.workerCount >= this.MAX_WORKERS; }

  private updateWorkerLabel(): void {
    if (this.workerCount === 0) {
      this.workerLabel.setText('');
    } else {
      const full = this.workerCount >= this.MAX_WORKERS;
      const colour = full ? '#ff8844' : '#aaccee';
      this.workerLabel.setText(`⛏ ${this.workerCount}/${this.MAX_WORKERS}`).setColor(colour);
    }
  }

  // ── Harvesting ─────────────────────────────────────────────────────────────

  harvest(amount: number): number {
    const taken = Math.min(amount, this.amount);
    this.amount -= taken;
    // Update depletion bar width
    const pct = this.initialAmount > 0 ? this.amount / this.initialAmount : 0;
    this.depletionBar.width = 26 * pct;
    if (this.amount <= 0) {
      this.depleteVisuals();
    } else {
      this.label.setText(`${this.amount}`);
      // Show pulsing warning icon when below 20% remaining
      if (!this._warningShown && pct < 0.2) {
        this._warningShown = true;
        const worldX = this.tileX * TILE_SIZE + TILE_SIZE / 2;
        const worldY = this.tileY * TILE_SIZE + TILE_SIZE / 2;
        this._warningIcon = this.scene.add.text(worldX + 14, worldY - 18, '!', {
          fontSize: '12px', color: '#ffdd00', stroke: '#000000', strokeThickness: 3,
          fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(15);
        // Pulse alpha
        this.scene.tweens.add({
          targets: this._warningIcon,
          alpha: { from: 1, to: 0.25 },
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
    return taken;
  }

  private depleteVisuals(): void {
    this.label.setText('');
    this.workerLabel.setText('');
    this.depletionBar.setVisible(false);
    this.depletionBarBg.setVisible(false);
    // Replace pulsing warning with a static grey X
    if (this._warningIcon) {
      this.scene.tweens.killTweensOf(this._warningIcon);
      this._warningIcon.destroy();
      this._warningIcon = null;
    }
    const worldX = this.tileX * TILE_SIZE + TILE_SIZE / 2;
    const worldY = this.tileY * TILE_SIZE + TILE_SIZE / 2;
    this.scene.add.text(worldX, worldY - 10, '✕', {
      fontSize: '13px', color: '#888888', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(15);
    // Fade out and then hide completely
    this.scene.tweens.add({
      targets: [this.sprite],
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => {
        this.sprite.setVisible(false);
        this.scene.events.emit('node:depleted', this);
      },
    });
  }

  isDepleted(): boolean { return this.amount <= 0; }
  getAmount(): number   { return this.amount; }
}
