import Phaser from 'phaser';
import { Unit } from '@/units/Unit';
import { Building } from '@/buildings/Building';

const MAP_W = 160;
const MAP_H = 128;
const BORDER = 2;
const DEPTH  = 400;

export interface MinimapExtraData {
  terrainRocks:     Array<{ x: number; y: number }>;      // tile coords
  terrainTrees:     Array<{ x: number; y: number }>;      // tile coords
  resourceNodes:    Array<{ tileX: number; tileY: number; type: 'gold' | 'juice'; isDepleted: () => boolean }>;
  neutralOutposts:  Array<{ tileX: number; tileY: number }>;
}

/**
 * Bottom-right minimap panel.
 *
 * Dots / markers:
 *  - Brown  dots  = rock terrain
 *  - Green  dots  = tree terrain
 *  - Yellow dots  = gold resource nodes
 *  - Purple dots  = juice resource nodes
 *  - White  cross = neutral outpost
 *  - Blue   rects = player buildings / units
 *  - Red    rects = enemy buildings / units (fog-visible only)
 *  - White  rect  = current camera viewport
 *
 * Interactions:
 *  - Left-click / drag  → pan camera to that world position
 *  - Right-click        → send a ping (yellow expanding ring on map + flashing dot on minimap)
 */
export class Minimap {
  private scene: Phaser.Scene;
  private gfx: Phaser.GameObjects.Graphics;

  /** Top-left corner of the map area in screen space. */
  private readonly ox: number;
  private readonly oy: number;

  /** World → minimap scale factors. */
  private readonly sx: number;
  private readonly sy: number;

  /** World-px dimensions — needed to convert right-click minimap pings. */
  private readonly worldW: number;
  private readonly worldH: number;

  /** Active ping markers (minimap-space). Fade out over time. */
  private pings: Array<{ mx: number; my: number; alpha: number; wx: number; wy: number }> = [];

  /** Unit id → remaining flash time (ms) for combat damage indicator. */
  private _combatFlashes = new Map<string, number>();
  private readonly COMBAT_FLASH_DURATION_MS = 300;

  /** Timestamp of the last left-click on the minimap (for double-click detection). */
  private _lastClickTime: number = 0;

  constructor(scene: Phaser.Scene, worldWidthPx: number, worldHeightPx: number) {
    this.scene = scene;
    this.worldW = worldWidthPx;
    this.worldH = worldHeightPx;

    const { width, height } = scene.scale;
    this.ox = width  - MAP_W - 10;
    this.oy = height - MAP_H - 10;
    this.sx = MAP_W / worldWidthPx;
    this.sy = MAP_H / worldHeightPx;

    // Static background + border (drawn once)
    const bg = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    bg.fillStyle(0x050d1a, 0.95);
    bg.fillRect(this.ox - BORDER, this.oy - BORDER, MAP_W + BORDER * 2, MAP_H + BORDER * 2);
    bg.lineStyle(1.5, 0x2a4a6a, 1);
    bg.strokeRect(this.ox - BORDER, this.oy - BORDER, MAP_W + BORDER * 2, MAP_H + BORDER * 2);

    // Label
    scene.add.text(this.ox, this.oy - BORDER - 14, 'MAP', {
      fontSize: '9px', color: '#3a5a7a',
    }).setScrollFactor(0).setDepth(DEPTH);

    // Dynamic graphics layer redrawn each frame
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1);

    // Combat flash: when a unit takes damage, flash its minimap dot red for 0.3s
    scene.events.on('unit:damaged', (unit: Unit) => {
      this._combatFlashes.set(unit.id, this.COMBAT_FLASH_DURATION_MS);
    });

    // Left-click + drag → pan camera; double-click → send idle units
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) {
        if (this.isInside(p.x, p.y)) {
          const now = scene.time.now;
          const worldX = (p.x - this.ox) / this.sx;
          const worldY = (p.y - this.oy) / this.sy;
          if (now - this._lastClickTime < 300) {
            // Double-click: send idle player units to this world position
            scene.events.emit('minimap:sendIdleUnits', { worldX, worldY });
          }
          this._lastClickTime = now;
        }
        this.tryPan(p.x, p.y);
      }
      if (p.rightButtonDown()) this.tryPing(p.x, p.y);
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.tryPan(p.x, p.y);
    });
  }

  private isInside(screenX: number, screenY: number): boolean {
    return screenX >= this.ox && screenX <= this.ox + MAP_W &&
           screenY >= this.oy && screenY <= this.oy + MAP_H;
  }

  private tryPan(screenX: number, screenY: number): void {
    if (!this.isInside(screenX, screenY)) return;
    const worldX = (screenX - this.ox) / this.sx;
    const worldY = (screenY - this.oy) / this.sy;
    this.scene.cameras.main.pan(worldX, worldY, 180, 'Power2');
  }

  private tryPing(screenX: number, screenY: number): void {
    if (!this.isInside(screenX, screenY)) return;

    const worldX = (screenX - this.ox) / this.sx;
    const worldY = (screenY - this.oy) / this.sy;
    const mx = screenX;
    const my = screenY;

    // Record minimap ping dot
    this.pings.push({ mx, my, alpha: 1, wx: worldX, wy: worldY });

    // Expanding yellow ring on the actual map
    const ring = this.scene.add.arc(worldX, worldY, 6, 0, 360, false, 0xffee00, 0.85).setDepth(50);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 8, scaleY: 8, alpha: 0,
      duration: 900, ease: 'Power2',
      onComplete: () => ring.destroy(),
    });

    // Second smaller ring for pulse effect
    const ring2 = this.scene.add.arc(worldX, worldY, 4, 0, 360, false, 0xffffff, 0.6).setDepth(50);
    this.scene.tweens.add({
      targets: ring2,
      scaleX: 5, scaleY: 5, alpha: 0,
      duration: 550, delay: 100, ease: 'Power1',
      onComplete: () => ring2.destroy(),
    });
  }

  update(units: Unit[], buildings: Building[], extra?: MinimapExtraData, deltaMs = 16): void {
    // Tick combat flash timers
    this._combatFlashes.forEach((remaining, id) => {
      const next = remaining - deltaMs;
      if (next <= 0) this._combatFlashes.delete(id);
      else this._combatFlashes.set(id, next);
    });

    const g = this.gfx;
    g.clear();

    // Dark map fill
    g.fillStyle(0x081422, 1);
    g.fillRect(this.ox, this.oy, MAP_W, MAP_H);

    // ── Terrain features ───────────────────────────────────────────────────
    if (extra) {
      // Rock outcrops — muted brown dots
      g.fillStyle(0x7a5a3a, 0.7);
      for (const r of extra.terrainRocks) {
        const mx = this.ox + (r.x * 32 + 16) * this.sx;
        const my = this.oy + (r.y * 32 + 16) * this.sy;
        g.fillRect(mx - 1, my - 1, 2, 2);
      }

      // Tree clusters — dark green dots
      g.fillStyle(0x2a6622, 0.75);
      for (const t of extra.terrainTrees) {
        const mx = this.ox + (t.x * 32 + 16) * this.sx;
        const my = this.oy + (t.y * 32 + 16) * this.sy;
        g.fillRect(mx - 1, my - 1, 2, 2);
      }

      // Resource nodes — yellow (gold) / purple (juice), skip depleted
      for (const node of extra.resourceNodes) {
        if (node.isDepleted()) continue;
        const mx = this.ox + (node.tileX * 32 + 16) * this.sx;
        const my = this.oy + (node.tileY * 32 + 16) * this.sy;
        g.fillStyle(node.type === 'gold' ? 0xffd700 : 0xcc44ff, 0.9);
        g.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }

      // Neutral outposts — white cross marker
      g.lineStyle(1, 0xddddaa, 0.85);
      for (const op of extra.neutralOutposts) {
        const mx = this.ox + (op.tileX * 32 + 16) * this.sx;
        const my = this.oy + (op.tileY * 32 + 16) * this.sy;
        g.lineBetween(mx - 3, my, mx + 3, my);
        g.lineBetween(mx, my - 3, mx, my + 3);
      }
    }

    // ── Buildings ──────────────────────────────────────────────────────────
    for (const b of buildings) {
      if (b.isDestroyed()) continue;
      if (b.faction === 'enemy' && !b.fogVisible) continue;

      const { x, y } = b.getWorldCenter();
      const mx = this.ox + x * this.sx;
      const my = this.oy + y * this.sy;
      const mw = Math.max(3, b.def.tileWidth  * 32 * this.sx);
      const mh = Math.max(3, b.def.tileHeight * 32 * this.sy);

      g.fillStyle(b.faction === 'player' ? 0x2266cc : 0xcc3322, 0.9);
      g.fillRect(mx - mw / 2, my - mh / 2, mw, mh);
    }

    // ── Units ──────────────────────────────────────────────────────────────
    for (const u of units) {
      if (!u.isAlive()) continue;
      if (u.faction === 'enemy' && !u.fogVisible) continue;

      const { x, y } = u.getPosition();
      const mx = this.ox + x * this.sx;
      const my = this.oy + y * this.sy;

      const isFlashing = this._combatFlashes.has(u.id);
      if (isFlashing) {
        // Bright red flash overlay
        g.fillStyle(0xff0000, 1);
        g.fillRect(mx - 2.5, my - 2.5, 5, 5);
      } else {
        g.fillStyle(u.faction === 'player' ? 0x44aaff : 0xff5533, 1);
        g.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }

    // ── Ping dots ──────────────────────────────────────────────────────────
    const PING_DECAY = deltaMs / 2000; // fades to 0 over ~2 seconds
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.alpha -= PING_DECAY;
      if (p.alpha <= 0) { this.pings.splice(i, 1); continue; }

      // Flashing: show/hide based on time so it blinks
      const blink = Math.floor(this.scene.time.now / 150) % 2 === 0;
      if (blink) {
        g.fillStyle(0xffee00, p.alpha);
        g.fillCircle(p.mx, p.my, 4);
        g.lineStyle(1.5, 0xffffff, p.alpha * 0.7);
        g.strokeCircle(p.mx, p.my, 4);
      }
    }

    // ── Camera viewport rectangle ──────────────────────────────────────────
    const cam = this.scene.cameras.main;
    const vx  = this.ox + cam.scrollX * this.sx;
    const vy  = this.oy + cam.scrollY * this.sy;
    const vw  = (cam.width  / cam.zoom) * this.sx;
    const vh  = (cam.height / cam.zoom) * this.sy;
    g.lineStyle(1, 0xffffff, 0.55);
    g.strokeRect(vx, vy, vw, vh);
  }
}
