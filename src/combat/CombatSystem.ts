import Phaser from 'phaser';
import { Unit } from '@/units/Unit';
import { Building } from '@/buildings/Building';
import { Projectile, ProjectileConfig } from './Projectile';

const BUILDING_SEEK_RANGE_PX = 600; // how far a unit scans for enemy buildings when idle

// Units that use instant melee hit effects instead of traveling projectiles
const MELEE_UNIT_TYPES = new Set(['crusader', 'ironclad', 'iron_warden']);

function getProjectileConfig(attacker: Unit): ProjectileConfig {
  switch (attacker.unitTypeId) {
    // ── Architects ───────────────────────────────────────────────────────────
    case 'rifleman':        return { style: 'bullet', colour: 0x88ffff, speed: 520 };
    case 'arc_trooper':     return { style: 'bolt',   colour: 0x00eeff, speed: 410 };
    case 'arbiter':         return { style: 'orb',    colour: 0x4499ff, speed: 310 };
    case 'prime_construct': return { style: 'orb',    colour: 0x00ccff, speed: 310 };
    // ── Covenant ─────────────────────────────────────────────────────────────
    case 'devotee':         return { style: 'orb',    colour: 0xffee66, speed: 285 };
    case 'high_inquisitor': return { style: 'orb',    colour: 0xffd700, speed: 285 };
    // ── Bulwark ──────────────────────────────────────────────────────────────
    case 'demolisher':      return { style: 'shell',  colour: 0xff8833, speed: 220 };
    case 'siege_crawler':   return { style: 'shell',  colour: 0xff6622, speed: 185 };
    // ── Unseen ───────────────────────────────────────────────────────────────
    case 'phantom':         return { style: 'needle', colour: 0xcc44ff, speed: 560 };
    case 'shadow_reaper':   return { style: 'needle', colour: 0xaa22dd, speed: 460 };
    case 'void_walker':     return { style: 'orb',    colour: 0xcc44ff, speed: 310 };
    case 'void_reaver':     return { style: 'bolt',   colour: 0xcc44ff, speed: 360 };
    default:
      return attacker.faction === 'player'
        ? { style: 'bolt', colour: 0x88ccff, speed: 380 }
        : { style: 'bolt', colour: 0xff6644, speed: 380 };
  }
}

function spawnMeleeEffect(scene: Phaser.Scene, attacker: Unit, target: Unit): void {
  const { x: ax, y: ay } = attacker.getPosition();
  const { x: tx, y: ty } = target.getPosition();
  const angle = Math.atan2(ty - ay, tx - ax);
  const typeId = attacker.unitTypeId;

  if (typeId === 'crusader') {
    // Golden holy slash — fan of lines from impact direction
    const colour = 0xffdd55;
    const g = scene.add.graphics().setDepth(26);
    g.lineStyle(2.5, colour, 0.95);
    for (let i = -2; i <= 2; i++) {
      const a = angle + i * 0.22;
      g.lineBetween(tx - Math.cos(a) * 6, ty - Math.sin(a) * 6, tx + Math.cos(a) * 17, ty + Math.sin(a) * 17);
    }
    scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
    const flash = scene.add.circle(tx, ty, 9, colour, 0.7).setDepth(25);
    scene.tweens.add({ targets: flash, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 180, ease: 'Power2', onComplete: () => flash.destroy() });

  } else if (typeId === 'ironclad') {
    // Shockwave pulse ring
    const colour = 0xffffff;
    const ring = scene.add.arc(tx, ty, 8, 0, 360, false, colour, 0).setDepth(25).setStrokeStyle(2.5, colour, 0.9);
    scene.tweens.add({ targets: ring, scaleX: 3, scaleY: 3, alpha: 0, duration: 220, ease: 'Power2', onComplete: () => ring.destroy() });
    const flash = scene.add.circle(tx, ty, 7, colour, 0.7).setDepth(26);
    scene.tweens.add({ targets: flash, scaleX: 2, scaleY: 2, alpha: 0, duration: 150, ease: 'Power2', onComplete: () => flash.destroy() });

  } else if (typeId === 'iron_warden') {
    // Heavy hero slam — two staggered rings + debris
    const colour = 0xdd9944;
    const ring1 = scene.add.arc(tx, ty, 10, 0, 360, false, colour, 0).setDepth(25).setStrokeStyle(3, colour, 0.9);
    scene.tweens.add({ targets: ring1, scaleX: 3, scaleY: 3, alpha: 0, duration: 240, ease: 'Power2', onComplete: () => ring1.destroy() });
    const ring2 = scene.add.arc(tx, ty, 10, 0, 360, false, colour, 0).setDepth(24).setStrokeStyle(1.5, colour, 0.55);
    scene.tweens.add({ targets: ring2, scaleX: 4.5, scaleY: 4.5, alpha: 0, delay: 70, duration: 380, ease: 'Power2', onComplete: () => ring2.destroy() });
    const flash = scene.add.circle(tx, ty, 10, colour, 0.75).setDepth(26);
    scene.tweens.add({ targets: flash, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 180, ease: 'Power2', onComplete: () => flash.destroy() });
    // 4 debris chunks
    for (let i = 0; i < 4; i++) {
      const a  = angle + (i / 4) * Math.PI * 2;
      const dot = scene.add.circle(tx, ty, 2.5, colour, 0.9).setDepth(25);
      scene.tweens.add({ targets: dot, x: tx + Math.cos(a) * (12 + Math.random() * 8), y: ty + Math.sin(a) * (12 + Math.random() * 8), alpha: 0, scale: 0.2, duration: 260 + Math.random() * 120, ease: 'Power2', onComplete: () => dot.destroy() });
    }
  }
}

export class CombatSystem {
  private scene: Phaser.Scene;
  private projectiles: Projectile[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    scene.events.on('unit:attacked', (attacker: Unit, target: Unit) => {
      // Colossus has its own beam visual — skip standard projectile
      if (attacker.unitTypeId === 'colossus') return;

      if (MELEE_UNIT_TYPES.has(attacker.unitTypeId)) {
        spawnMeleeEffect(scene, attacker, target);
      } else {
        const config = getProjectileConfig(attacker);
        const ap = attacker.getPosition();
        const tp = target.getPosition();
        this.projectiles.push(new Projectile(scene, ap.x, ap.y, tp.x, tp.y, config));
      }
    });
  }

  update(delta: number, units: Unit[], buildings: Building[]): { deadUnits: Unit[]; destroyedBuildings: Building[] } {
    const deadUnits: Unit[] = [];
    const destroyedBuildings: Building[] = [];

    // Advance projectiles
    this.projectiles = this.projectiles.filter(p => { p.update(delta); return !p.isDone(); });

    const living = units.filter(u => u.isAlive());

    for (const unit of living) {
      if (!unit.canAttack) continue;

      // If currently attacking, validate target is still alive and in range
      if (unit.attackTarget) {
        // Stance determines how far the target can stray before the unit disengages.
        // hold: tight leash — disengage immediately at range edge
        // defensive: medium leash — slight tolerance
        // aggressive: wide leash — keep chasing a little further
        const leashFactor = unit.stance === 'hold' ? 1.0
                          : unit.stance === 'defensive' ? 1.12
                          : 1.3;
        const effRange = unit.isOnHighGround ? unit.attackRangePx * 1.2 : unit.attackRangePx;
        if (!unit.attackTarget.isAlive() || unit.distanceTo(unit.attackTarget) > effRange * leashFactor) {
          unit.endAttack();
        } else {
          continue; // already engaged
        }
      }

      // Units with an active player-issued move order keep moving — don't interrupt them.
      // They will auto-engage once they arrive (moveDest cleared) or if explicitly
      // attack-moved. This prevents "losing control" when passing near enemies.
      if (unit.moveDest !== null) continue;

      // Find nearest enemy unit in range
      const target = this.findNearestEnemyUnit(unit, living);
      if (target) {
        unit.beginAttack(target);
        continue;
      }

      // No unit target — check nearby enemy buildings (aggressive stance only, idle only)
      if (unit.stance === 'aggressive' && !unit.isMoving()) {
        const bTarget = this.findNearestEnemyBuilding(unit, buildings);
        if (bTarget) {
          const { x: bx, y: by } = bTarget.getWorldCenter();
          const distToBuilding = unit.distanceToPoint(bx, by);
          if (distToBuilding <= unit.attackRangePx) {
            unit.stopMoving();
            const dmg = unit.attackDamage * (delta / unit.attackCooldownMs);
            if (bTarget.takeDamage(dmg)) {
              destroyedBuildings.push(bTarget);
            }
          } else {
            this.scene.events.emit('unit:pathToBuilding', unit, bx, by);
          }
        }
      }
    }

    // Collect dead units
    for (const unit of living) {
      if (!unit.isAlive()) deadUnits.push(unit);
    }

    return { deadUnits, destroyedBuildings };
  }

  private findNearestEnemyUnit(attacker: Unit, living: Unit[]): Unit | null {
    // High-ground units get +20% attack range
    const effectiveRange = attacker.isOnHighGround
      ? attacker.attackRangePx * 1.2
      : attacker.attackRangePx;

    // Separate clones from real targets; give 50% chance to prefer clone
    let cloneTarget: Unit | null = null;
    let cloneDist = effectiveRange;
    let realTarget: Unit | null = null;
    let realDist = effectiveRange;

    for (const other of living) {
      if (other.faction === attacker.faction || !other.isAlive()) continue;
      if (other.isStealthed && !other.detectedByDetector) continue;
      if (!other.fogVisible) continue;
      const d = attacker.distanceTo(other);
      if ((other as any).isShadowClone) {
        if (d < cloneDist) { cloneDist = d; cloneTarget = other; }
      } else {
        if (d < realDist) { realDist = d; realTarget = other; }
      }
    }

    // If both a clone and real unit are in range: 50% chance to target clone
    if (realTarget && cloneTarget) {
      return Math.random() < 0.5 ? cloneTarget : realTarget;
    }
    return realTarget ?? cloneTarget;
  }

  private findNearestEnemyBuilding(attacker: Unit, buildings: Building[]): Building | null {
    let nearest: Building | null = null;
    // Scan up to BUILDING_SEEK_RANGE_PX; attack fires only when within attackRangePx
    let nearestDist = BUILDING_SEEK_RANGE_PX;
    for (const b of buildings) {
      if (b.faction === attacker.faction || b.isDestroyed()) continue;
      if (!b.fogVisible) continue;
      const { x, y } = b.getWorldCenter();
      const d = attacker.distanceToPoint(x, y);
      if (d < nearestDist) { nearestDist = d; nearest = b; }
    }
    return nearest;
  }

  destroy(): void {
    this.projectiles.forEach(p => p.destroy());
    this.projectiles = [];
  }
}
