import Phaser from 'phaser';
import { Unit } from '@/units/Unit';
import { Building } from '@/buildings/Building';
import { Projectile } from './Projectile';

const BUILDING_SEEK_RANGE_PX = 600; // how far a unit scans for enemy buildings when idle

export class CombatSystem {
  private scene: Phaser.Scene;
  private projectiles: Projectile[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Spawn a visual projectile on each attack event
    scene.events.on('unit:attacked', (attacker: Unit, target: Unit) => {
      const col = attacker.unitTypeId === 'void_reaver' ? 0xcc44ff
                : attacker.faction === 'player' ? 0x88ccff : 0xff6644;
      this.projectiles.push(new Projectile(
        scene,
        attacker.getPosition().x, attacker.getPosition().y,
        target.getPosition().x, target.getPosition().y,
        col
      ));
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

      // Hold stance: never auto-acquire new targets if already stationary.
      // (They will only react to enemies entering their attack range — which is
      //  exactly what findNearestEnemyUnit does by using attackRangePx as the cap.)

      // Find nearest enemy unit in range
      const target = this.findNearestEnemyUnit(unit, living);
      if (target) {
        unit.beginAttack(target);
        continue;
      }

      // No unit target — check nearby enemy buildings
      const bTarget = this.findNearestEnemyBuilding(unit, buildings);
      if (bTarget) {
        const { x: bx, y: by } = bTarget.getWorldCenter();
        const distToBuilding = unit.distanceToPoint(bx, by);
        const inRange = distToBuilding <= unit.attackRangePx;

        if (inRange) {
          unit.stopMoving();
          const dmg = unit.attackDamage * (delta / unit.attackCooldownMs);
          if (bTarget.takeDamage(dmg)) {
            destroyedBuildings.push(bTarget);
          }
        } else if (unit.stance === 'aggressive' && !unit.isMoving()) {
          // Path toward the building so it can get in range
          this.scene.events.emit('unit:pathToBuilding', unit, bx, by);
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
