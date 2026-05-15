import Phaser from 'phaser';

export type ProjectileStyle = 'bullet' | 'bolt' | 'orb' | 'shell' | 'needle';

export interface ProjectileConfig {
  style: ProjectileStyle;
  colour: number;
  speed: number;
}

export class Projectile {
  private scene: Phaser.Scene;
  private core: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle;
  private glow: Phaser.GameObjects.Arc | null = null;
  private targetX: number;
  private targetY: number;
  private active = true;
  private config: ProjectileConfig;
  private trailTimer = 0;

  constructor(
    scene: Phaser.Scene,
    fromX: number, fromY: number,
    toX: number, toY: number,
    config: ProjectileConfig
  ) {
    this.scene    = scene;
    this.targetX  = toX;
    this.targetY  = toY;
    this.config   = config;
    const angle   = Math.atan2(toY - fromY, toX - fromX);
    const { style, colour } = config;

    if (style === 'bullet') {
      this.core = scene.add.rectangle(fromX, fromY, 14, 2.5, colour, 1)
        .setRotation(angle).setDepth(20);
    } else if (style === 'needle') {
      this.core = scene.add.rectangle(fromX, fromY, 16, 1.5, colour, 0.92)
        .setRotation(angle).setDepth(20);
    } else if (style === 'bolt') {
      this.glow = scene.add.circle(fromX, fromY, 7,  colour, 0.22).setDepth(19);
      this.core = scene.add.circle(fromX, fromY, 4,  colour, 1).setDepth(20) as unknown as Phaser.GameObjects.Arc;
    } else if (style === 'orb') {
      this.glow = scene.add.circle(fromX, fromY, 12, colour, 0.18).setDepth(19);
      this.core = scene.add.circle(fromX, fromY, 6,  colour, 1).setDepth(20) as unknown as Phaser.GameObjects.Arc;
    } else {
      // shell
      this.glow = scene.add.circle(fromX, fromY, 14, colour, 0.22).setDepth(19);
      this.core = scene.add.circle(fromX, fromY, 8,  colour, 1).setDepth(20) as unknown as Phaser.GameObjects.Arc;
    }
  }

  private get cx(): number { return (this.core as any).x; }
  private get cy(): number { return (this.core as any).y; }
  private setPos(x: number, y: number): void {
    (this.core as any).x = x;
    (this.core as any).y = y;
    if (this.glow) { this.glow.x = x; this.glow.y = y; }
  }

  update(delta: number): boolean {
    if (!this.active) return true;
    const dx   = this.targetX - this.cx;
    const dy   = this.targetY - this.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = this.config.speed * (delta / 1000);

    // Shell smoke trail
    if (this.config.style === 'shell') {
      this.trailTimer += delta;
      if (this.trailTimer > 28) {
        this.trailTimer = 0;
        const smoke = this.scene.add.circle(this.cx, this.cy, 3 + Math.random() * 2, 0x888888, 0.38).setDepth(18);
        this.scene.tweens.add({
          targets: smoke, scaleX: 2.8, scaleY: 2.8, alpha: 0,
          duration: 270, ease: 'Power1', onComplete: () => smoke.destroy(),
        });
      }
    }

    if (dist <= step) {
      this.spawnImpact(this.cx, this.cy);
      this.core.destroy();
      this.glow?.destroy();
      this.active = false;
      return true;
    }

    this.setPos(this.cx + (dx / dist) * step, this.cy + (dy / dist) * step);
    return false;
  }

  private spawnImpact(x: number, y: number): void {
    const { style, colour } = this.config;
    const s = this.scene;

    if (style === 'bullet') {
      // Tight spark burst + bright dot
      for (let i = 0; i < 4; i++) {
        const a  = (i / 4) * Math.PI * 2 + Math.random() * 0.8;
        const sp = s.add.rectangle(x, y, 6, 1.5, colour, 0.9).setDepth(22).setRotation(a);
        s.tweens.add({ targets: sp, x: x + Math.cos(a) * (7 + Math.random() * 6), y: y + Math.sin(a) * (7 + Math.random() * 6), alpha: 0, scaleX: 0.2, duration: 130 + Math.random() * 70, ease: 'Power2', onComplete: () => sp.destroy() });
      }
      const dot = s.add.circle(x, y, 4, colour, 1).setDepth(23);
      s.tweens.add({ targets: dot, scaleX: 2, scaleY: 2, alpha: 0, duration: 100, ease: 'Power2', onComplete: () => dot.destroy() });

    } else if (style === 'needle') {
      // Tight dark ring + core dot
      const ring = s.add.arc(x, y, 5, 0, 360, false, colour, 0).setDepth(22).setStrokeStyle(1.5, colour, 0.9);
      s.tweens.add({ targets: ring, scaleX: 3, scaleY: 3, alpha: 0, duration: 155, ease: 'Power2', onComplete: () => ring.destroy() });
      const dot = s.add.circle(x, y, 3, colour, 0.9).setDepth(23);
      s.tweens.add({ targets: dot, scaleX: 1.5, scaleY: 1.5, alpha: 0, duration: 120, ease: 'Power2', onComplete: () => dot.destroy() });

    } else if (style === 'bolt') {
      // Expanding ring + 4 electric sparks
      const ring = s.add.arc(x, y, 7, 0, 360, false, colour, 0).setDepth(22).setStrokeStyle(2, colour, 0.9);
      s.tweens.add({ targets: ring, scaleX: 3.2, scaleY: 3.2, alpha: 0, duration: 200, ease: 'Power2', onComplete: () => ring.destroy() });
      for (let i = 0; i < 4; i++) {
        const a  = (i / 4) * Math.PI * 2 + Math.random() * 0.6;
        const sp = s.add.rectangle(x, y, 7, 2, colour, 0.9).setDepth(22).setRotation(a);
        s.tweens.add({ targets: sp, x: x + Math.cos(a) * (9 + Math.random() * 7), y: y + Math.sin(a) * (9 + Math.random() * 7), alpha: 0, scaleX: 0.2, duration: 160 + Math.random() * 80, ease: 'Power2', onComplete: () => sp.destroy() });
      }

    } else if (style === 'orb') {
      // Large ring + flash + 5 sparks
      const ring  = s.add.arc(x, y, 10, 0, 360, false, colour, 0).setDepth(22).setStrokeStyle(2.5, colour, 0.85);
      s.tweens.add({ targets: ring, scaleX: 3.8, scaleY: 3.8, alpha: 0, duration: 260, ease: 'Power2', onComplete: () => ring.destroy() });
      const flash = s.add.circle(x, y, 8, colour, 0.85).setDepth(23);
      s.tweens.add({ targets: flash, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 190, ease: 'Power2', onComplete: () => flash.destroy() });
      for (let i = 0; i < 5; i++) {
        const a  = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
        const sp = s.add.rectangle(x, y, 7, 2, colour, 0.85).setDepth(22).setRotation(a);
        s.tweens.add({ targets: sp, x: x + Math.cos(a) * (11 + Math.random() * 8), y: y + Math.sin(a) * (11 + Math.random() * 8), alpha: 0, scaleX: 0.2, duration: 180 + Math.random() * 90, ease: 'Power2', onComplete: () => sp.destroy() });
      }

    } else {
      // shell — explosion ring + debris + rising smoke
      const ring  = s.add.arc(x, y, 12, 0, 360, false, colour, 0).setDepth(22).setStrokeStyle(3, colour, 0.85);
      s.tweens.add({ targets: ring, scaleX: 4.5, scaleY: 4.5, alpha: 0, duration: 330, ease: 'Power2', onComplete: () => ring.destroy() });
      const flash = s.add.circle(x, y, 12, colour, 0.9).setDepth(23);
      s.tweens.add({ targets: flash, scaleX: 2.8, scaleY: 2.8, alpha: 0, duration: 260, ease: 'Power2', onComplete: () => flash.destroy() });
      for (let i = 0; i < 7; i++) {
        const a   = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
        const r   = 18 + Math.random() * 16;
        const col = i % 2 === 0 ? colour : 0xffcc44;
        const dot = s.add.circle(x, y, 2 + Math.random() * 3, col, 0.9).setDepth(22);
        s.tweens.add({ targets: dot, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, alpha: 0, scale: 0.2, duration: 360 + Math.random() * 200, ease: 'Power2', onComplete: () => dot.destroy() });
      }
      for (let i = 0; i < 3; i++) {
        const ox    = (Math.random() - 0.5) * 14;
        const smoke = s.add.circle(x + ox, y, 4 + Math.random() * 3, 0x666666, 0.45).setDepth(21);
        s.tweens.add({ targets: smoke, y: y - 20 - Math.random() * 12, alpha: 0, scaleX: 2.5, scaleY: 2.5, delay: 60 + i * 50, duration: 460 + Math.random() * 180, ease: 'Power1', onComplete: () => smoke.destroy() });
      }
    }
  }

  isDone(): boolean { return !this.active; }

  destroy(): void {
    if (this.active) {
      this.core.destroy();
      this.glow?.destroy();
      this.active = false;
    }
  }
}
