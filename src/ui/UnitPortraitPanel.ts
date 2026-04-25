import Phaser from 'phaser';
import { Unit } from '@/units/Unit';
import { Race } from '@/constants';

const PANEL_W   = 200;
const PANEL_H   = 106;
const PORT_SZ   = 60;   // portrait square side
const PAD       = 8;
const LINE_H    = 14;
const DEPTH     = 200;
const PANEL_X   = 210;  // to the right of CommandCard (which ends ~200px from left)

const UNIT_NAMES: Record<string, string> = {
  rifleman: 'Rifleman',
  devotee:  'Devotee',
  ironclad: 'Ironclad',
  phantom:  'Phantom',
  arbiter:  'Arbiter',
  worker:   'Worker',
};

/**
 * Bottom-left panel that displays rich info about the single currently-selected unit.
 * Hidden when 0 or 2+ units are selected. Redraws every frame (stateless, cleared & rebuilt).
 */
export class UnitPortraitPanel {
  private scene: Phaser.Scene;
  private race: Race;
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, race: Race) {
    this.scene = scene;
    this.race  = race;
    void this.race; // may be used for future race-specific portrait art
  }

  /** Call each frame from GameScene.update(). Pass null to hide the panel. */
  update(unit: Unit | null): void {
    this.clear();
    if (!unit || !unit.isAlive()) return;
    this.draw(unit);
  }

  hide(): void { this.clear(); }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private clear(): void {
    for (const o of this.objects) {
      (o as Phaser.GameObjects.GameObject & { destroy(): void }).destroy();
    }
    this.objects = [];
  }

  private push<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    return o;
  }

  private draw(unit: Unit): void {
    const H = this.scene.scale.height;
    const panelX = PANEL_X;
    const panelY = H - PANEL_H - 10;

    // ── Background ───────────────────────────────────────────────────────────
    const bg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH));
    bg.fillStyle(0x06101e, 0.93);
    bg.fillRoundedRect(panelX, panelY, PANEL_W, PANEL_H, 10);
    bg.lineStyle(1.5, 0x1e3050, 1);
    bg.strokeRoundedRect(panelX, panelY, PANEL_W, PANEL_H, 10);

    // ── Portrait square ──────────────────────────────────────────────────────
    const portX = panelX + PAD;
    const portY = panelY + (PANEL_H - PORT_SZ) / 2;

    // Dark portrait background
    const portBg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1));
    portBg.fillStyle(0x020810, 1);
    portBg.fillRoundedRect(portX, portY, PORT_SZ, PORT_SZ, 6);

    // Race-tinted inner fill
    const rawTint = unit.sprite.tintTopLeft >>> 0;
    const tr = ((rawTint >> 16) & 0xff);
    const tg = ((rawTint >>  8) & 0xff);
    const tb = ( rawTint        & 0xff);
    // Darken for background swatch
    const swatchR = Math.round(tr * 0.35);
    const swatchG = Math.round(tg * 0.35);
    const swatchB = Math.round(tb * 0.35);
    const swatchColor = (swatchR << 16) | (swatchG << 8) | swatchB;

    const portFill = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 2));
    portFill.fillStyle(swatchColor, 0.9);
    portFill.fillRoundedRect(portX + 2, portY + 2, PORT_SZ - 4, PORT_SZ - 4, 4);
    portFill.lineStyle(1.5, rawTint, 0.65);
    portFill.strokeRoundedRect(portX + 2, portY + 2, PORT_SZ - 4, PORT_SZ - 4, 4);

    // Unit initial in the portrait
    const unitName = UNIT_NAMES[unit.unitTypeId] ?? (unit.isWorker ? 'Worker' : '?');
    const hexTint  = `#${rawTint.toString(16).padStart(6, '0')}`;
    this.push(this.scene.add.text(portX + PORT_SZ / 2, portY + PORT_SZ / 2 - 4, unitName[0].toUpperCase(), {
      fontSize: '26px', color: hexTint,
      stroke: '#000', strokeThickness: 3,
      fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(DEPTH + 3).setOrigin(0.5));

    // Veterancy stars overlaid at bottom of portrait
    if (unit.veterancyLevel > 0) {
      const stars      = unit.veterancyLevel === 2 ? '★★' : '★';
      const starColor  = unit.veterancyLevel === 2 ? '#ffd700' : '#ffffff';
      this.push(this.scene.add.text(portX + PORT_SZ / 2, portY + PORT_SZ - 5, stars, {
        fontSize: '9px', color: starColor, stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(DEPTH + 3).setOrigin(0.5, 1));
    }

    // Stasis indicator on portrait
    if (unit.isStasised) {
      const iceGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3));
      iceGfx.fillStyle(0x88ccff, 0.22);
      iceGfx.fillRoundedRect(portX + 2, portY + 2, PORT_SZ - 4, PORT_SZ - 4, 4);
      this.push(this.scene.add.text(portX + PORT_SZ / 2, portY + PORT_SZ / 2 + 12, '❄', {
        fontSize: '13px', color: '#88ccff',
      }).setScrollFactor(0).setDepth(DEPTH + 4).setOrigin(0.5));
    }

    // ── Info column ──────────────────────────────────────────────────────────
    const infoX = portX + PORT_SZ + PAD;
    const infoW = PANEL_W - PORT_SZ - PAD * 3;  // space from infoX to panel right edge
    let lineY   = panelY + PAD;

    const txt = (x: number, y: number, str: string, color: string, size = '10px') =>
      this.push(this.scene.add.text(x, y, str, {
        fontSize: size, color, stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0));

    // Row 1: unit name + kill count
    const killSuffix = unit.killCount > 0 ? `  ⚔${unit.killCount}` : '';
    txt(infoX, lineY, unitName + killSuffix, '#e8d8a0');
    lineY += LINE_H;

    // Row 2: veterancy tier
    const tierLabel = ['Rookie', 'Veteran', 'Elite'][unit.veterancyLevel];
    const tierColor = ['#888888', '#dddddd', '#ffd700'][unit.veterancyLevel];
    txt(infoX, lineY, tierLabel, tierColor);
    lineY += LINE_H;

    // Row 3: HP bar + numbers
    const hpPct    = unit.health / unit.maxHealth;
    const barW     = infoW;
    const hpBarBg  = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1));
    hpBarBg.fillStyle(0x111111, 0.9);
    hpBarBg.fillRoundedRect(infoX, lineY, barW, 7, 2);
    const hpColor  = hpPct > 0.6 ? 0x44ff44 : hpPct > 0.3 ? 0xffcc00 : 0xff4444;
    hpBarBg.fillStyle(hpColor, 1);
    hpBarBg.fillRoundedRect(infoX, lineY, Math.max(3, barW * hpPct), 7, 2);
    // HP text below bar
    txt(infoX, lineY + 9, `${unit.health}/${unit.maxHealth}`, '#888888', '8px');
    lineY += LINE_H + 2;

    // Row 4: stance (combat units only)
    if (!unit.isWorker) {
      const stanceIcon: Record<string, string>  = { aggressive: '⚔', defensive: '◈', hold: '■' };
      const stanceName: Record<string, string>  = { aggressive: 'Aggressive', defensive: 'Defensive', hold: 'Hold' };
      const stanceColor: Record<string, string> = { aggressive: '#ff8844', defensive: '#44aaff', hold: '#44ff88' };
      txt(infoX, lineY,
        `${stanceIcon[unit.stance] ?? ''} ${stanceName[unit.stance] ?? unit.stance}`,
        stanceColor[unit.stance] ?? '#aaaaaa');
      lineY += LINE_H;
    }

    // Row 5: ability cooldown arc pips + label
    if (!unit.isWorker) {
      const abilities = this.getAbilityDefs(unit);
      if (abilities.length > 0) {
        const PIP = 16;    // pip circle diameter
        const PIP_GAP = 4;
        let ax = infoX;
        for (const ab of abilities) {
          const cx = ax + PIP / 2;
          const cy = lineY + PIP / 2;
          const r  = PIP / 2 - 1;

          const pipGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 2));

          if (ab.ready) {
            // Green filled pip — ready
            pipGfx.fillStyle(0x003300, 1);
            pipGfx.fillCircle(cx, cy, r);
            pipGfx.lineStyle(1.5, 0x44ff88, 1);
            pipGfx.strokeCircle(cx, cy, r);
          } else if (ab.active) {
            // Pulsing blue pip — currently active
            pipGfx.fillStyle(0x002244, 1);
            pipGfx.fillCircle(cx, cy, r);
            pipGfx.lineStyle(1.5, 0x44aaff, 1);
            pipGfx.strokeCircle(cx, cy, r);
            // Inner dot
            pipGfx.fillStyle(0x88ccff, 1);
            pipGfx.fillCircle(cx, cy, r * 0.35);
          } else {
            // Grey overlay arc draining down as cooldown expires
            const progress = 1 - ab.cdFrac; // 0 = just started, 1 = done
            pipGfx.fillStyle(0x111122, 1);
            pipGfx.fillCircle(cx, cy, r);
            // Grey bg arc
            pipGfx.lineStyle(2, 0x222233, 1);
            pipGfx.beginPath();
            pipGfx.arc(cx, cy, r, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(270), false);
            pipGfx.strokePath();
            // Coloured progress arc (fills as cooldown drains)
            if (progress > 0.02) {
              pipGfx.lineStyle(2, 0x4466aa, 1);
              pipGfx.beginPath();
              pipGfx.arc(
                cx, cy, r,
                Phaser.Math.DegToRad(-90),
                Phaser.Math.DegToRad(-90 + 360 * progress),
                false
              );
              pipGfx.strokePath();
            }
            // Cooldown seconds text inside
            const secsLeft = Math.ceil(ab.cdMs / 1000);
            if (secsLeft > 0) {
              this.push(this.scene.add.text(cx, cy, `${secsLeft}`, {
                fontSize: '7px', color: '#556688', stroke: '#000', strokeThickness: 1,
              }).setScrollFactor(0).setDepth(DEPTH + 3).setOrigin(0.5));
            }
          }

          // Key label below pip
          this.push(this.scene.add.text(cx, cy + PIP / 2 + 1, ab.key, {
            fontSize: '7px', color: ab.ready ? '#44ff88' : ab.active ? '#44aaff' : '#334455',
            stroke: '#000', strokeThickness: 1,
          }).setScrollFactor(0).setDepth(DEPTH + 2).setOrigin(0.5, 0));

          ax += PIP + PIP_GAP;
        }
      }
    }
  }

  /** Describes one ability's current state for the cooldown pip display. */
  private getAbilityDefs(unit: Unit): Array<{
    key: string;
    ready: boolean;
    active: boolean;
    cdFrac: number;   // remaining cooldown fraction [0..1], 0 = done
    cdMs:   number;   // remaining cooldown in ms
  }> {
    switch (unit.unitTypeId) {
      case 'rifleman':
        return [{
          key: 'C',
          // ready = can be activated (not on cooldown, not already active)
          ready:  !unit.overchargeReady && unit.overchargeCooldownRemaining <= 0,
          // active = ability is currently powered (glow on, waiting for next shot)
          active: unit.overchargeReady,
          cdFrac: unit.overchargeCooldownRemaining / 12000,
          cdMs:   unit.overchargeCooldownRemaining,
        }];

      case 'ironclad':
        return [{
          key: 'C',
          ready:  !unit.shieldWallActive && unit.shieldWallCooldownRemaining <= 0,
          active: unit.shieldWallActive,
          cdFrac: unit.shieldWallCooldownRemaining / 30000,
          cdMs:   unit.shieldWallCooldownRemaining,
        }];

      case 'devotee':
        return [{
          key: 'E',
          ready:  unit.divinePulseCooldownRemaining <= 0,
          active: false,
          cdFrac: unit.divinePulseCooldownRemaining / 25000,
          cdMs:   unit.divinePulseCooldownRemaining,
        }];

      case 'phantom':
        return [
          {
            key: 'B',
            ready:  unit.stealthCooldownRemaining <= 0 && !unit.isStealthed,
            active: unit.isStealthed,
            cdFrac: unit.stealthCooldownRemaining / 20000,
            cdMs:   unit.stealthCooldownRemaining,
          },
          {
            key: 'E',
            ready:  unit.shadowStepCooldownRemaining <= 0,
            active: false,
            cdFrac: unit.shadowStepCooldownRemaining / 15000,
            cdMs:   unit.shadowStepCooldownRemaining,
          },
        ];

      case 'arbiter':
        return [{
          key: 'E',
          ready:  unit.stasisCooldownRemaining <= 0 && !unit.isStasised,
          active: unit.isStasised,
          cdFrac: unit.stasisCooldownRemaining / 30000,
          cdMs:   unit.stasisCooldownRemaining,
        }];

      default:
        return [];
    }
  }
}
