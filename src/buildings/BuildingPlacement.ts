import Phaser from 'phaser';
import { BuildingDef } from './definitions';
import { BuildingManager } from './BuildingManager';
import { TILE_SIZE } from '@/constants';

export class BuildingPlacement {
  private scene: Phaser.Scene;
  private buildingManager: BuildingManager;
  private activeDef: BuildingDef | null = null;
  private extraValidator: ((tileX: number, tileY: number) => boolean) | null = null;

  private ghost: Phaser.GameObjects.Image | null = null;
  private ghostOverlay: Phaser.GameObjects.Rectangle | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;

  private currentTileX = 0;
  private currentTileY = 0;
  private isValid = false;

  // State tracking to detect fresh clicks without relying on the event system
  private skipFrames = 0;
  private leftWasDown  = false;
  private rightWasDown = false;

  onPlaced: ((def: BuildingDef, tileX: number, tileY: number) => void) | null = null;
  onCancelled: (() => void) | null = null;

  constructor(scene: Phaser.Scene, buildingManager: BuildingManager) {
    this.scene = scene;
    this.buildingManager = buildingManager;
  }

  beginPlacement(def: BuildingDef, extraValidator?: (tileX: number, tileY: number) => boolean): void {
    this.cancelPlacement();
    this.activeDef = def;
    this.extraValidator = extraValidator ?? null;
    this.skipFrames = 4;   // wait a few frames so the dock click doesn't instantly trigger
    this.leftWasDown  = false;
    this.rightWasDown = false;

    const spriteW = def.tileWidth * TILE_SIZE;
    const spriteH = def.tileHeight * TILE_SIZE;

    this.ghost = this.scene.add.image(0, 0, def.textureKey)
      .setDisplaySize(spriteW, spriteH)
      .setTint(def.tint)
      .setAlpha(0.65)
      .setDepth(50);

    this.ghostOverlay = this.scene.add.rectangle(0, 0, spriteW, spriteH, 0x00ff00, 0.2)
      .setDepth(51);

    const hint = def.resourceType === 'gold'
      ? 'Place near a gold node  ·  Right-click to cancel'
      : def.resourceType === 'juice'
      ? 'Place near a juice geyser  ·  Right-click to cancel'
      : 'Click to place  ·  Right-click / ESC to cancel';

    this.hintText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height - 160,
      hint,
      { fontSize: '13px', color: '#ffff88', stroke: '#000', strokeThickness: 3 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(210);

    this.scene.input.keyboard!.once('keydown-ESCAPE', this.cancelPlacement, this);
  }

  /** Called every frame from GameScene.update() */
  update(): void {
    if (!this.activeDef || !this.ghost) return;

    const pointer = this.scene.input.activePointer;

    // Update ghost every frame regardless of skip
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.currentTileX = Math.floor(world.x / TILE_SIZE);
    this.currentTileY = Math.floor(world.y / TILE_SIZE);

    const def = this.activeDef;
    const snapX = (this.currentTileX + def.tileWidth  / 2) * TILE_SIZE;
    const snapY = (this.currentTileY + def.tileHeight / 2) * TILE_SIZE;
    this.ghost.setPosition(snapX, snapY);
    this.ghostOverlay!.setPosition(snapX, snapY);

    const baseValid  = this.buildingManager.isValidPlacement(def, this.currentTileX, this.currentTileY);
    const extraValid = this.extraValidator ? this.extraValidator(this.currentTileX, this.currentTileY) : true;
    this.isValid = baseValid && extraValid;
    this.ghostOverlay!.setFillStyle(this.isValid ? 0x00ff00 : 0xff0000, 0.25);

    // Ignore clicks for the first few frames to avoid placing on the same click that opened placement
    if (this.skipFrames > 0) {
      this.skipFrames--;
      this.leftWasDown  = pointer.leftButtonDown();
      this.rightWasDown = pointer.rightButtonDown();
      return;
    }

    const leftDown  = pointer.leftButtonDown();
    const rightDown = pointer.rightButtonDown();

    // Detect fresh left click (was up, now down)
    if (leftDown && !this.leftWasDown) {
      if (this.isValid) {
        const tx = this.currentTileX;
        const ty = this.currentTileY;
        this.cleanupGhost();
        this.activeDef = null;
        this.extraValidator = null;
        this.onPlaced?.(def, tx, ty);
        return;
      }
    }

    // Detect fresh right click → cancel
    if (rightDown && !this.rightWasDown) {
      this.cancelPlacement();
      return;
    }

    this.leftWasDown  = leftDown;
    this.rightWasDown = rightDown;
  }

  cancelPlacement(): void {
    this.cleanupGhost();
    this.activeDef = null;
    this.extraValidator = null;
    this.onCancelled?.();
  }

  private cleanupGhost(): void {
    this.ghost?.destroy();
    this.ghostOverlay?.destroy();
    this.hintText?.destroy();
    this.ghost = null;
    this.ghostOverlay = null;
    this.hintText = null;
    this.scene.input.keyboard!.off('keydown-ESCAPE', this.cancelPlacement, this);
  }

  isPlacing(): boolean { return this.activeDef !== null; }
}
