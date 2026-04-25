import Phaser from 'phaser';

const PROJECTILE_SPEED = 320; // px/s

export class Projectile {
  private dot: Phaser.GameObjects.Arc;
  private scene: Phaser.Scene;
  private targetX: number;
  private targetY: number;
  private active = true;
  private colour: number;

  constructor(scene: Phaser.Scene, fromX: number, fromY: number, toX: number, toY: number, colour: number) {
    this.scene = scene;
    this.targetX = toX;
    this.targetY = toY;
    this.colour = colour;
    this.dot = scene.add.circle(fromX, fromY, 4, colour, 1);
    this.dot.setDepth(20);
  }

  update(delta: number): boolean {
    if (!this.active) return true;
    const dx = this.targetX - this.dot.x;
    const dy = this.targetY - this.dot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = PROJECTILE_SPEED * (delta / 1000);
    if (dist <= step) {
      this.dot.destroy();
      this.active = false;
      // Impact flash — small burst at the target point
      const impact = this.scene.add.circle(this.targetX, this.targetY, 5, this.colour, 0.85).setDepth(21);
      this.scene.tweens.add({
        targets: impact, scaleX: 3, scaleY: 3, alpha: 0,
        duration: 200, ease: 'Power2',
        onComplete: () => impact.destroy(),
      });
      return true; // done
    }
    this.dot.x += (dx / dist) * step;
    this.dot.y += (dy / dist) * step;
    return false;
  }

  isDone(): boolean { return !this.active; }

  destroy(): void {
    if (this.active) { this.dot.destroy(); this.active = false; }
  }
}
