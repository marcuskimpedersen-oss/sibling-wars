import Phaser from 'phaser';
import { PathStep } from '@/types';
import { TILE_SIZE, UNIT_SPEED, Faction, CombatStats, Race } from '@/constants';

export type UnitState = 'idle' | 'moving' | 'attacking';

/** Unit combat stance — governs engagement and leash behaviour. */
export type UnitStance = 'aggressive' | 'defensive' | 'hold';

/** Tile the unit is currently walking toward (cleared on arrival or new order). */
export interface MoveDest { tileX: number; tileY: number }

export class Unit {
  readonly id: string;
  readonly sprite: Phaser.GameObjects.Image;
  protected scene: Phaser.Scene;

  protected state: UnitState = 'idle';
  protected path: PathStep[] = [];
  protected currentStep: number = 0;
  protected speed: number = UNIT_SPEED;
  private onArrivedCallback: (() => void) | null = null;

  // Faction & combat
  readonly faction: Faction;
  readonly canAttack: boolean;
  readonly isWorker: boolean = false;

  health: number;
  maxHealth: number;
  attackDamage: number;
  attackRangePx: number;
  readonly attackCooldownMs: number;
  armor: number = 0;

  // ── Veterancy ─────────────────────────────────────────────────────────────────
  killCount: number = 0;
  veterancyLevel: 0 | 1 | 2 = 0;
  private _baseMaxHealth: number = 0;
  private _baseAttackDamage: number = 0;
  private _veterancyStar: Phaser.GameObjects.Text | null = null;
  private attackTimer: number = 0;
  attackTarget: Unit | null = null;

  /** Multiplier applied to attack timer ticks (e.g. 1.25 = 25% faster attacks). */
  attackSpeedMultiplier: number = 1.0;

  isSelected: boolean = false;
  isGarrisoned: boolean = false;
  private alive: boolean = true;

  // Unit type — set by UnitManager when spawning; used for ability logic
  unitTypeId: string = '';

  // Attack-move resume: when a unit interrupts a move to fight, store the dest tile
  moveDest: MoveDest | null = null;

  // ── Order queue (Shift+right-click) ──────────────────────────────────────────
  private orderQueue: Array<{ tileX: number; tileY: number }> = [];
  private waypointGfx: Phaser.GameObjects.Graphics;

  // ── Stance ───────────────────────────────────────────────────────────────────
  stance: UnitStance = 'aggressive';
  /** World-space anchor used by the defensive stance to leash and return. */
  defensiveAnchor: { x: number; y: number } | null = null;

  // ── Hero unit ─────────────────────────────────────────────────────────────────
  isHero: boolean = false;
  heroAbilityCooldownRemaining: number = 0;
  heroInvulnActive: boolean = false;
  private heroInvulnTimer: number = 0;
  private readonly HERO_INVULN_DURATION_MS = 8000;
  private _heroInvulnRing: Phaser.GameObjects.Arc | null = null;
  private _crownLabel: Phaser.GameObjects.Text | null = null;
  /** When true, stealth never expires (Void Walker). */
  permanentlyCloaked: boolean = false;

  // ── Stealth (Phantom — Unseen faction) ───────────────────────────────────────
  isStealthed: boolean = false;
  stealthCooldownRemaining: number = 0;
  private stealthDurationRemaining: number = 0;

  // ── Overcharge (Rifleman — Architects faction) ───────────────────────────────
  /** True while the overcharge has been activated and the next shot is powered. */
  overchargeReady: boolean = false;
  overchargeCooldownRemaining: number = 0;
  private readonly OVERCHARGE_COOLDOWN_MS = 12000;
  private overchargeGlow: Phaser.GameObjects.Arc | null = null;

  // ── Shield Wall (Ironclad — Bulwark faction) ─────────────────────────────────
  shieldWallActive: boolean = false;
  /** True when shield wall is managed passively by GameScene adjacency check. */
  shieldWallIsPassive: boolean = false;
  private shieldWallTimer: number = 0;
  shieldWallCooldownRemaining: number = 0;
  private readonly SHIELD_WALL_DURATION_MS = 6000;
  private readonly SHIELD_WALL_COOLDOWN_MS = 30000;
  private shieldRing: Phaser.GameObjects.Arc | null = null;

  // ── Race flags (set by UnitManager at spawn time) ────────────────────────────
  isCovenantUnit: boolean = false;
  isUnseenUnit: boolean = false;
  isBulwarkUnit: boolean = false;
  /** Race of this unit — used for selection ring colour. Null for enemies. */
  unitRace: Race | null = null;

  // ── Control group badge (set by UnitManager) ──────────────────────────────────
  /** Which control group (1-9) this unit belongs to, or null if none. */
  controlGroupNumber: number | null = null;
  private _controlGroupBadge: Phaser.GameObjects.Text | null = null;

  // ── Fortified Ground (Bulwark passive) ────────────────────────────────────────
  /** Accumulated ms of stillness for Fortified Ground passive. */
  private _fortifiedGroundTimer: number = 0;
  /** True when unit has stood still for 3+ seconds (10% damage reduction). */
  _fortifiedGroundActive: boolean = false;
  private _fortifiedGroundRing: Phaser.GameObjects.Arc | null = null;

  // ── Fortify (Bulwark — any combat unit) ───────────────────────────────────────
  fortifyActive: boolean = false;
  private fortifyTimer: number = 0;
  private readonly FORTIFY_DURATION_MS = 20000;
  private _fortifyShieldIcon: Phaser.GameObjects.Text | null = null;
  private _fortifyTimerText: Phaser.GameObjects.Text | null = null;

  // ── Divine Pulse (Devotee — Covenant faction) ─────────────────────────────
  divinePulseCooldownRemaining: number = 0;
  private readonly DIVINE_PULSE_COOLDOWN_MS = 25000;

  // ── Holy Nova (Devotee — Covenant faction) ────────────────────────────────
  holyNovaCooldownRemaining: number = 0;
  private readonly HOLY_NOVA_COOLDOWN_MS = 20000;

  // ── Holy Nova V (all Covenant units — V key) ─────────────────────────────
  holyNovaVCooldownRemaining: number = 0;
  private readonly HOLY_NOVA_V_COOLDOWN_MS = 35000;

  // ── Reconstruction Protocol (Architects units) ────────────────────────────
  repairModeActive: boolean = false;
  repairModeTimer: number = 0;
  repairModeCooldownRemaining: number = 0;
  private readonly REPAIR_MODE_DURATION_MS = 8000;
  private readonly REPAIR_MODE_COOLDOWN_MS = 30000;

  // ── Assassinate (Unseen faction — F2 key) ─────────────────────────────────
  assassinateCooldown: number = 0;
  private readonly ASSASSINATE_COOLDOWN_MS = 30000;
  static readonly ASSASSINATE_DAMAGE = 80;
  static readonly ASSASSINATE_RADIUS_PX = 60;

  // ── Divine Wrath (Covenant faction — F3 key) ──────────────────────────────
  divineWrathCooldown: number = 0;
  private readonly DIVINE_WRATH_COOLDOWN_MS = 50000;

  // ── Iron Bastion (Bulwark faction — N key) ────────────────────────────────
  ironBastionCooldown: number = 0;
  private readonly IRON_BASTION_COOLDOWN_MS = 60000;

  // ── Shadow Step (Phantom — Unseen faction) ────────────────────────────────
  shadowStepCooldownRemaining: number = 0;
  private readonly SHADOW_STEP_COOLDOWN_MS = 15000;
  static readonly SHADOW_STEP_RANGE_PX = 280;

  // ── Phase Shift (Phantom — Unseen faction) ────────────────────────────────
  phaseShiftActive: boolean = false;
  private phaseShiftTimer: number = 0;
  phaseShiftCooldownRemaining: number = 0;
  private readonly PHASE_SHIFT_DURATION_MS = 4000;
  private readonly PHASE_SHIFT_COOLDOWN_MS = 25000;
  private _phaseShiftRing: Phaser.GameObjects.Arc | null = null;

  // ── Shadow Clone (Phantom — Unseen faction) ───────────────────────────────
  shadowCloneCooldownRemaining: number = 0;
  private readonly SHADOW_CLONE_COOLDOWN_MS = 40000;

  /** True when this unit is a shadow clone decoy, not a real unit. */
  isShadowClone: boolean = false;

  // ── Aegis Shield (Covenant Z ability — applied from outside) ─────────────
  /** True while this unit is protected by an Aegis Shield and cannot take damage. */
  isAegisShielded: boolean = false;

  // ── EMP Stun (Architects X ability — applied from outside) ───────────────
  /** True while this unit is stunned by an EMP Pulse and cannot move or attack. */
  isEmpStunned: boolean = false;
  empStunRemaining: number = 0;

  // ── Stasis (Arbiter — Covenant faction) ───────────────────────────────────
  /** True while this unit is frozen by a Stasis field. */
  isStasised: boolean = false;
  stasisRemaining: number = 0;
  stasisCooldownRemaining: number = 0;
  private readonly STASIS_COOLDOWN_MS = 30000;
  private stasisGfx: Phaser.GameObjects.Arc | null = null;

  // ── Siege Mode (Siege Crawler — Bulwark faction) ──────────────────────────
  siegeModeActive: boolean = false;
  /** True while the 2-second deploy/undeploy transition is in progress. */
  siegeModeTransitioning: boolean = false;
  private siegeModeTransitionTimer: number = 0;
  private readonly SIEGE_TRANSITION_MS = 2000;
  /** Saved normal-mode stats to restore when undeploying. */
  private _siegeBaseRange: number = 0;
  private _siegeBaseDamage: number = 0;
  private _siegeTransitionGfx: Phaser.GameObjects.Arc | null = null;

  /**
   * Fog-of-war visibility flag set externally each frame by the GameScene.
   * When false the unit's sprites are hidden and it cannot be auto-targeted.
   */
  fogVisible: boolean = true;

  /** Last world position used for fog update — skip recheck if unit barely moved. */
  _lastFogX: number = -9999;
  _lastFogY: number = -9999;

  /**
   * Movement speed multiplier applied by external zone effects (e.g. Shade Zone).
   * Reset to 1.0 each frame by GameScene before applying zone logic.
   */
  moveSpeedMultiplier: number = 1.0;

  /**
   * Armor bonus from zone effects (e.g. Shade Zone +2 armor for Unseen units).
   * Reset to 0 each frame by GameScene before applying zone logic.
   */
  zoneArmorBonus: number = 0;

  // Devotee heal timer (Covenant faction)
  devoteeHealTimer: number = 0;

  // ── Patrol ───────────────────────────────────────────────────────────────────
  isPatrolling: boolean = false;
  /** World-space patrol endpoint A (origin) and B (destination). */
  private patrolA: { tileX: number; tileY: number } | null = null;
  private patrolB: { tileX: number; tileY: number } | null = null;
  /** Which end the unit is currently heading toward (true = B, false = A). */
  private patrolTowardB: boolean = true;

  // ── Height / terrain ─────────────────────────────────────────────────────────
  /** Set each frame by GameScene based on height zone overlap. */
  isOnHighGround: boolean = false;

  // ── Retreat ───────────────────────────────────────────────────────────────────
  isRetreating: boolean = false;
  private retreatHQX: number = 0;
  private retreatHQY: number = 0;
  private _retreatLabel: Phaser.GameObjects.Text | null = null;
  private readonly RETREAT_SPEED_MULT = 1.5;
  private readonly RETREAT_STOP_DIST_SQ = 150 * 150;

  // ── On Fire (kill streak) ─────────────────────────────────────────────────────
  onFireActive: boolean = false;
  private onFireTimer: number = 0;
  private readonly ON_FIRE_DURATION_MS = 30000;
  private readonly ON_FIRE_KILL_WINDOW_MS = 60000;
  private readonly ON_FIRE_KILL_THRESHOLD = 10;
  /** Timestamps (ms scene clock) of recent kills — used to detect 10-in-60s streak. */
  private recentKillTimes: number[] = [];
  private onFireGlow: Phaser.GameObjects.Arc | null = null;

  // ── Detector (e.g. Prime Construct) ──────────────────────────────────────────
  /** When true, this unit reveals nearby cloaked/stealthed enemies. */
  isDetector: boolean = false;
  readonly DETECTION_RADIUS_PX = 160;
  /** Set each frame by GameScene when a friendly detector is in range. */
  detectedByDetector: boolean = false;
  private _detectorRing: Phaser.GameObjects.Graphics | null = null;
  private _detectedOutline: Phaser.GameObjects.Graphics | null = null;

  // ── Upgrade badges ───────────────────────────────────────────────────────────
  /** How many attack upgrades this unit has received (incremented by UnitManager). */
  attackUpgrades: number = 0;
  /** How many armor upgrades this unit has received (incremented by UnitManager). */
  armorUpgrades: number = 0;
  private _upgradeBadges: Phaser.GameObjects.Graphics | null = null;

  // ── Wounded state ─────────────────────────────────────────────────────────────
  private _wounded: boolean = false;
  private _baseSpeed: number = 0;
  private _woundedTween: Phaser.Tweens.Tween | null = null;

  // ── Last Stand (passive — all races, below 15% HP) ────────────────────────
  lastStandActive: boolean = false;
  private _lastStandAura: Phaser.GameObjects.Arc | null = null;

  // Visuals
  protected shadow: Phaser.GameObjects.Ellipse;
  private selectionCircle: Phaser.GameObjects.Ellipse;
  private healthBarBg: Phaser.GameObjects.Rectangle;
  private healthBar: Phaser.GameObjects.Rectangle;
  private xpBarBg: Phaser.GameObjects.Rectangle;
  private xpBar: Phaser.GameObjects.Rectangle;
  private moveDustTimer = 0;
  /** Accumulated ms spent trying to reach the current path step; reset on step advance. */
  private _stepTimer = 0;
  /** Cached health value used to skip re-rendering the health bar when unchanged. */
  private _lastRenderedHealth = -1;
  /** True when waypoint lines were drawn last frame — used to avoid redundant clears. */
  private _hadWaypoints = false;

  constructor(
    scene: Phaser.Scene,
    tileX: number,
    tileY: number,
    id: string,
    textureKey = 'unit',
    faction: Faction = 'player',
    stats: CombatStats = { maxHealth: 80, attackDamage: 10, attackRangePx: 100, attackCooldownMs: 1500 }
  ) {
    this.scene = scene;
    this.id = id;
    this.faction = faction;
    this.maxHealth = stats.maxHealth;
    this.health = stats.maxHealth;
    this.attackDamage = stats.attackDamage;
    this.attackRangePx = stats.attackRangePx;
    this.attackCooldownMs = stats.attackCooldownMs;
    this.canAttack = stats.attackDamage > 0;
    this._baseMaxHealth = stats.maxHealth;
    this._baseAttackDamage = stats.attackDamage;
    this._baseSpeed = UNIT_SPEED;

    const worldX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const worldY = tileY * TILE_SIZE + TILE_SIZE / 2;

    // Unit shadow (rendered just above buildings, below the unit itself)
    this.shadow = scene.add.ellipse(worldX, worldY + TILE_SIZE / 2 - 2, TILE_SIZE - 6, 8, 0x000000, 0.22);
    this.shadow.setDepth(8.5);

    // Selection circle
    this.selectionCircle = scene.add.ellipse(worldX, worldY + TILE_SIZE / 2 - 4, TILE_SIZE - 4, 10, 0x00ff88, 0.6);
    this.selectionCircle.setDepth(9).setVisible(false);

    // Sprite
    this.sprite = scene.add.image(worldX, worldY, textureKey);
    this.sprite.setDepth(10);
    this.sprite.setInteractive();
    this.sprite.on('pointerdown', (pointer: Phaser.Input.Pointer, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (pointer.leftButtonDown()) {
        scene.events.emit('unit:clicked', this);
      } else if (pointer.rightButtonDown()) {
        scene.events.emit('unit:rightClicked', this);
      }
    });

    // Health bar (hidden at full health)
    this.healthBarBg = scene.add.rectangle(worldX, worldY - 20, 26, 4, 0x222222, 0.9)
      .setDepth(13).setVisible(false);
    this.healthBar = scene.add.rectangle(worldX - 13, worldY - 20, 26, 4, 0x44ff44)
      .setOrigin(0, 0.5).setDepth(14).setVisible(false);

    // XP bar — thin blue bar below the health bar, fills toward next veterancy rank
    this.xpBarBg = scene.add.rectangle(worldX, worldY - 14, 20, 3, 0x111133, 0.85)
      .setDepth(13).setVisible(false);
    this.xpBar = scene.add.rectangle(worldX - 10, worldY - 14, 0, 3, 0x4488ff)
      .setOrigin(0, 0.5).setDepth(14).setVisible(false);

    // Waypoint graphics (drawn per-frame when unit is selected with a queued order)
    this.waypointGfx = scene.add.graphics().setDepth(7);

    // Upgrade badge graphics (drawn above health bar)
    this._upgradeBadges = scene.add.graphics().setDepth(14);
  }

  // ── Stance ───────────────────────────────────────────────────────────────────

  setStance(s: UnitStance): void {
    this.stance = s;
    if (s === 'hold') {
      // Freeze in place
      this.stopMoving();
      this.moveDest = null;
    }
    if (s === 'defensive') {
      // Anchor at current world position
      this.defensiveAnchor = { x: this.sprite.x, y: this.sprite.y };
    }
    if (s === 'aggressive') {
      this.defensiveAnchor = null;
    }
    this.updateStanceIndicator();
  }

  private updateStanceIndicator(): void {
    // Tint selection circle by stance when unit is selected
    // Aggressive uses the race colour; defensive/hold use fixed colours for clarity
    if (!this.isSelected) return;
    const colour = this.stance === 'aggressive' ? this.getRaceSelectionColor()
                 : this.stance === 'defensive'  ? 0x4488ff
                 :                                0x44ff88;
    this.selectionCircle.setFillStyle(colour, 0.6);
  }

  // ── Retreat ───────────────────────────────────────────────────────────────────

  beginRetreat(hqWorldX: number, hqWorldY: number): void {
    this.isRetreating = true;
    this.retreatHQX = hqWorldX;
    this.retreatHQY = hqWorldY;
    this.attackTarget = null;
    // Show floating RETREAT label
    if (this._retreatLabel) { this._retreatLabel.destroy(); this._retreatLabel = null; }
    this._retreatLabel = this.scene.add.text(
      this.sprite.x, this.sprite.y - 28, 'RETREAT',
      { fontSize: '10px', color: '#ff8844', stroke: '#000', strokeThickness: 2, fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(20);
    this.scene.tweens.add({
      targets: this._retreatLabel, y: this.sprite.y - 44, alpha: 0,
      duration: 1200, ease: 'Power1',
      onComplete: () => { this._retreatLabel?.destroy(); this._retreatLabel = null; },
    });
  }

  stopRetreat(): void {
    this.isRetreating = false;
    this.stopMoving();
  }

  // ── Overcharge (Rifleman) ────────────────────────────────────────────────────

  canActivateOvercharge(): boolean {
    return this.unitTypeId === 'rifleman'
      && this.overchargeCooldownRemaining <= 0
      && !this.overchargeReady;
  }

  activateOvercharge(): void {
    this.overchargeReady = true;
    this.overchargeCooldownRemaining = this.OVERCHARGE_COOLDOWN_MS;
    // Persistent yellow glow while the powered shot is loaded
    this.overchargeGlow = this.scene.add.arc(this.sprite.x, this.sprite.y, 18, 0, 360, false, 0xffaa00, 0)
      .setDepth(11).setStrokeStyle(3, 0xffaa00, 0.9);
    this.scene.tweens.add({
      targets: this.overchargeGlow,
      strokeAlpha: { from: 0.9, to: 0.25 },
      duration: 350, yoyo: true, repeat: -1,
    });
  }

  private fireOvercharge(): void {
    this.overchargeReady = false;
    if (this.overchargeGlow) {
      const g = this.overchargeGlow;
      this.overchargeGlow = null;
      this.scene.tweens.killTweensOf(g);
      this.scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
    }
    // Big orange burst at attacker
    const burst = this.scene.add.arc(this.sprite.x, this.sprite.y, 20, 0, 360, false, 0xff8800, 0.75).setDepth(26);
    this.scene.tweens.add({ targets: burst, alpha: 0, scaleX: 2.8, scaleY: 2.8, duration: 280, ease: 'Power2', onComplete: () => burst.destroy() });
  }

  // ── Shield Wall (Ironclad) ───────────────────────────────────────────────────

  canActivateShieldWall(): boolean {
    return this.unitTypeId === 'ironclad'
      && this.shieldWallCooldownRemaining <= 0
      && !this.shieldWallActive;
  }

  activateShieldWall(): void {
    this.shieldWallActive = true;
    this.shieldWallTimer = this.SHIELD_WALL_DURATION_MS;
    this.shieldWallCooldownRemaining = this.SHIELD_WALL_COOLDOWN_MS;
    // Blue pulsing shield ring
    this.shieldRing = this.scene.add.arc(this.sprite.x, this.sprite.y, 20, 0, 360, false, 0x2255cc, 0)
      .setDepth(11).setStrokeStyle(4, 0x4488ff, 0.85);
    this.scene.tweens.add({
      targets: this.shieldRing,
      strokeAlpha: { from: 0.85, to: 0.3 },
      duration: 500, yoyo: true, repeat: -1,
    });
  }

  private deactivateShieldWall(): void {
    this.shieldWallActive = false;
    this.shieldWallIsPassive = false;
    this.shieldWallTimer = 0;
    if (this.shieldRing) {
      const ring = this.shieldRing;
      this.shieldRing = null;
      this.scene.tweens.killTweensOf(ring);
      this.scene.tweens.add({ targets: ring, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
    }
  }

  /** Passive shield wall — managed by GameScene adjacency check every 500ms. */
  setShieldWallPassive(active: boolean): void {
    if (active === this.shieldWallActive && active === this.shieldWallIsPassive) return;
    if (active) {
      this.shieldWallActive = true;
      this.shieldWallIsPassive = true;
      this.shieldWallTimer = 999999999; // won't expire via timer
      if (!this.shieldRing) {
        this.shieldRing = this.scene.add.arc(this.sprite.x, this.sprite.y, 20, 0, 360, false, 0x2255cc, 0)
          .setDepth(11).setStrokeStyle(3, 0x66aaff, 0.7);
        this.scene.tweens.add({
          targets: this.shieldRing,
          strokeAlpha: { from: 0.7, to: 0.2 },
          duration: 600, yoyo: true, repeat: -1,
        });
      }
    } else {
      this.shieldWallIsPassive = false;
      this.deactivateShieldWall();
    }
  }

  // ── Fortify (Bulwark) ────────────────────────────────────────────────────────

  canFortify(): boolean {
    return !this.fortifyActive && !this.isWorker && this.isAlive();
  }

  activateFortify(): void {
    this.fortifyActive = true;
    this.fortifyTimer = this.FORTIFY_DURATION_MS;
    this.stopMoving();
    this.moveDest = null;
    // Shield icon + countdown timer above unit
    this._fortifyShieldIcon = this.scene.add.text(
      this.sprite.x, this.sprite.y - 34, '🛡',
      { fontSize: '13px' }
    ).setOrigin(0.5).setDepth(21);
    this._fortifyTimerText = this.scene.add.text(
      this.sprite.x, this.sprite.y - 20, '20s',
      { fontSize: '9px', color: '#44aaff', stroke: '#000', strokeThickness: 2 }
    ).setOrigin(0.5).setDepth(21);
  }

  deactivateFortify(): void {
    if (!this.fortifyActive) return;
    this.fortifyActive = false;
    this.fortifyTimer = 0;
    if (this._fortifyShieldIcon) { this._fortifyShieldIcon.destroy(); this._fortifyShieldIcon = null; }
    if (this._fortifyTimerText)  { this._fortifyTimerText.destroy();  this._fortifyTimerText  = null; }
  }

  // ── Hero abilities ───────────────────────────────────────────────────────────

  /** Set this unit as a Hero — adds crown icon and special properties. */
  setAsHero(): void {
    this.isHero = true;
    this._crownLabel = this.scene.add.text(
      this.sprite.x, this.sprite.y - 36, '♛',
      { fontSize: '12px', color: '#ffd700', stroke: '#000000', strokeThickness: 2 }
    ).setOrigin(0.5).setDepth(16);
    if (this.unitTypeId === 'void_walker') {
      this.permanentlyCloaked = true;
      this.isStealthed = true;
      this.sprite.setAlpha(0.22);
    }
  }

  canActivateHeroAbility(): boolean {
    return this.isHero && this.heroAbilityCooldownRemaining <= 0 && !this.heroInvulnActive;
  }

  activateHeroAbility(): void {
    if (!this.canActivateHeroAbility()) return;
    const cdMap: Record<string, number> = {
      high_inquisitor: 45000,
      prime_construct:  45000,
      void_walker:      45000,
      iron_warden:      60000,
    };
    this.heroAbilityCooldownRemaining = cdMap[this.unitTypeId] ?? 45000;

    if (this.unitTypeId === 'iron_warden') {
      this.heroInvulnActive = true;
      this.heroInvulnTimer  = this.HERO_INVULN_DURATION_MS;
      this._heroInvulnRing  = this.scene.add.arc(
        this.sprite.x, this.sprite.y, 24, 0, 360, false, 0xffd700, 0
      ).setDepth(12).setStrokeStyle(4, 0xffd700, 0.9);
      this.scene.tweens.add({
        targets: this._heroInvulnRing,
        strokeAlpha: { from: 0.9, to: 0.25 },
        duration: 400, yoyo: true, repeat: -1,
      });
    }
  }

  // ── Siege Mode (Siege Crawler) ───────────────────────────────────────────────

  canToggleSiegeMode(): boolean {
    return this.unitTypeId === 'siege_crawler' && !this.siegeModeTransitioning;
  }

  /**
   * Begin a 2-second transition.  On completion, siege mode flips:
   *   deploy   → immobile, +100% range, +50% dmg, wider/flatter sprite
   *   undeploy → restore normal stats, movement re-enabled
   */
  toggleSiegeMode(): void {
    if (!this.canToggleSiegeMode()) return;
    this.siegeModeTransitioning = true;
    this.siegeModeTransitionTimer = this.SIEGE_TRANSITION_MS;
    this.stopMoving();

    // Orange pulsing ring while transitioning
    this._siegeTransitionGfx = this.scene.add.arc(this.sprite.x, this.sprite.y, 22, 0, 360, false, 0xff8800, 0)
      .setDepth(11).setStrokeStyle(3, 0xff8800, 0.9);
    this.scene.tweens.add({
      targets: this._siegeTransitionGfx,
      strokeAlpha: { from: 0.9, to: 0.2 },
      duration: 300, yoyo: true, repeat: -1,
    });

    const label = this.siegeModeActive ? 'Undeploying…' : 'Deploying…';
    this.scene.events.emit('unit:abilityActivated', this, 'siege_transition');
    this.scene.events.emit('unit:siegeTransitionLabel', this, label);
  }

  /** Called each frame to tick the siege transition. */
  tickSiegeMode(delta: number): void {
    if (!this.siegeModeTransitioning) return;
    this.siegeModeTransitionTimer -= delta;
    if (this.siegeModeTransitionTimer > 0) return;

    // Transition complete
    this.siegeModeTransitioning = false;
    if (this._siegeTransitionGfx) {
      const g = this._siegeTransitionGfx;
      this._siegeTransitionGfx = null;
      this.scene.tweens.killTweensOf(g);
      this.scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
    }

    if (!this.siegeModeActive) {
      // Deploy: save base stats, apply siege bonuses, flatten sprite
      this._siegeBaseRange  = this.attackRangePx;
      this._siegeBaseDamage = this.attackDamage;
      this.attackRangePx  = Math.round(this.attackRangePx  * 2.0);
      this.attackDamage   = Math.round(this.attackDamage   * 1.5);
      this.siegeModeActive = true;
      // Wide, flat silhouette
      this.sprite.setScale(1.7, 0.65);
      this.scene.events.emit('unit:abilityActivated', this, 'siege_deploy');
    } else {
      // Undeploy: restore stats, normal sprite
      this.attackRangePx  = this._siegeBaseRange;
      this.attackDamage   = this._siegeBaseDamage;
      this.siegeModeActive = false;
      this.sprite.setScale(1, 1);
      this.scene.events.emit('unit:abilityActivated', this, 'siege_undeploy');
    }
  }

  // ── Divine Pulse (Devotee) ───────────────────────────────────────────────────

  canActivateDivinePulse(): boolean {
    return this.unitTypeId === 'devotee' && this.divinePulseCooldownRemaining <= 0;
  }

  activateDivinePulse(): void {
    this.divinePulseCooldownRemaining = this.DIVINE_PULSE_COOLDOWN_MS;
    // The actual AoE heal is resolved in GameScene; we emit an event with our position
    this.scene.events.emit('unit:divinePulseActivated', this);
    // Expanding teal ring visual
    const ring = this.scene.add.arc(this.sprite.x, this.sprite.y, 10, 0, 360, false, 0x44ffaa, 0.5).setDepth(26);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 20, scaleY: 20,
      alpha: 0,
      duration: 500,
      ease: 'Power2',
      onComplete: () => ring.destroy(),
    });
  }

  // ── Holy Nova (Devotee — Covenant faction) ───────────────────────────────────

  canActivateHolyNova(): boolean {
    return this.unitTypeId === 'devotee' && this.holyNovaCooldownRemaining <= 0;
  }

  activateHolyNova(): void {
    this.holyNovaCooldownRemaining = this.HOLY_NOVA_COOLDOWN_MS;
    // AoE damage/heal resolved in GameScene via this event
    this.scene.events.emit('unit:holyNovaActivated', this);

    // Bright white outer ring expanding rapidly
    const outerRing = this.scene.add.arc(this.sprite.x, this.sprite.y, 8, 0, 360, false, 0xffffff, 0)
      .setDepth(27).setStrokeStyle(4, 0xffffff, 1);
    this.scene.tweens.add({
      targets: outerRing,
      scaleX: 22, scaleY: 22,
      strokeAlpha: 0,
      duration: 420,
      ease: 'Power2',
      onComplete: () => outerRing.destroy(),
    });

    // Gold inner burst fill
    const innerBurst = this.scene.add.arc(this.sprite.x, this.sprite.y, 12, 0, 360, false, 0xffd700, 0.7).setDepth(26);
    this.scene.tweens.add({
      targets: innerBurst,
      scaleX: 14, scaleY: 14,
      alpha: 0,
      duration: 340,
      ease: 'Power3',
      onComplete: () => innerBurst.destroy(),
    });

    // Soft white core flash
    const core = this.scene.add.arc(this.sprite.x, this.sprite.y, 18, 0, 360, false, 0xffffff, 0.9).setDepth(28);
    this.scene.tweens.add({
      targets: core,
      alpha: 0,
      scaleX: 0.3, scaleY: 0.3,
      duration: 180,
      ease: 'Power4',
      onComplete: () => core.destroy(),
    });
  }

  // ── Holy Nova V (all Covenant units — V key) ────────────────────────────────

  canActivateHolyNovaV(): boolean {
    return this.isCovenantUnit && this.faction === 'player' && this.holyNovaVCooldownRemaining <= 0;
  }

  activateHolyNovaV(): void {
    this.holyNovaVCooldownRemaining = this.HOLY_NOVA_V_COOLDOWN_MS;
    this.scene.events.emit('unit:holyNovaVActivated', this);

    // Expanding white ring
    const ring = this.scene.add.arc(this.sprite.x, this.sprite.y, 4, 0, 360, false, 0xffffff, 0)
      .setDepth(27).setStrokeStyle(3, 0xffffff, 1);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 30, scaleY: 30,
      strokeAlpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => ring.destroy(),
    });

    // Inner white fill burst
    const fill = this.scene.add.arc(this.sprite.x, this.sprite.y, 10, 0, 360, false, 0xffffff, 0.85).setDepth(26);
    this.scene.tweens.add({
      targets: fill, scaleX: 13, scaleY: 13, alpha: 0,
      duration: 350, ease: 'Power3', onComplete: () => fill.destroy(),
    });
  }

  // ── Reconstruction Protocol (Architects — any Architects unit) ───────────────

  canActivateReconstructionProtocol(): boolean {
    return !this.repairModeActive && this.repairModeCooldownRemaining <= 0;
  }

  activateReconstructionProtocol(): void {
    this.repairModeActive = true;
    this.repairModeTimer = this.REPAIR_MODE_DURATION_MS;
    this.repairModeCooldownRemaining = this.REPAIR_MODE_COOLDOWN_MS;
    this.scene.events.emit('unit:reconstructionActivated', this);

    // Green activation pulse
    const pulse = this.scene.add.arc(this.sprite.x, this.sprite.y, 20, 0, 360, false, 0x44ff88, 0.7).setDepth(26);
    this.scene.tweens.add({
      targets: pulse, scaleX: 3, scaleY: 3, alpha: 0, duration: 400, ease: 'Power2',
      onComplete: () => pulse.destroy(),
    });
  }

  // ── Sacred Ground (Covenant — any Covenant unit) ────────────────────────────

  sacredGroundCooldownRemaining: number = 0;
  private readonly SACRED_GROUND_COOLDOWN_MS = 45000;

  canActivateSacredGround(): boolean {
    return this.faction === 'player' && this.sacredGroundCooldownRemaining <= 0;
  }

  /**
   * Creates a gold circle at this unit's position that heals all friendly units
   * within 100px by 5 HP every second for 10 seconds, then fades out.
   */
  activateSacredGround(): void {
    this.sacredGroundCooldownRemaining = this.SACRED_GROUND_COOLDOWN_MS;
    const cx = this.sprite.x;
    const cy = this.sprite.y;
    const RADIUS = 100;
    const DURATION_MS = 10000;
    const TICK_MS = 1000;
    const HEAL_AMOUNT = 5;

    // Gold translucent ground circle
    const circle = this.scene.add.graphics().setDepth(5);
    circle.fillStyle(0xffd700, 0.3);
    circle.fillCircle(cx, cy, RADIUS);
    circle.lineStyle(2, 0xffd700, 0.7);
    circle.strokeCircle(cx, cy, RADIUS);

    // Tick heal every second for 10 seconds
    let ticksRemaining = DURATION_MS / TICK_MS;
    const tickEvent = this.scene.time.addEvent({
      delay: TICK_MS,
      repeat: ticksRemaining - 1,
      callback: () => {
        // Emit event so GameScene can resolve the heal (it has access to all units)
        this.scene.events.emit('unit:sacredGroundTick', cx, cy, RADIUS, HEAL_AMOUNT);
        ticksRemaining--;
      },
    });

    // After 10s, fade and destroy the circle
    this.scene.time.delayedCall(DURATION_MS, () => {
      tickEvent.destroy();
      this.scene.tweens.add({
        targets: circle,
        alpha: 0,
        duration: 500,
        onComplete: () => circle.destroy(),
      });
    });
  }

  // ── Stasis (Arbiter) ────────────────────────────────────────────────────────

  canCastStasis(): boolean {
    return this.unitTypeId === 'arbiter' && this.stasisCooldownRemaining <= 0;
  }

  /** Mark this caster as having fired; begins the cooldown timer. */
  beginStasisCooldown(): void {
    this.stasisCooldownRemaining = this.STASIS_COOLDOWN_MS;
  }

  /**
   * Freeze this unit for durationMs milliseconds.
   * Works on both player and enemy units (friend-and-foe).
   */
  applyStasis(durationMs: number): void {
    this.isStasised = true;
    this.stasisRemaining = durationMs;
    this.stopMoving();
    this.attackTarget = null;
    // Icy blue ring around frozen unit
    if (!this.stasisGfx) {
      this.stasisGfx = this.scene.add.arc(this.sprite.x, this.sprite.y, 18, 0, 360, false, 0x88ccff, 0.25)
        .setDepth(20).setStrokeStyle(2.5, 0x44aaff, 0.9);
      this.scene.tweens.add({
        targets: this.stasisGfx,
        strokeAlpha: { from: 0.9, to: 0.35 },
        duration: 400, yoyo: true, repeat: -1,
      });
    }
  }

  // ── Assassinate (Unseen — F2 key) ────────────────────────────────────────────

  canAssassinate(): boolean {
    return this.isUnseenUnit && this.faction === 'player' && this.assassinateCooldown <= 0;
  }

  /**
   * Teleport to (targetX, targetY), deal 80 burst damage to the nearest enemy
   * within 60px on arrival. Returns true if the teleport was executed.
   */
  executeAssassinate(targetX: number, targetY: number): boolean {
    if (!this.canAssassinate()) return false;
    this.assassinateCooldown = this.ASSASSINATE_COOLDOWN_MS;

    // Smoke puff at origin
    const smoke = this.scene.add.arc(this.sprite.x, this.sprite.y, 16, 0, 360, false, 0x333333, 0.7).setDepth(26);
    this.scene.tweens.add({ targets: smoke, scaleX: 3, scaleY: 3, alpha: 0, duration: 450, ease: 'Power2', onComplete: () => smoke.destroy() });

    // Teleport
    this.sprite.setPosition(targetX, targetY);
    this.path = [];
    this.currentStep = 0;
    this.state = 'idle';
    this.moveDest = null;

    // Smoke puff at destination
    const smokeB = this.scene.add.arc(targetX, targetY, 16, 0, 360, false, 0x222222, 0.8).setDepth(26);
    this.scene.tweens.add({ targets: smokeB, scaleX: 3.5, scaleY: 3.5, alpha: 0, duration: 500, ease: 'Power2', onComplete: () => smokeB.destroy() });

    // Emit event so GameScene can resolve the damage (needs access to all units)
    this.scene.events.emit('unit:assassinateArrival', this, targetX, targetY);

    return true;
  }

  // ── Shadow Step (Phantom) ────────────────────────────────────────────────────

  canActivateShadowStep(): boolean {
    return this.unitTypeId === 'phantom' && this.shadowStepCooldownRemaining <= 0;
  }

  /** Teleport to (targetX, targetY) if within range. Returns true on success. */
  activateShadowStep(targetX: number, targetY: number): boolean {
    const dist = Math.hypot(targetX - this.sprite.x, targetY - this.sprite.y);
    if (dist > Unit.SHADOW_STEP_RANGE_PX) return false;
    this.shadowStepCooldownRemaining = this.SHADOW_STEP_COOLDOWN_MS;

    // Ghost trail at origin
    const ghost = this.scene.add.image(this.sprite.x, this.sprite.y, this.sprite.texture.key)
      .setDepth(10).setAlpha(0.55).setTint(0xbb44ee);
    this.scene.tweens.add({ targets: ghost, alpha: 0, scaleX: 0.5, scaleY: 0.5, duration: 400, onComplete: () => ghost.destroy() });

    // Teleport
    this.sprite.setPosition(targetX, targetY);
    this.path = [];
    this.currentStep = 0;
    this.state = 'idle';
    this.moveDest = null;

    // Brief 2s stealth on arrival
    this.isStealthed = true;
    this.stealthDurationRemaining = 2000;
    this.sprite.setAlpha(0.18);

    // Purple burst at landing
    const burst = this.scene.add.arc(targetX, targetY, 16, 0, 360, false, 0xbb44ee, 0.7).setDepth(26);
    this.scene.tweens.add({ targets: burst, scaleX: 3, scaleY: 3, alpha: 0, duration: 350, ease: 'Power2', onComplete: () => burst.destroy() });

    return true;
  }

  // ── Phase Shift (Phantom) ────────────────────────────────────────────────────

  canActivatePhaseShift(): boolean {
    return this.unitTypeId === 'phantom'
      && this.phaseShiftCooldownRemaining <= 0
      && !this.phaseShiftActive;
  }

  activatePhaseShift(): void {
    this.phaseShiftActive = true;
    this.phaseShiftTimer = this.PHASE_SHIFT_DURATION_MS;
    this.phaseShiftCooldownRemaining = this.PHASE_SHIFT_COOLDOWN_MS;
    this.stopMoving();
    this.attackTarget = null;
    this.sprite.setAlpha(0.4);
    // Pulsing purple ring
    this._phaseShiftRing = this.scene.add.arc(
      this.sprite.x, this.sprite.y, 20, 0, 360, false, 0xaa44ee, 0
    ).setDepth(11).setStrokeStyle(3, 0xaa44ee, 0.9);
    this.scene.tweens.add({
      targets: this._phaseShiftRing,
      strokeAlpha: { from: 0.9, to: 0.2 },
      duration: 400, yoyo: true, repeat: -1,
    });
    // Activation burst
    const burst = this.scene.add.arc(this.sprite.x, this.sprite.y, 18, 0, 360, false, 0xaa44ee, 0.7).setDepth(26);
    this.scene.tweens.add({ targets: burst, scaleX: 3, scaleY: 3, alpha: 0, duration: 350, ease: 'Power2', onComplete: () => burst.destroy() });
  }

  private deactivatePhaseShift(): void {
    this.phaseShiftActive = false;
    this.phaseShiftTimer = 0;
    this.sprite.setAlpha(this.isStealthed ? 0.18 : 1.0);
    if (this._phaseShiftRing) {
      const r = this._phaseShiftRing;
      this._phaseShiftRing = null;
      this.scene.tweens.killTweensOf(r);
      this.scene.tweens.add({ targets: r, alpha: 0, duration: 300, onComplete: () => r.destroy() });
    }
  }

  // ── Shadow Clone (Phantom) ────────────────────────────────────────────────────

  canActivateShadowClone(): boolean {
    return this.unitTypeId === 'phantom'
      && this.shadowCloneCooldownRemaining <= 0;
  }

  activateShadowClone(): void {
    this.shadowCloneCooldownRemaining = this.SHADOW_CLONE_COOLDOWN_MS;
    this.scene.events.emit('unit:shadowCloneCreated', this);
    const burst = this.scene.add.arc(this.sprite.x, this.sprite.y, 16, 0, 360, false, 0x8844bb, 0.6).setDepth(26);
    this.scene.tweens.add({ targets: burst, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 300, ease: 'Power2', onComplete: () => burst.destroy() });
  }

  // ── Veterancy ─────────────────────────────────────────────────────────────────

  /** Call when this unit lands the killing blow on an enemy. */
  recordKill(): void {
    if (!this.alive || this.faction !== 'player') return;
    this.killCount++;
    if (this.killCount === 3 && this.veterancyLevel === 0) {
      this.promoteVeterancy(1);
    } else if (this.killCount === 6 && this.veterancyLevel === 1) {
      this.promoteVeterancy(2);
    }
    // On Fire kill streak: track recent kills within the time window
    const now = (this.scene as Phaser.Scene & { time: Phaser.Time.Clock }).time.now;
    this.recentKillTimes.push(now);
    // Prune kills older than 60 seconds
    this.recentKillTimes = this.recentKillTimes.filter(t => now - t <= this.ON_FIRE_KILL_WINDOW_MS);
    if (!this.onFireActive && this.recentKillTimes.length >= this.ON_FIRE_KILL_THRESHOLD) {
      this.activateOnFire();
    }
  }

  private activateOnFire(): void {
    this.onFireActive = true;
    this.onFireTimer = this.ON_FIRE_DURATION_MS;
    // Orange pulsing glow
    this.onFireGlow = this.scene.add.arc(
      this.sprite.x, this.sprite.y, 18, 0, 360, false, 0xff6600, 0
    ).setDepth(9.5).setStrokeStyle(4, 0xff6600, 0.85);
    // Pulse the glow
    this.scene.tweens.add({
      targets: this.onFireGlow,
      strokeAlpha: 0.2,
      duration: 300,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    // Pop flash
    const burst = this.scene.add.arc(this.sprite.x, this.sprite.y, 24, 0, 360, false, 0xff6600, 0.8).setDepth(26);
    this.scene.tweens.add({ targets: burst, scaleX: 3.5, scaleY: 3.5, alpha: 0, duration: 400, ease: 'Power2', onComplete: () => burst.destroy() });
    // Floating text
    const txt = this.scene.add.text(this.sprite.x, this.sprite.y - 32, '🔥 ON FIRE!', {
      fontSize: '11px', color: '#ff6600', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(27);
    this.scene.tweens.add({ targets: txt, y: txt.y - 22, alpha: 0, duration: 1200, ease: 'Power1', onComplete: () => txt.destroy() });
  }

  private deactivateOnFire(): void {
    this.onFireActive = false;
    this.onFireTimer = 0;
    if (this.onFireGlow) {
      this.scene.tweens.killTweensOf(this.onFireGlow);
      this.onFireGlow.destroy();
      this.onFireGlow = null;
    }
  }

  private promoteVeterancy(level: 1 | 2): void {
    this.veterancyLevel = level;
    const hpMult  = level === 1 ? 1.15 : 1.30;
    const dmgMult = level === 1 ? 1.10 : 1.20;
    const scale   = level === 1 ? 1.12 : 1.25;

    // Scale HP proportionally so current health benefits immediately
    const hpRatio = this.health / this.maxHealth;
    this.maxHealth    = Math.round(this._baseMaxHealth  * hpMult);
    this.health       = Math.round(this.maxHealth * hpRatio);
    this.attackDamage = Math.round(this._baseAttackDamage * dmgMult);
    this.sprite.setScale(scale);

    // Star icon above unit
    if (this._veterancyStar) this._veterancyStar.destroy();
    const starColor = level === 1 ? '#ffffff' : '#ffd700';
    this._veterancyStar = this.scene.add.text(
      this.sprite.x, this.sprite.y - 28, '★',
      { fontSize: level === 1 ? '10px' : '13px', color: starColor, stroke: '#000000', strokeThickness: 2 }
    ).setOrigin(0.5).setDepth(15);

    // Promotion flash
    const burstColor = level === 1 ? 0xffffff : 0xffd700;
    const burst = this.scene.add.arc(this.sprite.x, this.sprite.y, 22, 0, 360, false, burstColor, 0.7).setDepth(26);
    this.scene.tweens.add({
      targets: burst, scaleX: 3, scaleY: 3, alpha: 0, duration: 400, ease: 'Power2',
      onComplete: () => burst.destroy(),
    });

    // Floating "RANK UP!" text in gold
    const rankTxt = this.scene.add.text(
      this.sprite.x, this.sprite.y - 36, 'RANK UP!',
      { fontSize: '11px', color: '#ffd700', stroke: '#000000', strokeThickness: 3, fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(28);
    this.scene.tweens.add({
      targets: rankTxt, y: rankTxt.y - 26, alpha: 0, duration: 1500, ease: 'Power1',
      onComplete: () => rankTxt.destroy(),
    });
  }

  // ── Order queue (Shift+right-click) ──────────────────────────────────────────

  /**
   * Append a tile destination to this unit's order queue.
   * If the unit is idle the order is consumed immediately (emits unit:requestNextOrder).
   */
  queueOrder(tileX: number, tileY: number): void {
    this.orderQueue.push({ tileX, tileY });
    if (this.state === 'idle') {
      this.consumeNextOrder();
    }
  }

  getOrderQueue(): Array<{ tileX: number; tileY: number }> {
    return this.orderQueue;
  }

  /** Pop the front of the order queue and ask the scene to pathfind for it. */
  private consumeNextOrder(): void {
    if (this.orderQueue.length === 0) return;
    const next = this.orderQueue.shift()!;
    this.scene.events.emit('unit:requestNextOrder', this, next.tileX, next.tileY);
  }

  // ── Patrol ─────────────────────────────────────────────────────────────────

  /** Begin patrolling between two tile positions. Unit will auto-attack along the way. */
  startPatrol(tileAX: number, tileAY: number, tileBX: number, tileBY: number): void {
    this.patrolA = { tileX: tileAX, tileY: tileAY };
    this.patrolB = { tileX: tileBX, tileY: tileBY };
    this.patrolTowardB = true;
    this.isPatrolling = true;
    this.orderQueue = [];
    // Request first move toward B
    this.scene.events.emit('unit:patrolMove', this, tileBX, tileBY);
  }

  stopPatrol(): void {
    this.isPatrolling = false;
    this.patrolA = null;
    this.patrolB = null;
  }

  /** Called when patrol move arrives — reverse direction and go to other end. */
  onPatrolArrived(): void {
    if (!this.isPatrolling || !this.patrolA || !this.patrolB) return;
    this.patrolTowardB = !this.patrolTowardB;
    const dest = this.patrolTowardB ? this.patrolB : this.patrolA;
    this.scene.events.emit('unit:patrolMove', this, dest.tileX, dest.tileY);
  }

  // ── Path / movement ──────────────────────────────────────────────────────────

  /**
   * @param clearQueue  When true (default) clears any queued Shift+click orders.
   *                    Pass false when advancing through the order queue internally.
   */
  setPath(path: PathStep[], onArrived?: () => void, clearQueue = true): void {
    if (clearQueue) this.orderQueue = [];
    this.path = path;
    this.currentStep = 0;
    this._stepTimer = 0;
    this.onArrivedCallback = onArrived ?? null;
    this.attackTarget = null;
    this.state = path.length > 0 ? 'moving' : 'idle';
    // Track destination so we can resume after an interrupted fight
    if (path.length > 0) {
      const last = path[path.length - 1];
      this.moveDest = { tileX: last.x, tileY: last.y };
      // Defensive units update their anchor to wherever the player sends them
      if (this.stance === 'defensive') {
        this.defensiveAnchor = {
          x: last.x * TILE_SIZE + TILE_SIZE / 2,
          y: last.y * TILE_SIZE + TILE_SIZE / 2,
        };
      }
    } else {
      this.moveDest = null;
    }
  }

  stopMoving(): void {
    this.path = [];
    this.currentStep = 0;
    this.onArrivedCallback = null;
    if (this.state === 'moving') this.state = 'idle';
  }

  // ── Combat ───────────────────────────────────────────────────────────────────

  beginAttack(target: Unit): void {
    this.attackTarget = target;
    this.stopMoving();
    this.state = 'attacking';
  }

  endAttack(): void {
    this.attackTarget = null;
    this.state = 'idle';
    // Resume the interrupted move, if any.
    // moveDest is intentionally NOT cleared here so that units executing an
    // attack-move can re-resume toward their original destination after every
    // successive kill in a chain. It is only cleared when the unit finally
    // arrives (setPath's arrival handler) or the player issues a new command.
    if (this.moveDest) {
      this.scene.events.emit('unit:resumeMove', this, this.moveDest.tileX, this.moveDest.tileY);
    } else if (this.stance === 'defensive' && this.defensiveAnchor) {
      // Defensive units return to their anchor when the fight ends
      const ax = Math.floor(this.defensiveAnchor.x / TILE_SIZE);
      const ay = Math.floor(this.defensiveAnchor.y / TILE_SIZE);
      this.scene.events.emit('unit:resumeMove', this, ax, ay);
    }
  }

  heal(amount: number): number {
    if (!this.alive || this.health >= this.maxHealth) return 0;
    const prev = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - prev;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    // Phase Shift: invulnerable while shifted
    if (this.phaseShiftActive) return false;
    // Iron Warden hero invulnerability: absorb all damage
    if (this.heroInvulnActive) return false;
    // Aegis Shield: completely invulnerable for duration
    if (this.isAegisShielded) return false;
    // Shield Wall: 20% damage reduction (passive adjacency bonus)
    // Fortify: reduce incoming damage by 33% (equivalent to +50% effective armor)
    // Fortified Ground: 10% reduction when stood still for 3+ seconds
    const mitigated = this.shieldWallActive        ? Math.ceil(amount * 0.8)
                    : this.fortifyActive            ? Math.ceil(amount * 0.67)
                    : this._fortifiedGroundActive   ? Math.ceil(amount * 0.9)
                    : amount;
    const effective = Math.max(1, mitigated - (this.armor + this.zoneArmorBonus));
    this.health = Math.max(0, this.health - effective);
    // Notify scene if a player unit was attacked
    if (this.faction === 'player') {
      this.scene.events.emit('player:underAttack', this.sprite.x, this.sprite.y);
    }
    // Minimap combat flash
    this.scene.events.emit('unit:damaged', this);

    // Hit flash — brief white burst at unit position
    const flash = this.scene.add.ellipse(this.sprite.x, this.sprite.y, 30, 30, 0xffffff, 0.55).setDepth(25);
    this.scene.tweens.add({
      targets: flash, alpha: 0, scaleX: 1.6, scaleY: 1.6,
      duration: 160, ease: 'Power2',
      onComplete: () => flash.destroy(),
    });

    if (this.health === 0) {
      this.alive = false;
      this.onDeath();
    }
    return !this.alive;
  }

  private onDeath(): void {
    this.scene.events.emit('unit:died', this);
    // Kill any in-progress sprite tweens (e.g. mine-entry animation) so they
    // don't fight the death animation that follows.
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setScale(1).setAlpha(0.3).setTint(0x888888);
    this.shadow.setVisible(false);
    this.selectionCircle.setVisible(false);
    this.healthBarBg.setVisible(false);
    this.healthBar.setVisible(false);
    if (this._upgradeBadges) { this._upgradeBadges.setVisible(false); }

    // Clean up wounded tween
    if (this._woundedTween) {
      this.scene.tweens.remove(this._woundedTween);
      this._woundedTween = null;
      this.sprite.clearTint();
    }

    // Clean up ability visuals
    if (this.overchargeGlow) { this.scene.tweens.killTweensOf(this.overchargeGlow); this.overchargeGlow.destroy(); this.overchargeGlow = null; }
    if (this.shieldRing) { this.scene.tweens.killTweensOf(this.shieldRing); this.shieldRing.destroy(); this.shieldRing = null; }
    if (this._veterancyStar) { this._veterancyStar.destroy(); this._veterancyStar = null; }
    if (this._phaseShiftRing) { this.scene.tweens.killTweensOf(this._phaseShiftRing); this._phaseShiftRing.destroy(); this._phaseShiftRing = null; }
    this.phaseShiftActive = false;
    if (this.stasisGfx) { this.scene.tweens.killTweensOf(this.stasisGfx); this.stasisGfx.destroy(); this.stasisGfx = null; }
    if (this._siegeTransitionGfx) { this.scene.tweens.killTweensOf(this._siegeTransitionGfx); this._siegeTransitionGfx.destroy(); this._siegeTransitionGfx = null; }
    if (this._detectorRing) { this.scene.tweens.killTweensOf(this._detectorRing); this._detectorRing.destroy(); this._detectorRing = null; }
    if (this._detectedOutline) { this._detectedOutline.destroy(); this._detectedOutline = null; }
    if (this._crownLabel) { this._crownLabel.destroy(); this._crownLabel = null; }
    if (this._heroInvulnRing) { this.scene.tweens.killTweensOf(this._heroInvulnRing); this._heroInvulnRing.destroy(); this._heroInvulnRing = null; }
    this.heroInvulnActive = false;
    // Bulwark fortify visuals leak if not cleaned up — update() returns early for dead units
    if (this.fortifyActive) this.deactivateFortify();
    if (this._fortifiedGroundRing) { this._fortifiedGroundRing.destroy(); this._fortifiedGroundRing = null; this._fortifiedGroundActive = false; }
    // On Fire glow: update() returns early for dead units so deactivateOnFire() never fires
    if (this.onFireGlow) { this.scene.tweens.killTweensOf(this.onFireGlow); this.onFireGlow.destroy(); this.onFireGlow = null; }
    this.onFireActive = false;
    // Last Stand aura: update() returns early for dead units so cleanup must happen here
    if (this._lastStandAura) { this.scene.tweens.killTweensOf(this._lastStandAura); this._lastStandAura.destroy(); this._lastStandAura = null; }
    this.lastStandActive = false;

    // ── Death animation variant (random) ─────────────────────────────────────
    const variant = Math.floor(Math.random() * 3);
    const sx = this.sprite.x;
    const sy = this.sprite.y;

    if (variant === 0) {
      // Explosion: orange/red particle burst
      const count = 10 + Math.floor(Math.random() * 6);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const radius = 20 + Math.random() * 22;
        const px = sx + Math.cos(angle) * radius;
        const py = sy + Math.sin(angle) * radius;
        const col = Math.random() < 0.6 ? 0xff6600 : 0xff2200;
        const dot = this.scene.add.circle(sx, sy, 2 + Math.random() * 3, col, 0.95).setDepth(25);
        this.scene.tweens.add({
          targets: dot, x: px, y: py, alpha: 0, scale: 0.1,
          duration: 350 + Math.random() * 250, ease: 'Power2',
          onComplete: () => dot.destroy(),
        });
      }
      // Central flash
      const flash = this.scene.add.circle(sx, sy, 12, 0xffcc44, 0.8).setDepth(26);
      this.scene.tweens.add({
        targets: flash, scaleX: 2.5, scaleY: 2.5, alpha: 0,
        duration: 280, ease: 'Power2', onComplete: () => flash.destroy(),
      });
      this.scene.tweens.add({ targets: this.sprite, alpha: 0, duration: 200, onComplete: () => this.sprite.setVisible(false) });

    } else if (variant === 1) {
      // Collapse: shrink to 0 scale while fading
      this.scene.tweens.add({
        targets: this.sprite, scaleX: 0, scaleY: 0, alpha: 0,
        duration: 500, ease: 'Back.easeIn',
        onComplete: () => this.sprite.setVisible(false),
      });
      // Dust puff
      for (let i = 0; i < 5; i++) {
        const ox = (Math.random() - 0.5) * 20;
        const oy = (Math.random() - 0.5) * 20;
        const dust = this.scene.add.circle(sx + ox, sy + oy, 3 + Math.random() * 3, 0x888888, 0.6).setDepth(25);
        this.scene.tweens.add({
          targets: dust, y: sy + oy - 20, alpha: 0, scaleX: 2, scaleY: 2,
          duration: 450 + Math.random() * 200, ease: 'Power1', onComplete: () => dust.destroy(),
        });
      }

    } else {
      // Shatter: 4 pieces fly apart
      const w = this.sprite.displayWidth / 2;
      const h = this.sprite.displayHeight / 2;
      const quadrants = [
        { ox: -w * 0.35, oy: -h * 0.35, tx: -30 - Math.random() * 20, ty: -25 - Math.random() * 15 },
        { ox:  w * 0.35, oy: -h * 0.35, tx:  30 + Math.random() * 20, ty: -25 - Math.random() * 15 },
        { ox: -w * 0.35, oy:  h * 0.35, tx: -25 - Math.random() * 15, ty:  30 + Math.random() * 20 },
        { ox:  w * 0.35, oy:  h * 0.35, tx:  25 + Math.random() * 15, ty:  30 + Math.random() * 20 },
      ];
      const tint = this.faction === 'player' ? 0x55aaff : 0xff5533;
      quadrants.forEach(({ ox, oy, tx, ty }) => {
        const piece = this.scene.add.rectangle(sx + ox, sy + oy, w * 0.9, h * 0.9, tint, 0.85).setDepth(25);
        this.scene.tweens.add({
          targets: piece, x: sx + ox + tx, y: sy + oy + ty,
          alpha: 0, angle: (Math.random() - 0.5) * 180,
          duration: 480 + Math.random() * 200, ease: 'Power2',
          onComplete: () => piece.destroy(),
        });
      });
      this.scene.tweens.add({ targets: this.sprite, alpha: 0, duration: 120, onComplete: () => this.sprite.setVisible(false) });
    }
  }

  isAlive(): boolean { return this.alive; }
  isMoving(): boolean { return this.state === 'moving'; }
  isAttacking(): boolean { return this.state === 'attacking'; }

  // ── Stealth (Phantom) ────────────────────────────────────────────────────────

  canStealth(): boolean {
    return this.unitTypeId === 'phantom' && this.stealthCooldownRemaining <= 0 && !this.isStealthed;
  }

  activateStealth(): void {
    this.isStealthed = true;
    this.stealthDurationRemaining = 6000;
    this.stealthCooldownRemaining = 20000;
    this.sprite.setAlpha(0.18);
  }

  private deactivateStealth(): void {
    this.isStealthed = false;
    this.stealthDurationRemaining = 0;
    this.sprite.setAlpha(1.0);
  }

  // ── Detector ─────────────────────────────────────────────────────────────────

  /** Call after setting isDetector = true to draw the dashed detection radius ring. */
  buildDetectorRing(): void {
    if (this._detectorRing) return;
    const g = this.scene.add.graphics().setDepth(9);
    this._detectorRing = g;
    this._redrawDetectorRing();
    // Pulse the ring
    this.scene.tweens.add({
      targets: g, alpha: { from: 0.55, to: 0.18 },
      duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private _redrawDetectorRing(): void {
    const g = this._detectorRing;
    if (!g) return;
    g.clear();
    const { x, y } = this.getPosition();
    const r = this.DETECTION_RADIUS_PX;
    const segments = 24;
    g.lineStyle(1.5, 0xff2222, 1);
    for (let i = 0; i < segments; i++) {
      if (i % 2 === 0) continue; // alternating gaps
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 0.85) / segments) * Math.PI * 2;
      g.beginPath();
      g.arc(x, y, r, a0, a1, false);
      g.strokePath();
    }
  }

  /** Update dashed ring position each frame (called by GameScene). */
  updateDetectorRing(): void {
    if (!this._detectorRing || !this.isAlive()) return;
    this._redrawDetectorRing();
  }

  /** Show/hide red detection outline on this unit (when revealed by a detector). */
  setDetectedVisual(detected: boolean): void {
    if (detected) {
      if (!this._detectedOutline) {
        this._detectedOutline = this.scene.add.graphics().setDepth(11);
      }
      const { x, y } = this.getPosition();
      const g = this._detectedOutline;
      g.clear();
      g.lineStyle(2, 0xff2222, 0.9);
      g.strokeRect(x - 10, y - 10, 20, 20);
    } else {
      this._detectedOutline?.destroy();
      this._detectedOutline = null;
    }
  }

  // ── Fog-of-war visibility ────────────────────────────────────────────────────

  /**
   * Called by GameScene.updateFogVisibility() each time the fog state changes for
   * this unit.  Unlike setting `fogVisible` directly, this method immediately
   * applies the visual change so there is never a one-frame lag where an enemy
   * sprite is visible after the fog computation decides it should be hidden.
   *
   * Fade-in (300 ms) plays when the unit first enters the player's vision so the
   * reveal feels intentional.  Hide is instant — enemies vanish the moment they
   * leave sight range, matching the minimap dot behaviour.
   */
  applyFogVisibility(visible: boolean): void {
    const wasVisible = this.fogVisible;
    this.fogVisible = visible;

    if (!visible) {
      // Kill any fade-in tween that might be in progress, then hide immediately.
      this.scene.tweens.killTweensOf(this.sprite);
      this.sprite.setVisible(false).setAlpha(1); // reset alpha so next reveal fades correctly
      this.shadow.setVisible(false);
      this.selectionCircle.setVisible(false);
      this.healthBarBg.setVisible(false);
      this.healthBar.setVisible(false);
      if (this.shieldRing)       this.shieldRing.setVisible(false);
      if (this.overchargeGlow)   this.overchargeGlow.setVisible(false);
      if (this._veterancyStar)   this._veterancyStar.setVisible(false);
      if (this.stasisGfx)        this.stasisGfx.setVisible(false);
      if (this._crownLabel)      this._crownLabel.setVisible(false);
      if (this._heroInvulnRing)  this._heroInvulnRing.setVisible(false);
      if (this._phaseShiftRing)  this._phaseShiftRing.setVisible(false);
    } else if (!wasVisible) {
      // Unit just entered vision range — fade sprite in from transparent.
      this.scene.tweens.killTweensOf(this.sprite);
      this.shadow.setVisible(true);
      this.sprite.setAlpha(0).setVisible(true);
      this.scene.tweens.add({
        targets: this.sprite,
        alpha: 1,
        duration: 300,
        ease: 'Power1',
      });
      if (this.stasisGfx) this.stasisGfx.setVisible(true);
    }
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  update(delta: number): void {
    if (!this.alive) return;

    // ── Off-screen early-out: skip expensive visuals for off-screen units ────────
    const _cam = this.scene.cameras.main;
    const _screenX = this.sprite.x - _cam.scrollX;
    const _screenY = this.sprite.y - _cam.scrollY;
    const _offScreen = _screenX < -200 || _screenX > _cam.width + 200
                    || _screenY < -200 || _screenY > _cam.height + 200;

    // ── Wounded state (below 25% HP) ─────────────────────────────────────────
    const hpRatio = this.health / this.maxHealth;
    if (!this._wounded && hpRatio < 0.25) {
      this._wounded = true;
      this.speed = this._baseSpeed * 0.8;
      if (this.stance === 'aggressive') {
        this.setStance('defensive');
      }
      if (!this._woundedTween) {
        this._woundedTween = this.scene.tweens.add({
          targets: this.sprite,
          tint: { from: 0xff4444, to: 0xffffff },
          duration: 280,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } else if (this._wounded && hpRatio >= 0.25) {
      this._wounded = false;
      this.speed = this._baseSpeed;
      if (this._woundedTween) {
        this.scene.tweens.remove(this._woundedTween);
        this._woundedTween = null;
        this.sprite.clearTint();
      }
    }

    // ── Last Stand (below 15% HP: +50% damage on attack, +20% speed, bright red aura) ───
    const lastStandThreshold = 0.15;
    if (!this.lastStandActive && hpRatio < lastStandThreshold && hpRatio > 0) {
      this.lastStandActive = true;
      // Speed surge overrides the wounded speed penalty
      this.speed = this._baseSpeed * 1.2;
      if (!this._lastStandAura) {
        this._lastStandAura = this.scene.add.arc(
          this.sprite.x, this.sprite.y, 18, 0, 360, false, 0xff2200, 0
        ).setDepth(13).setStrokeStyle(3, 0xff0000, 1).setAlpha(0);
        this.scene.tweens.add({
          targets: this._lastStandAura,
          alpha: 0.4,
          scale: 1.3,
          duration: 180,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } else if (this.lastStandActive && hpRatio >= lastStandThreshold) {
      // Healed back above threshold
      this.lastStandActive = false;
      this.speed = this._baseSpeed * (this._wounded ? 0.8 : 1.0);
      if (this._lastStandAura) {
        this.scene.tweens.killTweensOf(this._lastStandAura);
        this._lastStandAura.destroy();
        this._lastStandAura = null;
      }
    }
    // Sync Last Stand aura position with sprite
    if (this._lastStandAura) {
      this._lastStandAura.setPosition(this.sprite.x, this.sprite.y);
      this._lastStandAura.setVisible(this.fogVisible && !_offScreen);
    }

    // ── Stasis: completely freeze movement and attacks ────────────────────────
    if (this.isStasised) {
      this.stasisRemaining -= delta;
      if (this.stasisGfx && this.fogVisible) {
        this.stasisGfx.setPosition(this.sprite.x, this.sprite.y).setVisible(true);
      }
      if (this.stasisRemaining <= 0) {
        this.isStasised = false;
        this.stasisRemaining = 0;
        if (this.stasisGfx) {
          const g = this.stasisGfx;
          this.stasisGfx = null;
          this.scene.tweens.killTweensOf(g);
          this.scene.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
        }
      } else {
        // Still frozen: update visual positions but skip all movement / combat
        this.shadow.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 2);
        this.selectionCircle.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 4);
        if (this._veterancyStar) this._veterancyStar.setPosition(this.sprite.x, this.sprite.y - 28);
        return;
      }
    }
    // Stasis cooldown tick (for Arbiter casters)
    if (this.stasisCooldownRemaining > 0) {
      this.stasisCooldownRemaining = Math.max(0, this.stasisCooldownRemaining - delta);
    }

    // ── EMP Stun: freeze movement and attacks (like stasis but no visual here — handled in GameScene) ──
    if (this.isEmpStunned) {
      this.empStunRemaining -= delta;
      if (this.empStunRemaining <= 0) {
        this.isEmpStunned = false;
        this.empStunRemaining = 0;
      } else {
        this.shadow.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 2);
        this.selectionCircle.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 4);
        if (this._veterancyStar) this._veterancyStar.setPosition(this.sprite.x, this.sprite.y - 28);
        return;
      }
    }

    // Hero cooldown tick
    if (this.heroAbilityCooldownRemaining > 0) {
      this.heroAbilityCooldownRemaining = Math.max(0, this.heroAbilityCooldownRemaining - delta);
    }
    // Hero invulnerability timer (Iron Warden)
    if (this.heroInvulnActive) {
      this.heroInvulnTimer -= delta;
      if (this._heroInvulnRing && this.fogVisible) this._heroInvulnRing.setPosition(this.sprite.x, this.sprite.y);
      if (this.heroInvulnTimer <= 0) {
        this.heroInvulnActive = false;
        if (this._heroInvulnRing) {
          const r = this._heroInvulnRing;
          this._heroInvulnRing = null;
          this.scene.tweens.killTweensOf(r);
          this.scene.tweens.add({ targets: r, alpha: 0, duration: 300, onComplete: () => r.destroy() });
        }
      }
    }

    // Stealth timers
    if (this.isStealthed) {
      if (!this.permanentlyCloaked) this.stealthDurationRemaining -= delta;
      if (this.stealthDurationRemaining <= 0 && !this.permanentlyCloaked) this.deactivateStealth();
    }
    if (this.stealthCooldownRemaining > 0) {
      this.stealthCooldownRemaining = Math.max(0, this.stealthCooldownRemaining - delta);
    }

    // Overcharge cooldown tick
    if (this.overchargeCooldownRemaining > 0) {
      this.overchargeCooldownRemaining = Math.max(0, this.overchargeCooldownRemaining - delta);
    }

    // Divine Pulse cooldown tick
    if (this.divinePulseCooldownRemaining > 0) {
      this.divinePulseCooldownRemaining = Math.max(0, this.divinePulseCooldownRemaining - delta);
    }

    // Holy Nova cooldown tick
    if (this.holyNovaCooldownRemaining > 0) {
      this.holyNovaCooldownRemaining = Math.max(0, this.holyNovaCooldownRemaining - delta);
    }

    // Holy Nova V cooldown tick
    if (this.holyNovaVCooldownRemaining > 0) {
      this.holyNovaVCooldownRemaining = Math.max(0, this.holyNovaVCooldownRemaining - delta);
    }

    // Shadow Step cooldown tick
    if (this.shadowStepCooldownRemaining > 0) {
      this.shadowStepCooldownRemaining = Math.max(0, this.shadowStepCooldownRemaining - delta);
    }

    // Assassinate cooldown tick
    if (this.assassinateCooldown > 0) {
      this.assassinateCooldown = Math.max(0, this.assassinateCooldown - delta);
    }

    // Divine Wrath cooldown tick
    if (this.divineWrathCooldown > 0) {
      this.divineWrathCooldown = Math.max(0, this.divineWrathCooldown - delta);
    }

    // Iron Bastion cooldown tick
    if (this.ironBastionCooldown > 0) {
      this.ironBastionCooldown = Math.max(0, this.ironBastionCooldown - delta);
    }

    // Phase Shift timer + cooldown
    if (this.phaseShiftActive) {
      this.phaseShiftTimer -= delta;
      if (this._phaseShiftRing && this.fogVisible) {
        this._phaseShiftRing.setPosition(this.sprite.x, this.sprite.y).setVisible(true);
      }
      if (this.phaseShiftTimer <= 0) {
        this.deactivatePhaseShift();
      } else {
        // Frozen: update positions but skip all movement / combat
        this.shadow.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 2);
        this.selectionCircle.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 4);
        if (this._veterancyStar) this._veterancyStar.setPosition(this.sprite.x, this.sprite.y - 28);
        return;
      }
    }
    if (this.phaseShiftCooldownRemaining > 0) {
      this.phaseShiftCooldownRemaining = Math.max(0, this.phaseShiftCooldownRemaining - delta);
    }

    // Shadow Clone cooldown tick
    if (this.shadowCloneCooldownRemaining > 0) {
      this.shadowCloneCooldownRemaining = Math.max(0, this.shadowCloneCooldownRemaining - delta);
    }

    // Reconstruction Protocol timer + cooldown tick
    if (this.repairModeActive) {
      this.repairModeTimer -= delta;
      if (this.repairModeTimer <= 0) {
        this.repairModeActive = false;
        this.repairModeTimer = 0;
      }
    }
    if (this.repairModeCooldownRemaining > 0) {
      this.repairModeCooldownRemaining = Math.max(0, this.repairModeCooldownRemaining - delta);
    }

    // Sacred Ground cooldown tick
    if (this.sacredGroundCooldownRemaining > 0) {
      this.sacredGroundCooldownRemaining = Math.max(0, this.sacredGroundCooldownRemaining - delta);
    }

    // Shield Wall timers
    if (this.shieldWallActive) {
      if (!this.shieldWallIsPassive) {
        this.shieldWallTimer -= delta;
        if (this.shieldWallTimer <= 0) this.deactivateShieldWall();
      }
      if (this.shieldRing) this.shieldRing.setPosition(this.sprite.x, this.sprite.y);
    }
    if (this.shieldWallCooldownRemaining > 0) {
      this.shieldWallCooldownRemaining = Math.max(0, this.shieldWallCooldownRemaining - delta);
    }

    // Fortify timer (Bulwark — immobile, +armor, +attack speed for 20s)
    if (this.fortifyActive) {
      this.fortifyTimer -= delta;
      this.stopMoving();
      if (this._fortifyShieldIcon) this._fortifyShieldIcon.setPosition(this.sprite.x, this.sprite.y - 34);
      if (this._fortifyTimerText) {
        this._fortifyTimerText.setPosition(this.sprite.x, this.sprite.y - 20);
        this._fortifyTimerText.setText(`${Math.ceil(this.fortifyTimer / 1000)}s`);
      }
      if (this.fortifyTimer <= 0) this.deactivateFortify();
    }

    // ── Fortified Ground (Bulwark passive) ────────────────────────────────────
    if (this.isBulwarkUnit && !this.isWorker && !this.fortifyActive) {
      const isMoving = this.path.length > 0 || this.state === 'moving';
      if (isMoving) {
        this._fortifiedGroundTimer = 0;
        if (this._fortifiedGroundActive) {
          this._fortifiedGroundActive = false;
          if (this._fortifiedGroundRing) {
            const r = this._fortifiedGroundRing;
            this._fortifiedGroundRing = null;
            this.scene.tweens.add({ targets: r, alpha: 0, duration: 400, onComplete: () => r.destroy() });
          }
        }
      } else {
        this._fortifiedGroundTimer += delta;
        if (!this._fortifiedGroundActive && this._fortifiedGroundTimer >= 3000) {
          this._fortifiedGroundActive = true;
          this._fortifiedGroundRing = this.scene.add.arc(
            this.sprite.x, this.sprite.y, 20, 0, 360, false, 0x7a5c2e, 0
          ).setDepth(8.4).setStrokeStyle(2, 0x8b6914, 0.55);
          this.scene.tweens.add({
            targets: this._fortifiedGroundRing, alpha: 0.55, duration: 600, ease: 'Power1',
          });
        }
        if (this._fortifiedGroundRing) {
          this._fortifiedGroundRing.setPosition(this.sprite.x, this.sprite.y);
          this._fortifiedGroundRing.setVisible(this.fogVisible);
        }
      }
    }

    // ── Control group badge ────────────────────────────────────────────────────
    if (this.faction === 'player' && this.controlGroupNumber !== null && !this.isGarrisoned) {
      if (!this._controlGroupBadge) {
        this._controlGroupBadge = this.scene.add.text(
          this.sprite.x - 10, this.sprite.y + 8,
          String(this.controlGroupNumber),
          { fontSize: '9px', color: '#000000', backgroundColor: '#ffffff',
            padding: { x: 2, y: 1 }, fontStyle: 'bold' }
        ).setOrigin(0.5).setDepth(16);
      }
      this._controlGroupBadge.setText(String(this.controlGroupNumber));
      this._controlGroupBadge.setPosition(this.sprite.x - 10, this.sprite.y + 8);
      this._controlGroupBadge.setVisible(this.fogVisible && this.alive);
    } else if (this._controlGroupBadge) {
      this._controlGroupBadge.setVisible(false);
    }

    // Waypoint queue visualisation — dots + lines drawn when selected.
    // Only clear/redraw when there is something to show or previously was something shown.
    const needsWaypoints = !_offScreen && this.fogVisible && this.isSelected && this.orderQueue.length > 0;
    if (needsWaypoints) {
      this.waypointGfx.clear();
      this.waypointGfx.lineStyle(1.5, 0x44ff88, 0.45);
      let prevX = this.sprite.x;
      let prevY = this.sprite.y;
      for (const order of this.orderQueue) {
        const wx = order.tileX * TILE_SIZE + TILE_SIZE / 2;
        const wy = order.tileY * TILE_SIZE + TILE_SIZE / 2;
        this.waypointGfx.beginPath();
        this.waypointGfx.moveTo(prevX, prevY);
        this.waypointGfx.lineTo(wx, wy);
        this.waypointGfx.strokePath();
        this.waypointGfx.fillStyle(0x44ff88, 0.85);
        this.waypointGfx.fillCircle(wx, wy, 4);
        prevX = wx; prevY = wy;
      }
      this._hadWaypoints = true;
    } else if (this._hadWaypoints) {
      this.waypointGfx.clear();
      this._hadWaypoints = false;
    }

    // Fog-of-war: hide all visuals when not in vision range
    if (!this.fogVisible) {
      this.sprite.setVisible(false);
      this.shadow.setVisible(false);
      this.selectionCircle.setVisible(false);
      this.healthBarBg.setVisible(false);
      this.healthBar.setVisible(false);
      if (this.shieldRing)      this.shieldRing.setVisible(false);
      if (this.overchargeGlow)  this.overchargeGlow.setVisible(false);
      if (this._veterancyStar)  this._veterancyStar.setVisible(false);
      if (this._crownLabel)     this._crownLabel.setVisible(false);
      if (this._heroInvulnRing) this._heroInvulnRing.setVisible(false);
      // Still allow movement/combat state to advance
    } else {
      this.sprite.setVisible(true);
      this.shadow.setVisible(true);
      if (this.shieldRing)     this.shieldRing.setVisible(true);
      if (this.overchargeGlow) {
        this.overchargeGlow.setVisible(true);
        this.overchargeGlow.setPosition(this.sprite.x, this.sprite.y);
      }
      // Keep veterancy star positioned above unit
      if (this._veterancyStar) {
        this._veterancyStar.setVisible(true);
        this._veterancyStar.setPosition(this.sprite.x, this.sprite.y - 28);
      }
      // Crown (hero units)
      if (this._crownLabel) {
        this._crownLabel.setVisible(true);
        this._crownLabel.setPosition(this.sprite.x, this.sprite.y - 38);
      }
      if (this._heroInvulnRing) this._heroInvulnRing.setVisible(true);
    }

    // Sync shadow position (always, even when hidden, so it snaps on reveal)
    this.shadow.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 2);

    // Sync health bar — only when fog-visible
    const showBar = this.fogVisible && this.health < this.maxHealth;
    this.healthBarBg.setPosition(this.sprite.x, this.sprite.y - 20).setVisible(showBar);
    this.healthBar.setPosition(this.sprite.x - 13, this.sprite.y - 20).setVisible(showBar);
    // Only recalculate width and colour when health has actually changed
    if (showBar && this.health !== this._lastRenderedHealth) {
      const pct = this.health / this.maxHealth;
      this.healthBar.width = 26 * pct;
      this.healthBar.setFillStyle(pct > 0.6 ? 0x44ff44 : pct > 0.3 ? 0xffcc00 : 0xff4444);
      this._lastRenderedHealth = this.health;
    }

    // Sync XP bar — show for player units only, fills toward next veterancy rank
    const showXp = this.fogVisible && this.faction === 'player' && this.veterancyLevel < 2;
    this.xpBarBg.setPosition(this.sprite.x, this.sprite.y - 14).setVisible(showXp);
    this.xpBar.setPosition(this.sprite.x - 10, this.sprite.y - 14).setVisible(showXp);
    if (showXp) {
      // XP progress: level 0 → need 3 kills; level 1 → need 3 more kills
      const killsInLevel = this.veterancyLevel === 0 ? this.killCount : this.killCount - 3;
      const xpPct = Math.min(1, killsInLevel / 3);
      this.xpBar.width = 20 * xpPct;
    }

    // Upgrade badge diamonds — drawn below health bar, hidden in fog or off-screen
    if (this._upgradeBadges) {
      const totalBadges = this.attackUpgrades + this.armorUpgrades;
      if (totalBadges > 0 && this.fogVisible && !_offScreen) {
        this._upgradeBadges.clear();
        const badgeY = this.sprite.y - 27;  // below health bar
        const DIAM = 4;   // half-size of diamond (full = 8px)
        const GAP  = 10;  // spacing between diamonds
        const startX = this.sprite.x - ((totalBadges - 1) * GAP) / 2;
        let idx = 0;
        // Attack diamonds (orange/gold)
        this._upgradeBadges.fillStyle(0xff9900, 1);
        for (let i = 0; i < this.attackUpgrades; i++, idx++) {
          const cx = startX + idx * GAP;
          this._upgradeBadges.fillTriangle(
            cx,        badgeY - DIAM,
            cx + DIAM, badgeY,
            cx,        badgeY + DIAM
          );
          this._upgradeBadges.fillTriangle(
            cx,        badgeY - DIAM,
            cx - DIAM, badgeY,
            cx,        badgeY + DIAM
          );
        }
        // Armor diamonds (blue/silver)
        this._upgradeBadges.fillStyle(0x44aaff, 1);
        for (let i = 0; i < this.armorUpgrades; i++, idx++) {
          const cx = startX + idx * GAP;
          this._upgradeBadges.fillTriangle(
            cx,        badgeY - DIAM,
            cx + DIAM, badgeY,
            cx,        badgeY + DIAM
          );
          this._upgradeBadges.fillTriangle(
            cx,        badgeY - DIAM,
            cx - DIAM, badgeY,
            cx,        badgeY + DIAM
          );
        }
        this._upgradeBadges.setVisible(true);
      } else {
        this._upgradeBadges.setVisible(false);
      }
    }

    // Selection circle — only when fog-visible
    this.selectionCircle.setPosition(this.sprite.x, this.sprite.y + TILE_SIZE / 2 - 4);
    if (!this.fogVisible) this.selectionCircle.setVisible(false);

    // Siege mode transition tick (Siege Crawler)
    if (this.unitTypeId === 'siege_crawler') {
      this.tickSiegeMode(delta);
      // In siege mode the unit is immobile
      if (this.siegeModeActive || this.siegeModeTransitioning) {
        this.stopMoving();
      }
      // Sync transition ring position
      if (this._siegeTransitionGfx) {
        this._siegeTransitionGfx.setPosition(this.sprite.x, this.sprite.y);
      }
    }

    // Tick On Fire timer
    if (this.onFireActive) {
      this.onFireTimer -= delta;
      if (this.onFireTimer <= 0) {
        this.deactivateOnFire();
      } else if (this.onFireGlow) {
        this.onFireGlow.setPosition(this.sprite.x, this.sprite.y);
      }
    }

    if (this.state === 'attacking') {
      // Retreating units don't attack — break off and keep running
      if (this.isRetreating) { this.endAttack(); return; }
      // Siege Crawler in siege mode can't attack while transitioning
      if (this.unitTypeId === 'siege_crawler' && this.siegeModeTransitioning) return;

      // Face the attack target so the sprite doesn't shoot backward.
      if (this.attackTarget?.isAlive()) {
        this.sprite.setFlipX(this.attackTarget.sprite.x < this.sprite.x);
      }

      const onFireBonus   = this.onFireActive   ? 1.15 : 1.0;
      const fortifyBonus  = this.fortifyActive  ? 1.5  : 1.0;
      this.attackTimer += delta * this.attackSpeedMultiplier * onFireBonus * fortifyBonus;
      if (this.attackTimer >= this.attackCooldownMs) {
        this.attackTimer = 0;
        if (this.attackTarget?.isAlive()) {
          if (this.unitTypeId === 'colossus') {
            // Thermal beam: scene handles line-AoE damage + visual (no projectile)
            this.scene.events.emit('unit:colossusBeam', this, this.attackTarget);
            // Still credit a kill if the primary target dies — scene will handle it
          } else {
            // Overcharge: triple damage on the first shot after activation
            let dmg = this.overchargeReady ? this.attackDamage * 3 : this.attackDamage;
            if (this.overchargeReady) this.fireOvercharge();
            // Uphill penalty: -1 damage when shooting from low ground to high ground
            if (!this.isOnHighGround && this.attackTarget.isOnHighGround) dmg = Math.max(1, dmg - 1);
            const killed = this.attackTarget.takeDamage(dmg);
            this.scene.events.emit('unit:attacked', this, this.attackTarget);
            // Void Reaver drain — convert 50% of damage dealt into juice
            if (this.unitTypeId === 'void_reaver' && this.faction === 'player') {
              this.scene.events.emit('unit:voidDrain', dmg, this.getPosition().x, this.getPosition().y);
            }
            if (killed) {
              if (this.isUnseenUnit && this.faction === 'player') {
                const kp = this.attackTarget.getPosition();
                this.scene.events.emit('unit:voidRiftKill', kp.x, kp.y);
              }
              this.recordKill();
            }
            // Siege Crawler siege-mode splash
            if (this.unitTypeId === 'siege_crawler' && this.siegeModeActive) {
              this.scene.events.emit('unit:siegeSplash', this, this.attackTarget.getPosition().x, this.attackTarget.getPosition().y);
            }
          }
        }
      }
      return;
    }

    // ── Retreat movement ────────────────────────────────────────────────────────
    if (this.isRetreating) {
      const dx = this.retreatHQX - this.sprite.x;
      const dy = this.retreatHQY - this.sprite.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= this.RETREAT_STOP_DIST_SQ) {
        // Arrived near HQ
        this.isRetreating = false;
        this.state = 'idle';
        return;
      }
      const dist = Math.sqrt(distSq);
      const step = this.speed * this.RETREAT_SPEED_MULT * this.moveSpeedMultiplier * (delta / 1000);
      this.sprite.x += (dx / dist) * step;
      this.sprite.y += (dy / dist) * step;
      this.sprite.setFlipX(dx < 0);
      this.state = 'moving';
      return;
    }

    if (this.state !== 'moving' || this.path.length === 0) return;

    // Movement dust trail
    this.moveDustTimer -= delta;
    if (this.moveDustTimer <= 0) {
      this.moveDustTimer = 180;
      const dust = this.scene.add.circle(
        this.sprite.x + (Math.random() - 0.5) * 8,
        this.sprite.y + TILE_SIZE / 3,
        1.5, 0xaaaaaa, 0.3
      ).setDepth(8);
      this.scene.tweens.add({
        targets: dust, y: dust.y + 5, alpha: 0, scaleX: 1.8, scaleY: 1.8,
        duration: 280, ease: 'Power1',
        onComplete: () => dust.destroy(),
      });
    }

    const target = this.path[this.currentStep];
    const targetWorldX = target.x * TILE_SIZE + TILE_SIZE / 2;
    const targetWorldY = target.y * TILE_SIZE + TILE_SIZE / 2;
    const dx = targetWorldX - this.sprite.x;
    const dy = targetWorldY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = this.speed * this.moveSpeedMultiplier * (delta / 1000);

    // Stuck detection: if we've been trying to reach this waypoint for more
    // than 800 ms without arriving (e.g. a building was placed on the path),
    // skip it and try the next step rather than spinning in place.
    this._stepTimer += delta;
    if (this._stepTimer > 800 && dist > step) {
      this._stepTimer = 0;
      this.currentStep++;
      if (this.currentStep >= this.path.length) {
        this.state = 'idle';
        this.path = [];
        this.moveDest = null;
        const cb = this.onArrivedCallback;
        this.onArrivedCallback = null;
        cb?.();
      }
      return;
    }

    if (dist <= step) {
      this._stepTimer = 0;
      this.sprite.setPosition(targetWorldX, targetWorldY);
      this.currentStep++;
      if (this.currentStep >= this.path.length) {
        this.state = 'idle';
        this.path = [];
        this.moveDest = null;
        const cb = this.onArrivedCallback;
        this.onArrivedCallback = null;
        cb?.();
        // Resume patrol if active
        if (this.isPatrolling) {
          this.onPatrolArrived();
          return;
        }
        // Advance through order queue if any waypoints remain
        this.consumeNextOrder();
      }
    } else {
      this.sprite.x += (dx / dist) * step;
      this.sprite.y += (dy / dist) * step;
      this.sprite.setFlipX(dx < 0);
    }
  }

  // ── Selection / helpers ──────────────────────────────────────────────────────

  /** Returns the selection ring colour for this unit's race. */
  private getRaceSelectionColor(): number {
    switch (this.unitRace) {
      case 'covenant':   return 0xffdd00;
      case 'architects': return 0x00ccff;
      case 'unseen':     return 0xaa44ff;
      case 'bulwark':    return 0xff6600;
      default:           return 0x00ff88;
    }
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    if (selected && this.alive) {
      this.selectionCircle.setVisible(true);
      this.updateStanceIndicator();
      // Visual sound cue: white ring pulse on selection
      this.scene.events.emit('unit:selected', this);
    } else {
      this.selectionCircle.setVisible(false);
      // Reset to race colour when deselected
      this.selectionCircle.setFillStyle(this.getRaceSelectionColor(), 0.6);
    }
  }

  getCurrentTile(): { tileX: number; tileY: number } {
    return {
      tileX: Math.floor(this.sprite.x / TILE_SIZE),
      tileY: Math.floor(this.sprite.y / TILE_SIZE),
    };
  }

  getPosition(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  distanceTo(other: Unit): number {
    const dx = other.sprite.x - this.sprite.x;
    const dy = other.sprite.y - this.sprite.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  distanceToPoint(wx: number, wy: number): number {
    const dx = wx - this.sprite.x;
    const dy = wy - this.sprite.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.selectionCircle.destroy();
    this.healthBarBg.destroy();
    this.healthBar.destroy();
    this.xpBarBg.destroy();
    this.xpBar.destroy();
    if (this.overchargeGlow) { this.scene.tweens.killTweensOf(this.overchargeGlow); this.overchargeGlow.destroy(); }
    if (this.shieldRing) { this.scene.tweens.killTweensOf(this.shieldRing); this.shieldRing.destroy(); }
    this._veterancyStar?.destroy();
    if (this._siegeTransitionGfx) { this.scene.tweens.killTweensOf(this._siegeTransitionGfx); this._siegeTransitionGfx.destroy(); }
    if (this.stasisGfx) { this.scene.tweens.killTweensOf(this.stasisGfx); this.stasisGfx.destroy(); }
    if (this._phaseShiftRing) { this.scene.tweens.killTweensOf(this._phaseShiftRing); this._phaseShiftRing.destroy(); }
    if (this._detectorRing) { this.scene.tweens.killTweensOf(this._detectorRing); this._detectorRing.destroy(); }
    this._detectedOutline?.destroy();
    this._crownLabel?.destroy();
    if (this._heroInvulnRing) { this.scene.tweens.killTweensOf(this._heroInvulnRing); this._heroInvulnRing.destroy(); }
    this.waypointGfx.destroy();
    this._upgradeBadges?.destroy();
    this._controlGroupBadge?.destroy();
    this._fortifiedGroundRing?.destroy();
    if (this._woundedTween) { this.scene.tweens.remove(this._woundedTween); }
    if (this.onFireGlow) { this.scene.tweens.killTweensOf(this.onFireGlow); this.onFireGlow.destroy(); }
    if (this._lastStandAura) { this.scene.tweens.killTweensOf(this._lastStandAura); this._lastStandAura.destroy(); }
  }
}
