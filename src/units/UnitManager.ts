import Phaser from 'phaser';
import { Unit, UnitStance } from './Unit';
import { WorkerUnit } from './WorkerUnit';
import { PathfinderService } from '@/pathfinding/PathfinderService';
import { ResourceManager } from '@/economy/ResourceManager';
import { CombatStats, ENEMY_COMBAT_STATS, RACE_COMBAT_STATS, Race, TILE_SIZE } from '@/constants';
import { getRaceTint } from '@/buildings/definitions';

/**
 * Generate tile-space formation offsets for `count` units arranged in a
 * centred grid.  Each slot is 2 tiles apart so units don't visually stack.
 * Works for any squad size — no clamping needed.
 */
function computeFormationOffsets(count: number): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const STRIDE = 2; // tiles between adjacent slots
  const cols   = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows   = Math.ceil(count / cols);
  const offsets: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    offsets.push({
      x: Math.round((col - (cols - 1) / 2) * STRIDE),
      y: Math.round((row - (rows - 1) / 2) * STRIDE),
    });
  }
  return offsets;
}

export class UnitManager {
  private units: Map<string, Unit> = new Map();
  selectedUnits: Set<Unit> = new Set();
  private scene: Phaser.Scene;
  private nextId: number = 0;
  private resources: ResourceManager;
  private pathfinder: PathfinderService;
  playerRace: Race = 'architects';
  /** Prepended to every auto-generated unit ID to avoid cross-player conflicts in multiplayer. */
  unitIdPrefix: string = '';
  /** IDs of enemy units that died locally — prevents sync_units from resurrecting them. */
  private _deadEnemyIds = new Set<string>();

  attackBonus: number = 0;
  armorBonus: number = 0;
  /** Cumulative speed bonus from global upgrades (pixels/second added to UNIT_SPEED). */
  speedBonus: number = 0;
  /** Abilities that have been unlocked via academy research. */
  unlockedAbilities: Set<string> = new Set();

  unlockAbility(key: string): void { this.unlockedAbilities.add(key); }
  isAbilityUnlocked(key: string): boolean { return this.unlockedAbilities.has(key); }
  /** Opponent's cumulative attack/armor/speed upgrades — applied to enemy mirror units. */
  enemyAttackBonus: number = 0;
  enemyArmorBonus: number = 0;
  enemySpeedBonus: number = 0;

  /** World-space repellers for environmental obstacles (rocks, trees, water). */
  private obstacleRepellers: Array<{ x: number; y: number; radius: number }> = [];
  /** World-space repellers for placed buildings — refreshed periodically. */
  private buildingRepellers: Array<{ x: number; y: number; radius: number }> = [];

  // ── Control groups (Ctrl+1-9 assign, 1-9 recall) ─────────────────────────
  /** Maps group number 1-9 → array of unit IDs in that group. */
  private controlGroups: Map<number, string[]> = new Map();

  constructor(scene: Phaser.Scene, resources: ResourceManager, pathfinder: PathfinderService) {
    this.scene = scene;
    this.resources = resources;
    this.pathfinder = pathfinder;
  }

  /** Callback fired when a player unit dies (for supply refund). */
  onUnitDied: ((unit: Unit) => void) | null = null;
  /** Callback fired when an enemy unit dies (for kill-count tracking). */
  onEnemyDied: ((unit: Unit) => void) | null = null;

  spawnUnit(tileX: number, tileY: number, stats?: CombatStats, unitTypeId = ''): Unit {
    const id = `${this.unitIdPrefix}unit_${this.nextId++}`;
    const base = stats ?? RACE_COMBAT_STATS[this.playerRace];
    const boosted = { ...base, attackDamage: base.attackDamage + this.attackBonus };
    const textureKey = unitTypeId && this.scene.textures.exists(`unit_${unitTypeId}`) ? `unit_${unitTypeId}` : 'unit';
    const unit = new Unit(this.scene, tileX, tileY, id, textureKey, 'player', boosted);
    unit.armor = this.armorBonus;
    unit.attackUpgrades = Math.min(3, Math.floor(this.attackBonus / 3));
    unit.armorUpgrades  = Math.min(3, Math.floor(this.armorBonus  / 3));
    unit.unitTypeId = unitTypeId;
    if (this.speedBonus > 0) {
      (unit as any).speed = (unit as any).speed + this.speedBonus;
      (unit as any)._baseSpeed = (unit as any)._baseSpeed + this.speedBonus;
    }
    unit.sprite.setTint(getRaceTint(this.playerRace));
    if (this.playerRace === 'covenant') unit.isCovenantUnit = true;
    if (this.playerRace === 'unseen')   unit.isUnseenUnit   = true;
    if (this.playerRace === 'bulwark')  unit.isBulwarkUnit  = true;
    unit.unitRace = this.playerRace;
    this.units.set(id, unit);
    return unit;
  }

  applyUpgradeToAll(attackDelta: number, armorDelta: number): void {
    this.units.forEach(u => {
      if (u.faction === 'player' && u.isAlive() && !u.isWorker) {
        u.attackDamage += attackDelta;
        u.armor += armorDelta;
        if (attackDelta > 0) u.attackUpgrades = Math.min(3, u.attackUpgrades + 1);
        if (armorDelta  > 0) u.armorUpgrades  = Math.min(3, u.armorUpgrades  + 1);
      }
    });
  }

  applyUpgradeToEnemies(attackDelta: number, armorDelta: number, speedDelta = 0): void {
    this.enemyAttackBonus += attackDelta;
    this.enemyArmorBonus  += armorDelta;
    this.enemySpeedBonus  += speedDelta;
    this.units.forEach(u => {
      if (u.faction === 'enemy' && u.isAlive() && !u.isWorker) {
        u.attackDamage += attackDelta;
        u.armor        += armorDelta;
        if (speedDelta !== 0) {
          (u as any).speed      = ((u as any).speed      ?? 150) + speedDelta;
          (u as any)._baseSpeed = ((u as any)._baseSpeed ?? 150) + speedDelta;
        }
      }
    });
  }

  spawnWorker(tileX: number, tileY: number): WorkerUnit {
    const id = `${this.unitIdPrefix}worker_${this.nextId++}`;
    const worker = new WorkerUnit(this.scene, tileX, tileY, id);
    // Workers get a lighter tint — same race colour but softer
    const raceTint = getRaceTint(this.playerRace);
    const r = ((raceTint >> 16) & 0xff);
    const g = ((raceTint >>  8) & 0xff);
    const b = ( raceTint        & 0xff);
    const softTint = ((Math.min(255, r + 60) << 16) | (Math.min(255, g + 60) << 8) | Math.min(255, b + 60));
    worker.sprite.setTint(softTint);
    this.units.set(id, worker);
    return worker;
  }

  spawnEnemyUnit(tileX: number, tileY: number, stats?: CombatStats, race?: Race, unitTypeId?: string): Unit {
    const id = `enemy_${this.nextId++}`;
    const enemyTextureKey = unitTypeId && this.scene.textures.exists(`unit_${unitTypeId}`) ? `unit_${unitTypeId}` : 'enemy_unit';
    const unit = new Unit(this.scene, tileX, tileY, id, enemyTextureKey, 'enemy', stats ?? ENEMY_COMBAT_STATS);
    if (race) unit.sprite.setTint(getRaceTint(race));
    if (unitTypeId) unit.unitTypeId = unitTypeId;
    this.units.set(id, unit);
    return unit;
  }

  /** Spawn an enemy unit with a caller-supplied ID (used for multiplayer remote unit sync). */
  spawnEnemyUnitWithId(id: string, tileX: number, tileY: number, race: Race, stats?: CombatStats): Unit {
    // Dedup: if a unit with this ID already exists, return the existing one.
    // Also block resurrection — once an enemy unit dies locally it stays dead
    // even if a sync_units retry from the opponent arrives for the same ID.
    if (this._deadEnemyIds.has(id)) return null!;
    const existing = this.units.get(id);
    if (existing) return existing;
    // If explicit stats are provided (e.g. WORKER_COMBAT_STATS), use them as-is.
    // For regular combat units (stats=undefined), apply the opponent's accumulated bonuses.
    let combatStats: CombatStats;
    if (stats) {
      combatStats = stats;
    } else {
      const base = RACE_COMBAT_STATS[race] ?? ENEMY_COMBAT_STATS;
      combatStats = { ...base, attackDamage: base.attackDamage + this.enemyAttackBonus };
    }
    const unit = new Unit(this.scene, tileX, tileY, id, 'enemy_unit', 'enemy', combatStats);
    if (!stats) {
      unit.armor += this.enemyArmorBonus;
      if (this.enemySpeedBonus !== 0) {
        (unit as any).speed      = ((unit as any).speed      ?? 150) + this.enemySpeedBonus;
        (unit as any)._baseSpeed = ((unit as any)._baseSpeed ?? 150) + this.enemySpeedBonus;
      }
    }
    unit.sprite.setTint(getRaceTint(race));
    unit.unitRace = race;
    this.units.set(id, unit);
    return unit;
  }

  removeDeadUnits(): Unit[] {
    const dead: Unit[] = [];
    this.units.forEach((unit, id) => {
      if (!unit.isAlive()) {
        dead.push(unit);
        // Remove from the live map immediately — prevents onUnitDied from firing
        // again on every subsequent frame while the death animation plays (~42 frames
        // at 60 fps before the old 700 ms delayedCall would have fired).
        this.units.delete(id);
        this.selectedUnits.delete(unit);
        if (unit.faction === 'player') this.onUnitDied?.(unit);
        else if (unit.faction === 'enemy') { this._deadEnemyIds.add(id); this.onEnemyDied?.(unit); }
        // Defer Phaser GameObject destruction so the death animation can finish.
        this.scene.time.delayedCall(700, () => unit.destroy());
      }
    });
    return dead;
  }

  handleUnitClick(unit: Unit, additive: boolean): void {
    if (!unit.isAlive() || unit.faction === 'enemy') return;
    if (additive) {
      if (unit.isSelected) { this.selectedUnits.delete(unit); unit.setSelected(false); }
      else                 { this.selectedUnits.add(unit);    unit.setSelected(true); }
    } else {
      this.deselectAll();
      this.selectedUnits.add(unit);
      unit.setSelected(true);
    }
  }

  selectUnitsInRect(worldRect: Phaser.Geom.Rectangle): void {
    this.deselectAll();
    this.units.forEach(unit => {
      if (!unit.isAlive() || unit.faction === 'enemy' || unit.isGarrisoned) return;
      // Skip workers who are physically inside a mine node (sprite alpha=0 at node center)
      if ((unit as WorkerUnit).miningState === 'harvesting' ||
          (unit as WorkerUnit).miningState === 'exiting_mine') return;
      const { x, y } = unit.getPosition();
      if (worldRect.contains(x, y)) { this.selectedUnits.add(unit); unit.setSelected(true); }
    });
  }

  deselectAll(): void {
    this.selectedUnits.forEach(u => u.setSelected(false));
    this.selectedUnits.clear();
  }

  moveSelectedUnits(toTileX: number, toTileY: number): void {
    const units = Array.from(this.selectedUnits).filter(u => u.isAlive());
    // Cancel patrol on any patrolling unit when the player issues a manual move
    units.forEach(u => { if (u.isPatrolling) u.stopPatrol(); });
    const offsets = computeFormationOffsets(units.length);
    units.forEach((unit, i) => {
      const off = offsets[i];
      const destX = toTileX + off.x;
      const destY = toTileY + off.y;
      const { tileX, tileY } = unit.getCurrentTile();
      this.pathfinder.findPath(tileX, tileY, destX, destY, (path) => {
        if (path && path.length > 0) {
          unit.setPath(path);
        } else {
          // Target tile is blocked — try adjacent tiles in spiral order
          const ADJACENT = [
            {dx:0,dy:1},{dx:1,dy:0},{dx:0,dy:-1},{dx:-1,dy:0},
            {dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1},
            {dx:0,dy:2},{dx:2,dy:0},{dx:0,dy:-2},{dx:-2,dy:0},
          ];
          let found = false;
          let adjIdx = 0;
          const tryNext = () => {
            if (found || adjIdx >= ADJACENT.length) return;
            const a = ADJACENT[adjIdx++];
            this.pathfinder.findPath(tileX, tileY, destX + a.dx, destY + a.dy, (p2) => {
              if (!found && p2 && p2.length > 0) {
                found = true;
                unit.setPath(p2);
              } else {
                tryNext();
              }
            });
          };
          tryNext();
        }
      });
    });
  }

  /** Attack-move: units march to destination and resume after each fight. */
  attackMoveSelectedUnits(toTileX: number, toTileY: number): void {
    // Identical to regular move — resume-after-combat is automatic via moveDest
    this.moveSelectedUnits(toTileX, toTileY);
  }

  /** Issue a patrol order to all selected combat units between current tile and the given tile. */
  startPatrolForSelected(toTileX: number, toTileY: number): void {
    const units = Array.from(this.selectedUnits).filter(u => u.isAlive() && !u.isWorker && u.canAttack);
    units.forEach(unit => {
      const { tileX, tileY } = unit.getCurrentTile();
      unit.startPatrol(tileX, tileY, toTileX, toTileY);
    });
  }

  /** Stop patrol on all selected units. */
  stopPatrolForSelected(): void {
    this.selectedUnits.forEach(u => { if (u.isPatrolling) u.stopPatrol(); });
  }

  /**
   * Right-click-attack a specific enemy unit.
   * Units already in range begin attacking immediately; others path toward the target
   * and will auto-engage once the CombatSystem detects them in range.
   */
  attackTargetUnit(target: Unit): void {
    const units = Array.from(this.selectedUnits).filter(u => u.isAlive() && u.canAttack);
    const offsets = computeFormationOffsets(units.length);
    units.forEach((unit, i) => {
      if (unit.distanceTo(target) <= unit.attackRangePx) {
        unit.beginAttack(target);
      } else {
        const off = offsets[i];
        const { tileX, tileY } = target.getCurrentTile();
        const from = unit.getCurrentTile();
        this.pathfinder.findPath(from.tileX, from.tileY, tileX + off.x, tileY + off.y, (path) => {
          if (path && path.length > 0) unit.setPath(path);
        });
      }
    });
  }

  /**
   * Shift+right-click: append a waypoint to each selected unit's order queue.
   * If a unit is currently idle it starts moving immediately; otherwise it
   * queues the order and executes it when the current path completes.
   */
  queueMoveSelectedUnits(toTileX: number, toTileY: number): void {
    const units = Array.from(this.selectedUnits).filter(u => u.isAlive());
    const offsets = computeFormationOffsets(units.length);
    units.forEach((unit, i) => {
      const off = offsets[i];
      unit.queueOrder(toTileX + off.x, toTileY + off.y);
    });
  }

  /** Returns all selected living workers. */
  getSelectedWorkers(): WorkerUnit[] {
    const result: WorkerUnit[] = [];
    this.selectedUnits.forEach(u => {
      if (u instanceof WorkerUnit && u.isAlive()) result.push(u);
    });
    return result;
  }

  // ── Stance ────────────────────────────────────────────────────────────────────

  /** Set the combat stance on all selected non-worker player units. */
  setStanceForSelected(stance: UnitStance): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.faction === 'player' && !u.isWorker) {
        u.setStance(stance);
      }
    });
  }

  /**
   * Returns the stance of the selected combat units.
   * 'mixed' if not all share the same stance; null if no combat units are selected.
   */
  getSelectedStance(): UnitStance | 'mixed' | null {
    const combatUnits = Array.from(this.selectedUnits).filter(u => u.isAlive() && !u.isWorker && u.faction === 'player');
    if (combatUnits.length === 0) return null;
    const first = combatUnits[0].stance;
    return combatUnits.every(u => u.stance === first) ? first : 'mixed';
  }

  // ── Unit abilities ────────────────────────────────────────────────────────────

  /** Activate the race-specific ability (Overcharge / Shield Wall / Hero) on selected units. */
  activateAbilityForSelected(): void {
    this.selectedUnits.forEach(u => {
      if (!u.isAlive()) return;
      // Hero ability takes priority
      if (u.isHero && u.canActivateHeroAbility()) {
        u.activateHeroAbility();
        this.scene.events.emit('unit:heroAbility', u);
      } else if (u.canActivateOvercharge()) {
        u.activateOvercharge();
        this.scene.events.emit('unit:abilityActivated', u, 'overcharge');
      } else if (u.canActivateShieldWall()) {
        u.activateShieldWall();
        this.scene.events.emit('unit:abilityActivated', u, 'shieldwall');
      } else if (u.canActivateShadowClone()) {
        u.activateShadowClone();
        this.scene.events.emit('unit:abilityActivated', u, 'shadowclone');
      }
    });
  }

  /** Returns hero ability info for the first selected hero unit. */
  getSelectedHeroAbilityInfo(): { type: string; ready: boolean; active: boolean; cooldownSec: number } | null {
    const typeLabels: Record<string, string> = {
      high_inquisitor: 'Smite (AoE)',
      prime_construct:  'Repair Building',
      void_walker:      'Reveal Cloaked',
      iron_warden:      'Invulnerable',
    };
    for (const u of this.selectedUnits) {
      if (!u.isAlive() || !u.isHero) continue;
      return {
        type: typeLabels[u.unitTypeId] ?? 'Hero Ability',
        ready: u.canActivateHeroAbility(),
        active: u.heroInvulnActive,
        cooldownSec: Math.ceil(u.heroAbilityCooldownRemaining / 1000),
      };
    }
    return null;
  }

  /**
   * Returns ability info for the first selected unit that has an ability.
   * Returns `{ locked: true }` when the ability exists but hasn't been unlocked yet.
   * Used by the HUD to display the C-key ability status.
   */
  getSelectedAbilityInfo(): { type: string; ready: boolean; active: boolean; cooldownSec: number; locked?: boolean } | null {
    for (const u of this.selectedUnits) {
      if (!u.isAlive()) continue;
      // Hero units show their ability as the C-ability
      if (u.isHero) return this.getSelectedHeroAbilityInfo();
      if (u.unitTypeId === 'rifleman') {
        if (!this.isAbilityUnlocked('unlock_overcharge'))
          return { type: 'Overcharge', ready: false, active: false, cooldownSec: 0, locked: true };
        return {
          type: 'Overcharge',
          ready: u.canActivateOvercharge(),
          active: u.overchargeReady,
          cooldownSec: Math.ceil(u.overchargeCooldownRemaining / 1000),
        };
      }
      if (u.unitTypeId === 'ironclad') {
        if (!this.isAbilityUnlocked('unlock_shield_wall'))
          return { type: 'Shield Wall', ready: false, active: false, cooldownSec: 0, locked: true };
        return {
          type: 'Shield Wall',
          ready: u.canActivateShieldWall(),
          active: u.shieldWallActive,
          cooldownSec: Math.ceil(u.shieldWallCooldownRemaining / 1000),
        };
      }
      if (u.unitTypeId === 'phantom') {
        if (!this.isAbilityUnlocked('unlock_shadow_clone'))
          return { type: 'Shadow Clone', ready: false, active: false, cooldownSec: 0, locked: true };
        return {
          type: 'Shadow Clone',
          ready: u.canActivateShadowClone(),
          active: false,
          cooldownSec: Math.ceil(u.shadowCloneCooldownRemaining / 1000),
        };
      }
    }
    return null;
  }

  // ── Control group API ─────────────────────────────────────────────────────────

  /** Sync the controlGroupNumber field on all player units based on current controlGroups map. */
  private syncControlGroupBadges(): void {
    // Clear all badges first
    this.units.forEach(u => {
      if (u.faction === 'player') u.controlGroupNumber = null;
    });
    // Re-assign from current groups (higher group numbers win if unit is in multiple groups)
    this.controlGroups.forEach((ids, n) => {
      ids.forEach(id => {
        const u = this.units.get(id);
        if (u && u.faction === 'player' && u.isAlive()) u.controlGroupNumber = n;
      });
    });
  }

  /** Assign the current selection to control group n (1-9). Replaces any prior assignment. */
  assignControlGroup(n: number): void {
    const ids = Array.from(this.selectedUnits)
      .filter(u => u.isAlive() && u.faction === 'player')
      .map(u => u.id);
    this.controlGroups.set(n, ids);
    this.syncControlGroupBadges();
  }

  /**
   * Select all living units in control group n.
   * Returns the selected units so the caller can optionally center the camera.
   */
  recallControlGroup(n: number): Unit[] {
    const ids = this.controlGroups.get(n);
    if (!ids || ids.length === 0) return [];

    const alive: Unit[] = [];
    ids.forEach(id => {
      const u = this.units.get(id);
      if (u?.isAlive() && !u.isGarrisoned) alive.push(u);
    });
    // Prune dead units from the stored group
    this.controlGroups.set(n, alive.map(u => u.id));

    if (alive.length === 0) return [];
    this.deselectAll();
    alive.forEach(u => { this.selectedUnits.add(u); u.setSelected(true); });
    this.syncControlGroupBadges();
    return alive;
  }

  /**
   * Returns a map of group number → living unit count for HUD display.
   * Groups with 0 living units are omitted.
   */
  getControlGroupCounts(): Map<number, number> {
    const result = new Map<number, number>();
    this.controlGroups.forEach((ids, n) => {
      const alive = ids.filter(id => this.units.get(id)?.isAlive()).length;
      if (alive > 0) result.set(n, alive);
    });
    return result;
  }

  getSelectedPhantoms(): Unit[] {
    return Array.from(this.selectedUnits).filter(u => u.unitTypeId === 'phantom' && u.isAlive());
  }

  getSelectedArbiters(): Unit[] {
    return Array.from(this.selectedUnits).filter(u => u.unitTypeId === 'arbiter' && u.isAlive());
  }

  /** Returns the single selected unit when exactly one is selected; null otherwise. */
  getSingleSelectedUnit(): Unit | null {
    if (this.selectedUnits.size !== 1) return null;
    const [unit] = this.selectedUnits;
    return unit.isAlive() ? unit : null;
  }

  /** Activate Divine Pulse on all selected Devotees that have it ready. */
  activateDivinePulseForSelected(): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.canActivateDivinePulse()) {
        u.activateDivinePulse();
        this.scene.events.emit('unit:abilityActivated', u, 'divinepulse');
      }
    });
  }

  /** True when at least one selected unit is a Covenant player unit. */
  hasSelectedCovenantUnits(): boolean {
    return Array.from(this.selectedUnits).some(u => u.isAlive() && (u as any).isCovenantUnit);
  }

  /** Activate Holy Nova V on all selected Covenant units that have it ready. */
  activateHolyNovaVForSelected(): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.canActivateHolyNovaV()) {
        u.activateHolyNovaV();
      }
    });
  }

  /** Activate Holy Nova on all selected Devotees that have it ready. */
  activateHolyNovaForSelected(): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.canActivateHolyNova()) {
        u.activateHolyNova();
        this.scene.events.emit('unit:abilityActivated', u, 'holynova');
      }
    });
  }

  /** Returns R-ability info (Holy Nova) for the first selected Devotee. */
  getSelectedRAbilityInfo(): { type: string; ready: boolean; active: boolean; cooldownSec: number; locked?: boolean } | null {
    for (const u of this.selectedUnits) {
      if (!u.isAlive()) continue;
      if (u.unitTypeId === 'devotee') {
        if (!this.isAbilityUnlocked('unlock_holy_nova'))
          return { type: 'Holy Nova', ready: false, active: false, cooldownSec: 0, locked: true };
        return {
          type: 'Holy Nova',
          ready: u.canActivateHolyNova(),
          active: false,
          cooldownSec: Math.ceil(u.holyNovaCooldownRemaining / 1000),
        };
      }
    }
    return null;
  }

  /** Returns selected Phantoms that can currently Shadow Step. */
  getSelectedPhantomsShadowStep(): Unit[] {
    return Array.from(this.selectedUnits).filter(u => u.isAlive() && u.canActivateShadowStep());
  }

  /** Activate Shadow Step on each phantom, teleporting to (worldX, worldY). */
  activateShadowStepForSelected(worldX: number, worldY: number): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.canActivateShadowStep()) {
        const success = u.activateShadowStep(worldX, worldY);
        if (success) this.scene.events.emit('unit:abilityActivated', u, 'shadowstep');
      }
    });
  }

  /** Returns selected Phantoms that can currently Phase Shift. */
  getSelectedPhantomsPhaseShift(): Unit[] {
    return Array.from(this.selectedUnits).filter(u => u.isAlive() && u.canActivatePhaseShift());
  }

  /** Activate Phase Shift on all eligible selected phantoms. */
  activatePhaseShiftForSelected(): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.canActivatePhaseShift()) {
        u.activatePhaseShift();
        this.scene.events.emit('unit:abilityActivated', u, 'phaseshift');
      }
    });
  }

  /** Activate Shadow Clone on all eligible selected phantoms. */
  activateShadowCloneForSelected(): void {
    this.selectedUnits.forEach(u => {
      if (u.isAlive() && u.canActivateShadowClone()) {
        u.activateShadowClone();
        this.scene.events.emit('unit:abilityActivated', u, 'shadowclone');
      }
    });
  }

  /**
   * Returns E-ability info for the first selected unit that has one.
   * Returns `{ locked: true }` when the ability exists but hasn't been unlocked yet.
   * Used by the HUD to display the E-key ability status.
   */
  getSelectedEAbilityInfo(): { type: string; ready: boolean; active: boolean; cooldownSec: number; locked?: boolean } | null {
    for (const u of this.selectedUnits) {
      if (!u.isAlive()) continue;
      if (u.unitTypeId === 'devotee') {
        if (!this.isAbilityUnlocked('unlock_divine_pulse'))
          return { type: 'Divine Pulse', ready: false, active: false, cooldownSec: 0, locked: true };
        return {
          type: 'Divine Pulse',
          ready: u.canActivateDivinePulse(),
          active: false,
          cooldownSec: Math.ceil(u.divinePulseCooldownRemaining / 1000),
        };
      }
      if (u.unitTypeId === 'phantom') {
        if (!this.isAbilityUnlocked('unlock_phase_shift'))
          return { type: 'Phase Shift', ready: false, active: false, cooldownSec: 0, locked: true };
        return {
          type: 'Phase Shift',
          ready: u.canActivatePhaseShift(),
          active: u.phaseShiftActive,
          cooldownSec: Math.ceil(u.phaseShiftCooldownRemaining / 1000),
        };
      }
      if (u.unitTypeId === 'arbiter') {
        return {
          type: 'Stasis',
          ready: u.canCastStasis(),
          active: false,
          cooldownSec: Math.ceil(u.stasisCooldownRemaining / 1000),
        };
      }
    }
    return null;
  }

  getLivingDevotees(): Unit[] {
    return Array.from(this.units.values())
      .filter(u => u.isAlive() && u.faction === 'player' && u.unitTypeId === 'devotee');
  }

  getSelectedCount(): number { return this.selectedUnits.size; }

  hasOnlyWorkers(): boolean {
    if (this.selectedUnits.size === 0) return false;
    for (const u of this.selectedUnits) { if (!u.isWorker) return false; }
    return true;
  }

  /**
   * Returns a summary of selected units grouped by type.
   * Used by the HUD to show "12 selected · Riflemen ×4 · Workers ×2" etc.
   */
  getSelectionComposition(): { total: number; groups: Array<{ label: string; count: number }> } {
    const total = this.selectedUnits.size;
    if (total === 0) return { total: 0, groups: [] };

    const counts = new Map<string, number>();
    for (const u of this.selectedUnits) {
      if (!u.isAlive()) continue;
      const key = u.isWorker ? 'Worker' : this.unitTypeLabel(u.unitTypeId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const groups = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1]) // descending by count
      .map(([label, count]) => ({ label, count }));

    return { total, groups };
  }

  private unitTypeLabel(typeId: string): string {
    const labels: Record<string, string> = {
      rifleman: 'Rifleman',
      devotee:  'Devotee',
      ironclad: 'Ironclad',
      phantom:  'Phantom',
      arbiter:  'Arbiter',
    };
    return labels[typeId] ?? 'Unit';
  }

  /**
   * Count all living player combat units grouped by type.
   * Used for population breakdown tooltip in HUD supply row.
   */
  getPlayerUnitCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const u of this.units.values()) {
      if (!u.isAlive() || u.faction !== 'player') continue;
      const key = u.isWorker ? 'Worker' : this.unitTypeLabel(u.unitTypeId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /** Stop all selected units in place (clears move/attack orders). */
  stopSelectedUnits(): void {
    for (const u of this.selectedUnits) {
      if (u.isAlive()) {
        u.stopMoving();
        u.moveDest = null; // prevent endAttack() from resuming a move the player explicitly cancelled
      }
    }
  }

  /** Register world-space obstacle repellers so moving units steer around them. */
  setObstacleRepellers(repellers: Array<{ x: number; y: number; radius: number }>): void {
    this.obstacleRepellers = repellers;
  }

  /** Update building repellers (called from GameScene every 30 frames). */
  setBuildingRepellers(repellers: Array<{ x: number; y: number; radius: number }>): void {
    this.buildingRepellers = repellers;
  }

  /**
   * Nudge a unit away from every other unit it is overlapping with.
   * Applied every frame for all living, non-garrisoned units so stacked units
   * naturally drift apart and you can distinguish individuals.
   */
  private applyUnitSeparation(unit: Unit, allUnits: Unit[]): void {
    // Use ~75% of a tile as the personal-space radius. Units that stray closer
    // than this get gently pushed away. The force scales linearly so that
    // fully-overlapping units get the maximum push and units near the boundary
    // feel almost nothing.
    const RADIUS  = TILE_SIZE * 0.75; // ~24 px
    const MAX_PUSH = 1.8;             // px per frame at full overlap

    for (const other of allUnits) {
      if (other === unit || !other.isAlive() || other.isGarrisoned) continue;
      const dx = unit.sprite.x - other.sprite.x;
      const dy = unit.sprite.y - other.sprite.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= RADIUS * RADIUS || distSq < 0.01) continue;
      const dist  = Math.sqrt(distSq);
      const force = (1 - dist / RADIUS) * MAX_PUSH;
      unit.sprite.x += (dx / dist) * force;
      unit.sprite.y += (dy / dist) * force;
    }
  }

  /**
   * Nudge a unit away from any obstacle or building repeller it has drifted inside.
   * Called after unit.update() so the separation is applied on top of that frame's movement.
   */
  private applyObstacleSeparation(unit: Unit): void {
    const THRESHOLD = 10;
    const MAX_PUSH = 3.0;

    const applyList = (list: Array<{ x: number; y: number; radius: number }>) => {
      for (const rep of list) {
        const dx = unit.sprite.x - rep.x;
        const dy = unit.sprite.y - rep.y;
        const distSq = dx * dx + dy * dy;
        const limit = rep.radius + THRESHOLD;
        if (distSq >= limit * limit || distSq < 0.01) continue;
        const dist = Math.sqrt(distSq);
        const force = (1 - dist / limit) * MAX_PUSH;
        unit.sprite.x += (dx / dist) * force;
        unit.sprite.y += (dy / dist) * force;
      }
    };

    applyList(this.obstacleRepellers);
    applyList(this.buildingRepellers);
  }

  update(delta: number): void {
    // Snapshot living units once so applyUnitSeparation doesn't re-query the map each call.
    const allUnits = Array.from(this.units.values());
    this.units.forEach(unit => {
      unit.update(delta);
      if (unit.isAlive() && !unit.isGarrisoned) {
        // Separate from nearby units regardless of movement state — idle units clump too.
        this.applyUnitSeparation(unit, allUnits);
      }
      // Steer moving units away from terrain obstacles and buildings
      if (unit.isAlive() && unit.isMoving()) {
        this.applyObstacleSeparation(unit);
      }
    });
  }

  getAllUnits(): Unit[] { return Array.from(this.units.values()); }
  getLivingUnits(): Unit[] { return Array.from(this.units.values()).filter(u => u.isAlive()); }

  /** Look up a unit by its ID string. Returns undefined if not found. */
  getUnitById(id: string): Unit | undefined { return this.units.get(id); }

  /** Move a specific set of units to a tile position (formation, no selection change). */
  moveSpecificUnits(units: Unit[], toTileX: number, toTileY: number): void {
    const alive = units.filter(u => u.isAlive());
    const offsets = computeFormationOffsets(alive.length);
    alive.forEach((unit, i) => {
      const off = offsets[i];
      const destX = toTileX + off.x;
      const destY = toTileY + off.y;
      const { tileX, tileY } = unit.getCurrentTile();
      this.pathfinder.findPath(tileX, tileY, destX, destY, (path) => {
        if (path && path.length > 0) unit.setPath(path);
      });
    });
  }
}
