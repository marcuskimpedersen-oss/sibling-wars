import Phaser from 'phaser';

/**
 * Draws the rubber-band selection rectangle in screen space.
 * The graphics object has scrollFactor(0) so it stays fixed while the camera moves.
 */
export class SelectionBox {
  private graphics: Phaser.GameObjects.Graphics;
  private active: boolean = false;
  private startX: number = 0;
  private startY: number = 0;
  private endX: number = 0;
  private endY: number = 0;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setScrollFactor(0);
    this.graphics.setDepth(999);
  }

  begin(screenX: number, screenY: number): void {
    this.active = true;
    this.startX = screenX;
    this.startY = screenY;
    this.endX = screenX;
    this.endY = screenY;
  }

  update(screenX: number, screenY: number): void {
    if (!this.active) return;
    this.endX = screenX;
    this.endY = screenY;
    this.draw();
  }

  private draw(): void {
    this.graphics.clear();
    const x = Math.min(this.startX, this.endX);
    const y = Math.min(this.startY, this.endY);
    const w = Math.abs(this.endX - this.startX);
    const h = Math.abs(this.endY - this.startY);

    // SC2-style: white semi-transparent fill + bright white border
    this.graphics.fillStyle(0xffffff, 0.08);
    this.graphics.fillRect(x, y, w, h);
    this.graphics.lineStyle(1.5, 0xffffff, 0.9);
    this.graphics.strokeRect(x, y, w, h);
  }

  /** Returns the selection rect in SCREEN coordinates, or null if too small. */
  end(): { x: number; y: number; w: number; h: number } | null {
    this.active = false;
    this.graphics.clear();

    const w = Math.abs(this.endX - this.startX);
    const h = Math.abs(this.endY - this.startY);
    if (w < 4 && h < 4) return null;

    return {
      x: Math.min(this.startX, this.endX),
      y: Math.min(this.startY, this.endY),
      w,
      h,
    };
  }

  isActive(): boolean {
    return this.active;
  }
}
