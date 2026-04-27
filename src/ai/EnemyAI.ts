import Phaser from 'phaser';
import { UnitManager } from '@/units/UnitManager';
import { PathfinderService } from '@/pathfinding/PathfinderService';
import { BuildingManager } from '@/buildings/BuildingManager';
import {
  BASE_TILE, ENEMY_BASE_TILE, ENEMY_SPAWN_INTERVAL_MS, ENEMY_WAVE_SIZE, TILE_SIZE,
  MAP_WIDTH_TILES, MAP_HEIGHT_TILES,
  Race, RACE_COMBAT_STATS, RACE_UNIT_TYPES, CombatStats,
} from '@/constants';
import { getRaceTint } from '@/buildings/definitions';

/**
 * Four attack vectors radiating from different compass directions toward the
 * player base. Alternating waves along different vectors means units arrive
 * from varying angles rather than always funnelling down the same path.
 */
const APPROACH_POINTS = [
  { x: BASE_TILE.x + 5, y: BASE_TILE.y - 3 },   // north-east flank
  { x: BASE_TILE.x,     y: BASE_TILE.y     },    // direct center push
  { x: BASE_TILE.x + 7, y: BASE_TILE.y + 4 },   // east pincer
  { x: BASE_TILE.x + 2, y: BASE_TILE.y + 6 },   // south hook
] as const;

/**
 * Economy milestones — the AI builds an economy alongside its military.
 * Each milestone fires once when the wave count reaches its threshold.
 */
interface EconomyMilestone {
  wave: number;
  label: string;
  action: (ai: EnemyAI) => void;
  fired: boolean;
}

export class EnemyAI {
  /**
   * The race fielded by this AI. Set externally before initialize() is called.
   * Randomised by GameScene today; will be set by a lobby/matchmaking system
   * once multiplayer is added.
   */
  public race: Race = 'architects';

  /**
   * Stat multiplier applied to spawned enemy unit HP and damage.
   * Easy: 0.70  Normal: 0.75  Hard: 1.25  (Normal already baked 25% weaker)
   */
  public statMultiplier = 0.75;

  /**
   * Wave interval multiplier applied to ENEMY_SPAWN_INTERVAL_MS.
   * Easy: 1.5 (slower)  Normal: 1.0  Hard: 0.667 (1.5× faster)
   */
  public waveIntervalMultiplier = 1.0;

  /**
   * Milestone wave-count divisor. Hard difficulty fires milestones earlier.
   * Applied as: fire when waveCount >= milestone.wave / milestoneAccel
   */
  public milestoneAccel = 1.0;

  /** When false, all AI update logic is skipped (used in multiplayer). */
  private _enabled = true;
  setEnabled(v: boolean): void { this._enabled = v; }

  private static readonly PHASER_UPDATE = 'update' as const;
  private static readonly CROWN_Y_OFFSET = 38;

  /** Tracks active crown updaters so destroy() can clean up both the listener and the Text object. */
  private _crownUpdaters: Array<{ fn: () => void; crown: Phaser.GameObjects.Text }> = [];

  /** Call on game-over to remove all pending crown listeners and destroy any surviving crown sprites. */
  destroy(): void {
    for (const { fn, crown } of this._crownUpdaters) {
      this.scene.events.off(EnemyAI.PHASER_UPDATE, fn);
      if (crown.active) crown.destroy();
    }
    this._crownUpdaters = [];
  }

  private spawnTimer = 0;
  private orderTimer = 3000;
  private raidTimer  = 42000; // first raid after 42 s
  private waveCount  = 0;

  // ── Dynamic difficulty — set by GameScene each frame ─────────────────────────
  /** Current player unit count (set externally by GameScene). */
  playerUnitCount: number = 0;
  /** Current player gold (set externally by GameScene). */
  playerGold: number = 0;
  /** Ms since player last trained a unit or built (set externally). */
  playerIdleMs: number = 0;
  /** True if a harassment raid was sent due to player idle; resets when player acts. */
  private _idleRaidSent = false;
  /** Feint state: units are pulled back and a re-engage timer runs. */
  private feintTimer = 0;

  // ── Adaptive strategy ────────────────────────────────────────────────────────
  /** Current player ranged unit count (set externally by GameScene). */
  playerRangedUnitCount: number = 0;
  /** Current player melee unit count (set externally by GameScene). */
  playerMeleeUnitCount: number = 0;
  private _adaptiveCheckTimer = 0;
  private readonly ADAPTIVE_CHECK_MS = 30000;

  // ── Counter-build composition ────────────────────────────────────────────────
  private _counterBuildTimer = 0;
  private readonly COUNTER_BUILD_MS = 60000;
  /** Adjusts next wave composition based on player unit types. */
  private _counterBuildMode: 'normal' | 'shield' | 'ranged' = 'normal';
  /** Composition bias toward spawning high-HP melee or ranged-skew units. */
  private _playerCompositionBias: 'ranged' | 'melee' | 'balanced' = 'balanced';
  /** Extra units added to the next assault wave due to anti-ranged adaptation. */
  private _adaptiveMeleeBoost = 0;
  /** True once the all-in push has been sent (resets when player becomes active). */
  private _allInSent = false;
  /** Cooldown so gold raids don't spam (ms). */
  private _goldRaidCooldown = 0;

  // ── Elite enemy units (after 8 minutes) ──────────────────────────────────────
  /** Accumulated game time in ms — used to gate elite spawning after 8 minutes. */
  private _eliteGameTimerMs = 0;
  /** True when an elite has already been spawned in the current wave. */
  private _eliteSpawnedThisWave = false;

  // ── Virtual economy ──────────────────────────────────────────────────────────
  /** Gold the AI "earns" passively — used to fund barracks and unit upgrades. */
  private virtualGold = 200;
  private goldAccrueTimer = 0;
  private readonly GOLD_PER_TICK = 8;
  private readonly GOLD_TICK_MS  = 3000;

  /** Track how many barracks-equivalents the enemy has built. */
  private barrackCount = 0;
  private readonly MAX_BARRACKS = 3;

  /** Enemy attack and armor upgrades (applied to newly spawned units). */
  attackBonus  = 0;
  armorBonus   = 0;

  /** Milestones are evaluated once per wave cycle. */
  private milestones: EconomyMilestone[] = [
    {
      wave: 2, label: 'Enemy built a second barracks', fired: false,
      action: (ai) => { ai.buildBarracks(); },
    },
    {
      wave: 3, label: 'Enemy researched Weapons I', fired: false,
      action: (ai) => { ai.researchUpgrade('attack'); },
    },
    {
      wave: 5, label: 'Enemy built a third barracks', fired: false,
      action: (ai) => { ai.buildBarracks(); },
    },
    {
      wave: 6, label: 'Enemy researched Armor I', fired: false,
      action: (ai) => { ai.researchUpgrade('armor'); },
    },
    {
      wave: 9, label: 'Enemy researched Weapons II', fired: false,
      action: (ai) => { ai.researchUpgrade('attack'); },
    },
    {
      wave: 12, label: 'Enemy researched Armor II', fired: false,
      action: (ai) => { ai.researchUpgrade('armor'); },
    },
  ];

  constructor(
    private scene: Phaser.Scene,
    private unitManager: UnitManager,
    private pathfinder: PathfinderService,
    private buildingManager: BuildingManager
  ) {}

  initialize(): void {
    // Spawn 3 starting units
    for (let i = 0; i < 3; i++) this.spawnEnemy();
    // Place the initial barracks marker
    this.buildBarracks();
    // After 5 minutes, place a forward outpost in the upper-right quadrant
    this.scene.time.addEvent({
      delay: 300000,
      callback: this.placeForwardOutpost,
      callbackScope: this,
    });
  }

  /** Place an enemy forward outpost at map_width*0.75, map_height*0.25. */
  private placeForwardOutpost(): void {
    const outpostTileX = Math.floor(MAP_WIDTH_TILES * 0.75);
    const outpostTileY = Math.floor(MAP_HEIGHT_TILES * 0.25);

    const outpostDef = {
      id: 'enemy_forward_outpost',
      name: 'Forward Outpost',
      description: '',
      textureKey: 'building_hq',
      tileWidth: 2, tileHeight: 2,
      goldCost: 0,
      maxHealth: 500,
      supplyProvided: 0,
      isHQ: false,
      tint: getRaceTint(this.race),
    };

    const placed = this.buildingManager.placeBuilding(outpostDef as any, outpostTileX, outpostTileY, true, 'enemy');
    if (!placed) return;

    this.scene.events.emit('enemy:milestone', 'Enemy established a forward outpost!');

    // Spawn 1 defender every 30 seconds from this outpost
    this.scene.time.addEvent({
      delay: 30000,
      loop: true,
      callback: () => {
        if (placed.isDestroyed()) return;
        const unit = this.spawnEnemyAtTile(outpostTileX + 1, outpostTileY + 2);
        // Order it to attack toward the player base
        const tx = Math.max(1, Math.min(48, BASE_TILE.x + Math.floor(Math.random() * 5) - 2));
        const ty = Math.max(1, Math.min(38, BASE_TILE.y + Math.floor(Math.random() * 5) - 2));
        const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
        this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
          if (path && path.length > 0) unit.setPath(path);
        });
      },
    });
  }

  /** Spawn an enemy unit at a specific tile (for outpost use). */
  private spawnEnemyAtTile(tileX: number, tileY: number) {
    const base = RACE_COMBAT_STATS[this.race];
    const m = this.statMultiplier;
    const stats: CombatStats = {
      maxHealth:        Math.round(base.maxHealth * m),
      attackDamage:     Math.round((base.attackDamage + this.attackBonus) * m),
      attackRangePx:    base.attackRangePx,
      attackCooldownMs: base.attackCooldownMs,
    };
    const unit = this.unitManager.spawnEnemyUnit(tileX, tileY, stats, this.race, RACE_UNIT_TYPES[this.race]);
    unit.armor = Math.round(this.armorBonus * m);
    return unit;
  }

  update(delta: number): void {
    if (!this._enabled) return;
    // ── Game time accumulator (for elite spawning gate) ───────────────────────
    this._eliteGameTimerMs += delta;

    // ── Virtual gold accrual ─────────────────────────────────────────────────
    this.goldAccrueTimer += delta;
    if (this.goldAccrueTimer >= this.GOLD_TICK_MS) {
      this.goldAccrueTimer -= this.GOLD_TICK_MS;
      this.virtualGold += this.GOLD_PER_TICK + this.barrackCount * 2;
    }

    this.spawnTimer += delta;
    this.orderTimer += delta;

    // ── 2.5-minute grace period: no attacks before 150 s ─────────────────────
    if (this._eliteGameTimerMs < 150000) return;

    // ── Dynamic difficulty: escalate if player is strong or rich ─────────────
    const playerDominant = this.playerUnitCount > 15 || this.playerGold > 500;
    // Early waves (1-3) get a 40% longer interval so the player has breathing
    // room right after the grace period ends before pressure ramps up.
    const earlyWaveFactor = this.waveCount < 3 ? 1.4 : 1.0;
    const effectiveInterval = ENEMY_SPAWN_INTERVAL_MS * this.waveIntervalMultiplier
      * earlyWaveFactor
      * (playerDominant ? 0.7 : 1.0); // 30% faster waves when player is dominant

    // Main assault wave
    if (this.spawnTimer >= effectiveInterval) {
      this.spawnTimer = 0;
      this.waveCount++;
      this._eliteSpawnedThisWave = false;

      // Check economy milestones each wave
      this.checkMilestones();

      // Larger waves when player is dominant or adaptive melee boost is active.
      // Waves 1-3: no size growth — keep them at base size to match the slower cadence.
      const sizeBoost = playerDominant ? 2 : 0;
      const sizeGrowth = this.waveCount <= 3 ? 0 : Math.floor(this.waveCount / 3);
      const waveSize = ENEMY_WAVE_SIZE + sizeGrowth + sizeBoost + this._adaptiveMeleeBoost;
      this._adaptiveMeleeBoost = 0; // consume boost
      this.launchAssaultWave(waveSize);

      // After 8 minutes, occasionally include one elite unit per wave
      if (this._eliteGameTimerMs >= 480000 && !this._eliteSpawnedThisWave) {
        this._eliteSpawnedThisWave = true;
        this.spawnEliteEnemy();
      }
    }

    // Re-order idle units every 3 s — occasionally feint (pull back then charge)
    if (this.orderTimer >= 3000) {
      this.orderTimer = 0;
      if (Math.random() < 0.12) {
        this.launchFeint();
      } else {
        this.orderIdleUnits();
      }
    }

    // Feint re-engage timer
    if (this.feintTimer > 0) {
      this.feintTimer -= delta;
      if (this.feintTimer <= 0) {
        this.feintTimer = 0;
        this.orderIdleUnits(); // charge again after feint pull-back
      }
    }

    // Harassment raids start after wave 4; interval 35–50 s
    if (this.waveCount >= 4) {
      this.raidTimer -= delta;
      if (this.raidTimer <= 0) {
        this.raidTimer = 35000 + Math.random() * 15000;
        this.launchHarassmentRaid();
      }
    }

    // ── Idle player harassment ─────────────────────────────────────────────────
    if (this.playerIdleMs >= 60000 && !this._idleRaidSent) {
      this._idleRaidSent = true;
      this.launchIdleHarassmentRaid();
    }
    // Reset flag once player acts again (idle time drops)
    if (this.playerIdleMs < 60000) {
      this._idleRaidSent = false;
    }

    // ── Adaptive strategy — check every 30 s ──────────────────────────────────
    this._adaptiveCheckTimer += delta;
    if (this._adaptiveCheckTimer >= this.ADAPTIVE_CHECK_MS) {
      this._adaptiveCheckTimer = 0;
      this.runAdaptiveStrategy();
    }
    // Tick gold raid cooldown
    if (this._goldRaidCooldown > 0) this._goldRaidCooldown -= delta;
    // Reset all-in flag when player becomes active again
    if (this.playerIdleMs < 30000) this._allInSent = false;

    // ── Counter-build composition check every 60 s ────────────────────────────
    this._counterBuildTimer += delta;
    if (this._counterBuildTimer >= this.COUNTER_BUILD_MS) {
      this._counterBuildTimer = 0;
      this.updateCompositionBias();
    }
  }

  /** Expose economy info for minimap / debug overlays. */
  getEconomyInfo(): { gold: number; barracks: number; attackBonus: number; armorBonus: number } {
    return {
      gold: this.virtualGold,
      barracks: this.barrackCount,
      attackBonus: this.attackBonus,
      armorBonus: this.armorBonus,
    };
  }

  // ── Economy actions ─────────────────────────────────────────────────────────

  /** Place a visible enemy barracks building near the enemy base. */
  buildBarracks(): void {
    if (this.barrackCount >= this.MAX_BARRACKS) return;

    const BARRACKS_COST = 150;
    if (this.virtualGold < BARRACKS_COST) return;
    this.virtualGold -= BARRACKS_COST;
    this.barrackCount++;

    // Stagger positions around the enemy HQ
    const offsets = [
      { x: -4, y: 0 }, { x: -4, y: -3 }, { x: -7, y: 0 },
    ];
    const off = offsets[Math.min(this.barrackCount - 1, offsets.length - 1)];
    const tx = Math.max(1, Math.min(48, ENEMY_BASE_TILE.x + off.x));
    const ty = Math.max(1, Math.min(38, ENEMY_BASE_TILE.y + off.y));

    // Use the existing Bulwark garrison def as a stand-in for the enemy barracks
    const barracksLikeDef = {
      id: `enemy_barracks_${this.barrackCount}`,
      name: 'Enemy Barracks',
      description: '',
      textureKey: 'building_barracks',
      tileWidth: 2, tileHeight: 2,
      goldCost: 0,
      maxHealth: 200,
      supplyProvided: 0,
      isHQ: false,
      tint: getRaceTint(this.race),
    };

    const placed = this.buildingManager.placeBuilding(barracksLikeDef, tx, ty, true, 'enemy');
    if (placed) {
      this.scene.events.emit('enemy:buildingConstructed', placed, 'barracks');
    }

    // Spawn garrison ring around the HQ whenever a barracks is built
    this.spawnGarrisonDefenders();
  }

  /**
   * Spawn 4–6 stationary defenders in a ring around the enemy HQ.
   * These units are set to Hold stance so they never leave their post.
   */
  private spawnGarrisonDefenders(): void {
    const count = 4 + Math.floor(Math.random() * 3); // 4, 5, or 6
    const ringRadius = 3; // tiles from HQ centre

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const ox = Math.round(Math.cos(angle) * ringRadius);
      const oy = Math.round(Math.sin(angle) * ringRadius);
      const tx = Math.max(1, Math.min(48, ENEMY_BASE_TILE.x + ox));
      const ty = Math.max(1, Math.min(38, ENEMY_BASE_TILE.y + oy));

      const base = RACE_COMBAT_STATS[this.race];
      const m = this.statMultiplier;
      const boostedStats: CombatStats = {
        maxHealth:        Math.round(base.maxHealth * m * 1.2), // 20% tankier
        attackDamage:     Math.round((base.attackDamage + this.attackBonus) * m),
        attackRangePx:    base.attackRangePx,
        attackCooldownMs: base.attackCooldownMs,
      };

      const unit = this.unitManager.spawnEnemyUnit(tx, ty, boostedStats, this.race, RACE_UNIT_TYPES[this.race]);
      unit.armor = Math.round(this.armorBonus * m);
      unit.setStance('hold');
    }
  }

  /** Upgrade enemy unit stats when the AI "researches" an upgrade tier. */
  researchUpgrade(type: 'attack' | 'armor'): void {
    const UPGRADE_COST = 150;
    if (this.virtualGold < UPGRADE_COST) return;
    this.virtualGold -= UPGRADE_COST;

    if (type === 'attack') {
      this.attackBonus += 3;
      // Apply to existing enemy units
      this.unitManager.getAllUnits()
        .filter(u => u.faction === 'enemy' && u.isAlive())
        .forEach(u => { u.attackDamage += 3; });
    } else {
      this.armorBonus += 3;
      this.unitManager.getAllUnits()
        .filter(u => u.faction === 'enemy' && u.isAlive())
        .forEach(u => { u.armor += 3; });
    }

    this.scene.events.emit('enemy:upgraded', type, type === 'attack' ? this.attackBonus : this.armorBonus);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private checkMilestones(): void {
    for (const m of this.milestones) {
      const threshold = Math.max(1, Math.round(m.wave / this.milestoneAccel));
      if (!m.fired && this.waveCount >= threshold) {
        m.fired = true;
        m.action(this);
        this.scene.events.emit('enemy:milestone', m.label);
      }
    }
  }

  /** Re-evaluate composition bias based on player army makeup. */
  private updateCompositionBias(): void {
    const prev = this._playerCompositionBias;
    if (this.playerRangedUnitCount > 4 && this.playerRangedUnitCount > this.playerMeleeUnitCount) {
      this._playerCompositionBias = 'ranged'; // player heavy on ranged → spawn melee-skew
    } else if (this.playerMeleeUnitCount > 4 && this.playerMeleeUnitCount > this.playerRangedUnitCount) {
      this._playerCompositionBias = 'melee'; // player heavy on melee → spawn ranged-skew
    } else {
      this._playerCompositionBias = 'balanced';
    }
    if (this._playerCompositionBias !== prev && this._playerCompositionBias !== 'balanced') {
      const msg = this._playerCompositionBias === 'ranged'
        ? '⚔ Enemy adapts: sending heavy melee!'
        : '🏹 Enemy adapts: sending ranged skirmishers!';
      const screenW = this.scene.scale.width;
      const warn = this.scene.add.text(screenW / 2, 36, msg, {
        fontSize: '12px', color: '#ff9944', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
      this.scene.tweens.add({
        targets: warn, y: 20, alpha: 0, duration: 2500, ease: 'Power2',
        onComplete: () => warn.destroy(),
      });
    }
  }

  private spawnEnemy() {
    const ox = Math.floor(Math.random() * 4) - 2;
    const oy = Math.floor(Math.random() * 4) - 2;
    const tx = Math.max(1, Math.min(48, ENEMY_BASE_TILE.x + ox));
    const ty = Math.max(1, Math.min(38, ENEMY_BASE_TILE.y + oy));
    const base = RACE_COMBAT_STATS[this.race];
    const m = this.statMultiplier;

    // Adjust stats based on composition bias to counter player army makeup
    let hpMult = 1.0;
    let dmgMult = 1.0;
    let rangeMult = 1.0;
    if (this._playerCompositionBias === 'ranged') {
      // Player has many ranged → spawn high-HP melee-skew units
      hpMult = 1.35;
      dmgMult = 1.1;
      rangeMult = 0.6; // short range = melee-style
    } else if (this._playerCompositionBias === 'melee') {
      // Player has many melee → spawn ranged-skew units
      dmgMult = 1.2;
      rangeMult = 1.5; // longer range
      hpMult = 0.85;
    }

    const boostedStats: CombatStats = {
      maxHealth:       Math.round(base.maxHealth       * m * hpMult),
      attackDamage:    Math.round((base.attackDamage + this.attackBonus) * m * dmgMult),
      attackRangePx:   Math.round(base.attackRangePx * rangeMult),
      attackCooldownMs: base.attackCooldownMs,
    };
    const unit = this.unitManager.spawnEnemyUnit(tx, ty, boostedStats, this.race, RACE_UNIT_TYPES[this.race]);
    unit.armor = Math.round(this.armorBonus * m);
    return unit;
  }

  /** Spawn an elite enemy unit — 2× HP, 1.5× damage, larger sprite, red crown. */
  private spawnEliteEnemy(): void {
    const ox = Math.floor(Math.random() * 4) - 2;
    const oy = Math.floor(Math.random() * 4) - 2;
    const tx = Math.max(1, Math.min(48, ENEMY_BASE_TILE.x + ox));
    const ty = Math.max(1, Math.min(38, ENEMY_BASE_TILE.y + oy));
    const base = RACE_COMBAT_STATS[this.race];
    const m = this.statMultiplier;
    const eliteStats: CombatStats = {
      maxHealth:        Math.round(base.maxHealth       * m * 2),
      attackDamage:     Math.round((base.attackDamage + this.attackBonus) * m * 1.5),
      attackRangePx:    base.attackRangePx,
      attackCooldownMs: base.attackCooldownMs,
    };
    const unit = this.unitManager.spawnEnemyUnit(tx, ty, eliteStats, this.race, RACE_UNIT_TYPES[this.race]);
    unit.armor = Math.round(this.armorBonus * m) + 2;
    // Scale up sprite
    unit.sprite.setScale(1.4);
    // Red crown label above the unit
    const crown = this.scene.add.text(
      unit.sprite.x, unit.sprite.y - EnemyAI.CROWN_Y_OFFSET, '♛',
      { fontSize: '14px', color: '#ff2222', stroke: '#000', strokeThickness: 2 }
    ).setOrigin(0.5).setDepth(18);
    // Move the crown each frame; remove listener + sprite when the unit dies or on AI destroy.
    const crownUpdater = () => {
      const removeSelf = () => {
        this.scene.events.off(EnemyAI.PHASER_UPDATE, crownUpdater);
        this._crownUpdaters = this._crownUpdaters.filter(entry => entry.fn !== crownUpdater);
      };
      if (!crown.active) {
        // Crown was already destroyed externally (e.g. scene shutdown); just deregister.
        removeSelf();
        return;
      }
      if (!unit.isAlive()) {
        removeSelf();
        crown.destroy();
        return;
      }
      crown.setPosition(unit.sprite.x, unit.sprite.y - EnemyAI.CROWN_Y_OFFSET);
      crown.setVisible(unit.fogVisible);
    };
    this._crownUpdaters.push({ fn: crownUpdater, crown });
    this.scene.events.on(EnemyAI.PHASER_UPDATE, crownUpdater);
    // Path toward player base immediately
    const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
    const tgt = APPROACH_POINTS[this.waveCount % APPROACH_POINTS.length];
    this.pathfinder.findPath(fromX, fromY, tgt.x, tgt.y, (path) => {
      if (path && path.length > 0) unit.setPath(path);
    });
    // Alert the player
    this.scene.events.emit('enemy:milestone', '⚠ Elite enemy unit incoming!');
  }

  /**
   * Spawn a wave and immediately path each unit toward a designated approach
   * point, cycling through the four vectors so successive waves hit different
   * sides of the player base.
   *
   * When enemy forces outnumber the player 2:1 or more, the wave is split:
   * 60 % attacks from the main vector while 40 % flanks at a 90° offset.
   */
  private launchAssaultWave(size: number): void {
    const vector = APPROACH_POINTS[this.waveCount % APPROACH_POINTS.length];

    // ── Flanking check ────────────────────────────────────────────────────────
    const enemyCount = this.unitManager.getAllUnits()
      .filter(u => u.faction === 'enemy' && u.isAlive()).length;
    const shouldFlank = size >= 4 && this.playerUnitCount > 0 &&
      enemyCount >= this.playerUnitCount * 2;

    if (shouldFlank) {
      const primarySize = Math.ceil(size * 0.6);
      const flankSize   = size - primarySize;

      // Primary group → main vector
      for (let i = 0; i < primarySize; i++) {
        const unit = this.spawnEnemy();
        const tx = Math.max(1, Math.min(48, vector.x + Math.floor(Math.random() * 3) - 1));
        const ty = Math.max(1, Math.min(38, vector.y + Math.floor(Math.random() * 3) - 1));
        const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
        this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
          if (path && path.length > 0) unit.setPath(path);
        });
      }

      // Flanking group → 90° perpendicular to main attack direction
      const mainDx = vector.x - ENEMY_BASE_TILE.x;
      const mainDy = vector.y - ENEMY_BASE_TILE.y;
      const len = Math.sqrt(mainDx * mainDx + mainDy * mainDy) || 1;
      // Clockwise 90°: (dy, -dx) normalised then scaled 6 tiles
      const perpX = Math.round((mainDy / len) * 6);
      const perpY = Math.round((-mainDx / len) * 6);
      const flankTX = Math.max(1, Math.min(48, vector.x + perpX));
      const flankTY = Math.max(1, Math.min(38, vector.y + perpY));

      for (let i = 0; i < flankSize; i++) {
        const unit = this.spawnEnemy();
        const tx = Math.max(1, Math.min(48, flankTX + Math.floor(Math.random() * 3) - 1));
        const ty = Math.max(1, Math.min(38, flankTY + Math.floor(Math.random() * 3) - 1));
        const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
        this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
          if (path && path.length > 0) unit.setPath(path);
        });
      }

      // Flash a flanking warning
      const screenW = this.scene.scale.width;
      const warn = this.scene.add.text(screenW / 2, 36, '⚡ Enemy flanking manoeuvre!', {
        fontSize: '12px', color: '#ffcc44', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
      this.scene.tweens.add({
        targets: warn, y: 20, alpha: 0, duration: 2000, ease: 'Power2',
        onComplete: () => warn.destroy(),
      });
      return;
    }

    // Standard wave
    for (let i = 0; i < size; i++) {
      const unit = this.spawnEnemy();
      const tx = Math.max(1, Math.min(48, vector.x + Math.floor(Math.random() * 3) - 1));
      const ty = Math.max(1, Math.min(38, vector.y + Math.floor(Math.random() * 3) - 1));
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
        if (path && path.length > 0) unit.setPath(path);
      });
    }
  }

  /**
   * Send 2–3 freshly spawned units to raid a random player building (not the
   * HQ). Targets player economy buildings so the player must also defend
   * their resource income, not just their HQ.
   */
  private launchHarassmentRaid(): void {
    const playerBuildings = this.buildingManager.getBuildings()
      .filter(b => b.faction === 'player' && !b.isDestroyed() && b.def.id !== 'hq');

    if (playerBuildings.length === 0) return;

    const target = playerBuildings[Math.floor(Math.random() * playerBuildings.length)];
    const { x: wx, y: wy } = target.getWorldCenter();
    const targetTileX = Math.floor(wx / TILE_SIZE);
    const targetTileY = Math.floor(wy / TILE_SIZE);

    const raidSize = 2 + Math.floor(Math.random() * 2); // 2–3
    for (let i = 0; i < raidSize; i++) {
      const unit = this.spawnEnemy();
      const tx = Math.max(1, Math.min(48, targetTileX + (i % 2)));
      const ty = Math.max(1, Math.min(38, targetTileY + Math.floor(i / 2)));
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
        if (path && path.length > 0) unit.setPath(path);
      });
    }

    // Flash a warning in the scene
    const screenW = this.scene.scale.width;
    const warn = this.scene.add.text(screenW / 2, 36, '\u26a0 Enemy raid incoming!', {
      fontSize: '13px', color: '#ff4444', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
    this.scene.tweens.add({
      targets: warn, y: 20, alpha: 0, duration: 2200, ease: 'Power2',
      onComplete: () => warn.destroy(),
    });
  }

  /**
   * Feint: pull idle enemy units 200px back toward the enemy base,
   * then re-engage after a short pause to bait the player forward.
   */
  private launchFeint(): void {
    const retreatPoint = APPROACH_POINTS[Math.floor(Math.random() * APPROACH_POINTS.length)];
    // Retreat 200px worth of tiles (~6 tiles) back toward enemy base
    const retreatTileX = Math.max(1, Math.min(48, ENEMY_BASE_TILE.x - 4 + Math.floor(Math.random() * 3)));
    const retreatTileY = Math.max(1, Math.min(38, ENEMY_BASE_TILE.y - 4 + Math.floor(Math.random() * 3)));

    this.unitManager.getAllUnits()
      .filter(u => u.faction === 'enemy' && !u.isWorker && u.isAlive() && !u.isAttacking())
      .forEach(u => {
        const { tileX, tileY } = u.getCurrentTile();
        this.pathfinder.findPath(tileX, tileY, retreatTileX, retreatTileY, (path) => {
          if (path && path.length > 0) u.setPath(path);
        });
      });

    // Re-engage after 2.5 seconds
    this.feintTimer = 2500;

    void retreatPoint; // suppress unused warning
  }

  /**
   * Send 3–5 fast enemy units as an immediate harassment raid when the player
   * has been idle for 60 seconds (no units trained, no buildings built).
   */
  private launchIdleHarassmentRaid(): void {
    const vector = APPROACH_POINTS[Math.floor(Math.random() * APPROACH_POINTS.length)];
    const raidSize = 3 + Math.floor(Math.random() * 3); // 3–5
    for (let i = 0; i < raidSize; i++) {
      const unit = this.spawnEnemy();
      const tx = Math.max(1, Math.min(48, vector.x + Math.floor(Math.random() * 3) - 1));
      const ty = Math.max(1, Math.min(38, vector.y + Math.floor(Math.random() * 3) - 1));
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
        if (path && path.length > 0) unit.setPath(path);
      });
    }

    const screenW = this.scene.scale.width;
    const warn = this.scene.add.text(screenW / 2, 36, '⚡ Enemy strikes while you idle!', {
      fontSize: '13px', color: '#ffaa44', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
    this.scene.tweens.add({
      targets: warn, y: 20, alpha: 0, duration: 2500, ease: 'Power2',
      onComplete: () => warn.destroy(),
    });
  }

  // ── Adaptive strategy ────────────────────────────────────────────────────────

  private runAdaptiveStrategy(): void {
    // 1. Player has many ranged units → boost the next wave with extra melee
    if (this.playerRangedUnitCount > 5) {
      this._adaptiveMeleeBoost = Math.max(this._adaptiveMeleeBoost, 3);
      const screenW = this.scene.scale.width;
      const warn = this.scene.add.text(screenW / 2, 36, '\u26a1 Enemy adapts to your ranged forces!', {
        fontSize: '12px', color: '#ff9944', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
      this.scene.tweens.add({
        targets: warn, y: 20, alpha: 0, duration: 2500, ease: 'Power2',
        onComplete: () => warn.destroy(),
      });
    }

    // 2. Player turtles (no action for 4 min) → all-in push with every unit
    if (this.playerIdleMs >= 240000 && !this._allInSent) {
      this._allInSent = true;
      this.launchAllInPush();
    }

    // 3. Player is low on gold → raiding party targets resource nodes
    if (this.playerGold < 50 && this._goldRaidCooldown <= 0) {
      this._goldRaidCooldown = 90000;
      this.launchResourceRaid();
    }
  }

  /** All-in push: send all available enemy units plus a large fresh wave. */
  private launchAllInPush(): void {
    const vector = APPROACH_POINTS[this.waveCount % APPROACH_POINTS.length];
    // Spawn a large strike wave
    const pushSize = Math.min(20, 8 + Math.floor(this.waveCount / 2));
    for (let i = 0; i < pushSize; i++) {
      const unit = this.spawnEnemy();
      const tx = Math.max(1, Math.min(48, vector.x + Math.floor(Math.random() * 4) - 2));
      const ty = Math.max(1, Math.min(38, vector.y + Math.floor(Math.random() * 4) - 2));
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
        if (path && path.length > 0) unit.setPath(path);
      });
    }
    // Also march every idle enemy unit forward
    this.unitManager.getAllUnits()
      .filter(u => u.faction === 'enemy' && u.isAlive() && !u.isAttacking())
      .forEach(u => {
        const { tileX, tileY } = u.getCurrentTile();
        const tx = Math.max(1, Math.min(48, vector.x + Math.floor(Math.random() * 4) - 2));
        const ty = Math.max(1, Math.min(38, vector.y + Math.floor(Math.random() * 4) - 2));
        this.pathfinder.findPath(tileX, tileY, tx, ty, (path) => {
          if (path && path.length > 0) u.setPath(path);
        });
      });

    const screenW = this.scene.scale.width;
    const warn = this.scene.add.text(screenW / 2, 36, '\u26a0 All-in push! The enemy has been patient...', {
      fontSize: '13px', color: '#ff2222', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
    this.scene.tweens.add({
      targets: warn, y: 20, alpha: 0, duration: 3000, ease: 'Power2',
      onComplete: () => warn.destroy(),
    });
  }

  /**
   * Send a raiding party targeting player resource nodes.
   * GameScene listens to 'enemy:resourceRaid' to path the units to actual nodes.
   */
  private launchResourceRaid(): void {
    const raidSize = 3 + Math.floor(Math.random() * 2); // 3–4
    const raidUnits: import('@/units/Unit').Unit[] = [];
    for (let i = 0; i < raidSize; i++) raidUnits.push(this.spawnEnemy());

    // Let GameScene handle the exact pathfinding to resource nodes
    this.scene.events.emit('enemy:resourceRaid', raidUnits);

    const screenW = this.scene.scale.width;
    const warn = this.scene.add.text(screenW / 2, 36, '\u26a1 Enemy targets your resources!', {
      fontSize: '13px', color: '#ff8800', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
    this.scene.tweens.add({
      targets: warn, y: 20, alpha: 0, duration: 2500, ease: 'Power2',
      onComplete: () => warn.destroy(),
    });
  }

  /** Re-order idle enemy units toward a varied approach point. */
  private orderIdleUnits(): void {
    this.unitManager.getAllUnits()
      .filter(u => u.faction === 'enemy' && !u.isWorker && u.isAlive() && !u.isMoving() && !u.isAttacking())
      .forEach(u => {
        const { tileX, tileY } = u.getCurrentTile();
        const vector = APPROACH_POINTS[Math.floor(Math.random() * APPROACH_POINTS.length)];
        const tx = Math.max(1, Math.min(48, vector.x + Math.floor(Math.random() * 5) - 2));
        const ty = Math.max(1, Math.min(38, vector.y + Math.floor(Math.random() * 5) - 2));
        this.pathfinder.findPath(tileX, tileY, tx, ty, (path) => {
          if (path && path.length > 0) u.setPath(path);
        });
      });
  }
}
