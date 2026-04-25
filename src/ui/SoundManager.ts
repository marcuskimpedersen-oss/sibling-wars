import Phaser from 'phaser';
import { Unit } from '@/units/Unit';

/**
 * Visual-only audio substitute.
 *
 * Since the game has no audio files yet, every sonic moment is replaced with
 * a brief coloured ring that expands and fades at the relevant world position.
 * This makes combat and ability use feel much more alive without any .mp3s.
 *
 * Colour palette:
 *   Red    (#ff3300) – attack fired
 *   Orange (#ff7700) – hit / taking damage
 *   Grey   (#888888) – unit death
 *   Ability-specific colours passed per event
 *   Green  (#44ff88) – building completed
 *   Gold   (#ffd700) – upgrade completed
 */
export class SoundManager {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.wire();
  }

  // ── Core primitives ─────────────────────────────────────────────────────────

  /**
   * Expanding hollow ring at world position (wx, wy).
   * Starts at startR pixels radius, grows to endR while fading to transparent.
   */
  ring(wx: number, wy: number, color: number, startR = 12, endR = 34, duration = 380, startAlpha = 0.70): void {
    const arc = this.scene.add
      .arc(wx, wy, startR, 0, 360, false, color, 0)
      .setStrokeStyle(2.5, color, startAlpha)
      .setDepth(22);

    // Tween the scale so radius grows from startR → endR
    const scaleFactor = endR / startR;
    this.scene.tweens.add({
      targets: arc,
      scaleX: scaleFactor,
      scaleY: scaleFactor,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => arc.destroy(),
    });
  }

  /**
   * Filled dot flash — used for "centre flash" effects like upgrade complete.
   */
  flash(wx: number, wy: number, color: number, radius = 10, duration = 450): void {
    const dot = this.scene.add.circle(wx, wy, radius, color, 0.85).setDepth(22);
    this.scene.tweens.add({
      targets: dot,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => dot.destroy(),
    });
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  private wire(): void {
    const s = this.scene;

    // ── Unit selected — brief white pulse ring ────────────────────────────────
    s.events.on('unit:selected', (unit: Unit) => {
      const { x, y } = unit.getPosition();
      this.ring(x, y, 0xffffff, 8, 26, 280, 0.55);
    });

    // ── Attack fired + hit received ───────────────────────────────────────────
    s.events.on('unit:attacked', (attacker: Unit, target: Unit) => {
      const ap = attacker.getPosition();
      const tp = target.getPosition();
      // Red ring on attacker (shot fired)
      this.ring(ap.x, ap.y, 0xff3300, 10, 28, 320);
      // Orange ring on target (impact)
      this.ring(tp.x, tp.y, 0xff7700, 8, 26, 260);
    });

    // ── Unit death — red burst + grey expanding ring ──────────────────────────
    s.events.on('unit:died', (unit: Unit) => {
      const { x, y } = unit.getPosition();
      // Red burst at death origin
      this.flash(x, y, 0xff2200, 12, 350);
      this.ring(x, y, 0xff3300, 10, 36, 320, 0.75);
      // Trailing grey ring
      this.scene.time.delayedCall(80, () => this.ring(x, y, 0x888888, 14, 48, 500, 0.60));
    });

    // ── Abilities ─────────────────────────────────────────────────────────────

    // Overcharge / Shield Wall / Siege (C-ability group)
    s.events.on('unit:abilityActivated', (unit: Unit, type: string) => {
      const { x, y } = unit.getPosition();
      const colorMap: Record<string, number> = {
        siege_deploy:     0xffaa00,
        siege_undeploy:   0x8899aa,
        siege_transition: 0xffcc44,
      };
      const col = colorMap[type] ?? 0x88ccff;
      this.ring(x, y, col, 16, 44, 420);
    });

    // Divine Pulse (Covenant E) — teal
    s.events.on('unit:divinePulseActivated', (unit: Unit) => {
      const { x, y } = unit.getPosition();
      this.ring(x, y, 0x44ffaa, 18, 72, 480, 0.75);
    });

    // Holy Nova (Covenant R) — bright gold
    s.events.on('unit:holyNovaActivated', (unit: Unit) => {
      const { x, y } = unit.getPosition();
      this.ring(x, y, 0xffee44, 20, 78, 500, 0.80);
      this.scene.time.delayedCall(80, () => this.ring(x, y, 0xffffff, 10, 40, 320, 0.55));
    });

    // Void Drain — purple ring on the caster side
    s.events.on('unit:voidDrain', (_dmg: number, wx: number, wy: number) => {
      this.ring(wx, wy, 0xcc44ff, 10, 30, 350);
    });

    // ── Buildings ─────────────────────────────────────────────────────────────

    // Building placed / construction complete — green pulse
    s.events.on('sound:buildingComplete', (wx: number, wy: number) => {
      this.ring(wx, wy, 0x44ff88, 20, 56, 480, 0.80);
      this.flash(wx, wy, 0x44ff88, 8, 400);
    });

    // Upgrade researched — gold centre flash
    s.events.on('sound:upgradeComplete', (wx: number, wy: number) => {
      this.flash(wx, wy, 0xffd700, 12, 500);
      this.ring(wx, wy, 0xffd700, 18, 52, 480, 0.85);
    });
  }
}
