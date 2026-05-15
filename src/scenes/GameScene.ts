import Phaser from 'phaser';
import { MapManager } from '@/map/MapManager';
import { PathfinderService } from '@/pathfinding/PathfinderService';
import { UnitManager } from '@/units/UnitManager';
import { WorkerUnit } from '@/units/WorkerUnit';
import { InputHandler } from '@/input/InputHandler';
import { ResourceManager } from '@/economy/ResourceManager';
import { ResourceNode } from '@/economy/ResourceNode';
import { HUD } from '@/ui/HUD';
import { Minimap } from '@/ui/Minimap';
import { BuildMenu } from '@/ui/BuildMenu';
import { ProductionPanel } from '@/ui/ProductionPanel';
import { BuildingManager } from '@/buildings/BuildingManager';
import { BuildingPlacement } from '@/buildings/BuildingPlacement';
import { Building } from '@/buildings/Building';
import { CombatSystem } from '@/combat/CombatSystem';
import { EnemyAI } from '@/ai/EnemyAI';
import { getBuildingsForRace, getRaceTint, getBuildingDefById } from '@/buildings/definitions';
import {
  Race, GOLD_POSITIONS, JUICE_POSITIONS, BASE_TILE, ENEMY_BASE_TILE, RACES,
  RACE_COMBAT_STATS, RACE_UNIT_TYPES, WORKER_COMBAT_STATS, RESOURCE_SNAP_RADIUS_TILES, TILE_SIZE, UNIT_SPEED, Difficulty, WinCondition, SURVIVAL_DURATION_MS,
} from '@/constants';
import { CommandCard } from '@/ui/CommandCard';
import { UnitPortraitPanel } from '@/ui/UnitPortraitPanel';
import { SoundManager } from '@/ui/SoundManager';
import { NetworkManager, CommandPayload } from '@/network/NetworkManager';

export class GameScene extends Phaser.Scene {
  private mapManager!: MapManager;
  private pathfinder!: PathfinderService;
  private unitManager!: UnitManager;
  private inputHandler!: InputHandler;
  private resources!: ResourceManager;
  private buildingManager!: BuildingManager;
  private buildingPlacement!: BuildingPlacement;
  private combatSystem!: CombatSystem;
  private enemyAI!: EnemyAI;

  private hud!: HUD;
  private minimap!: Minimap;
  private buildMenu!: BuildMenu;
  private productionPanel!: ProductionPanel;

  // Fog of war
  private readonly FOG_UNIT_SIGHT_PX     = 220;
  private readonly FOG_BUILDING_SIGHT_PX = 160;
  private readonly FOG_FEATHER_PX        = 56;   // px of soft gradient at vision edge
  private fogOverlay!: Phaser.GameObjects.Graphics;
  /** Last set of vision sources used to draw fog; cached to avoid recomputing. */
  private _fogSources: Array<{ x: number; y: number; r: number }> = [];

  private race: Race = RACES.HUW;
  /** Randomly assigned each game; will be set externally when multiplayer adds a lobby. */
  private enemyRace: Race = RACES.HUW;
  private difficulty: Difficulty = 'normal';
  private winCondition: WinCondition = 'hq';
  /** Milliseconds remaining for the Survival win condition. */
  private survivalMsRemaining = 0;
  private supplyUsed = 6;
  private resourceNodes: ResourceNode[] = [];

  // ── Gold income tracking (sliding 10s window) ─────────────────────────────
  private goldIncomeHistory: Array<{ time: number; amount: number }> = [];
  private goldIncomePerMin = 0;
  private _incomeTickAccum = 0;

  // ── Command card & portrait panel ────────────────────────────────────────
  private commandCard!: CommandCard;
  private portraitPanel!: UnitPortraitPanel;
  private soundManager!: SoundManager;

  // ── Stasis targeting (Arbiter E-ability) ──────────────────────────────────
  private stasisTargetingActive  = false;
  private stasisTargetingHint:   Phaser.GameObjects.Text | null = null;
  private _stasisArbiters:       import('@/units/Unit').Unit[] = [];

  private playerHQ: Building | null = null;
  private enemyHQ:  Building | null = null;
  private gameOver = false;

  // ── Pause / game-speed ───────────────────────────────────────────────────────
  private isPaused    = false;
  private gameSpeed   = 1.0;           // 0.5 / 1 / 2 / 4
  private pauseOverlay: Phaser.GameObjects.Rectangle | null = null;
  private pauseLabel:   Phaser.GameObjects.Text      | null = null;

  // ── Statistics ───────────────────────────────────────────────────────────────
  private stats = { enemiesKilled: 0, unitsLost: 0, buildingsLost: 0, buildingsBuilt: 0, startTimeMs: 0, goldSpent: 0, unitsTrained: 0 };

  // ── Achievement tracking ──────────────────────────────────────────────────────
  private achievements: { id: string; label: string; icon: string; unlocked: boolean }[] = [];

  // ── Hero unit tracking ────────────────────────────────────────────────────────
  /** Maps race → the active hero unit (null when dead or never trained). */
  private activeHeroes = new Map<string, import('@/units/Unit').Unit>();
  /** Maps race → ms remaining before a new hero can be trained (120s respawn). */
  private heroRespawnTimers = new Map<string, number>();
  /** HUD label showing active hero respawn timers. */
  private heroRespawnLabel: Phaser.GameObjects.Text | null = null;

  // ── Player activity tracking (for AI idle harassment) ─────────────────────────
  private lastPlayerActionMs = 0; // game-time of last unit trained or building built

  // Shrine / upgrade state
  private buildCostMultiplier = 1.0;
  private bonusSupply = 0;
  private purchasedUpgrades = new Set<string>();
  private targetingMode: 'none' | 'hack' | 'bomb' = 'none';
  private targetingOverlay: Phaser.GameObjects.Rectangle | null = null;
  private targetingHintText: Phaser.GameObjects.Text | null = null;

  // HQ passive aura system
  private hqPassiveTimer = 0;
  private readonly HQ_AURA_RADIUS_PX = 180;

  // Idle military tracking
  private _idleMilitaryTimers = new Map<string, number>();
  private _idleMilitaryCount = 0;
  private readonly HQ_HEAL_TICK_MS = 3000;
  private readonly HQ_ARMOR_TICK_MS = 3000;

  // ── Per-frame throttle counters ───────────────────────────────────────────
  /** Incremented each frame; used to throttle expensive O(n·m) passes. */
  private _frameCount = 0;

  // ── Game clock (real-time elapsed, paused when game is paused) ───────────
  private gameElapsedMs = 0;

  // ── Sentinel Turret attack cooldowns (building id → ms remaining) ─────────
  private _turretCooldowns = new Map<string, number>();

  // ── TAB score overlay ─────────────────────────────────────────────────────
  private scoreOverlay: Phaser.GameObjects.Container | null = null;
  private scoreOverlayTexts: Phaser.GameObjects.Text[] = [];

  // ── Idle worker indicator ─────────────────────────────────────────────────
  private _idleWorkerCount = 0;

  // ── Multi-select count badge ──────────────────────────────────────────────
  private _selectionBadge: Phaser.GameObjects.Text | null = null;
  /** Index into idle worker list for F-key cycling. */
  private _idleWorkerCycleIdx = 0;

  // ── Alert / notification system ───────────────────────────────────────────
  private readonly ALERT_COOLDOWN_MS = 4000;
  private lastUnderAttackAlertMs = -9999;
  private lastEnemySpottedAlertMs = -9999;
  /** Enemy unit IDs that have already been "spotted" — so we only alert on first sight. */
  private knownEnemyFogIds = new Set<string>();

  // ── Height zones (elevated terrain — units on high ground get +20% range) ──
  private heightZones: Array<{ rect: Phaser.Geom.Rectangle; label: string }> = [];

  // ── Randomised terrain tile lists (shared between spawn + repeller setup) ──
  private _terrainRocks: Array<{ x: number; y: number }> = [];
  private _terrainTrees: Array<{ x: number; y: number }> = [];
  private _terrainPonds: Array<{ cx: number; cy: number; rx: number; ry: number }> = [];
  /** Cached terrain repellers (rocks/trees/ponds) — set once, reused each building refresh. */
  private _terrainRepellers: Array<{ x: number; y: number; radius: number }> = [];
  /** Neutral outpost tile positions recorded for minimap rendering. */
  private _neutralOutpostTiles: Array<{ tileX: number; tileY: number }> = [];

  // ── Unseen Shade Spire zones ──────────────────────────────────────────────
  /** Each active shade spire with its expanding dark zone circle. */
  private shadeSpires: Array<{
    building: Building;
    zoneCircle: Phaser.GameObjects.Arc;
    zoneRing: Phaser.GameObjects.Arc;
    maxRadius: number;
  }> = [];

  // ── Covenant Wellspring juice generation ──────────────────────────────────
  private _wellspringJuiceAccum = 0;
  private _wellspringVisualTimer = 0;

  // ── Unseen Void Gates ─────────────────────────────────────────────────────
  /** Active portal entries. Two entries = one linked pair. */
  private _voidGates: Array<{
    building: Building;
    worldX: number;
    worldY: number;
    portalGfx: Phaser.GameObjects.Graphics;
    labelText: Phaser.GameObjects.Text;
    particleAngle: number;         // rotates each frame for swirl effect
    linkedIdx: number | null;      // index in _voidGates of the paired portal, or null
  }> = [];
  /** Cooldown set per unit id to prevent instant re-teleport. */
  private _voidGateCooldowns = new Map<string, number>();

  // ── Shadow Step targeting mode ────────────────────────────────────────────
  private shadowStepTargetingActive = false;
  private shadowStepTargetingHint: Phaser.GameObjects.Text | null = null;

  // ── Assassinate targeting mode (Unseen — F2) ──────────────────────────────
  private _assassinateTargetingActive = false;
  private _assassinateTargetingHint: Phaser.GameObjects.Text | null = null;

  // ── Divine Wrath targeting mode (Covenant — F3) ───────────────────────────
  private _divineWrathTargetingActive = false;
  private _divineWrathTargetingHint: Phaser.GameObjects.Text | null = null;

  // ── Iron Bastion walls (Bulwark — N key) ─────────────────────────────────
  private _ironBastionWalls: Array<{
    gfx: Phaser.GameObjects.Graphics;
    tileX: number; tileY: number;
    hp: number;
    timer: number;
  }> = [];

  // ── Multi-building production selection ───────────────────────────────────
  /** Buildings in the current production selection (supports Shift+click to add). */
  private selectedBuildings: import('@/buildings/Building').Building[] = [];
  /** Pulsing highlight rings for selected buildings. */
  private _buildingSelectionRings: Map<string, { gfx: Phaser.GameObjects.Graphics; tween: Phaser.Tweens.Tween }> = new Map();

  // Garrisoned workers per mine building id
  private garrisonedWorkers = new Map<string, import('@/units/Unit').Unit[]>();

  // ── Worker auto-mining assignments ────────────────────────────────────────
  /** Maps workerUnit.id → the ResourceNode they are assigned to mine. */
  private miningAssignments = new Map<string, ResourceNode>();

  // ── Multiplayer ───────────────────────────────────────────────────────────
  /** True when we entered via LobbyScene. Disables the AI and enables network sync. */
  private isMultiplayer  = false;
  /** 0 = host/player-left, 1 = joiner/player-right. */
  private mpPlayerIndex  = 0;
  private mySessionId    = '';
  private mpOpponentRace: Race = RACES.HUW;
  /** When true, ignore player inputs (spectating / wrong side). Not used yet, future auth. */
  private _mpInputLocked = false;

  // ── Replay system ─────────────────────────────────────────────────────────
  private _replayEventLog: Array<{
    t: number;
    type: 'move' | 'attack_move' | 'build' | 'train' | 'stance';
    tileX?: number; tileY?: number;
    defId?: string; unitTypeId?: string; stance?: string;
  }> = [];
  private _replayMode = false;
  private _replayEventIdx = 0;

  // ── Hotkey help overlay ───────────────────────────────────────────────────
  private _helpOverlay: Phaser.GameObjects.Container | null = null;
  private _helpOverlayVisible = false;

  // ── Impassable zones (terrain blockers) ───────────────────────────────────
  private _impassableZones: Array<{ tileX: number; tileY: number; tileW: number; tileH: number }> = [];

  // ── Follow cam ────────────────────────────────────────────────────────────
  private _followCamActive = false;
  private _followCamTarget: import('@/units/Unit').Unit | null = null;
  private _followCamIndicator: Phaser.GameObjects.Text | null = null;
  /** Most recently selected unit — used as follow cam target. */
  private _lastSelectedUnit: import('@/units/Unit').Unit | null = null;

  // ── Enemy transmissions (flavour chat) ────────────────────────────────────
  private _transmissionTimer = 0;
  private readonly TRANSMISSION_INTERVAL_MS = 90000;
  private _transmissionPanel: Phaser.GameObjects.Container | null = null;

  // ── Kill feed (top-right corner) ──────────────────────────────────────────
  private _killFeed: Array<{ text: Phaser.GameObjects.Text; remainingMs: number }> = [];

  // ── Move order lines (right-click move visual) ────────────────────────────
  private _moveOrderGfx: Phaser.GameObjects.Graphics | null = null;

  // ── Rain effect (cosmetic; starts at 3 min, stops at 5 min) ──────────────
  private _rainStarted = false;
  private _rainEmitter: Phaser.Time.TimerEvent | null = null;

  // ── Shield Wall passive adjacency check ───────────────────────────────────
  private _shieldWallAccum = 0;
  private readonly SHIELD_WALL_CHECK_INTERVAL_MS = 500;
  private readonly SHIELD_WALL_ADJ_PX = 80;

  // ── Void Rift vortexes (Unseen kill-triggered) ────────────────────────────
  private _voidRifts: Array<{
    x: number; y: number; timer: number;
    gfx: Phaser.GameObjects.Graphics;
    spinAngle: number;
    hitUnitIds: Set<string>;
  }> = [];
  private _voidRiftSlowedUnits = new Map<string, number>(); // unit.id → remaining ms
  private readonly VOID_RIFT_RADIUS_PX = 60;
  private readonly VOID_RIFT_DAMAGE = 15;
  private readonly VOID_RIFT_SLOW_PCT = 0.3;
  private readonly VOID_RIFT_SLOW_MS = 2000;
  private readonly VOID_RIFT_DURATION_MS = 5000;
  private readonly VOID_RIFT_MAX = 3;

  // ── Unit tooltip on hover ─────────────────────────────────────────────────
  private _tooltipContainer: Phaser.GameObjects.Container | null = null;
  private _tooltipHoverUnit: import('@/units/Unit').Unit | null = null;
  private _tooltipHoverTimer = 0;
  private readonly TOOLTIP_SHOW_DELAY_MS = 500;
  private readonly TOOLTIP_AUTO_HIDE_MS = 3000;
  private _tooltipShowTimer = 0;

  // ── Overcharge Turret (Architects T key) ──────────────────────────────────
  /** Per-unit cooldown (unit id → ms remaining before can fire again). */
  private _overchargeTurretCooldowns = new Map<string, number>();
  /** Turrets currently in overcharge mode (building id → ms remaining). */
  private _overchargedTurrets = new Map<string, number>();

  // ── Deploy Drone (Architects D key) ──────────────────────────────────────
  private _droneCooldowns = new Map<string, number>();
  /** drone unit id → { remainingMs, ownerId } */
  private _droneTimers = new Map<string, { remainingMs: number; ownerId: string }>();

  // ── War Cry (Bulwark W key) ───────────────────────────────────────────────
  private _warCryCooldowns = new Map<string, number>();
  /** unit id → ms remaining of the +25% attack speed boost */
  private _warCryBuffs = new Map<string, number>();

  // ── Aegis Shield (Covenant Z key) ─────────────────────────────────────────
  /** Caster unit id → ms remaining on cooldown */
  private _aegisShieldCooldowns = new Map<string, number>();
  /** Shield target id → shield state. phaseMs drives the pulse alpha. */
  private _aegisShields = new Map<string, { remainingMs: number; gfx: Phaser.GameObjects.Graphics; staticX: number; staticY: number; isUnit: boolean; phaseMs: number }>();

  // ── Architects Structural Analysis (passive) ──────────────────────────────
  /** Graphics object for blue dotted repair lines — redrawn each frame. */
  private _structuralAnalysisGfx: Phaser.GameObjects.Graphics | null = null;
  /** Accumulator for passive repair ticks (avoids fractional HP). */
  private _structAnalysisAccum = 0;

  // ── Wind gust (after rain ends) ───────────────────────────────────────────
  private _windGustEmitter: Phaser.Time.TimerEvent | null = null;

  // ── Supply depot callout ──────────────────────────────────────────────────
  /** Game-time (ms) when the last supply-providing building was placed. */
  private _lastSupplyBuildingBuiltMs = -Infinity;
  /** Whether the supply-almost-full warning is currently visible. */
  private _supplyAlmostFullVisible = false;

  // ── EMP Pulse (Architects X key) ─────────────────────────────────────────
  /** Unit id → ms remaining on EMP Pulse cooldown */
  private _empPulseCooldowns = new Map<string, number>();

  // ── Architects Scanner Sweep (passive, every 45s) ─────────────────────────
  /** Accumulates ms toward next scanner sweep (resets at 45000). */
  private _scannerSweepTimer = 0;
  /** Active scanner sweep reveal sources — removed when remainingMs hits 0. */
  private _scannerSweepSources: Array<{ x: number; y: number; r: number; remainingMs: number }> = [];

  // ── Camera shake — rolling unit death window ──────────────────────────────
  private _recentUnitDeathTimes: number[] = [];

  // ── Global Upgrade Panel (U key) ──────────────────────────────────────────
  private _upgradePanel: Phaser.GameObjects.Container | null = null;
  private _upgradePanelVisible = false;
  private _panelUpgrades = new Set<string>();
  /** How many speed upgrade tiers the player has purchased (0–2). */
  private _speedUpgradeTier = 0;
  /** How many building HP upgrade tiers the player has purchased (0–2). */
  private _buildingHpUpgradeTier = 0;

  // ── Narrative intro sequence ───────────────────────────────────────────────
  /** True while the opening narrative intro is playing; blocks game logic. */
  private _introActive = false;

  // ── Covenant Sanctuary Zones ───────────────────────────────────────────────
  private sanctuaryZones: Array<{
    worldX: number; worldY: number; radius: number;
    hp: number; maxHp: number;
    gfx: Phaser.GameObjects.Graphics;
    pulseGfx: Phaser.GameObjects.Graphics;
    pulseProxy: { alpha: number };
    hpLabel: Phaser.GameObjects.Text;
  }> = [];
  private _sanctuaryHealAccum = 0;
  private readonly SANCTUARY_HEAL_INTERVAL_MS = 1000;
  private readonly SANCTUARY_HEAL_AMOUNT = 2;
  private readonly SANCTUARY_RADIUS_PX = 80;
  private readonly SANCTUARY_MAX_HP = 200;
  private readonly SANCTUARY_MAX_ZONES = 2;
  private readonly SANCTUARY_COST = 100;

  constructor() { super({ key: 'GameScene' }); }

  init(data: {
    race?: Race; difficulty?: Difficulty; winCondition?: WinCondition;
    multiplayer?: boolean; playerIndex?: number; opponentRace?: string;
    mySessionId?: string; isHost?: boolean; replay?: boolean;
  }): void {
    this.race = (data?.race as Race) ?? RACES.HUW;
    this.difficulty = (data?.difficulty as Difficulty) ?? 'normal';
    this.winCondition = (data?.winCondition as WinCondition) ?? 'hq';
    this.survivalMsRemaining = SURVIVAL_DURATION_MS;
    this.isMultiplayer  = data?.multiplayer ?? false;
    this.mpPlayerIndex  = data?.playerIndex ?? 0;
    this.mySessionId    = data?.mySessionId ?? '';
    this.mpOpponentRace = (data?.opponentRace as Race) ?? RACES.HUW;

    // Replay mode: load saved event log from localStorage
    this._replayMode = data?.replay ?? false;
    this._replayEventLog = [];
    this._replayEventIdx = 0;
    if (this._replayMode) {
      try {
        const saved = localStorage.getItem('sibling_wars_replay');
        if (saved) this._replayEventLog = JSON.parse(saved);
      } catch { /* ignore */ }
    }

    if (this.isMultiplayer) {
      // In multiplayer, player 1 (index 1, the joiner) controls the right side.
      // We reuse the same map but the "enemy" base is the opponent's base.
      this.enemyRace = this.mpOpponentRace;
    } else {
      const allRaces = (Object.values(RACES) as Race[]).filter(r => r !== this.race);
      this.enemyRace = allRaces[Math.floor(Math.random() * allRaces.length)];
    }

    this.gameOver = false;
    this.supplyUsed = 6;
    this.resourceNodes = [];
    this.miningAssignments = new Map();
    this.goldIncomeHistory = [];
    this.goldIncomePerMin = 0;
    this._incomeTickAccum = 0;
  }

  private testModeBadge: Phaser.GameObjects.Text | null = null;

  private setTestMode(enabled: boolean): void {
    this.resources.infiniteResources = enabled;
    this.testModeBadge?.destroy();
    this.testModeBadge = null;
    if (enabled) {
      this.testModeBadge = this.add.text(this.scale.width / 2, 4, '⚗ TEST MODE  —  ∞ Resources  (Ctrl+G to toggle)', {
        fontSize: '11px', color: '#ffee44', backgroundColor: '#00000088', padding: { x: 8, y: 3 },
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998);
    }
  }

  create(): void {
    this.resources = new ResourceManager();
    // Track gold income for per-minute display
    this.resources.onGoldAdded = (amount) => {
      const now = this.time.now;
      this.goldIncomeHistory.push({ time: now, amount });
    };
    // Track gold spent for Battle Report
    this.resources.onGoldSpent = (amount) => { this.stats.goldSpent += amount; };
    this.mapManager = new MapManager(this);
    const grid = this.mapManager.buildWalkabilityGrid();
    this.pathfinder = new PathfinderService(grid);
    this.buildingManager = new BuildingManager(this, this.pathfinder, this.resources);
    this.buildingManager.isSupplyCapped = () => {
      const cap = this.buildingManager.getTotalSupply() + this.bonusSupply;
      return this.supplyUsed >= cap;
    };
    this.buildingPlacement = new BuildingPlacement(this, this.buildingManager);
    this.unitManager = new UnitManager(this, this.resources, this.pathfinder);
    this.unitManager.playerRace = this.race;
    if (this.isMultiplayer) this.unitManager.unitIdPrefix = `p${this.mpPlayerIndex}_`;
    this.combatSystem = new CombatSystem(this);
    this.enemyAI = new EnemyAI(this, this.unitManager, this.pathfinder, this.buildingManager);
    this.enemyAI.race = this.enemyRace;

    // Apply difficulty settings to EnemyAI
    switch (this.difficulty) {
      case 'easy':
        this.enemyAI.statMultiplier       = 0.52;  // ~30% weaker than normal's 0.75
        this.enemyAI.waveIntervalMultiplier = 1.5;
        this.enemyAI.milestoneAccel        = 0.67; // milestones fire later
        break;
      case 'hard':
        this.enemyAI.statMultiplier       = 1.25;
        this.enemyAI.waveIntervalMultiplier = 0.667;
        this.enemyAI.milestoneAccel        = 1.5;  // milestones fire earlier
        break;
      default: // normal
        this.enemyAI.statMultiplier       = 0.75;
        this.enemyAI.waveIntervalMultiplier = 1.0;
        this.enemyAI.milestoneAccel        = 1.0;
    }

    this.spawnResources();
    this.spawnEnvironmentalProps();
    this.createHeightZones();
    this.setupObstacleRepellers();
    this.createAmbientParticles();

    // Fog overlay — depth 19 (above terrain, below units)
    this.fogOverlay = this.add.graphics().setDepth(19).setScrollFactor(1);

    this.placeStartingHQ();
    this.addHQAuraVisual();
    this.placeEnemyHQ();
    this.spawnInitialUnits();
    if (!this.isMultiplayer) {
      this.enemyAI.initialize();
    } else {
      this.enemyAI.setEnabled(false);
    }
    this.showEnemyRaceBanner();

    // ── UI ──────────────────────────────────────────────────────────────────
    this.inputHandler = new InputHandler(this, this.unitManager, this.pathfinder);
    this.hud = new HUD(this, this.resources);
    const { widthInPixels: mapW, heightInPixels: mapH } = this.mapManager.getMapDimensions();
    this.minimap = new Minimap(this, mapW, mapH);
    this.soundManager = new SoundManager(this);

    // Minimap double-click → move all idle player units to that location
    this.events.on('minimap:sendIdleUnits', ({ worldX, worldY }: { worldX: number; worldY: number }) => {
      const idleUnits = this.unitManager.getAllUnits().filter(
        u => u.isAlive() && u.faction === 'player' && !u.isWorker && !u.isMoving() && !u.isAttacking()
      );
      if (idleUnits.length === 0) return;
      const tileX = Math.floor(worldX / TILE_SIZE);
      const tileY = Math.floor(worldY / TILE_SIZE);
      this.unitManager.moveSpecificUnits(idleUnits, tileX, tileY);
    });

    // ── Right-click intercept — rally points and targeting modes ─────────────
    this.inputHandler.onRightClick = (worldX, worldY) => {
      // Stasis targeting mode
      if (this.stasisTargetingActive) {
        this.executeStasis(worldX, worldY);
        this.endStasisTargeting();
        return true;
      }

      // Shadow Step targeting mode
      if (this.shadowStepTargetingActive) {
        this.unitManager.activateShadowStepForSelected(worldX, worldY);
        this.endShadowStepTargeting();
        return true;
      }

      // Assassinate targeting mode
      if (this._assassinateTargetingActive) {
        this._executeAssassinate(worldX, worldY);
        this._endAssassinateTargeting();
        return true;
      }

      // Divine Wrath targeting mode
      if (this._divineWrathTargetingActive) {
        this._executeDivineWrath(worldX, worldY);
        this._endDivineWrathTargeting();
        return true;
      }

      // Let existing targeting overlays handle clicks first
      if (this.targetingMode !== 'none') return false;

      // If a player building is open in the production panel and NO units are selected,
      // right-click sets its rally point. When units are selected, right-click moves them.
      if (this.unitManager.getSelectedCount() === 0) {
        const activeBuilding = this.selectedBuildings[0] ?? this.productionPanel.getActiveBuilding();
        if (activeBuilding && !activeBuilding.isDestroyed() && activeBuilding.faction === 'player' && activeBuilding.def.produces?.length) {
          const tileX = Math.floor(worldX / TILE_SIZE);
          const tileY = Math.floor(worldY / TILE_SIZE);
          this.selectedBuildings.filter(b => !b.isDestroyed()).forEach(b => b.setRallyTile(tileX, tileY));
          if (this.selectedBuildings.length === 0) activeBuilding.setRallyTile(tileX, tileY);
          this.spawnFloatingText(worldX, worldY - 22, 'Rally set', '#44ff88');
          return true; // consumed — don't move units
        }
      }

      // ── Worker mining assignment: right-click near a resource node ────────
      const selectedWorkers = this.unitManager.getSelectedWorkers();
      if (selectedWorkers.length > 0) {
        const nearestNode = this.findNearestNodeAtPoint(worldX, worldY, 52);
        if (nearestNode && !nearestNode.isDepleted()) {
          this.assignWorkersToNode(selectedWorkers, nearestNode);
          return true; // consumed — workers are heading to mine, not moving freely
        }
        // Manual move: cancel mining assignments for these workers
        selectedWorkers.forEach(w => {
          if (w.miningState !== 'idle') this.stopWorkerMining(w);
        });
      }

      return false; // default move behaviour
    };

    // ── Path aggressive unit toward an enemy building ─────────────────────────
    this.events.on('unit:pathToBuilding', (unit: import('@/units/Unit').Unit, worldX: number, worldY: number) => {
      if (!unit.isAlive() || unit.isAttacking()) return;
      const tileX = Math.floor(worldX / TILE_SIZE);
      const tileY = Math.floor(worldY / TILE_SIZE);
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tileX, tileY, (path) => {
        if (!unit.isAlive() || unit.isAttacking() || unit.isMoving()) return;
        if (path && path.length > 0) unit.setPath(path);
      });
    });

    // ── Attack-move resume: repath a unit to its saved destination ────────────
    this.events.on('unit:resumeMove', (unit: import('@/units/Unit').Unit, tileX: number, tileY: number) => {
      if (!unit.isAlive()) return;
      // Guard: if the unit immediately re-acquired a target (CombatSystem runs
      // in the same tick), don't interrupt the new fight.
      if (unit.isAttacking()) return;
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tileX, tileY, (path) => {
        // Re-check after the async pathfind; unit may have started a new fight.
        if (!unit.isAlive() || unit.isAttacking()) return;
        if (path && path.length > 0) unit.setPath(path);
      });
    });

    // ── Patrol movement: pathfind to next patrol waypoint ────────────────────
    this.events.on('unit:patrolMove', (unit: import('@/units/Unit').Unit, tileX: number, tileY: number) => {
      if (!unit.isAlive() || !unit.isPatrolling) return;
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tileX, tileY, (path) => {
        if (!unit.isAlive() || !unit.isPatrolling) return;
        if (path && path.length > 0) {
          unit.setPath(path);
        } else {
          // If pathfinding fails, just reverse immediately
          unit.onPatrolArrived();
        }
      });
    });

    this.stats.startTimeMs = this.time.now;
    this.lastPlayerActionMs = 0;

    // ── Hero respawn HUD label ────────────────────────────────────────────────
    this.heroRespawnLabel = this.add.text(
      this.scale.width - 12, 52, '',
      { fontSize: '11px', color: '#ffaa44', stroke: '#000', strokeThickness: 2,
        backgroundColor: '#1a0a00cc', padding: { x: 6, y: 3 } }
    ).setOrigin(1, 0).setScrollFactor(0).setDepth(9994).setVisible(false);

    // ── Achievement definitions ───────────────────────────────────────────────
    this.achievements = [
      { id: 'first_blood',       label: 'First Blood',               icon: '\u2694',   unlocked: false },
      { id: 'destroyer_50',      label: 'Architect of Destruction',  icon: '\ud83d\udca5', unlocked: false },
      { id: 'economist',         label: 'Economist',                 icon: '\ud83d\udcb0', unlocked: false },
      { id: 'turtle',            label: 'Turtle',                    icon: '\ud83d\udc22', unlocked: false },
      { id: 'blitzkrieg',        label: 'Blitzkrieg',               icon: '\u26a1',   unlocked: false },
    ];

    // ── Supply refund + stats on player unit death ────────────────────────────
    this.unitManager.onUnitDied = (unit) => {
      // Drones and shadow clones don't cost supply — skip decrement for them
      const isDrone = unit.unitTypeId === 'drone';
      if (!unit.isWorker && !isDrone && !unit.isShadowClone) this.supplyUsed = Math.max(0, this.supplyUsed - 1);
      if (!isDrone && !unit.isShadowClone) this.stats.unitsLost++;
      // Hero death: start 120s respawn timer
      if (unit.isHero) {
        this.activeHeroes.delete(this.race);
        this.heroRespawnTimers.set(this.race, 120000);
        this.showAlertBanner('♛ Hero has fallen! Respawn in 120s', '#ffaa44');
      }
      // Worker died while mining — reset miningState immediately so in-flight
      // animateExitMine/animateEnterMine callbacks bail when they check miningState.
      // tickWorkerMining can no longer do this because removeDeadUnits now deletes
      // the unit from this.units before tickWorkerMining runs.
      if (unit.isWorker) {
        const worker = unit as WorkerUnit;
        if (this.miningAssignments.has(worker.id)) this.stopWorkerMining(worker);
        else if (worker.miningState !== 'idle') worker.miningState = 'idle';
      }
      // Kill feed: player unit lost
      const label = unit.unitTypeId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      this.addKillFeedEntry(`${label} lost`, false);
    };

    // ── Kill counter + achievement checks ─────────────────────────────────────
    this.unitManager.onEnemyDied = (unit) => {
      this.stats.enemiesKilled++;
      this.checkAchievement('first_blood',  this.stats.enemiesKilled >= 1);
      this.checkAchievement('destroyer_50', this.stats.enemiesKilled >= 50);
      if (!this.gameOver && this.winCondition === 'annihilation') {
        this.checkAnnihilationWin();
      }
      // Kill feed: enemy unit destroyed
      const label = unit.unitTypeId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      this.addKillFeedEntry(`${label} destroyed`, true);
      // Camera shake: track death for cluster detection
      this._recentUnitDeathTimes.push(this.gameElapsedMs);
      if (this._recentUnitDeathTimes.filter(t => this.gameElapsedMs - t < 2000).length >= 5) {
        this.cameras.main.shake(200, 0.005);
        this._recentUnitDeathTimes = []; // reset to avoid repeat shakes
      }
    };

    // ── Enemy economy events ──────────────────────────────────────────────────
    this.events.on('enemy:milestone', (label: string) => {
      this.showAlertBanner(`\u26a0 ${label}`, '#ff9944');
    });

    this.events.on('enemy:upgraded', (type: 'attack' | 'armor', level: number) => {
      this.hud.showEnemyUpgrade(type, level);
    });

    // ── Order queue: pathfind to the next waypoint when a unit requests it ────
    this.events.on('unit:requestNextOrder', (unit: import('@/units/Unit').Unit, tileX: number, tileY: number) => {
      if (!unit.isAlive()) return;
      const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
      this.pathfinder.findPath(fromX, fromY, tileX, tileY, (path) => {
        if (!unit.isAlive()) return;
        if (path && path.length > 0) unit.setPath(path, undefined, false);
      });
    });

    // ── Command card M-button: show "Right-click to move" hint ────────────────
    this.events.on('commandcard:move', () => {
      this.showScreenMessage('Right-click to move', '#88aacc');
    });

    // ── Siege Mode (T key — Siege Crawlers) ───────────────────────────────────
    this.events.on('input:toggleSiegeMode', () => {
      let toggled = 0;
      this.unitManager.getAllUnits().forEach(u => {
        if (u.isSelected && u.isAlive() && u.faction === 'player' && u.unitTypeId === 'siege_crawler') {
          u.toggleSiegeMode();
          toggled++;
        }
      });
      if (toggled === 0 && this.unitManager.getSelectedCount() > 0) {
        this.showScreenMessage('No Siege Crawlers selected', '#ff8844');
      }
    });

    // ── Pause / speed ─────────────────────────────────────────────────────────
    this.events.on('input:togglePause', () => this.togglePause());
    this.events.on('input:speedUp',     () => this.stepGameSpeed(1));
    this.events.on('input:speedDown',   () => this.stepGameSpeed(-1));
    this.events.on('input:speedReset',  () => this.setGameSpeed(1));

    // Stop command: cancel mining for selected workers so they don't stay stuck
    // in 'to_node' or 'to_hq' with stale miningAssignments entries.
    this.events.on('input:stopUnits', () => {
      this.unitManager.getSelectedWorkers().forEach(w => {
        if (w.miningState !== 'idle') this.stopWorkerMining(w);
      });
    });

    // ── Phantom stealth (B key) ───────────────────────────────────────────────
    this.events.on('input:activateStealth', () => {
      if (!this.unitManager.isAbilityUnlocked('unlock_stealth')) return;
      this.unitManager.getSelectedPhantoms().forEach(p => {
        if (p.canStealth()) {
          p.activateStealth();
          const { x, y } = p.getPosition();
          this.spawnFloatingText(x, y - 22, 'Stealth!', '#bb44ee');
        }
      });
    });

    // ── Shadow Clone — spawn a decoy when the Phantom activates it ────────────
    this.events.on('unit:shadowCloneCreated', (source: import('@/units/Unit').Unit) => {
      if (!source.isAlive()) return;
      const { tileX, tileY } = source.getCurrentTile();
      const cloneStats = { maxHealth: 30, attackDamage: 0, attackRangePx: 0, attackCooldownMs: 99999 };
      const clone = this.unitManager.spawnUnit(tileX, tileY, cloneStats, 'phantom');
      clone.isShadowClone = true;
      clone.canAttack = false;
      clone.sprite.setTint(source.sprite.tintTopLeft);
      clone.sprite.setAlpha(0.72);
      // Expire after 8 seconds
      this.time.delayedCall(8000, () => {
        if (clone.isAlive()) clone.takeDamage(9999);
      });
    });

    // ── Unit stances (H / V / G keys) ─────────────────────────────────────────
    this.events.on('input:setStance', (stance: import('@/units/Unit').UnitStance) => {
      this.unitManager.setStanceForSelected(stance);
      const labels: Record<string, string> = { aggressive: 'Aggressive', defensive: 'Defensive', hold: 'Hold Position' };
      const colors: Record<string, string> = { aggressive: '#ff8844',    defensive: '#44aaff',   hold: '#44ff88' };
      this.unitManager.getAllUnits()
        .filter(u => u.isSelected && u.isAlive() && u.faction === 'player' && !u.isWorker)
        .forEach(u => {
          const { x, y } = u.getPosition();
          this.spawnFloatingText(x, y - 22, labels[stance] ?? stance, colors[stance] ?? '#ffffff');
        });
    });

    // ── Unit abilities (C key — Overcharge / Shield Wall) ─────────────────────
    this.events.on('input:activateAbility', () => {
      this.unitManager.activateAbilityForSelected();
    });

    this.events.on('unit:abilityActivated', (unit: import('@/units/Unit').Unit, type: string) => {
      const { x, y } = unit.getPosition();
      if (type === 'overcharge')        this.spawnFloatingText(x, y - 22, '\u26a1 Overcharge!',   '#ffaa00');
      else if (type === 'shieldwall')   this.spawnFloatingText(x, y - 22, '\u26ca Shield Wall!',  '#4488ff');
      else if (type === 'divinepulse')  this.spawnFloatingText(x, y - 22, '\u2665 Divine Pulse!', '#44ffaa');
      else if (type === 'holynova')     this.spawnFloatingText(x, y - 22, '\u2605 Holy Nova!',    '#ffffd0');
      else if (type === 'shadowstep')   this.spawnFloatingText(x, y - 22, '\u2727 Shadow Step!',  '#bb44ee');
      else if (type === 'shadowclone')  this.spawnFloatingText(x, y - 22, '\u{1F465} Clone!',       '#bb44ee');
      else if (type === 'siege_deploy') this.spawnFloatingText(x, y - 22, '\u{1F6E1} Siege Mode!', '#ff8800');
      else if (type === 'siege_undeploy') this.spawnFloatingText(x, y - 22, '\u{1F6E1} Mobile Mode', '#ffcc44');
    });

    // Clear building selection when units are selected via drag
    this.events.on('input:unitsSelected', () => {
      this.selectedBuildings = [];
      this.updateBuildingSelectionRings();
      this.productionPanel.hide();
    });

    // ── G-key: Sacred Ground (Covenant) — heals nearby friendlies for 10s ───────
    this.events.on('input:sacredGround', () => {
      this.unitManager.selectedUnits.forEach(u => {
        if (u.isAlive() && u.faction === 'player' && u.canActivateSacredGround()) {
          u.activateSacredGround();
          const { x, y } = u.getPosition();
          this.spawnFloatingText(x, y - 22, '\u2665 Sacred Ground!', '#ffd700');
        }
      });
    });

    // Sacred Ground tick: heal all player units within range
    this.events.on('unit:sacredGroundTick', (cx: number, cy: number, radius: number, amount: number) => {
      this.unitManager.getLivingUnits()
        .filter(u => u.faction === 'player' && Math.hypot(u.getPosition().x - cx, u.getPosition().y - cy) <= radius)
        .forEach(u => {
          const healed = Math.min(amount, u.maxHealth - u.health);
          if (healed > 0) {
            u.health += healed;
            const { x, y } = u.getPosition();
            this.spawnFloatingText(x, y - 16, `+${healed}`, '#ffd700');
          }
        });
    });

    // ── R-key: Retreat selected non-devotee combat units toward HQ ────────────
    this.events.on('input:retreat', () => {
      if (!this.playerHQ) return;
      const { x: hqX, y: hqY } = this.playerHQ.getWorldCenter();
      const hqTileX = Math.floor(hqX / TILE_SIZE);
      const hqTileY = Math.floor(hqY / TILE_SIZE);
      let count = 0;
      this.unitManager.getAllUnits().forEach(u => {
        if (u.isSelected && u.isAlive() && u.faction === 'player'
          && !u.isWorker && u.unitTypeId !== 'devotee') {
          const fromTileX = Math.floor(u.getPosition().x / TILE_SIZE);
          const fromTileY = Math.floor(u.getPosition().y / TILE_SIZE);
          this.pathfinder.findPath(fromTileX, fromTileY, hqTileX, hqTileY, (path) => {
            u.beginRetreat(hqX, hqY, path ?? undefined);
          });
          count++;
        }
      });
      if (count > 0) this.showScreenMessage(`⚑ Retreat! (${count} unit${count > 1 ? 's' : ''})`, '#ff8844');
    });

    // ── Assassinate (Unseen — F2) ─────────────────────────────────────────────
    this.events.on('input:assassinate', () => {
      const unseenUnits = this.unitManager.getAllUnits().filter(
        u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isUnseenUnit && u.canAssassinate()
      );
      if (unseenUnits.length > 0) this._beginAssassinateTargeting();
    });

    this.events.on('unit:assassinateArrival', (_unit: import('@/units/Unit').Unit, x: number, y: number) => {
      const RADIUS = 60;
      const DAMAGE = 80;
      let nearestEnemy: import('@/units/Unit').Unit | null = null;
      let nearestDist = Infinity;
      this.unitManager.getLivingUnits().filter(u => u.faction === 'enemy').forEach(e => {
        const { x: ex, y: ey } = e.getPosition();
        const d = Math.hypot(ex - x, ey - y);
        if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
      });
      if (nearestEnemy && nearestDist <= RADIUS) {
        const enemy = nearestEnemy as import('@/units/Unit').Unit;
        const dealt = Math.max(1, DAMAGE - (enemy.armor ?? 0));
        enemy.takeDamage(dealt);
        const ep = enemy.getPosition();
        this.spawnFloatingText(ep.x, ep.y - 22, `-${dealt}`, '#880088');
      }
    });

    // ── Divine Wrath (Covenant — F3) ──────────────────────────────────────────
    this.events.on('input:divineWrath', () => {
      const covenantUnits = this.unitManager.getAllUnits().filter(
        u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isCovenantUnit && u.divineWrathCooldown <= 0
      );
      if (covenantUnits.length > 0) this._beginDivineWrathTargeting();
    });

    // ── Iron Bastion (Bulwark — N key) ────────────────────────────────────────
    this.events.on('input:ironBastion', () => {
      this.unitManager.getAllUnits()
        .filter(u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isBulwarkUnit && u.ironBastionCooldown <= 0)
        .forEach(u => this._placeIronBastion(u));
    });

    // ── E-key ability: Divine Pulse / Shadow Step / Stasis ───────────────────
    this.events.on('input:activateEAbility', () => {
      // Devotees: instant AoE heal
      this.unitManager.activateDivinePulseForSelected();

      // Arbiters: enter stasis targeting mode
      const stasisArbiters = this.unitManager.getSelectedArbiters().filter(a => a.canCastStasis());
      if (stasisArbiters.length > 0) this.beginStasisTargeting(stasisArbiters);

      // Phantoms: enter targeting mode if any can shadow-step
      const steppable = this.unitManager.getSelectedPhantomsShadowStep();
      if (steppable.length > 0) this.beginShadowStepTargeting();
    });

    // ── Hero unit abilities ───────────────────────────────────────────────────
    this.events.on('unit:heroAbility', (unit: import('@/units/Unit').Unit) => {
      const { x, y } = unit.getPosition();

      if (unit.unitTypeId === 'high_inquisitor') {
        // AoE Smite: 80 damage in radius 80
        const SMITE_RANGE = 80;
        const SMITE_DAMAGE = 80;
        let hit = 0;
        this.unitManager.getLivingUnits()
          .filter(u => u.faction === 'enemy' && u.fogVisible
            && Math.hypot(u.getPosition().x - x, u.getPosition().y - y) <= SMITE_RANGE)
          .forEach(enemy => {
            const dealt = Math.max(1, SMITE_DAMAGE - (enemy.armor ?? 0));
            enemy.takeDamage(dealt);
            const ep = enemy.getPosition();
            this.spawnFloatingText(ep.x, ep.y - 20, `-${dealt}`, '#ffcc44');
            hit++;
          });
        this.soundManager.ring(x, y, 0xffcc44, 20, 90, 500, 0.85);
        this.soundManager.flash(x, y, 0xffcc44, 14, 350);
        this.spawnFloatingText(x, y - 32, `⚡ Smite${hit > 0 ? ` ×${hit}` : ''}!`, '#ffcc44');

      } else if (unit.unitTypeId === 'prime_construct') {
        // Repair nearest damaged friendly building to full HP
        let nearest: Building | null = null;
        let nearestDist = Infinity;
        this.buildingManager.getBuildings()
          .filter(b => b.faction === 'player' && !b.isDestroyed() && b.getHealth() < b.def.maxHealth)
          .forEach(b => {
            const { x: bx, y: by } = b.getWorldCenter();
            const d = Math.hypot(bx - x, by - y);
            if (d < nearestDist) { nearest = b; nearestDist = d; }
          });
        if (nearest) {
          (nearest as Building).repairToFull();
          const { x: bx, y: by } = (nearest as Building).getWorldCenter();
          this.soundManager.flash(bx, by, 0x44ff88, 18, 500);
          this.soundManager.ring(bx, by, 0x44ff88, 18, 56, 480, 0.80);
          this.spawnFloatingText(bx, by - 32, '🔧 Repaired!', '#44ff88');
        } else {
          this.spawnFloatingText(x, y - 32, 'No damaged buildings', '#667788');
          unit.heroAbilityCooldownRemaining = 0; // refund — no valid target
        }

      } else if (unit.unitTypeId === 'void_walker') {
        // Reveal all cloaked enemies in radius 120
        const REVEAL_RANGE = 120;
        let revealed = 0;
        this.unitManager.getLivingUnits()
          .filter(u => u.faction === 'enemy' && u.isStealthed
            && Math.hypot(u.getPosition().x - x, u.getPosition().y - y) <= REVEAL_RANGE)
          .forEach(enemy => { enemy.applyFogVisibility(true); revealed++; });
        this.soundManager.ring(x, y, 0xbb44ee, 16, 130, 400, 0.75);
        this.spawnFloatingText(x, y - 32, `👁 ${revealed > 0 ? `Revealed ${revealed}!` : 'Area scanned'}`, '#bb44ee');

      } else if (unit.unitTypeId === 'iron_warden') {
        // Invuln ring already applied in Unit.activateHeroAbility()
        this.soundManager.ring(x, y, 0xffd700, 20, 54, 420, 0.9);
        this.soundManager.flash(x, y, 0xffd700, 12, 320);
        this.spawnFloatingText(x, y - 32, '🛡 Invulnerable!', '#ffd700');
      }
    });

    // ── Colossus thermal beam ─────────────────────────────────────────────────
    this.events.on('unit:colossusBeam', (caster: import('@/units/Unit').Unit, primaryTarget: import('@/units/Unit').Unit) => {
      this.executeColossusBeam(caster, primaryTarget);
    });

    // ── Siege Crawler splash damage ───────────────────────────────────────────
    this.events.on('unit:siegeSplash', (caster: import('@/units/Unit').Unit, targetX: number, targetY: number) => {
      this.executeSiegeSplash(caster, targetX, targetY);
    });

    // ── Siege mode floating labels ─────────────────────────────────────────────
    this.events.on('unit:siegeTransitionLabel', (unit: import('@/units/Unit').Unit, label: string) => {
      const { x, y } = unit.getPosition();
      this.spawnFloatingText(x, y - 22, label, '#ff8800');
    });

    // ── Void Reaver drain — convert 50% of damage dealt into juice ────────────
    this.events.on('unit:voidDrain', (damage: number, fromX: number, fromY: number) => {
      const juice = Math.max(1, Math.round(damage * 0.5));
      this.resources.addJuice(juice);
      this.spawnFloatingText(fromX, fromY - 20, `+${juice} 🜾`, '#cc44ff');
    });

    // ── Hero death: screen shake + white flash overlay ───────────────────────
    this.events.on('unit:heroDied', (unit: import('@/units/Unit').Unit) => {
      if (unit.faction === 'player') {
        this.cameras.main.shake(350, 0.012);
        // Full-screen white flash
        const overlay = this.add.rectangle(
          this.cameras.main.scrollX + this.cameras.main.width  / 2,
          this.cameras.main.scrollY + this.cameras.main.height / 2,
          this.cameras.main.width, this.cameras.main.height,
          0xffffff, 0.45
        ).setDepth(50).setScrollFactor(0);
        this.tweens.add({
          targets: overlay, alpha: 0, duration: 400, ease: 'Power2',
          onComplete: () => overlay.destroy(),
        });
      } else {
        this.cameras.main.shake(250, 0.008);
      }
    });

    // ── Idle worker — select next on HUD button or F key ─────────────────────
    this.events.on('hud:selectIdleWorker', () => this.selectNextIdleWorker());
    this.events.on('hud:selectIdleMilitary', () => {
      const IDLE_THRESHOLD_MS = 10000;
      const idleUnits = this.unitManager.getLivingUnits().filter(u => {
        if (u.faction !== 'player' || u.isWorker || u.isGarrisoned) return false;
        if ((u as any).fortifyActive || (u as any).stance === 'hold') return false;
        const t = this._idleMilitaryTimers.get(u.id) ?? 0;
        return t >= IDLE_THRESHOLD_MS;
      });
      if (idleUnits.length > 0) {
        this.unitManager.deselectAll();
        idleUnits.forEach(u => {
          this.unitManager.selectedUnits.add(u);
          u.setSelected(true);
        });
        const { x, y } = idleUnits[0].getPosition();
        this.cameras.main.pan(x, y, 300, 'Power2');
      }
    });

    // ── Holy Nova (R key) ─────────────────────────────────────────────────────
    this.events.on('input:activateHolyNova', () => {
      this.unitManager.activateHolyNovaForSelected();
      // Architects: Reconstruction Protocol (R key = repair mode)
      if (this.race === 'architects') {
        this.unitManager.getLivingUnits().filter(u =>
          u.faction === 'player' && u.isSelected && u.canActivateReconstructionProtocol()
        ).forEach(u => u.activateReconstructionProtocol());
      }
    });

    // Holy Nova AoE resolution: damage enemies + heal friendlies within 150px
    this.events.on('unit:holyNovaActivated', (caster: import('@/units/Unit').Unit) => {
      const NOVA_RANGE_PX = 150;
      const NOVA_DAMAGE   = 20;
      const NOVA_HEAL     = 20;
      const { x: cx, y: cy } = caster.getPosition();

      // Damage all visible enemy units in range
      this.unitManager.getLivingUnits()
        .filter(u => u.faction === 'enemy' && u.fogVisible
          && Math.hypot(u.getPosition().x - cx, u.getPosition().y - cy) <= NOVA_RANGE_PX)
        .forEach(enemy => {
          const dealt = Math.max(1, NOVA_DAMAGE - (enemy.armor ?? 0));
          enemy.takeDamage(dealt);
          const { x, y } = enemy.getPosition();
          this.spawnFloatingText(x, y - 20, `-${dealt}`, '#ff4466');
        });

      // Heal all friendly units in range
      this.unitManager.getLivingUnits()
        .filter(u => u.faction === 'player'
          && Math.hypot(u.getPosition().x - cx, u.getPosition().y - cy) <= NOVA_RANGE_PX)
        .forEach(ally => {
          const healed = ally.heal(NOVA_HEAL);
          if (healed > 0) {
            const { x, y } = ally.getPosition();
            this.spawnFloatingText(x, y - 20, `+${healed}`, '#ffffd0');
          }
        });
    });

    // ── Holy Nova V (V key — all Covenant units) ──────────────────────────────
    this.events.on('input:holyNovaV', () => {
      this.unitManager.activateHolyNovaVForSelected();
    });

    // Holy Nova V AoE: 25 damage to enemies within 120px, +15 heal to friendlies
    this.events.on('unit:holyNovaVActivated', (caster: import('@/units/Unit').Unit) => {
      const NOVA_RANGE_PX = 120;
      const NOVA_DAMAGE   = 25;
      const NOVA_HEAL     = 15;
      const { x: cx, y: cy } = caster.getPosition();

      this.unitManager.getLivingUnits()
        .filter(u => u.faction === 'enemy' && u.fogVisible
          && Math.hypot(u.getPosition().x - cx, u.getPosition().y - cy) <= NOVA_RANGE_PX)
        .forEach(enemy => {
          const dealt = Math.max(1, NOVA_DAMAGE - (enemy.armor ?? 0));
          enemy.takeDamage(dealt);
          const { x, y } = enemy.getPosition();
          this.spawnFloatingText(x, y - 20, `-${dealt}`, '#ff4466');
        });

      this.unitManager.getLivingUnits()
        .filter(u => u.faction === 'player'
          && Math.hypot(u.getPosition().x - cx, u.getPosition().y - cy) <= NOVA_RANGE_PX)
        .forEach(ally => {
          const healed = ally.heal(NOVA_HEAL);
          if (healed > 0) {
            const { x, y } = ally.getPosition();
            this.spawnFloatingText(x, y - 20, `+${healed}`, '#ffffff');
          }
        });
    });

    // ── Void Rift (Unseen passive kill trigger) ────────────────────────────────
    this.events.on('unit:voidRiftKill', (worldX: number, worldY: number) => {
      // Cap at VOID_RIFT_MAX — remove oldest if over limit
      if (this._voidRifts.length >= this.VOID_RIFT_MAX) {
        const oldest = this._voidRifts.shift()!;
        oldest.gfx.destroy();
      }
      // Create swirling purple vortex graphic
      const gfx = this.add.graphics().setDepth(18);
      this._voidRifts.push({
        x: worldX, y: worldY,
        timer: this.VOID_RIFT_DURATION_MS,
        gfx,
        spinAngle: 0,
        hitUnitIds: new Set(),
      });
    });

    // Divine Pulse AoE heal resolution
    this.events.on('unit:divinePulseActivated', (caster: import('@/units/Unit').Unit) => {
      const PULSE_RANGE_PX = 200;
      const PULSE_HEAL = 35;
      const { x: cx, y: cy } = caster.getPosition();
      this.unitManager.getLivingUnits()
        .filter(u => u.faction === 'player' && Math.hypot(u.getPosition().x - cx, u.getPosition().y - cy) <= PULSE_RANGE_PX)
        .forEach(ally => {
          const healed = ally.heal(PULSE_HEAL);
          if (healed > 0) {
            const { x, y } = ally.getPosition();
            this.spawnFloatingText(x, y - 20, `+${healed}`, '#44ffaa');
          }
        });
    });

    // ── Overcharge Turret (T key — Architects) ────────────────────────────────
    this.events.on('input:overchargeTurret', () => {
      if (this.race !== 'architects') return;
      let activated = 0;
      this.unitManager.getAllUnits().forEach(u => {
        if (!u.isSelected || !u.isAlive() || u.faction !== 'player' || u.isWorker) return;
        const cd = this._overchargeTurretCooldowns.get(u.id) ?? 0;
        if (cd > 0) return;
        const { x: ux, y: uy } = u.getPosition();
        // Find nearest powered turret within 200px
        let nearest: Building | null = null;
        let nearestDist = 201;
        this.buildingManager.getBuildings().forEach(b => {
          if (b.faction !== 'player' || b.isDestroyed() || !b.def.isTurret) return;
          const { x: bx, y: by } = b.getWorldCenter();
          const dist = Math.hypot(bx - ux, by - uy);
          if (dist <= 200 && dist < nearestDist) { nearestDist = dist; nearest = b; }
        });
        if (!nearest) return;
        this._overchargedTurrets.set((nearest as Building).id, 8000);
        this._overchargeTurretCooldowns.set(u.id, 40000);
        // Flash turret yellow/white
        const turretSprite = (nearest as any).sprite as Phaser.GameObjects.Image;
        if (turretSprite) {
          const nearestBuilding = nearest as Building;
          let flash = true;
          const flashInterval = this.time.addEvent({
            delay: 150,
            repeat: 10,
            callback: () => {
              if (nearestBuilding.isDestroyed()) { flashInterval.destroy(); return; }
              turretSprite.setTint(flash ? 0xffff44 : 0xffffff);
              flash = !flash;
            },
          });
          this.time.delayedCall(8000, () => {
            flashInterval.destroy();
            if (!nearestBuilding.isDestroyed()) turretSprite.clearTint();
          });
        }
        const { x: bx, y: by } = (nearest as Building).getWorldCenter();
        this.spawnFloatingText(bx, by - 22, '⚡ Overcharged!', '#ffff44');
        activated++;
      });
      if (activated === 0 && this.unitManager.getSelectedCount() > 0) {
        this.showScreenMessage('No turret in range (200px)', '#888888');
      }
    });

    // ── Deploy Drone (D key — Architects) ─────────────────────────────────────
    this.events.on('input:deployDrone', () => {
      if (this.race !== 'architects') return;
      this.unitManager.getAllUnits().forEach(u => {
        if (!u.isSelected || !u.isAlive() || u.faction !== 'player' || u.isWorker) return;
        const cd = this._droneCooldowns.get(u.id) ?? 0;
        if (cd > 0) return;
        const activeDroneCount = Array.from(this._droneTimers.values()).filter(e => e.ownerId === u.id).length;
        if (activeDroneCount >= 2) {
          const { x, y } = u.getPosition();
          this.spawnFloatingText(x, y - 22, 'Max drones!', '#888888');
          return;
        }
        const { x: ux, y: uy } = u.getPosition();
        const tileX = Math.floor(ux / TILE_SIZE);
        const tileY = Math.floor(uy / TILE_SIZE);
        const drone = this.unitManager.spawnUnit(tileX, tileY, {
          maxHealth: 40, attackDamage: 8, attackRangePx: 90, attackCooldownMs: 1500,
        }, 'drone');
        drone.sprite.setTint(0x88ddff);
        drone.sprite.setScale(0.65);
        (drone as any).speed = UNIT_SPEED * 0.6;
        (drone as any)._baseSpeed = UNIT_SPEED * 0.6;
        // Note: drone deaths are tracked via _droneTimers; onUnitDied will handle supply safely
        this._droneCooldowns.set(u.id, 15000);
        this._droneTimers.set(drone.id, { remainingMs: 20000, ownerId: u.id });
        this.spawnFloatingText(ux, uy - 22, '🤖 Drone!', '#88ddff');
      });
    });

    // ── War Cry (W key — Bulwark) ─────────────────────────────────────────────
    this.events.on('input:warCry', () => {
      if (this.race !== 'bulwark') return;
      this.unitManager.getAllUnits().forEach(u => {
        if (!u.isSelected || !u.isAlive() || u.faction !== 'player' || u.isWorker) return;
        const cd = this._warCryCooldowns.get(u.id) ?? 0;
        if (cd > 0) return;
        this._warCryCooldowns.set(u.id, 30000);
        const { x: ux, y: uy } = u.getPosition();
        // Expanding golden ring visual
        const ring = this.add.graphics().setDepth(20);
        const ringProxy = { r: 1 };
        this.tweens.add({
          targets: ringProxy, r: 200, duration: 500, ease: 'Power2',
          onUpdate: () => {
            ring.clear();
            ring.lineStyle(3, 0xffd700, 0.6 * (1 - ringProxy.r / 200));
            ring.strokeCircle(ux, uy, ringProxy.r);
          },
          onComplete: () => { ring.destroy(); },
        });
        // Boost nearby friendly units (+25% attack speed for 8s)
        const RANGE = 200;
        this.unitManager.getLivingUnits()
          .filter(ally => ally.faction === 'player'
            && Math.hypot(ally.getPosition().x - ux, ally.getPosition().y - uy) <= RANGE)
          .forEach(ally => {
            if (!this._warCryBuffs.has(ally.id)) {
              ally.attackSpeedMultiplier = (ally.attackSpeedMultiplier ?? 1.0) * 1.25;
            }
            this._warCryBuffs.set(ally.id, 8000);
            // Brief gold flash
            ally.sprite.setTint(0xffd700);
            this.time.delayedCall(400, () => { if (ally.isAlive()) ally.sprite.clearTint(); });
          });
        this.spawnFloatingText(ux, uy - 28, '📢 War Cry!', '#ffd700');
      });
    });

    // ── Aegis Shield (Z key — Covenant) ──────────────────────────────────────
    this.events.on('input:aegisShield', () => {
      if (this.race !== 'covenant') return;
      const RANGE = 150;
      const DURATION = 5000;
      const COOLDOWN = 50000;
      this.unitManager.getAllUnits().forEach(caster => {
        if (!caster.isSelected || !caster.isAlive() || caster.faction !== 'player') return;
        const cd = this._aegisShieldCooldowns.get(caster.id) ?? 0;
        if (cd > 0) return;
        const { x: cx, y: cy } = caster.getPosition();
        // Find nearest friendly unit or building within range (exclude self)
        let bestDist = RANGE + 1;
        let bestTarget: { id: string; x: number; y: number; isUnit: boolean } | null = null;
        this.unitManager.getLivingUnits().forEach(u => {
          if (u === caster || u.faction !== 'player') return;
          const { x, y } = u.getPosition();
          const d = Math.hypot(x - cx, y - cy);
          if (d < bestDist) { bestDist = d; bestTarget = { id: u.id, x, y, isUnit: true }; }
        });
        this.buildingManager.getBuildings().forEach(b => {
          if (b.faction !== 'player' || b.isDestroyed()) return;
          const { x, y } = b.getWorldCenter();
          const d = Math.hypot(x - cx, y - cy);
          if (d < bestDist) { bestDist = d; bestTarget = { id: b.id, x, y, isUnit: false }; }
        });
        if (!bestTarget) return;
        const t = bestTarget as { id: string; x: number; y: number; isUnit: boolean };
        // Apply shield to target
        if (t.isUnit) {
          const u = this.unitManager.getLivingUnits().find(u => u.id === t.id);
          if (u) u.isAegisShielded = true;
        } else {
          const b = this.buildingManager.getBuildings().find(b => b.id === t.id);
          if (b) b.isAegisShielded = true;
        }
        this._aegisShieldCooldowns.set(caster.id, COOLDOWN);
        // Visual: pulsing white/gold hexagon — drawn every frame in updateAegisShields
        const gfx = this.add.graphics().setDepth(21);
        // Store initial building position for static targets (buildings don't move)
        this._aegisShields.set(t.id, { remainingMs: DURATION, gfx, staticX: t.x, staticY: t.y, isUnit: t.isUnit, phaseMs: 0 });
        this.spawnFloatingText(t.x, t.y - 26, '🛡 Aegis!', '#ffd700');
      });
    });

    // ── EMP Pulse (X key — Architects) ───────────────────────────────────────
    this.events.on('input:empPulse', () => {
      if (this.race !== 'architects') return;
      const RANGE = 150;
      const STUN_MS = 3000;
      const COOLDOWN = 45000;
      this.unitManager.getAllUnits().forEach(caster => {
        if (!caster.isSelected || !caster.isAlive() || caster.faction !== 'player') return;
        const cd = this._empPulseCooldowns.get(caster.id) ?? 0;
        if (cd > 0) return;
        const { x: cx, y: cy } = caster.getPosition();
        // Stun all enemies in range
        let stunned = 0;
        this.unitManager.getLivingUnits().forEach(enemy => {
          if (enemy.faction !== 'enemy') return;
          const { x, y } = enemy.getPosition();
          if (Math.hypot(x - cx, y - cy) <= RANGE) {
            enemy.isEmpStunned = true;
            enemy.empStunRemaining = STUN_MS;
            enemy.stopMoving();
            (enemy as any).attackTarget = null;
            stunned++;
          }
        });
        this._empPulseCooldowns.set(caster.id, COOLDOWN);
        // Visual: expanding blue lightning ring
        const ring = this.add.graphics().setDepth(22);
        const ringProxy = { r: 1 };
        this.tweens.add({
          targets: ringProxy, r: RANGE,
          duration: 500, ease: 'Power2',
          onUpdate: () => {
            ring.clear();
            ring.lineStyle(3, 0x44aaff, 1 - ringProxy.r / RANGE);
            ring.strokeCircle(cx, cy, ringProxy.r);
            // Inner lightning spokes (4 arcs at 90° intervals)
            ring.lineStyle(1.5, 0x88ddff, 0.6 * (1 - ringProxy.r / RANGE));
            for (let i = 0; i < 4; i++) {
              const angle = (Math.PI / 2) * i;
              ring.lineBetween(cx, cy, cx + ringProxy.r * 0.7 * Math.cos(angle), cy + ringProxy.r * 0.7 * Math.sin(angle));
            }
          },
          onComplete: () => ring.destroy(),
        });
        this.spawnFloatingText(cx, cy - 28, '⚡ EMP!', '#44aaff');
        if (stunned === 0) this.spawnFloatingText(cx, cy - 10, '(no targets)', '#888888');
      });
    });

    // ── Global Upgrade Panel (U key) ──────────────────────────────────────────
    this.events.on('input:toggleUpgradePanel', () => this.toggleUpgradePanel());

    // ── Unit tooltip on hover ─────────────────────────────────────────────────
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const worldX = this.cameras.main.scrollX + pointer.x / this.cameras.main.zoom;
      const worldY = this.cameras.main.scrollY + pointer.y / this.cameras.main.zoom;
      let found: import('@/units/Unit').Unit | null = null;
      for (const u of this.unitManager.getLivingUnits()) {
        if (!u.isAlive() || (!u.fogVisible && u.faction === 'enemy')) continue;
        const { x, y } = u.getPosition();
        if (Math.hypot(x - worldX, y - worldY) < 18) { found = u; break; }
      }
      if (found !== this._tooltipHoverUnit) {
        this._tooltipHoverUnit = found;
        this._tooltipHoverTimer = 0;
        this._hideTooltip();
      }
    });

    // ── Under-attack alerts ───────────────────────────────────────────────────
    this.events.on('player:underAttack', (wx: number, wy: number) => {
      const now = this.time.now;
      if (now - this.lastUnderAttackAlertMs >= this.ALERT_COOLDOWN_MS) {
        this.lastUnderAttackAlertMs = now;
        this.showAlertBanner('\u26a0 Under Attack!', '#ff4444');
        this.showDirectionArrow(wx, wy, 0xff4444);
      }
    });

    // ── Camera bookmarks (F1-F4) ───────────────────────────────────────────────
    this.events.on('camera:bookmarkFlash', (msg: string) => {
      this.showScreenMessage(msg, '#ffff88');
    });

    const allRaceBuildings = getBuildingsForRace(this.race);
    this.buildMenu = new BuildMenu(this, this.resources, allRaceBuildings, this.resourceNodes);

    this.buildMenu.onBuildSelected = (def) => {
      this.productionPanel.hide();

      // Apply cost multiplier (Hope shrine) + Jonty +50
      let effectiveCost = Math.round(def.goldCost * this.buildCostMultiplier);
      if (this.race === 'covenant' && def.goldCost > 0) effectiveCost += 50;
      const raceDef = effectiveCost !== def.goldCost ? { ...def, goldCost: effectiveCost } : def;

      // Base resource-node validator
      let validator: ((tx: number, ty: number) => boolean) | undefined;
      if (raceDef.resourceType === 'gold')  validator = (tx, ty) => this.findNearestNode(tx, ty, 'gold')  !== null;
      if (raceDef.resourceType === 'juice') validator = (tx, ty) => this.findNearestNode(tx, ty, 'juice') !== null;

      // Finn (Bulwark): can't build within 3 tiles of any existing building.
      // Wall segments are exempt — they're meant to be placed flush against buildings.
      if (this.race === 'bulwark' && !raceDef.isWall) {
        const baseValidator = validator;
        validator = (tx, ty) => {
          const tooClose = this.buildingManager.getBuildings().some(b => {
            const dx = b.tileX - tx;
            const dy = b.tileY - ty;
            return Math.sqrt(dx * dx + dy * dy) <= 3;
          });
          if (tooClose) return false;
          return baseValidator ? baseValidator(tx, ty) : true;
        };
      }

      // Void Gate: max 2 active at a time
      if (raceDef.isVoidGate && this._voidGates.filter(g => !g.building.isDestroyed()).length >= 2) {
        const { x: hx, y: hy } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
        this.spawnFloatingText(hx, hy - 30, 'Max 2 Void Gates active!', '#cc44ff');
        return;
      }

      this.buildingPlacement.beginPlacement(raceDef, validator);
      this.buildingPlacement.onPlaced = (d, tx, ty) => {
        // Log for replay
        if (!this._replayMode) this._replayEventLog.push({ t: this.gameElapsedMs, type: 'build', defId: d.id, tileX: tx, tileY: ty });
        // Track when a supply-providing building is placed (for supply callout dismiss)
        if (d.supplyProvided > 0) this._lastSupplyBuildingBuiltMs = this.gameElapsedMs;
        if (this.race === 'architects') {
          this.beginHuwConstruction(d, tx, ty);
        } else if (this.race === 'unseen') {
          this.beginUnseenConstruction(d, tx, ty);
        } else {
          const b = this.placeAndLinkBuilding(d, tx, ty);
          if (b) {
            this.stats.buildingsBuilt++;
            this.lastPlayerActionMs = this.gameElapsedMs;
            const { x: bx, y: by } = b.getWorldCenter();
            this.events.emit('sound:buildingComplete', bx, by);
            // Finn (Bulwark): buildings have a construction delay before becoming active.
            if (this.race === 'bulwark') {
              b.beginConstruction(d.isWall ? 5000 : 10000);
            }
          }
        }
      };
    };

    this.productionPanel = new ProductionPanel(this, this.resources);
    this.commandCard   = new CommandCard(this);
    this.portraitPanel = new UnitPortraitPanel(this, this.race);
    this.productionPanel.purchasedUpgrades = this.purchasedUpgrades;
    this.productionPanel.getSupply = () => ({
      used: this.supplyUsed,
      cap: this.buildingManager.getTotalSupply() + this.bonusSupply,
    });
    this.productionPanel.getHeroBlock = () => {
      // Block if hero is alive
      if (this.activeHeroes.has(this.race)) return 'Hero already active';
      // Block if hero is on respawn cooldown
      const timer = this.heroRespawnTimers.get(this.race) ?? 0;
      if (timer > 0) return `Respawn: ${Math.ceil(timer / 1000)}s`;
      return null;
    };
    this.productionPanel.onUnitQueued = (_unitDef) => {
      // Supply is reserved only when the unit actually finishes production, not on queue
    };
    this.productionPanel.onShrineActivated = (shrine) => {
      this.activateShrineAbility(shrine);
    };
    this.productionPanel.onEjectWorkers = (mine) => {
      this.ejectWorkersFromMine(mine);
    };

    this.events.on('building:clicked', (building: Building) => {
      // Ellie hack targeting — intercept enemy building click
      if (this.targetingMode === 'hack' && building.faction === 'enemy' && !building.isDestroyed()) {
        this.endTargeting();
        building.hack(20000);
        this.spawnFloatingText(building.getWorldCenter().x, building.getWorldCenter().y - 30, 'HACKED!', '#ff4466');
        return;
      }

      if (building.faction === 'player' && !building.isDestroyed()) {
        // Mine / Juice Collector: garrison any selected workers
        if (building.def.id === 'mine' || building.def.id === 'juice_collector') {
          const workers = Array.from(this.unitManager.selectedUnits).filter(u => u.isWorker && u.isAlive());
          if (workers.length > 0) this.garrisonWorkersIntoMine(workers, building);
        }

        const shiftHeld = this.inputHandler.isShiftDown();

        if (shiftHeld && this.selectedBuildings.length > 0 &&
            this.selectedBuildings[0].def.id === building.def.id &&
            !this.selectedBuildings.includes(building)) {
          // Shift+click same type: add to multi-selection
          this.selectedBuildings.push(building);
        } else {
          // Normal click or different type: replace selection
          this.selectedBuildings = [building];
        }
        this.updateBuildingSelectionRings();

        this.productionPanel.hide();
        this.productionPanel.showMulti(this.selectedBuildings);
      }
    });

    this.buildingManager.onBuildingDestroyed = (building: Building) => {
      if (building.faction === 'player') this.stats.buildingsLost++;
      // Eject any garrisoned workers so they don't vanish permanently
      if (this.garrisonedWorkers.has(building.id)) this.ejectWorkersFromMine(building);
      // In multiplayer: when we kill an enemy mirror building, notify the opponent so
      // they destroy their own copy of that building on their screen.
      // Strip 'remote_' prefix (used for mirrors placed via place_building) to recover
      // the original building ID that exists on the opponent's screen.
      if (this.isMultiplayer && building.faction === 'enemy' && !this.gameOver) {
        const remoteId = building.id.startsWith('remote_') ? building.id.slice(7) : building.id;
        NetworkManager.instance.sendCommand({ type: 'building_destroyed', buildingId: remoteId });
      }
      if (building === this.playerHQ && !this.gameOver) this.endGame(false);
      if (building === this.enemyHQ && !this.gameOver && this.winCondition === 'hq') {
        // Blitzkrieg: destroy enemy HQ within 5 minutes
        this.checkAchievement('blitzkrieg', this.gameElapsedMs <= 300000);
        this.endGame(true);
      }
      // Annihilation: check after any enemy building is destroyed
      if (building.faction === 'enemy' && !this.gameOver && this.winCondition === 'annihilation') {
        this.checkAnnihilationWin();
      }
      // Kill feed: building destroyed
      if (building.faction === 'player') {
        this.addKillFeedEntry(`${building.def.name} lost`, false);
      } else {
        this.addKillFeedEntry(`${building.def.name} destroyed`, true);
      }
      // Camera shake on any building destruction
      this.cameras.main.shake(200, 0.005);
    };

    this.buildingManager.onUnitProduced = (unitDef, tileX, tileY, faction, building) => {
      if (faction === 'player') {
        // Population increases when the unit actually finishes production
        if (!unitDef.isUpgrade) this.supplyUsed++;
        // Log for replay
        if (!this._replayMode) this._replayEventLog.push({ t: this.gameElapsedMs, type: 'train', tileX, tileY, unitTypeId: unitDef.id });
        if (unitDef.isUpgrade) {
          this.applyUpgrade(unitDef.id);
        } else if (unitDef.id === 'worker') {
          const worker = this.unitManager.spawnWorker(tileX, tileY);
          this.sendWorkerToRallyThenAutoAssign(worker, building);
          this.lastPlayerActionMs = this.gameElapsedMs;
          // Sync worker to opponent
          if (this.isMultiplayer) {
            NetworkManager.instance.sendCommand({ type: 'spawn_unit', unitId: worker.id, tx: tileX, ty: tileY, race: this.race, unitTypeId: 'worker', isWorker: true });
          }
        } else {
          const stats = unitDef.combatStats ?? RACE_COMBAT_STATS[this.race];
          const unit  = this.unitManager.spawnUnit(tileX, tileY, stats, unitDef.id);
          this.sendToRallyOrPost(unit, building);
          this.stats.unitsTrained++;
          this.lastPlayerActionMs = this.gameElapsedMs;
          // Sync new unit to opponent, plus relay its rally-point move so it walks there too
          if (this.isMultiplayer) {
            const net = NetworkManager.instance;
            net.sendCommand({
              type: 'spawn_unit',
              unitId: unit.id,
              tx: tileX,
              ty: tileY,
              race: this.race,
              unitTypeId: unitDef.id,
              isHero:      unitDef.isHero     ?? false,
              isDetector:  unitDef.isDetector ?? false,
              isStealthed: unitDef.id === 'shadow_reaper',
            });
            const rally = building.getRallyTile();
            if (rally) {
              net.sendCommand({ type: 'move', unitMoves: [{ id: unit.id, tx: rally.tileX, ty: rally.tileY }] });
            }
          }
          // ── Hero unit setup ──────────────────────────────────────────────────
          if (unitDef.isHero) {
            unit.setAsHero();
            this.activeHeroes.set(this.race, unit);
            const { x, y } = unit.getPosition();
            this.spawnFloatingText(x, y - 36, '♛ Hero!', '#ffd700');
          }
          // ── Detector unit setup ───────────────────────────────────────────────
          if (unitDef.isDetector) {
            unit.isDetector = true;
            unit.buildDetectorRing();
          }
          // ── Permanently stealthed units ──────────────────────────────────────
          if (unitDef.id === 'shadow_reaper') {
            unit.isStealthed = true;
            (unit as any).isUnseenUnit = true;
          }
        }
      } else {
        // In singleplayer the AI spawns enemies; in multiplayer enemy units arrive via commands.
        if (!this.isMultiplayer) {
          this.unitManager.spawnEnemyUnit(tileX, tileY);
        }
      }
    };

    const { widthInPixels, heightInPixels } = this.mapManager.getMapDimensions();
    this.cameras.main.setBounds(0, 0, widthInPixels, heightInPixels);
    this.cameras.main.setZoom(1.0);
    if (this.isMultiplayer && this.mpPlayerIndex === 1) {
      this.cameras.main.centerOn(ENEMY_BASE_TILE.x * TILE_SIZE, ENEMY_BASE_TILE.y * TILE_SIZE);
    } else {
      this.cameras.main.centerOn(widthInPixels / 4, heightInPixels / 4);
    }
    this.cameras.main.fadeIn(400);

    // ── Score overlay (shown while TAB is held) ───────────────────────────────
    this.buildScoreOverlay();
    this.events.on('input:tabDown', () => {
      this.updateScorePanel();
      this.scoreOverlay?.setVisible(true);
    });
    this.events.on('input:tabUp', () => {
      this.scoreOverlay?.setVisible(false);
    });

    // ── Multiplayer bridge ─────────────────────────────────────────────────────
    if (this.isMultiplayer) {
      this.setupMultiplayerBridge();
    }

    // ── Screen edge vignette (subtle darkening to hint camera panning) ────────
    this.createEdgeVignette();

    // ── Move order line: draw fading lines from selected units to move target ──
    this.events.on('input:moveOrder', ({ worldX, worldY }: { worldX: number; worldY: number }) => {
      this.showMoveOrderLines(worldX, worldY);
    });

    // ── Replay event listeners ─────────────────────────────────────────────────
    this.events.on('replay:playerMove', (d: { tileX: number; tileY: number }) => {
      if (!this._replayMode) this._replayEventLog.push({ t: this.gameElapsedMs, type: 'move', tileX: d.tileX, tileY: d.tileY });
    });
    this.events.on('replay:playerAttackMove', (d: { tileX: number; tileY: number }) => {
      if (!this._replayMode) this._replayEventLog.push({ t: this.gameElapsedMs, type: 'attack_move', tileX: d.tileX, tileY: d.tileY });
    });

    // ── Hotkey help overlay ────────────────────────────────────────────────────
    this.events.on('input:toggleHelp', () => this.toggleHelpOverlay());

    // ── Replay mode setup ──────────────────────────────────────────────────────
    if (this._replayMode) {
      this.gameSpeed = 4;
      // Show replay badge
      const { width } = this.scale;
      this.add.text(width / 2, 44, '⏪ REPLAY  4×', {
        fontSize: '12px', color: '#88ccff', stroke: '#000', strokeThickness: 3,
        backgroundColor: '#00000066', padding: { x: 8, y: 3 },
      }).setScrollFactor(0).setDepth(9999).setOrigin(0.5, 0);
    }

    // ── Covenant Sanctuary Zone (S key) ───────────────────────────────────────
    this.events.on('input:sanctuaryZone', () => {
      if (this.race !== 'covenant') return;
      const hasCovenantSelected = this.unitManager.getAllUnits().some(
        u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isCovenantUnit
      );
      if (!hasCovenantSelected) return;
      this.placeSanctuaryZone();
    });

    // ── Enemy resource raid: path units to resource nodes ─────────────────────
    this.events.on('enemy:resourceRaid', (raiders: import('@/units/Unit').Unit[]) => {
      const aliveNodes = this.resourceNodes.filter(n => !n.isDepleted());
      if (aliveNodes.length === 0) return;
      const target = aliveNodes[Math.floor(Math.random() * aliveNodes.length)];
      raiders.forEach((unit, i) => {
        const tx = Math.max(1, Math.min(48, target.tileX + (i % 2)));
        const ty = Math.max(1, Math.min(38, target.tileY + Math.floor(i / 2)));
        const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
        this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
          if (!unit.isAlive()) return;
          if (path && path.length > 0) unit.setPath(path);
        });
      });
    });

    // ── Narrative intro (single-player only) ──────────────────────────────────
    if (!this.isMultiplayer && !this._replayMode) {
      this.showNarrativeIntro();
    }

    // Test mode: ?test in URL enables on start; Ctrl+G toggles in-game
    if (new URLSearchParams(window.location.search).has('test')) {
      this.setTestMode(true);
    }
    const ctrlKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    this.input.keyboard!.on('keydown-G', () => {
      if (ctrlKey.isDown) this.setTestMode(!this.resources.infiniteResources);
    });

    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const scene = this;
      (window as any).__SIBLING_WARS = {
        get gold() { return scene.resources.getGold(); },
        get gameOver() { return scene.gameOver; },
        get waveCount() { return scene.enemyAI.waveCount; },
        get playerUnitCount() {
          return scene.unitManager.getLivingUnits().filter((u: any) => u.faction === 'player').length;
        },
        get enemyUnitCount() {
          return scene.unitManager.getLivingUnits().filter((u: any) => u.faction === 'enemy').length;
        },
        get eliteGameTimerMs() { return (scene.enemyAI as any)._eliteGameTimerMs; },
        set eliteGameTimerMs(ms: number) { (scene.enemyAI as any)._eliteGameTimerMs = ms; },
        addGold(amount: number) { scene.resources.addGold(amount); },
        triggerWave() { (scene.enemyAI as any).launchAssaultWave(5); },
        endGame(won: boolean) { (scene as any).endGame(won); },
      };
    }
  }

  /**
   * Attaches NetworkManager listeners so that commands from the remote player
   * are executed locally, and local player actions are forwarded to the server.
   *
   * Command-based sync (lock-step lite):
   *  - Each player executes their own commands immediately locally.
   *  - They also send the command to the server which relays it to the other player.
   *  - The other player receives and executes the command on their end.
   *
   * For the initial version the "enemy" side mirrors the opponent: player 0 (host)
   * spawns on the left half, player 1 (joiner) spawns on the right half and controls
   * the "enemy" buildings/units from the other player's perspective.
   *
   * In a full P2P RTS this would require deterministic simulation. Here we use a
   * simplified approach: the AI is disabled and both players control their own units.
   * Remote commands are applied to units by looking up the unit id in the unit map.
   */
  private setupMultiplayerBridge(): void {
    const net = NetworkManager.instance;

    // Disable the AI — humans are playing both sides
    this.enemyAI.setEnabled(false);

    // Show player index badge so users can verify their role
    const badge = this.add.text(8, 8,
      `You are Player ${this.mpPlayerIndex + 1} (${this.race})`,
      { fontSize: '13px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 3 } }
    ).setScrollFactor(0).setDepth(9999);
    this.time.delayedCall(8000, () => badge.destroy());

    // ── Outgoing: intercept move commands ─────────────────────────────────────
    // Wrap moveSelectedUnits so every move is also forwarded to the opponent.
    // We send per-unit destinations (with formation offsets) so the remote screen
    // shows proper spread instead of every unit stacking on one tile.
    const origMove = this.unitManager.moveSelectedUnits.bind(this.unitManager);
    this.unitManager.moveSelectedUnits = (tx: number, ty: number) => {
      origMove(tx, ty);
      const units = Array.from(this.unitManager.selectedUnits).filter(u => u.isAlive());
      if (units.length === 0) return;
      // Build per-unit move entries: each unit now has a path destination set
      // by origMove, but we approximate by sending the same formation offsets.
      const unitMoves = units.map((u, i) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
        const STRIDE = 2;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ox = Math.round((col - (cols - 1) / 2) * STRIDE);
        const oy = Math.round((row - (Math.ceil(units.length / cols) - 1) / 2) * STRIDE);
        return { id: u.id, tx: tx + ox, ty: ty + oy };
      });
      net.sendCommand({ type: 'move', unitMoves });
    };

    // Wrap attackTargetUnit so right-clicking an enemy unit relays the command.
    const origAttack = this.unitManager.attackTargetUnit.bind(this.unitManager);
    this.unitManager.attackTargetUnit = (target) => {
      origAttack(target);
      const attackerIds = Array.from(this.unitManager.selectedUnits)
        .filter(u => u.isAlive() && u.canAttack)
        .map(u => u.id);
      if (attackerIds.length > 0) {
        const tile = target.getCurrentTile();
        net.sendCommand({ type: 'attack_target', attackerIds, targetId: target.id, tx: tile.tileX, ty: tile.tileY });
      }
    };

    // Wrap stopSelectedUnits so S-key stop is also relayed.
    const origStop = this.unitManager.stopSelectedUnits.bind(this.unitManager);
    this.unitManager.stopSelectedUnits = () => {
      origStop();
      const unitIds = Array.from(this.unitManager.selectedUnits).filter(u => u.isAlive()).map(u => u.id);
      if (unitIds.length > 0) net.sendCommand({ type: 'stop', unitIds });
    };

    // Wrap queueMoveSelectedUnits (Shift+right-click) to relay waypoints.
    // Use a distinct 'queue_move' type so the receiver appends rather than replaces.
    const origQueue = this.unitManager.queueMoveSelectedUnits.bind(this.unitManager);
    this.unitManager.queueMoveSelectedUnits = (tx: number, ty: number) => {
      origQueue(tx, ty);
      const units = Array.from(this.unitManager.selectedUnits).filter(u => u.isAlive());
      if (units.length === 0) return;
      const unitMoves = units.map((u, i) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
        const STRIDE = 2;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ox = Math.round((col - (cols - 1) / 2) * STRIDE);
        const oy = Math.round((row - (Math.ceil(units.length / cols) - 1) / 2) * STRIDE);
        return { id: u.id, tx: tx + ox, ty: ty + oy };
      });
      net.sendCommand({ type: 'queue_move', unitMoves });
    };

    // Intercept stance changes so the mirrored units use the same combat stance.
    const origSetStance = this.unitManager.setStanceForSelected.bind(this.unitManager);
    this.unitManager.setStanceForSelected = (stance: import('@/units/Unit').UnitStance) => {
      origSetStance(stance);
      const unitIds = Array.from(this.unitManager.selectedUnits)
        .filter(u => u.isAlive() && u.faction === 'player' && !u.isWorker)
        .map(u => u.id);
      if (unitIds.length > 0) net.sendCommand({ type: 'set_stance', stance, unitIds });
    };

    // Wrap startPatrolForSelected so patrol routes appear on both screens.
    const origPatrol = this.unitManager.startPatrolForSelected.bind(this.unitManager);
    this.unitManager.startPatrolForSelected = (toTileX: number, toTileY: number) => {
      origPatrol(toTileX, toTileY);
      const units = Array.from(this.unitManager.selectedUnits).filter(u => u.isAlive() && !u.isWorker && u.canAttack);
      if (units.length === 0) return;
      const patrols = units.map(u => {
        const { tileX: fromX, tileY: fromY } = u.getCurrentTile();
        return { id: u.id, fromTileX: fromX, fromTileY: fromY, toTileX, toTileY };
      });
      net.sendCommand({ type: 'patrol', patrols });
    };

    // Wrap moveSpecificUnits (minimap double-click: move idle military to clicked tile).
    const origMoveSpecific = this.unitManager.moveSpecificUnits.bind(this.unitManager);
    this.unitManager.moveSpecificUnits = (units: import('@/units/Unit').Unit[], tx: number, ty: number) => {
      origMoveSpecific(units, tx, ty);
      const alive = units.filter(u => u.isAlive() && u.faction === 'player');
      if (alive.length === 0) return;
      const cols = Math.max(1, Math.ceil(Math.sqrt(alive.length)));
      const rows = Math.ceil(alive.length / cols);
      const STRIDE = 2;
      const unitMoves = alive.map((u, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ox = Math.round((col - (cols - 1) / 2) * STRIDE);
        const oy = Math.round((row - (rows - 1) / 2) * STRIDE);
        return { id: u.id, tx: tx + ox, ty: ty + oy };
      });
      net.sendCommand({ type: 'move', unitMoves });
    };

    // ── Incoming: handle commands relayed from the other player ──────────────
    const commandHandler = (cmd: CommandPayload) => this.handleRemoteCommand(cmd);
    net.on('command', commandHandler);

    // ── Opponent disconnect ───────────────────────────────────────────────────
    net.on('player:left', () => {
      if (!this.gameOver) {
        this.showScreenMessage('Opponent disconnected — you win!', '#44ff88');
        // Give a short delay so the message is visible before the end screen
        this.time.delayedCall(2000, () => {
          if (!this.gameOver) this.endGame(true);
        });
      }
    });

    net.on('game:over', (data: { winnerId?: string }) => {
      if (!this.gameOver) {
        const won = data.winnerId === net.sessionId;
        this.endGame(won);
      }
    });

    // ── Initial unit sync — retry several times to survive any race condition ──
    const sendSync = () => {
      if (this.gameOver) return; // game ended before retry fired
      const myUnits = this.unitManager.getAllUnits()
        .filter(u => u.faction === 'player' && u.isAlive())
        .map(u => {
          const tile = u.getCurrentTile();
          return {
            id:          u.id,
            tileX:       tile.tileX,
            tileY:       tile.tileY,
            race:        this.race,
            isWorker:    u.isWorker,
            unitTypeId:  u.unitTypeId,
            isHero:      u.isHero,
            isDetector:  u.isDetector,
            isStealthed: u.isStealthed && !u.isWorker,
          };
        });
      net.sendCommand({ type: 'sync_units', units: myUnits });
    };
    // Send at 400 ms, 1500 ms, and 4000 ms — the receiving side deduplicates.
    setTimeout(sendSync, 400);
    setTimeout(sendSync, 1500);
    setTimeout(sendSync, 4000);
  }

  /**
   * Execute a command that arrived from the remote player.
   * Unit IDs are prefixed with the sender's player index so we can look them up.
   */
  private handleRemoteCommand(cmd: CommandPayload): void {
    if (this.gameOver) return; // discard late-arriving commands after game ends
    switch (cmd.type) {
      case 'move': {
        // New format: per-unit destinations with offsets already baked in
        const unitMoves = cmd.unitMoves as Array<{ id: string; tx: number; ty: number }> | undefined;
        // Legacy format: shared destination for all units
        const unitIds = cmd.unitIds as string[] | undefined;
        const tx = cmd.tx as number;
        const ty = cmd.ty as number;

        if (unitMoves) {
          unitMoves.forEach(({ id, tx: destX, ty: destY }) => {
            const unit = this.unitManager.getUnitById(id);
            if (!unit || !unit.isAlive() || unit.faction === 'player') return;
            const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
            this.pathfinder.findPath(fromX, fromY, destX, destY, (path) => {
              if (!unit.isAlive()) return;
              if (path && path.length > 0) unit.setPath(path);
            });
          });
        } else if (unitIds) {
          unitIds.forEach(id => {
            const unit = this.unitManager.getUnitById(id);
            if (!unit || !unit.isAlive() || unit.faction === 'player') return;
            const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
            this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
              if (!unit.isAlive()) return;
              if (path && path.length > 0) unit.setPath(path);
            });
          });
        }
        break;
      }
      case 'stop': {
        const unitIds = cmd.unitIds as string[];
        unitIds?.forEach(id => {
          const unit = this.unitManager.getUnitById(id);
          if (unit?.isAlive() && unit.faction !== 'player') unit.stopMoving();
        });
        break;
      }
      case 'attack_target': {
        // Remote player right-clicked an enemy unit — move the attacker units toward it
        const attackerIds = cmd.attackerIds as string[];
        const tx = cmd.tx as number;
        const ty = cmd.ty as number;
        attackerIds?.forEach(id => {
          const unit = this.unitManager.getUnitById(id);
          if (!unit || !unit.isAlive() || unit.faction === 'player') return;
          const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
          this.pathfinder.findPath(fromX, fromY, tx, ty, (path) => {
            if (!unit.isAlive()) return;
            if (path && path.length > 0) unit.setPath(path);
          });
        });
        break;
      }
      case 'spawn_unit': {
        // Remote player produced a unit from a building — create it as enemy faction
        const tx          = cmd.tx as number;
        const ty          = cmd.ty as number;
        const unitId      = (cmd.unitId    as string)  ?? '';
        const race        = (cmd.race      as Race)    ?? this.mpOpponentRace;
        const unitTypeId  = cmd.unitTypeId as string   | undefined;
        const isWorker    = cmd.isWorker   as boolean  | undefined;
        const isHero      = cmd.isHero     as boolean  | undefined;
        const isDetector  = cmd.isDetector as boolean  | undefined;
        const isStealthed = cmd.isStealthed as boolean | undefined;
        const stats       = isWorker ? WORKER_COMBAT_STATS : undefined;
        if (unitId) {
          const unit = this.unitManager.spawnEnemyUnitWithId(unitId, tx, ty, race, stats);
          if (unit) {
            if (unitTypeId)  unit.unitTypeId = unitTypeId;
            // unitTypeId must be set before setAsHero() so void_walker cloaking triggers correctly
            if (isHero)      unit.setAsHero();
            if (isDetector)  { unit.isDetector = true; unit.buildDetectorRing(); }
            if (isStealthed) {
              unit.isStealthed = true;
              if (unitTypeId === 'shadow_reaper') (unit as any).isUnseenUnit = true;
            }
          }
        } else {
          this.unitManager.spawnEnemyUnit(tx, ty, undefined, race);
        }
        break;
      }
      case 'sync_units': {
        // Opponent is sending their unit positions — create/update enemy versions.
        // spawnEnemyUnitWithId deduplicates so retries are safe.
        const units = cmd.units as Array<{
          id: string; tileX: number; tileY: number; race: Race;
          isWorker?: boolean; unitTypeId?: string;
          isHero?: boolean; isDetector?: boolean; isStealthed?: boolean;
        }>;
        units?.forEach(u => {
          const stats = u.isWorker ? WORKER_COMBAT_STATS : undefined;
          const unit  = this.unitManager.spawnEnemyUnitWithId(u.id, u.tileX, u.tileY, u.race, stats);
          if (unit) {
            if (u.unitTypeId && !unit.unitTypeId) unit.unitTypeId = u.unitTypeId;
            if (u.isHero     && !unit.isHero)    unit.setAsHero();
            if (u.isDetector && !unit.isDetector) { unit.isDetector = true; unit.buildDetectorRing(); }
            if (u.isStealthed && !unit.isStealthed) {
              unit.isStealthed = true;
              if (u.unitTypeId === 'shadow_reaper') (unit as any).isUnseenUnit = true;
            }
          }
        });
        break;
      }
      case 'set_stance': {
        const stance = cmd.stance as import('@/units/Unit').UnitStance;
        const unitIds = cmd.unitIds as string[];
        unitIds?.forEach(id => {
          const unit = this.unitManager.getUnitById(id);
          if (unit?.isAlive()) unit.setStance(stance);
        });
        break;
      }
      case 'patrol': {
        const patrols = cmd.patrols as Array<{ id: string; fromTileX: number; fromTileY: number; toTileX: number; toTileY: number }>;
        patrols?.forEach(p => {
          const unit = this.unitManager.getUnitById(p.id);
          if (unit?.isAlive()) unit.startPatrol(p.fromTileX, p.fromTileY, p.toTileX, p.toTileY);
        });
        break;
      }
      case 'queue_move': {
        // Shift+right-click waypoint — append to unit's order queue, don't replace path
        const queueMoves = cmd.unitMoves as Array<{ id: string; tx: number; ty: number }> | undefined;
        queueMoves?.forEach(({ id, tx: destX, ty: destY }) => {
          const unit = this.unitManager.getUnitById(id);
          if (!unit || !unit.isAlive()) return;
          unit.queueOrder(destX, destY);
        });
        break;
      }
      case 'place_building': {
        // Opponent placed a building — create an enemy-faction mirror on our screen
        // so our units can attack it and the pathfinder blocks those tiles correctly.
        const defId      = cmd.defId as string;
        const tx         = cmd.tx as number;
        const ty         = cmd.ty as number;
        const race       = (cmd.race as Race) ?? this.mpOpponentRace;
        const def        = getBuildingDefById(defId, race);
        const buildingId = cmd.buildingId as string | undefined;
        // Prefix with 'remote_' so the mirror ID never collides with our own building IDs.
        const forceId    = buildingId ? `remote_${buildingId}` : undefined;
        if (def) {
          this.buildingManager.placeBuilding(def, tx, ty, true, 'enemy', forceId);
        }
        break;
      }
      case 'building_destroyed': {
        // Opponent destroyed one of our buildings — kill it on our screen too.
        const rawId   = cmd.buildingId as string | undefined;
        if (!rawId) break;
        const building = this.buildingManager.getBuildingById(rawId);
        if (building && !building.isDestroyed()) {
          building.takeDamage(building.def.maxHealth * 10);
        }
        break;
      }
      case 'upgrade': {
        // Opponent researched an upgrade — apply the bonus to their mirror units/buildings.
        const upgradeType = cmd.upgradeType as 'attack' | 'armor' | 'bldghp' | 'speed';
        const delta       = (cmd.delta as number) ?? 3;
        if (upgradeType === 'attack') {
          this.unitManager.applyUpgradeToEnemies(delta, 0);
          this.events.emit('enemy:upgraded', 'attack', Math.round(this.unitManager.enemyAttackBonus / 3));
        } else if (upgradeType === 'armor') {
          this.unitManager.applyUpgradeToEnemies(0, delta);
          this.events.emit('enemy:upgraded', 'armor', Math.round(this.unitManager.enemyArmorBonus / 3));
        } else if (upgradeType === 'bldghp') {
          this.buildingManager.applyArmorUpgradeToEnemies(delta);
        } else if (upgradeType === 'speed') {
          this.unitManager.applyUpgradeToEnemies(0, 0, delta);
        }
        break;
      }
      default:
        break;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private spawnResources(): void {
    GOLD_POSITIONS.forEach(p  => this.resourceNodes.push(new ResourceNode(this, p.x, p.y, p.amount, 'gold')));
    JUICE_POSITIONS.forEach(p => this.resourceNodes.push(new ResourceNode(this, p.x, p.y, p.amount, 'juice')));
    this.spawnNeutralOutposts();

    // When a node depletes: stop any workers still assigned to it
    this.events.on('node:depleted', (node: ResourceNode) => {
      this.unitManager.getAllUnits().forEach(u => {
        if (!(u instanceof WorkerUnit) || u.miningNode !== node) return;
        if (u.miningState === 'harvesting') {
          // Worker is inside the mine — animate exit before stopping so they
          // don't snap to the impassable node-center tile.
          u.miningState = 'exiting_mine';
          u.animateExitMine(() => {
            if (u.miningState === 'exiting_mine') this.stopWorkerMining(u);
          });
        } else if (u.miningState !== 'to_hq') {
          // Skip workers already heading to HQ — they harvested the last batch and
          // depositAndContinue will call stopWorkerMining after depositing.
          // node:depleted fires 800ms after harvest() (inside the fade tween), so
          // any worker that harvested before depletion is already in 'to_hq' state.
          this.stopWorkerMining(u);
        }
      });
      // Show alert for player-side nodes
      const nodeWorldX = node.tileX * TILE_SIZE + TILE_SIZE / 2;
      const nodeWorldY = node.tileY * TILE_SIZE + TILE_SIZE / 2;
      this.spawnFloatingText(nodeWorldX, nodeWorldY - 20, 'Depleted!', '#ff8844');
    });
  }

  /**
   * Place 2–3 neutral gold outposts in the contested mid-map.
   * Both players can send workers to mine these for extra income.
   * Positions are randomised slightly each game within a safe mid-map band.
   */
  private spawnNeutralOutposts(): void {
    // Candidate anchor points spread across the mid-map band (tiles 18–32, 14–26)
    const anchors = [
      { x: 20, y: 17 },
      { x: 25, y: 20 },
      { x: 30, y: 16 },
    ];

    const count = 2 + Math.floor(Math.random() * 2); // 2 or 3 outposts
    for (let i = 0; i < count; i++) {
      const a = anchors[i];
      // Small random offset so outposts aren't at the exact same spot each game
      const jx = Math.floor(Math.random() * 3) - 1;
      const jy = Math.floor(Math.random() * 3) - 1;
      const tx = Math.max(16, Math.min(34, a.x + jx));
      const ty = Math.max(12, Math.min(28, a.y + jy));

      // Record for minimap rendering
      this._neutralOutpostTiles.push({ tileX: tx, tileY: ty });

      // Each outpost has 2 gold nodes placed side-by-side
      this.resourceNodes.push(new ResourceNode(this, tx,     ty,     800, 'gold'));
      this.resourceNodes.push(new ResourceNode(this, tx + 1, ty + 1, 800, 'gold'));

      // Visual marker: a small flag/beacon drawn in graphics
      const wx = tx * TILE_SIZE + TILE_SIZE;
      const wy = ty * TILE_SIZE + TILE_SIZE;
      const g = this.add.graphics().setDepth(4);
      // Pole
      g.lineStyle(2, 0xddccaa, 0.9);
      g.lineBetween(wx, wy + 8, wx, wy - 14);
      // Flag pennant
      g.fillStyle(0xffd700, 0.85);
      g.fillTriangle(wx, wy - 14, wx + 12, wy - 9, wx, wy - 4);
      // Base circle
      g.fillStyle(0xddccaa, 0.5);
      g.fillCircle(wx, wy + 8, 4);

      // Floating label
      const lbl = this.add.text(wx, wy - 22, 'Outpost', {
        fontSize: '9px', color: '#ffd700', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(5);
      // Gentle bob
      this.tweens.add({
        targets: lbl, y: wy - 25, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
  }

  private placeStartingHQ(): void {
    const [hqDef] = getBuildingsForRace(this.race);
    const isP1 = this.isMultiplayer && this.mpPlayerIndex === 1;
    const tx = isP1 ? ENEMY_BASE_TILE.x : BASE_TILE.x - 1;
    const ty = isP1 ? ENEMY_BASE_TILE.y : BASE_TILE.y - 3;
    this.playerHQ = this.buildingManager.placeBuilding(hqDef, tx, ty, true, 'player');
  }

  private placeEnemyHQ(): void {
    const [hqDef] = getBuildingsForRace(this.enemyRace);
    const isP1 = this.isMultiplayer && this.mpPlayerIndex === 1;
    const tx = isP1 ? BASE_TILE.x - 1 : ENEMY_BASE_TILE.x;
    const ty = isP1 ? BASE_TILE.y - 3 : ENEMY_BASE_TILE.y;
    this.enemyHQ = this.buildingManager.placeBuilding(hqDef, tx, ty, true, 'enemy');
  }

  /** Brief fade-in/out banner at game start announcing the enemy faction. */
  private showEnemyRaceBanner(): void {
    const raceName = this.enemyRace.charAt(0).toUpperCase() + this.enemyRace.slice(1);
    const tint = getRaceTint(this.enemyRace);
    const hex = `#${((tint >> 16) & 0xff).toString(16).padStart(2, '0')}${((tint >> 8) & 0xff).toString(16).padStart(2, '0')}${(tint & 0xff).toString(16).padStart(2, '0')}`;
    const screenW = this.scale.width;
    const label = this.add.text(screenW / 2, 56, `Enemy race: ${raceName}`, {
      fontSize: '12px', color: hex, stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9997).setAlpha(0);
    this.tweens.add({
      targets: label, alpha: 1, duration: 400, ease: 'Power1',
      onComplete: () => {
        this.tweens.add({
          targets: label, alpha: 0, duration: 1200, delay: 2800, ease: 'Power2',
          onComplete: () => label.destroy(),
        });
      },
    });
  }

  private spawnInitialUnits(): void {
    const stats = RACE_COMBAT_STATS[this.race];
    const typeId = RACE_UNIT_TYPES[this.race];
    if (this.isMultiplayer && this.mpPlayerIndex === 1) {
      const ex = ENEMY_BASE_TILE.x;
      const ey = ENEMY_BASE_TILE.y;
      this.unitManager.spawnUnit(ex - 2, ey - 1, stats, typeId);
      this.unitManager.spawnUnit(ex - 3, ey - 1, stats, typeId);
      this.unitManager.spawnUnit(ex - 2, ey + 1, stats, typeId);
      this.unitManager.spawnUnit(ex - 3, ey + 1, stats, typeId);
      this.unitManager.spawnWorker(ex - 2, ey + 3);
      this.unitManager.spawnWorker(ex - 3, ey + 3);
    } else {
      this.unitManager.spawnUnit(7, 4, stats, typeId);
      this.unitManager.spawnUnit(8, 4, stats, typeId);
      this.unitManager.spawnUnit(7, 6, stats, typeId);
      this.unitManager.spawnUnit(8, 6, stats, typeId);
      this.unitManager.spawnWorker(5, 7);
      this.unitManager.spawnWorker(6, 7);
    }
  }

  private findNearestNode(tileX: number, tileY: number, type: 'gold' | 'juice'): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestDist = Infinity;
    for (const node of this.resourceNodes) {
      if (node.type !== type || node.isDepleted()) continue;
      const dx = node.tileX - tileX;
      const dy = node.tileY - tileY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= RESOURCE_SNAP_RADIUS_TILES && dist < bestDist) { best = node; bestDist = dist; }
    }
    return best;
  }

  /** Place a building and link it to a resource node if applicable. */
  private placeAndLinkBuilding(def: import('@/buildings/definitions').BuildingDef, tx: number, ty: number, free = false): Building | null {
    const b = this.buildingManager.placeBuilding(def, tx, ty, free);
    if (b && def.resourceType) {
      const node = this.findNearestNode(tx, ty, def.resourceType);
      if (node) {
        b.linkResourceNode(node, this.resources);
        b.onCollectionTick = (amount, wx, wy) => {
          this.spawnFloatingText(wx, wy - 20, `+${amount} ${def.resourceType}`, def.resourceType === 'gold' ? '#ffd700' : '#cc88ff');
        };
      }
    }
    if (b && this.isMultiplayer) {
      NetworkManager.instance.sendCommand({ type: 'place_building', defId: def.id, tx, ty, race: this.race, buildingId: b.id });
    }
    return b;
  }

  /** Huw (Architects): selected worker walks to site, then builds for 5–10 seconds. */
  private beginHuwConstruction(def: import('@/buildings/definitions').BuildingDef, tx: number, ty: number): void {
    const worker = Array.from(this.unitManager.selectedUnits).find(u => u.isWorker && u.isAlive());
    if (!worker) {
      const { x: hx, y: hy } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.spawnFloatingText(hx, hy - 30, 'Select a worker first!', '#ff8844');
      return;
    }

    // Spend gold up-front (same as normal placement)
    if (!this.resources.spendGold(def.goldCost)) return;

    // Cancel any active mining assignment so the mining loop doesn't
    // fight over the worker while it's building
    const workerUnit = worker as WorkerUnit;
    if (workerUnit.miningState !== 'idle') this.stopWorkerMining(workerUnit);

    const worldX = (tx + def.tileWidth  / 2) * TILE_SIZE;
    const worldY = (ty + def.tileHeight / 2) * TILE_SIZE;
    const w = def.tileWidth  * TILE_SIZE;
    const h = def.tileHeight * TILE_SIZE;

    // Construction site marker
    const site = this.add.rectangle(worldX, worldY, w, h, 0xffcc00, 0.18).setDepth(5).setStrokeStyle(2, 0xffcc00, 0.8);
    const label = this.add.text(worldX, worldY - h / 2 - 12, 'Travelling…', {
      fontSize: '10px', color: '#ffcc00', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(6);
    const progressBg = this.add.rectangle(worldX, worldY + h / 2 + 8, w, 5, 0x222222).setDepth(6);
    const progressBar = this.add.rectangle(worldX - w / 2, worldY + h / 2 + 8, 0, 5, 0xffcc00).setOrigin(0, 0.5).setDepth(6);

    let constructionDone = false;
    let siteCleaned = false;
    let constructionTicker: Phaser.Time.TimerEvent | null = null;
    const cleanup = () => {
      if (siteCleaned) return;
      siteCleaned = true;
      // Cancel the build ticker so the building isn't placed for free after a worker-death refund
      if (constructionTicker) { constructionTicker.destroy(); constructionTicker = null; }
      site.destroy(); label.destroy(); progressBg.destroy(); progressBar.destroy();
      this.events.off('unit:died', onWorkerDied);
    };

    // If the worker dies in transit (path or walk), refund gold and clear the site UI.
    const onWorkerDied = (unit: import('@/units/Unit').Unit) => {
      if (unit !== worker || constructionDone) return;
      this.resources.addGold(def.goldCost);
      cleanup();
    };
    this.events.on('unit:died', onWorkerDied);

    const { tileX, tileY } = worker.getCurrentTile();
    this.pathfinder.findPath(tileX, tileY, tx, ty, (path) => {
      if (!worker.isAlive() || !path || path.length === 0) {
        if (worker.isAlive()) this.resources.addGold(def.goldCost); // refund only if alive (death handler refunds otherwise)
        cleanup();
        return;
      }
      worker.setPath(path, () => {
        // Worker arrived — start build timer
        label.setText('Building…');
        const buildMs = 5000 + Math.random() * 5000;
        const startTime = this.time.now;
        constructionTicker = this.time.addEvent({
          delay: 50, loop: true,
          callback: () => {
            const elapsed = this.time.now - startTime;
            progressBar.width = Math.min(elapsed / buildMs, 1) * w;
            if (elapsed >= buildMs) {
              constructionDone = true;
              cleanup();
              const built = this.placeAndLinkBuilding(def, tx, ty, true); // free — gold already spent
              if (built) {
                this.stats.buildingsBuilt++;
                const { x: bx, y: by } = built.getWorldCenter();
                this.events.emit('sound:buildingComplete', bx, by);
              }
            }
          },
        });
      });
    });
  }

  /** Marcus (Unseen): selected worker walks to site, building appears on arrival, worker dies. */
  private beginUnseenConstruction(def: import('@/buildings/definitions').BuildingDef, tx: number, ty: number): void {
    const worker = Array.from(this.unitManager.selectedUnits).find(u => u.isWorker && u.isAlive());
    if (!worker) {
      const { x: hx, y: hy } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.spawnFloatingText(hx, hy - 30, 'Select a worker first!', '#ff8844');
      return;
    }

    if (!this.resources.spendGold(def.goldCost)) return;

    const workerUnit = worker as WorkerUnit;
    if (workerUnit.miningState !== 'idle') this.stopWorkerMining(workerUnit);

    const worldX = (tx + def.tileWidth  / 2) * TILE_SIZE;
    const worldY = (ty + def.tileHeight / 2) * TILE_SIZE;
    const w = def.tileWidth  * TILE_SIZE;
    const h = def.tileHeight * TILE_SIZE;

    // Ghost outline so the player can see where the building will appear
    const site = this.add.rectangle(worldX, worldY, w, h, 0xbb44ee, 0.15)
      .setDepth(5).setStrokeStyle(2, 0xbb44ee, 0.7);
    const label = this.add.text(worldX, worldY - h / 2 - 12, 'Travelling…', {
      fontSize: '10px', color: '#cc88ff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(6);

    let done = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      site.destroy();
      label.destroy();
      this.events.off('unit:died', onWorkerDied);
    };

    const onWorkerDied = (unit: import('@/units/Unit').Unit) => {
      if (unit !== worker || done) return;
      this.resources.addGold(def.goldCost); // refund if worker dies in transit
      cleanup();
    };
    this.events.on('unit:died', onWorkerDied);

    const { tileX, tileY } = worker.getCurrentTile();
    this.pathfinder.findPath(tileX, tileY, tx, ty, (path) => {
      if (!worker.isAlive() || !path || path.length === 0) {
        if (worker.isAlive()) this.resources.addGold(def.goldCost);
        cleanup();
        return;
      }
      worker.setPath(path, () => {
        done = true;
        cleanup();
        const built = this.placeAndLinkBuilding(def, tx, ty, true);
        if (built) {
          this.stats.buildingsBuilt++;
          const { x: bx, y: by } = built.getWorldCenter();
          this.events.emit('sound:buildingComplete', bx, by);
          if (built.def.id === 'shade_spire') this.createShadeSpireZone(built);
          if (built.def.isVoidGate) this.registerVoidGate(built);
        }
        // Sacrifice the worker on arrival
        worker.takeDamage(9999);
      });
    });
  }

  // ── Garrison ───────────────────────────────────────────────────────────────

  private garrisonWorkersIntoMine(workers: import('@/units/Unit').Unit[], mine: Building): void {
    const { x: mineWorldX, y: mineWorldY } = mine.getWorldCenter();

    const enterMine = (worker: import('@/units/Unit').Unit) => {
      if (mine.isDestroyed() || !mine.garrisonWorker()) return;
      worker.isGarrisoned = true;
      worker.setSelected(false);
      this.unitManager.selectedUnits.delete(worker);
      // Suppress health bar / shadow immediately so nothing floats outside the mine
      worker.hideForGarrison();
      // Animate worker shrinking into mine centre
      if (worker instanceof WorkerUnit) {
        worker.animateEnterMine(mineWorldX, mineWorldY, () => {
          worker.sprite.setVisible(false);
          worker.sprite.setAlpha(1).setScale(1);
        });
      }
      const list = this.garrisonedWorkers.get(mine.id) ?? [];
      list.push(worker);
      this.garrisonedWorkers.set(mine.id, list);
    };

    workers.forEach(worker => {
      if (worker instanceof WorkerUnit && worker.miningState !== 'idle') {
        this.stopWorkerMining(worker);
      }
      const { tileX, tileY } = worker.getCurrentTile();

      // Tiles adjacent to the mine footprint, sorted nearest-first
      const adj: { x: number; y: number }[] = [];
      for (let dx = 0; dx < mine.def.tileWidth; dx++) {
        adj.push({ x: mine.tileX + dx, y: mine.tileY - 1 });
        adj.push({ x: mine.tileX + dx, y: mine.tileY + mine.def.tileHeight });
      }
      for (let dy = 0; dy < mine.def.tileHeight; dy++) {
        adj.push({ x: mine.tileX - 1,                 y: mine.tileY + dy });
        adj.push({ x: mine.tileX + mine.def.tileWidth, y: mine.tileY + dy });
      }
      adj.sort((a, b) =>
        (Math.abs(a.x - tileX) + Math.abs(a.y - tileY)) -
        (Math.abs(b.x - tileX) + Math.abs(b.y - tileY))
      );

      // Already adjacent — enter immediately
      if (adj.some(d => d.x === tileX && d.y === tileY)) {
        enterMine(worker);
        return;
      }

      // Path to nearest reachable adjacent tile; first result wins
      let resolved = false;
      for (const dest of adj) {
        this.pathfinder.findPath(tileX, tileY, dest.x, dest.y, (path) => {
          if (resolved || !worker.isAlive() || mine.isDestroyed() || !path || path.length === 0) return;
          resolved = true;
          worker.setPath(path, () => enterMine(worker));
        });
      }
    });
  }

  private ejectWorkersFromMine(mine: Building): void {
    const workers = this.garrisonedWorkers.get(mine.id) ?? [];
    workers.forEach((worker, i) => {
      worker.isGarrisoned = false;
      const exitX = (mine.tileX + mine.def.tileWidth + 1 + (i % 3)) * TILE_SIZE + TILE_SIZE / 2;
      const exitY = (mine.tileY + mine.def.tileHeight + Math.floor(i / 3)) * TILE_SIZE + TILE_SIZE / 2;
      worker.sprite.setPosition(exitX, exitY);
      worker.showAfterGarrison();
    });
    this.garrisonedWorkers.delete(mine.id);
    mine.ejectAllWorkers();
  }

  // ── Shrine abilities ────────────────────────────────────────────────────────

  private activateShrineAbility(shrine: Building): void {
    if (!shrine.isAbilityReady()) return;
    shrine.activateAbility();

    switch (shrine.def.id) {
      case 'shrine_hope':    this.activateHope();              break;
      case 'shrine_ellie':   this.beginTargeting('hack');       break;
      case 'shrine_anna':    this.activateAnna();               break;
      case 'shrine_olivia':  this.beginTargeting('bomb');       break;
    }
  }

  private activateHope(): void {
    this.buildCostMultiplier = 0.6;
    this.spawnFloatingText(
      this.playerHQ?.getWorldCenter().x ?? 400,
      (this.playerHQ?.getWorldCenter().y ?? 300) - 30,
      'Hope: buildings 40% cheaper for 30s', '#88ccff'
    );
    this.time.delayedCall(30000, () => {
      this.buildCostMultiplier = 1.0;
      this.spawnFloatingText(
        this.playerHQ?.getWorldCenter().x ?? 400,
        (this.playerHQ?.getWorldCenter().y ?? 300) - 30,
        'Hope faded', '#446688'
      );
    });
  }

  private activateAnna(): void {
    this.bonusSupply += 20;
    this.spawnFloatingText(
      this.playerHQ?.getWorldCenter().x ?? 400,
      (this.playerHQ?.getWorldCenter().y ?? 300) - 30,
      'Anna: +20 population cap', '#ffaa44'
    );
  }

  private beginTargeting(mode: 'hack' | 'bomb'): void {
    this.targetingMode = mode;
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0, 0)
      .setScrollFactor(0).setDepth(9990).setInteractive().setOrigin(0.5);
    this.targetingOverlay = overlay;

    const hint = mode === 'bomb'
      ? '🎯 Click target tile for BUNKER BUSTER  (ESC to cancel)'
      : '🎯 Click enemy building to HACK  (ESC to cancel)';
    this.targetingHintText = this.add.text(width / 2, 60, hint, {
      fontSize: '13px', color: '#ffaa44', stroke: '#000', strokeThickness: 3,
    }).setScrollFactor(0).setDepth(9991).setOrigin(0.5);

    overlay.once('pointerdown', (_p: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      const pointer = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const capturedMode = this.targetingMode;
      this.endTargeting();
      if (capturedMode === 'bomb') this.detonateBomb(world.x, world.y);
      else this.executeHackAt(world.x, world.y);
    });

    this.input.keyboard?.once('keydown-ESC', () => this.endTargeting());
  }

  private endTargeting(): void {
    this.targetingMode = 'none';
    this.targetingOverlay?.destroy();
    this.targetingOverlay = null;
    this.targetingHintText?.destroy();
    this.targetingHintText = null;
  }

  private executeHackAt(worldX: number, worldY: number): void {
    let nearest: Building | null = null;
    let nearestDist = Infinity;
    this.buildingManager.getBuildings()
      .filter(b => b.faction === 'enemy' && !b.isDestroyed())
      .forEach(b => {
        const { x, y } = b.getWorldCenter();
        const dist = Math.sqrt((x - worldX) ** 2 + (y - worldY) ** 2);
        if (dist < nearestDist) { nearest = b; nearestDist = dist; }
      });
    if (nearest) {
      (nearest as Building).hack(20000);
      const { x, y } = (nearest as Building).getWorldCenter();
      this.spawnFloatingText(x, y - 30, 'HACKED!', '#ff4466');
    } else {
      this.spawnFloatingText(worldX, worldY - 20, 'No target', '#667788');
    }
  }

  private detonateBomb(worldX: number, worldY: number): void {
    const RADIUS = 130;

    // Screen shake
    this.cameras.main.shake(220, 0.011);

    // Outer blast ring
    const blast = this.add.arc(worldX, worldY, RADIUS, 0, 360, false, 0xff6600, 0.6).setDepth(55).setScale(0);
    this.tweens.add({ targets: blast, scaleX: 1, scaleY: 1, alpha: 0, duration: 700, ease: 'Power2', onComplete: () => blast.destroy() });

    // Inner white flash
    const flash = this.add.arc(worldX, worldY, RADIUS * 0.55, 0, 360, false, 0xffffff, 1).setDepth(56).setScale(0);
    this.tweens.add({ targets: flash, scaleX: 1, scaleY: 1, alpha: 0, duration: 350, ease: 'Power3', onComplete: () => flash.destroy() });

    // Damage enemies in radius
    this.unitManager.getLivingUnits()
      .filter(u => u.faction === 'enemy')
      .forEach(u => {
        const { x, y } = u.getPosition();
        if (Math.hypot(x - worldX, y - worldY) <= RADIUS) u.takeDamage(250);
      });

    this.buildingManager.getBuildings()
      .filter(b => b.faction === 'enemy' && !b.isDestroyed())
      .forEach(b => {
        const { x, y } = b.getWorldCenter();
        if (Math.hypot(x - worldX, y - worldY) <= RADIUS) b.takeDamage(200);
      });

    this.spawnFloatingText(worldX, worldY - 40, '💥 INCOMING', '#ff6600');
  }

  /** Apply a completed upgrade from the academy. */
  private applyUpgrade(upgradeId: string): void {
    if (this.purchasedUpgrades.has(upgradeId)) return; // duplicate queue entry check
    this.purchasedUpgrades.add(upgradeId);

    // Ability unlock upgrades
    if (upgradeId.startsWith('unlock_')) {
      this.unitManager.unlockAbility(upgradeId);
      const { x, y } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.events.emit('sound:upgradeComplete', x, y);
      const abilityLabels: Record<string, string> = {
        unlock_overcharge:   '⚡ Overcharge unlocked',
        unlock_shield_wall:  '🛡 Shield Wall unlocked',
        unlock_stealth:      '👁 Stealth unlocked',
        unlock_shadow_clone: '✦ Shadow Clone unlocked',
        unlock_phase_shift:  '◈ Phase Shift unlocked',
        unlock_divine_pulse: '✦ Divine Pulse unlocked',
        unlock_holy_nova:    '✦ Holy Nova unlocked',
      };
      this.spawnFloatingText(x, y - 40, abilityLabels[upgradeId] ?? '✦ Ability unlocked', '#aaddff');
      return;
    }

    const isAttack = upgradeId.includes('attack');
    if (isAttack) {
      this.unitManager.attackBonus += 3;
      this.unitManager.applyUpgradeToAll(3, 0);
    } else {
      this.unitManager.armorBonus += 3;
      this.unitManager.applyUpgradeToAll(0, 3);
    }
    if (this.isMultiplayer) {
      NetworkManager.instance.sendCommand({ type: 'upgrade', upgradeType: isAttack ? 'attack' : 'armor', delta: 3 });
    }
    const { x, y } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
    this.events.emit('sound:upgradeComplete', x, y);
    this.spawnFloatingText(x, y - 40, isAttack ? '⚔ Weapons +3' : '🛡 Armor +3', isAttack ? '#ffaa44' : '#44aaff');
  }

  /**
   * Unlock an achievement by id if the condition is true and it isn't already unlocked.
   * Shows a brief toast notification.
   */
  private checkAchievement(id: string, condition: boolean): void {
    const a = this.achievements.find(x => x.id === id);
    if (!a || a.unlocked || !condition) return;
    a.unlocked = true;
    const { width } = this.scale;
    // Slide in from top-right corner
    const toast = this.add.text(
      width + 10, 52,
      `${a.icon} ${a.label}`, {
        fontSize: '13px', color: '#ffd700', stroke: '#000', strokeThickness: 3,
        backgroundColor: '#1a0e00dd', padding: { x: 10, y: 6 },
      }
    ).setOrigin(1, 0).setScrollFactor(0).setDepth(9995);
    this.tweens.add({
      targets: toast, x: width - 10, duration: 380, ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: toast, alpha: 0, delay: 2800, duration: 600,
          onComplete: () => toast.destroy(),
        });
      },
    });
  }

  // ── HQ Passive Auras ────────────────────────────────────────────────────────

  /** Draws a subtle pulsing aura ring around the player's starting HQ. */
  private addHQAuraVisual(): void {
    if (!this.playerHQ) return;
    const { x, y } = this.playerHQ.getWorldCenter();
    const tint = getRaceTint(this.race);

    const gfx = this.add.graphics().setDepth(5);
    gfx.fillStyle(tint, 1);
    gfx.fillCircle(x, y, this.HQ_AURA_RADIUS_PX);
    gfx.lineStyle(2, tint, 1);
    gfx.strokeCircle(x, y, this.HQ_AURA_RADIUS_PX);
    gfx.setAlpha(0.1);

    this.tweens.add({
      targets: gfx,
      alpha: { from: 0.06, to: 0.18 },
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // ── Architects Pylon Power Grid ────────────────────────────────────────────

  /**
   * Each frame: for Architects, find all powered pylons (including HQ) and
   * update the `isPowered` state of every building that requiresPower.
   * Run every 4 frames — power rarely changes quickly.
   */
  private updatePylonPower(): void {
    if (this.race !== 'architects') return;

    // Collect power sources: Pylons + HQ (which also has isPylon: true)
    const powerSources = this.buildingManager.getBuildings().filter(
      b => b.faction === 'player' && !b.isDestroyed() && b.def.isPylon
    );

    this.buildingManager.getBuildings()
      .filter(b => b.faction === 'player' && !b.isDestroyed() && b.def.requiresPower)
      .forEach(b => {
        const { x: bx, y: by } = b.getWorldCenter();
        const powered = powerSources.some(ps => {
          const { x: px, y: py } = ps.getWorldCenter();
          const range = ps.def.pylonRangePx ?? 240;
          return Math.hypot(bx - px, by - py) <= range;
        });
        b.setPowered(powered);
      });
  }

  /** Per-frame passive ability tick for each race's HQ. */
  private updateHQPassives(delta: number): void {
    const hq = this.playerHQ;
    if (!hq) return;

    const destroyed = hq.isDestroyed();
    const { x: hqX, y: hqY } = hq.getWorldCenter();

    switch (this.race) {
      // ── Covenant: Healing Aura — periodically restore HP to nearby player units ──
      case 'covenant': {
        if (destroyed) break;
        this.hqPassiveTimer += delta;
        if (this.hqPassiveTimer >= this.HQ_HEAL_TICK_MS) {
          this.hqPassiveTimer = 0;
          this.unitManager.getLivingUnits()
            .filter(u => u.faction === 'player')
            .forEach(u => {
              const { x, y } = u.getPosition();
              if (Math.hypot(x - hqX, y - hqY) <= this.HQ_AURA_RADIUS_PX) {
                const healed = u.heal(8);
                if (healed > 0) this.spawnFloatingText(x, y - 20, `+${healed}`, '#44ff88');
              }
            });
        }
        break;
      }

      // ── Architects: Overclock Aura — nearby units attack 25% faster ──
      case 'architects': {
        this.unitManager.getLivingUnits()
          .filter(u => u.faction === 'player' && !u.isWorker)
          .forEach(u => {
            const { x, y } = u.getPosition();
            const inAura = !destroyed && Math.hypot(x - hqX, y - hqY) <= this.HQ_AURA_RADIUS_PX;
            u.attackSpeedMultiplier = inAura ? 1.25 : 1.0;
          });
        break;
      }

      // ── Unseen: Cloak Field — HQ turns semi-transparent when no enemies nearby ──
      case 'unseen': {
        if (destroyed) break;
        const enemiesNearby = this.unitManager.getLivingUnits()
          .some(u => u.faction === 'enemy' && Math.hypot(u.getPosition().x - hqX, u.getPosition().y - hqY) <= this.HQ_AURA_RADIUS_PX);
        hq.cloakField(!enemiesNearby);
        break;
      }

      // ── Bulwark: Fortify — nearby player buildings gain +4 armor ──
      case 'bulwark': {
        this.hqPassiveTimer += delta;
        if (this.hqPassiveTimer >= this.HQ_ARMOR_TICK_MS) {
          this.hqPassiveTimer = 0;
          this.buildingManager.getBuildings()
            .filter(b => b.faction === 'player')
            .forEach(b => {
              const { x, y } = b.getWorldCenter();
              b.armorBonus = (!destroyed && Math.hypot(x - hqX, y - hqY) <= this.HQ_AURA_RADIUS_PX) ? 4 : 0;
            });
        }
        break;
      }
    }
  }

  // ── Worker auto-mining ─────────────────────────────────────────────────────

  /** Find the closest non-depleted resource node within radiusPx of a world point. */
  private findNearestNodeAtPoint(worldX: number, worldY: number, radiusPx: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestDist = radiusPx;
    for (const node of this.resourceNodes) {
      if (node.isDepleted()) continue;
      const nx = node.tileX * TILE_SIZE + TILE_SIZE / 2;
      const ny = node.tileY * TILE_SIZE + TILE_SIZE / 2;
      const dist = Math.hypot(nx - worldX, ny - worldY);
      if (dist < bestDist) { best = node; bestDist = dist; }
    }
    return best;
  }

  /**
   * Assign selected workers to a resource node.
   * Each worker walks to the node, harvests, carries back to HQ, deposits, and repeats.
   */
  private assignWorkersToNode(workers: WorkerUnit[], node: ResourceNode): void {
    // Find a mine/juice building linked to this node, or any within 3 tiles
    const buildings = this.buildingManager.getBuildings();
    let linkedMine = buildings.find(b =>
      b.faction === 'player' && !b.isDestroyed() && b.getLinkedNode() === node && b.def.resourceType != null
    );
    if (!linkedMine) {
      linkedMine = buildings.find(b =>
        b.faction === 'player' && !b.isDestroyed() && b.def.resourceType != null &&
        Math.abs(b.tileX - node.tileX) <= 3 && Math.abs(b.tileY - node.tileY) <= 3
      );
    }
    if (linkedMine) {
      this.garrisonWorkersIntoMine(workers, linkedMine);
    } else {
      workers.forEach(w => {
        this.spawnFloatingText(w.sprite.x, w.sprite.y - 26, 'Build a mine first', '#ff8844');
      });
    }
  }

  /** Cancel a worker's mining assignment and clean up. */
  private stopWorkerMining(worker: WorkerUnit): void {
    this.miningAssignments.delete(worker.id);
    worker.stopMining(); // handles node.removeWorker() internally
  }

  /** Issue a pathfinding request for a worker to walk to its assigned node. */
  private pathWorkerToNode(worker: WorkerUnit, node: ResourceNode): void {
    const { tileX, tileY } = worker.getCurrentTile();
    const nodeWorldX = node.tileX * TILE_SIZE + TILE_SIZE / 2;
    const nodeWorldY = node.tileY * TILE_SIZE + TILE_SIZE / 2;
    // Re-check whether a mine building is still linked — the building may have been
    // destroyed since the assignment was made, reverting to direct (2×) harvest time.
    const hasLinked = this.buildingManager.getBuildings()
      .some(b => b.faction === 'player' && !b.isDestroyed() && b.getLinkedNode() === node);
    worker.directMining = !hasLinked;
    const harvestDur = worker.directMining
      ? worker.HARVEST_DURATION_MS * 2
      : worker.HARVEST_DURATION_MS;

    const enterMine = () => {
      if (worker.miningState !== 'to_node') return;
      worker.animateEnterMine(nodeWorldX, nodeWorldY, () => {
        if (worker.miningState !== 'to_node') return;
        worker.miningState = 'harvesting';
        worker.harvestTimer = harvestDur;
      });
    };

    // Node tiles are impassable in the tilemap — path to the closest adjacent tile instead.
    // Issue all four requests in parallel; first non-null result wins.
    const adj = [
      { x: node.tileX,     y: node.tileY - 1 },
      { x: node.tileX + 1, y: node.tileY     },
      { x: node.tileX,     y: node.tileY + 1 },
      { x: node.tileX - 1, y: node.tileY     },
    ].sort((a, b) =>
      (Math.abs(a.x - tileX) + Math.abs(a.y - tileY)) -
      (Math.abs(b.x - tileX) + Math.abs(b.y - tileY))
    );

    // If the worker is already standing at one of the adjacent tiles, skip
    // pathfinding entirely — EasyStar returns an empty path for same-tile
    // queries, which would leave the worker stuck in 'to_node' forever.
    if (adj.some(d => d.x === tileX && d.y === tileY)) {
      enterMine();
      return;
    }

    let resolved = false;
    for (const dest of adj) {
      this.pathfinder.findPath(tileX, tileY, dest.x, dest.y, (path) => {
        if (resolved || !path || path.length === 0 || worker.miningState !== 'to_node') return;
        resolved = true;
        worker.setPath(path, enterMine);
      });
    }
  }

  /**
   * Per-frame tick for the worker carry-and-return mining loop.
   * Transitions: to_node → harvesting → to_hq → to_node → …
   */
  private tickWorkerMining(delta: number): void {
    for (const [workerId, node] of this.miningAssignments) {
      // Find the unit (use getAllUnits since worker could be alive but moving)
      const unit = this.unitManager.getAllUnits().find(u => u.id === workerId);
      if (!unit || !unit.isAlive()) {
        // Worker died — onUnitDied already called stopWorkerMining/reset miningState.
        // This branch is a safety net for any stale assignments that slipped through.
        node.removeWorker();
        this.miningAssignments.delete(workerId);
        continue;
      }
      const worker = unit as WorkerUnit;

      if (worker.miningState === 'harvesting') {
        worker.harvestTimer -= delta;
        if (worker.harvestTimer <= 0) {
          // Node could have been depleted by mine buildings while worker was inside.
          // Animate the worker emerging before stopping so they don't snap to the
          // impassable node-center tile.
          if (node.isDepleted()) {
            worker.miningState = 'exiting_mine';
            worker.animateExitMine(() => {
              if (worker.miningState === 'exiting_mine') this.stopWorkerMining(worker);
            });
            continue;
          }
          // Pick up resources
          worker.carryAmount = node.harvest(worker.CARRY_CAPACITY);
          // harvest() may fire node:depleted synchronously, which transitions
          // miningState to 'exiting_mine' (or 'idle' for other workers).
          // Bail out of the carry path if state changed — the event handler takes over.
          if ((worker.miningState as string) !== 'harvesting') continue;
          worker.carryType = node.type;

          // Helper: deposit resources and kick off the next trip.
          const depositAndContinue = () => {
            if (worker.miningState !== 'to_hq') return;
            const amt = worker.carryAmount;
            const hqPos = this.playerHQ?.getWorldCenter() ?? { x: worker.sprite.x, y: worker.sprite.y };
            if (worker.carryType === 'gold') {
              this.resources.addGold(amt);
              this.spawnFloatingText(hqPos.x, hqPos.y - 30, `+${amt}g`, '#ffd700');
            } else if (worker.carryType === 'juice') {
              this.resources.addJuice(amt);
              this.spawnFloatingText(hqPos.x, hqPos.y - 30, `+${amt}\u{1F700}`, '#cc88ff');
            }
            worker.carryAmount = 0;
            worker.carryType = null;
            worker.hideCarryVisual();
            if (node.isDepleted()) {
              this.stopWorkerMining(worker);
              return;
            }
            worker.miningState = 'to_node';
            this.pathWorkerToNode(worker, node);
          };

          // Animate the worker emerging from the mine, then path to HQ
          worker.miningState = 'exiting_mine';
          worker.animateExitMine(() => {
            if (worker.miningState !== 'exiting_mine') return;
            worker.showCarryVisual(worker.carryType!);
            worker.miningState = 'to_hq';
            const hqTile = worker.miningHQTile!;
            const { tileX, tileY } = worker.getCurrentTile();

            // If already at the HQ tile, deposit immediately — EasyStar returns
            // an empty path for same-tile queries and the callback would never fire.
            if (tileX === hqTile.tileX && tileY === hqTile.tileY) {
              depositAndContinue();
            } else {
              this.pathfinder.findPath(tileX, tileY, hqTile.tileX, hqTile.tileY, (path) => {
                if (!path || path.length === 0 || worker.miningState !== 'to_hq') return;
                worker.setPath(path, depositAndContinue);
              });
            }
          });
        }
      }
    }
  }

  // ── Rally point ─────────────────────────────────────────────────────────────

  /** Walk a freshly spawned unit to a building's rally tile (if one is set). */
  private sendToRallyPoint(unit: import('@/units/Unit').Unit, building: import('@/buildings/Building').Building): void {
    const rally = building.getRallyTile();
    if (!rally) return;
    const { tileX, tileY } = unit.getCurrentTile();
    this.pathfinder.findPath(tileX, tileY, rally.tileX, rally.tileY, (path) => {
      if (!unit.isAlive()) return;
      if (path && path.length > 0) unit.setPath(path);
    });
  }

  /** Send a freshly trained worker to the building's rally point; garrison into a mine if the rally is set on one. */
  private sendWorkerToRallyThenAutoAssign(
    worker: import('@/units/WorkerUnit').WorkerUnit,
    building: import('@/buildings/Building').Building
  ): void {
    const rally = building.getRallyTile();
    if (!rally) return;

    // Check if the rally tile is inside or adjacent to a mine / juice collector
    const mine = this.buildingManager.getBuildings().find(b =>
      b.faction === 'player' && !b.isDestroyed() &&
      (b.def.id === 'mine' || b.def.id === 'juice_collector') &&
      rally.tileX >= b.tileX - 1 && rally.tileX <= b.tileX + b.def.tileWidth &&
      rally.tileY >= b.tileY - 1 && rally.tileY <= b.tileY + b.def.tileHeight
    );

    if (mine) {
      this.garrisonWorkersIntoMine([worker], mine);
      return;
    }

    const { tileX, tileY } = worker.getCurrentTile();
    this.pathfinder.findPath(tileX, tileY, rally.tileX, rally.tileY, (path) => {
      if (!worker.isAlive() || !path || path.length === 0) return;
      worker.setPath(path);
    });
  }

  /**
   * Find the nearest non-depleted, non-saturated gold node close to the worker.
   * Prefers player-side nodes (tileX <= 25) but falls back to any available node.
   */
  private findNearestAvailableNodeForWorker(
    worker: import('@/units/WorkerUnit').WorkerUnit
  ): import('@/economy/ResourceNode').ResourceNode | null {
    let best: import('@/economy/ResourceNode').ResourceNode | null = null;
    let bestDist = Infinity;
    for (const node of this.resourceNodes) {
      if (node.isDepleted() || node.isSaturated()) continue;
      if (node.type !== 'gold') continue;
      // Prefer player-side nodes (roughly the left-half of the map)
      if (node.tileX > 25) continue;
      const nx = node.tileX * TILE_SIZE + TILE_SIZE / 2;
      const ny = node.tileY * TILE_SIZE + TILE_SIZE / 2;
      const dx = nx - worker.sprite.x;
      const dy = ny - worker.sprite.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = node; }
    }
    return best;
  }

  /**
   * Bulwark "Rally and Reinforce": if the player is Bulwark and a Garrison Post
   * exists, newly produced combat units march there automatically instead of
   * going to the barracks rally flag. Falls back to the standard rally point.
   */
  private sendToRallyOrPost(unit: import('@/units/Unit').Unit, building: import('@/buildings/Building').Building): void {
    if (this.race === 'bulwark') {
      const posts = this.buildingManager.getBuildings()
        .filter(b => b.faction === 'player' && !b.isDestroyed() && b.def.isGarrisonPost);
      if (posts.length > 0) {
        const { x: ux, y: uy } = unit.getPosition();
        const nearest = posts.reduce((best, b) => {
          const { x: bx, y: by } = b.getWorldCenter();
          const { x: bestX, y: bestY } = best.getWorldCenter();
          return Math.hypot(bx - ux, by - uy) < Math.hypot(bestX - ux, bestY - uy) ? b : best;
        });
        const destTileX = nearest.tileX + Math.floor(nearest.def.tileWidth / 2);
        const destTileY = nearest.tileY + nearest.def.tileHeight + 1;
        const { tileX: fromX, tileY: fromY } = unit.getCurrentTile();
        this.pathfinder.findPath(fromX, fromY, destTileX, destTileY, (path) => {
          if (!unit.isAlive()) return;
          if (path && path.length > 0) unit.setPath(path);
        });
        // Floating label so the player sees the routing
        const { x, y } = unit.getPosition();
        this.spawnFloatingText(x, y - 22, '→ Post', '#dd7744');
        return;
      }
    }
    this.sendToRallyPoint(unit, building);
  }

  // ── Idle military tracking ────────────────────────────────────────────────

  private updateIdleMilitaryTracking(delta: number): void {
    const IDLE_THRESHOLD_MS = 10000;
    let idleCount = 0;
    const livingIds = new Set<string>();

    for (const unit of this.unitManager.getLivingUnits()) {
      if (unit.faction !== 'player' || unit.isWorker || unit.isGarrisoned) continue;
      if ((unit as any).fortifyActive || (unit as any).stance === 'hold') continue;
      livingIds.add(unit.id);

      const isIdle = (unit as any).state === 'idle' && !unit.attackTarget;
      if (isIdle) {
        const prev = this._idleMilitaryTimers.get(unit.id) ?? 0;
        const next = prev + delta;
        this._idleMilitaryTimers.set(unit.id, next);
        if (next >= IDLE_THRESHOLD_MS) idleCount++;
      } else {
        this._idleMilitaryTimers.set(unit.id, 0);
      }
    }

    // Prune dead units
    for (const id of this._idleMilitaryTimers.keys()) {
      if (!livingIds.has(id)) this._idleMilitaryTimers.delete(id);
    }

    this._idleMilitaryCount = idleCount;
  }

  // ── Reconstruction Protocol (Architects) ─────────────────────────────────

  private _repairBeamGfx: Phaser.GameObjects.Graphics | null = null;

  private updateReconstructionProtocol(delta: number): void {
    const REPAIR_RANGE_PX = 150;
    const HP_PER_MS = 10 / 1000;  // 10 HP per second

    if (!this._repairBeamGfx) {
      this._repairBeamGfx = this.add.graphics().setDepth(7);
    }
    this._repairBeamGfx.clear();

    const repairingUnits = this.unitManager.getLivingUnits().filter(
      u => u.faction === 'player' && u.repairModeActive
    );

    for (const unit of repairingUnits) {
      const { x: ux, y: uy } = unit.getPosition();
      // Find nearest friendly building in range
      let nearest: import('@/buildings/Building').Building | null = null;
      let nearestDist = Infinity;
      for (const b of this.buildingManager.getBuildings()) {
        if (b.faction !== 'player' || b.isDestroyed()) continue;
        const { x: bx, y: by } = b.getWorldCenter();
        const dist = Math.hypot(bx - ux, by - uy);
        if (dist <= REPAIR_RANGE_PX && dist < nearestDist) {
          nearest = b;
          nearestDist = dist;
        }
      }
      if (!nearest) continue;

      // Apply HP repair
      const heal = HP_PER_MS * delta;
      nearest.repairHp(heal);

      // Draw faint green beam from unit to building
      const { x: bx, y: by } = nearest.getWorldCenter();
      this._repairBeamGfx.lineStyle(2, 0x44ff88, 0.55);
      this._repairBeamGfx.lineBetween(ux, uy, bx, by);
      // Small pulsing dot at building end
      const pulse = Math.abs(Math.sin(Date.now() / 200));
      this._repairBeamGfx.fillStyle(0x44ff88, 0.4 + pulse * 0.5);
      this._repairBeamGfx.fillCircle(bx, by, 4 + pulse * 3);
    }
  }

  // ── Sentinel Turret (Architects) ──────────────────────────────────────────

  private updateSentinelTurrets(delta: number): void {
    if (this.race !== 'architects') return;

    const turrets = this.buildingManager.getBuildings().filter(
      b => b.faction === 'player' && !b.isDestroyed() && b.def.isTurret && b.isPowered,
    );

    // Tick overcharge timers
    this._overchargedTurrets.forEach((ms, id) => {
      const remaining = ms - delta;
      if (remaining <= 0) this._overchargedTurrets.delete(id);
      else this._overchargedTurrets.set(id, remaining);
    });

    for (const turret of turrets) {
      const isOvercharged = this._overchargedTurrets.has(turret.id);
      const baseCooldown  = turret.def.turretCooldownMs ?? 2000;
      const effectiveCd   = isOvercharged ? baseCooldown / 3 : baseCooldown;

      // Tick cooldown
      const cd = Math.max(0, (this._turretCooldowns.get(turret.id) ?? 0) - delta);
      this._turretCooldowns.set(turret.id, cd);
      if (cd > 0) continue;

      const { x: tx, y: ty } = turret.getWorldCenter();
      const range = turret.def.turretRangePx ?? 200;

      // Find nearest visible enemy unit in range
      let nearest: import('@/units/Unit').Unit | null = null;
      let nearestDist = range + 1;
      for (const u of this.unitManager.getLivingUnits()) {
        if (u.faction !== 'enemy' || !u.fogVisible) continue;
        const { x, y } = u.getPosition();
        const d = Math.hypot(x - tx, y - ty);
        if (d <= range && d < nearestDist) { nearestDist = d; nearest = u; }
      }
      if (!nearest) continue;

      // Arm the cooldown for next shot
      this._turretCooldowns.set(turret.id, effectiveCd);

      const { x: ex, y: ey } = nearest.getPosition();
      const baseDmg = turret.def.turretDamage ?? 15;
      const dmg = isOvercharged ? baseDmg * 2 : baseDmg;

      // Targeting beam visual — yellow/hot when overcharged, blue-white normally
      const beamColor = isOvercharged ? 0xffee00 : 0xaaddff;
      const beam = this.add.graphics().setDepth(22);
      beam.lineStyle(isOvercharged ? 3 : 2, beamColor, 1.0);
      beam.lineBetween(tx, ty, ex, ey);
      beam.fillStyle(isOvercharged ? 0xffff88 : 0xffffff, 1);
      beam.fillCircle(tx, ty, isOvercharged ? 5 : 3);
      beam.fillStyle(isOvercharged ? 0xff8800 : 0x88ccff, 0.8);
      beam.fillCircle(ex, ey, 4);
      this.tweens.add({
        targets: beam, alpha: 0, duration: 250, ease: 'Power2',
        onComplete: () => beam.destroy(),
      });

      // Deal damage — let takeDamage() apply armor/shields; don't pre-subtract armor
      const hpBefore = nearest.health;
      const alive = !nearest.takeDamage(dmg);
      if (alive) {
        const actualDealt = Math.round(hpBefore - nearest.health);
        this.spawnFloatingText(ex, ey - 16, `-${actualDealt}`, isOvercharged ? '#ffff44' : '#88ccff');
      }
    }
  }

  // ── Void Gate portals (Unseen) ─────────────────────────────────────────────

  /**
   * Called when a Void Gate building is placed.
   * Registers the portal, creates its visuals, and links it to any existing
   * orphaned gate to form a wormhole pair.
   */
  private registerVoidGate(building: Building): void {
    const { x: wx, y: wy } = building.getWorldCenter();

    // Graphics layer for this portal (redrawn in updateVoidGates)
    const portalGfx = this.add.graphics().setDepth(18);

    // Draw initial portal circle
    this.drawPortalGfx(portalGfx, wx, wy, 0);

    // Status label above the portal
    const labelText = this.add.text(wx, wy - 28, '⬡ Unlinked', {
      fontSize: '9px', color: '#aa44cc', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(19);

    const entry: (typeof this._voidGates)[number] = {
      building, worldX: wx, worldY: wy,
      portalGfx, labelText,
      particleAngle: Math.random() * Math.PI * 2,
      linkedIdx: null,
    };

    // Check for an unlinked orphan to pair with
    const orphanIdx = this._voidGates.findIndex(
      g => g.linkedIdx === null && !g.building.isDestroyed(),
    );
    const myIdx = this._voidGates.length;
    this._voidGates.push(entry);

    if (orphanIdx !== -1) {
      // Link both portals
      this._voidGates[orphanIdx].linkedIdx = myIdx;
      entry.linkedIdx = orphanIdx;
      this._voidGates[orphanIdx].labelText.setText('⬡ Gate A');
      labelText.setText('⬡ Gate B');
      this.spawnFloatingText(wx, wy - 44, 'Wormhole linked!', '#cc44ff');
    }

    // Destroy portal gfx when building is destroyed — chain after the BuildingManager callback
    const prevOnDestroyed = building.onDestroyed;
    building.onDestroyed = () => {
      prevOnDestroyed?.();
      portalGfx.destroy();
      labelText.destroy();
      // Remove from list — find actual index first (myIdx is stale after splices)
      const idx = this._voidGates.indexOf(entry);
      if (idx !== -1) this._voidGates.splice(idx, 1);
      // Unlink partner using the real pre-splice index
      const partner = idx !== -1 ? this._voidGates.find(g => g.linkedIdx === idx) : null;
      if (partner) {
        partner.linkedIdx = null;
        partner.labelText.setText('⬡ Unlinked');
      }
      // Re-index remaining gates so linkedIdx values stay consistent
      this._voidGates.forEach((g, i) => {
        if (g.linkedIdx !== null && g.linkedIdx >= idx) {
          g.linkedIdx = Math.max(0, g.linkedIdx - 1);
        }
        void i; // suppress unused-var
      });
    };
  }

  /** Draw the swirling portal circle at the given position with the given angle offset. */
  private drawPortalGfx(g: Phaser.GameObjects.Graphics, cx: number, cy: number, angle: number): void {
    g.clear();
    const RADIUS = 20;

    // Dark void fill
    g.fillStyle(0x110022, 0.82);
    g.fillCircle(cx, cy, RADIUS);

    // Outer ring
    g.lineStyle(2, 0x9922cc, 0.9);
    g.strokeCircle(cx, cy, RADIUS);

    // Inner ring
    g.lineStyle(1, 0xcc44ff, 0.5);
    g.strokeCircle(cx, cy, RADIUS * 0.6);

    // Swirling particle dots (6 dots orbiting at different phases)
    const NUM_DOTS = 6;
    for (let i = 0; i < NUM_DOTS; i++) {
      const a = angle + (i / NUM_DOTS) * Math.PI * 2;
      const r = RADIUS * 0.75 + Math.sin(angle * 3 + i) * 4;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      const alpha = 0.5 + 0.5 * Math.sin(angle * 2 + i * 1.1);
      g.fillStyle(0xdd66ff, alpha);
      g.fillCircle(px, py, 2);
    }

    // Central glow dot
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(cx, cy, 5);
  }

  /** Per-frame update: animate portals and teleport units that step into one. */
  private updateVoidGates(delta: number): void {
    const ENTER_RADIUS = 32;     // px — within this range the unit gets sucked in
    const EXIT_OFFSET  = 48;     // px — units emerge this far from the exit portal
    const TELEPORT_COOLDOWN = 1500; // ms before a unit can use a portal again

    // Tick per-unit cooldowns
    for (const [uid, remaining] of this._voidGateCooldowns) {
      const next = remaining - delta;
      if (next <= 0) this._voidGateCooldowns.delete(uid);
      else this._voidGateCooldowns.set(uid, next);
    }

    for (const gate of this._voidGates) {
      if (gate.building.isDestroyed()) continue;

      // Advance swirl angle
      gate.particleAngle += delta * 0.003;

      // Redraw portal
      this.drawPortalGfx(gate.portalGfx, gate.worldX, gate.worldY, gate.particleAngle);

      // Only teleport through a fully-linked portal pair
      if (gate.linkedIdx === null) continue;
      const exit = this._voidGates[gate.linkedIdx];
      if (!exit || exit.building.isDestroyed()) continue;

      // Check player units walking into this portal
      for (const unit of this.unitManager.getLivingUnits()) {
        if (unit.faction !== 'player') continue;
        if (this._voidGateCooldowns.has(unit.id)) continue;

        const { x: ux, y: uy } = unit.getPosition();
        const dist = Math.hypot(ux - gate.worldX, uy - gate.worldY);
        if (dist > ENTER_RADIUS) continue;

        // Teleport to exit portal
        const angle = Math.atan2(uy - gate.worldY, ux - gate.worldX);
        const destX = exit.worldX + Math.cos(angle) * EXIT_OFFSET;
        const destY = exit.worldY + Math.sin(angle) * EXIT_OFFSET;

        unit.sprite.setPosition(destX, destY);

        // Brief purple flash at both ends
        const flashIn = this.add.circle(gate.worldX, gate.worldY, 24, 0xcc44ff, 0.7).setDepth(20);
        const flashOut = this.add.circle(exit.worldX, exit.worldY, 24, 0xcc44ff, 0.7).setDepth(20);
        this.tweens.add({ targets: [flashIn, flashOut], alpha: 0, scaleX: 2, scaleY: 2, duration: 350, onComplete: () => { flashIn.destroy(); flashOut.destroy(); } });

        this.spawnFloatingText(destX, destY - 22, '⬡ Void Jump!', '#cc44ff');

        // Start cooldown so the unit doesn't immediately re-enter
        this._voidGateCooldowns.set(unit.id, TELEPORT_COOLDOWN);
      }
    }
  }

  // ── TAB Score overlay ─────────────────────────────────────────────────────

  private buildScoreOverlay(): void {
    const { width, height } = this.scale;
    const W = 340;
    const ROWS = 9;
    const ROW_H = 22;
    const PAD = 18;
    const H = PAD * 2 + ROWS * ROW_H + 10;
    const ox = Math.round(width  / 2 - W / 2);
    const oy = Math.round(height / 2 - H / 2);
    const DEPTH = 9990;

    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH);

    // Background
    const bg = this.add.graphics().setScrollFactor(0);
    bg.fillStyle(0x060c18, 0.93);
    bg.fillRoundedRect(ox, oy, W, H, 10);
    bg.lineStyle(1, 0x1e3050, 1);
    bg.strokeRoundedRect(ox, oy, W, H, 10);
    container.add(bg);

    // Header
    const header = this.add.text(ox + W / 2, oy + PAD, 'SCORE', {
      fontSize: '14px', color: '#aaddff', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0);
    container.add(header);

    // Row helper
    const rowTexts: Phaser.GameObjects.Text[] = [];
    for (let i = 0; i < ROWS; i++) {
      const ry = oy + PAD + 24 + i * ROW_H;
      const labelT = this.add.text(ox + PAD, ry, '', {
        fontSize: '11px', color: '#667788', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0, 0).setScrollFactor(0);
      const valueT = this.add.text(ox + W - PAD, ry, '', {
        fontSize: '11px', color: '#ccddee', stroke: '#000', strokeThickness: 2,
      }).setOrigin(1, 0).setScrollFactor(0);
      container.add(labelT);
      container.add(valueT);
      rowTexts.push(labelT, valueT);
    }

    container.setVisible(false);
    this.scoreOverlay = container;
    this.scoreOverlayTexts = rowTexts;
  }

  private updateScorePanel(): void {
    if (!this.scoreOverlay || this.scoreOverlayTexts.length === 0) return;

    const raceName = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
    const upgradeLabel = (bonus: number) => bonus === 0 ? 'None' : `+${bonus}`;

    const rows: [string, string][] = [
      ['Player Race',       raceName(this.race)],
      ['Enemy Race',        raceName(this.enemyRace)],
      ['',                  ''],
      ['Units Killed',      `${this.stats.enemiesKilled}`],
      ['Units Lost',        `${this.stats.unitsLost}`],
      ['Buildings Built',   `${this.stats.buildingsBuilt}`],
      ['Buildings Lost',    `${this.stats.buildingsLost}`],
      ['Attack Upgrade',    upgradeLabel(this.unitManager.attackBonus)],
      ['Armor Upgrade',     upgradeLabel(this.unitManager.armorBonus)],
    ];

    rows.forEach(([label, value], i) => {
      const labelT = this.scoreOverlayTexts[i * 2];
      const valueT = this.scoreOverlayTexts[i * 2 + 1];
      if (!labelT || !valueT) return;
      labelT.setText(label);
      const color = label === '' ? '#334455'
        : label === 'Units Killed' ? '#44ff88'
        : label === 'Units Lost' ? '#ff6666'
        : '#ccddee';
      valueT.setText(value).setColor(color);
    });
  }

  // ── Devotee heal (Covenant passive unit ability) ─────────────────────────────

  private updateDevoteeHeal(delta: number): void {
    if (this.race !== 'covenant') return;
    const DEVOTEE_HEAL_RANGE_PX = 120;
    const DEVOTEE_HEAL_AMOUNT   = 12;
    const DEVOTEE_HEAL_INTERVAL = 4000;

    const allLiving = this.unitManager.getLivingUnits().filter(u => u.faction === 'player');
    this.unitManager.getLivingDevotees().forEach(devotee => {
      devotee.devoteeHealTimer += delta;
      if (devotee.devoteeHealTimer < DEVOTEE_HEAL_INTERVAL) return;
      devotee.devoteeHealTimer = 0;

      // Find nearest injured ally within range
      let nearestAlly: import('@/units/Unit').Unit | null = null;
      let nearestDist = DEVOTEE_HEAL_RANGE_PX;
      const { x: dx, y: dy } = devotee.getPosition();
      for (const ally of allLiving) {
        if (ally === devotee || ally.health >= ally.maxHealth) continue;
        const d = Math.hypot(ally.getPosition().x - dx, ally.getPosition().y - dy);
        if (d < nearestDist) { nearestDist = d; nearestAlly = ally; }
      }
      if (!nearestAlly) return;
      const healed = nearestAlly.heal(DEVOTEE_HEAL_AMOUNT);
      if (healed > 0) {
        const { x, y } = nearestAlly.getPosition();
        this.spawnFloatingText(x, y - 20, `+${healed}`, '#44ff88');
        // Brief green pulse on healer
        const pulse = this.add.circle(dx, dy, 14, 0x44ff88, 0.4).setDepth(25);
        this.tweens.add({ targets: pulse, alpha: 0, scaleX: 2, scaleY: 2, duration: 400, onComplete: () => pulse.destroy() });
      }
    });
  }

  // ── Stasis targeting (Arbiter E-ability) ──────────────────────────────────

  private beginStasisTargeting(arbiters: import('@/units/Unit').Unit[]): void {
    this.stasisTargetingActive = true;
    this._stasisArbiters = arbiters;
    const { width, height } = this.scale;
    this.stasisTargetingHint = this.add.text(
      width / 2, height - 56,
      '\u2744 Stasis: right-click target location  (ESC to cancel)', {
        fontSize: '13px', color: '#88ccff', stroke: '#000', strokeThickness: 3,
      }
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);
    this.input.keyboard?.once('keydown-ESC', () => this.endStasisTargeting());
  }

  private endStasisTargeting(): void {
    this.stasisTargetingActive = false;
    this.stasisTargetingHint?.destroy();
    this.stasisTargetingHint = null;
    this._stasisArbiters = [];
  }

  private executeStasis(worldX: number, worldY: number): void {
    const STASIS_RANGE_PX  = 160;
    const STASIS_DURATION  = 4000;

    // Put all casting Arbiters on cooldown
    this._stasisArbiters.forEach(a => a.beginStasisCooldown());

    // Freeze every living unit (friend and foe) within the blast radius
    const frozen = this.unitManager.getLivingUnits().filter(u => {
      const { x, y } = u.getPosition();
      return Math.hypot(x - worldX, y - worldY) <= STASIS_RANGE_PX;
    });
    frozen.forEach(u => u.applyStasis(STASIS_DURATION));

    // Expanding ice ring
    const ring = this.add.arc(worldX, worldY, 8, 0, 360, false, 0x88ccff, 0.5).setDepth(50);
    this.tweens.add({
      targets: ring,
      scaleX: STASIS_RANGE_PX / 8, scaleY: STASIS_RANGE_PX / 8,
      alpha: 0, duration: 500, ease: 'Power2',
      onComplete: () => ring.destroy(),
    });

    // Lingering frost area for the duration of the stasis
    const frostArea = this.add.arc(worldX, worldY, STASIS_RANGE_PX, 0, 360, false, 0x88ccff, 0.1)
      .setDepth(3.8).setStrokeStyle(1.5, 0x44aaff, 0.45);
    this.tweens.add({
      targets: frostArea, alpha: 0, duration: STASIS_DURATION,
      onComplete: () => frostArea.destroy(),
    });

    this.spawnFloatingText(worldX, worldY - 30, `\u2744 Stasis! (${frozen.length})`, '#88ccff');
  }

  // ── Shadow Step targeting ──────────────────────────────────────────────────

  private beginShadowStepTargeting(): void {
    this.shadowStepTargetingActive = true;
    const { width, height } = this.scale;
    this.shadowStepTargetingHint = this.add.text(
      width / 2, height - 38,
      '\u2727 Shadow Step: right-click target within range  (ESC to cancel)', {
        fontSize: '13px', color: '#bb44ee', stroke: '#000', strokeThickness: 3,
      }
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);
    // ESC cancels
    this.input.keyboard?.once('keydown-ESC', () => this.endShadowStepTargeting());
  }

  private endShadowStepTargeting(): void {
    this.shadowStepTargetingActive = false;
    this.shadowStepTargetingHint?.destroy();
    this.shadowStepTargetingHint = null;
  }

  // ── Assassinate targeting (Unseen — F2) ──────────────────────────────────

  private _beginAssassinateTargeting(): void {
    this._assassinateTargetingActive = true;
    const { width, height } = this.scale;
    this._assassinateTargetingHint = this.add.text(
      width / 2, height - 38,
      '✦ Assassinate: right-click destination  (ESC to cancel)', {
        fontSize: '13px', color: '#aa00cc', stroke: '#000', strokeThickness: 3,
      }
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);
    this.input.keyboard?.once('keydown-ESC', () => this._endAssassinateTargeting());
  }

  private _endAssassinateTargeting(): void {
    this._assassinateTargetingActive = false;
    this._assassinateTargetingHint?.destroy();
    this._assassinateTargetingHint = null;
  }

  private _executeAssassinate(worldX: number, worldY: number): void {
    this.unitManager.getAllUnits()
      .filter(u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isUnseenUnit && u.canAssassinate())
      .forEach(u => u.executeAssassinate(worldX, worldY));
  }

  // ── Divine Wrath targeting (Covenant — F3) ───────────────────────────────

  private _beginDivineWrathTargeting(): void {
    this._divineWrathTargetingActive = true;
    const { width, height } = this.scale;
    this._divineWrathTargetingHint = this.add.text(
      width / 2, height - 38,
      '✦ Divine Wrath: right-click target within 300px  (ESC to cancel)', {
        fontSize: '13px', color: '#ffdd88', stroke: '#000', strokeThickness: 3,
      }
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);
    this.input.keyboard?.once('keydown-ESC', () => this._endDivineWrathTargeting());
  }

  private _endDivineWrathTargeting(): void {
    this._divineWrathTargetingActive = false;
    this._divineWrathTargetingHint?.destroy();
    this._divineWrathTargetingHint = null;
  }

  private _executeDivineWrath(worldX: number, worldY: number): void {
    const casters = this.unitManager.getAllUnits().filter(
      u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isCovenantUnit && u.divineWrathCooldown <= 0
    );
    if (casters.length === 0) return;
    const caster = casters[0];
    const { x: cx, y: cy } = caster.getPosition();
    if (Math.hypot(worldX - cx, worldY - cy) > 300) {
      this.spawnFloatingText(cx, cy - 28, 'Out of range!', '#ff8844');
      return;
    }
    caster.divineWrathCooldown = 50000;

    // Pillar of light visual: bright white tall rectangle, fades out
    const pillar = this.add.graphics().setDepth(28);
    pillar.fillStyle(0xffffff, 0.85);
    pillar.fillRect(worldX - 12, worldY - 80, 24, 80);
    this.tweens.add({ targets: pillar, alpha: 0, duration: 600, ease: 'Power2', onComplete: () => pillar.destroy() });

    // Expanding shockwave ring at base
    const ring = this.add.arc(worldX, worldY, 8, 0, 360, false, 0xffffff, 0)
      .setDepth(27).setStrokeStyle(3, 0xffffaa, 1);
    this.tweens.add({ targets: ring, scaleX: 14, scaleY: 14, strokeAlpha: 0, duration: 450, ease: 'Power2', onComplete: () => ring.destroy() });

    // AoE damage
    const RANGE = 80;
    const DAMAGE = 40;
    let hit = 0;
    this.unitManager.getLivingUnits().filter(u => u.faction === 'enemy').forEach(e => {
      const { x: ex, y: ey } = e.getPosition();
      if (Math.hypot(ex - worldX, ey - worldY) <= RANGE) {
        const dealt = Math.max(1, DAMAGE - (e.armor ?? 0));
        e.takeDamage(dealt);
        const ep = e.getPosition();
        this.spawnFloatingText(ep.x, ep.y - 20, `-${dealt}`, '#ffdd44');
        hit++;
      }
    });
    this.spawnFloatingText(worldX, worldY - 32, `Divine Wrath${hit > 0 ? ` ×${hit}` : ''}!`, '#ffdd44');
  }

  // ── Iron Bastion wall (Bulwark — N key) ──────────────────────────────────

  private _placeIronBastion(unit: import('@/units/Unit').Unit): void {
    unit.ironBastionCooldown = 60000;
    const { x, y } = unit.getPosition();
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);

    // Grey wall rectangle
    const gfx = this.add.graphics().setDepth(9);
    gfx.fillStyle(0x888888, 0.9);
    gfx.fillRect(x - 48, y - 16, 96, 32);
    gfx.lineStyle(2, 0xaaaaaa, 1);
    gfx.strokeRect(x - 48, y - 16, 96, 32);

    // Block the tile in pathfinding
    this.pathfinder.blockTile(tileX, tileY);

    const wall = { gfx, tileX, tileY, hp: 300, timer: 15000 };
    this._ironBastionWalls.push(wall);

    this.spawnFloatingText(x, y - 28, 'Iron Bastion!', '#aaaaaa');
  }

  /** Tick all active Iron Bastion walls; remove expired or destroyed ones. */
  private _updateIronBastionWalls(delta: number): void {
    for (let i = this._ironBastionWalls.length - 1; i >= 0; i--) {
      const wall = this._ironBastionWalls[i];
      wall.timer -= delta;
      if (wall.timer <= 0 || wall.hp <= 0) {
        wall.gfx.destroy();
        this.pathfinder.unblockTile(wall.tileX, wall.tileY);
        this._ironBastionWalls.splice(i, 1);
      }
    }
  }

  // ── Narrative intro sequence ───────────────────────────────────────────────

  private showNarrativeIntro(): void {
    const { width, height } = this.scale;
    this._introActive = true;

    const FLAVOUR: Record<string, string> = {
      covenant:   'The Covenant march to reclaim the sacred relics...',
      architects: 'Architects deploy their mechanical legions...',
      bulwark:    'Bulwark stands firm, shields raised...',
      unseen:     'The Unseen emerge from shadow...',
    };
    const COLOURS: Record<string, string> = {
      covenant: '#44ff88', architects: '#4488ff',
      bulwark: '#dd9966', unseen: '#bb44ee',
    };

    const overlay = this.add.graphics().setScrollFactor(0).setDepth(9995);
    overlay.fillStyle(0x000000, 1);
    overlay.fillRect(0, 0, width, height);

    const flavour = FLAVOUR[this.race] ?? 'The battle begins...';
    const colour  = COLOURS[this.race] ?? '#ffffff';

    const text = this.add.text(width / 2, height / 2, flavour, {
      fontSize: '22px', color: colour, stroke: '#000', strokeThickness: 4,
      align: 'center', wordWrap: { width: width * 0.7 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(9996).setAlpha(0);

    const skipHint = this.add.text(width / 2, height - 40, 'Press ESC or click to skip', {
      fontSize: '11px', color: '#556677', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(9996).setAlpha(0);

    const cleanup = () => {
      if (!this._introActive) return;
      this._introActive = false;
      this.tweens.killTweensOf(overlay);
      this.tweens.killTweensOf(text);
      this.tweens.killTweensOf(skipHint);
      overlay.destroy();
      text.destroy();
      skipHint.destroy();
      skipArea.destroy();
    };

    // Invisible click-catcher at top depth to intercept skip clicks
    const skipArea = this.add.rectangle(0, 0, width, height, 0, 0)
      .setOrigin(0).setScrollFactor(0).setDepth(9997).setInteractive();
    skipArea.on('pointerdown', cleanup);
    this.input.keyboard?.on('keydown-ESC', cleanup);

    // Fade in text over 800 ms, hold 3 s, fade out, then fade overlay 1 s
    this.tweens.add({
      targets: text, alpha: 1, duration: 800, ease: 'Power1',
      onComplete: () => {
        this.tweens.add({ targets: skipHint, alpha: 0.7, duration: 400 });
        this.time.delayedCall(3000, () => {
          if (!this._introActive) return;
          this.tweens.add({
            targets: [text, skipHint], alpha: 0, duration: 500, ease: 'Power1',
            onComplete: () => {
              if (!this._introActive) return;
              this.tweens.add({
                targets: overlay, alpha: 0, duration: 1000, ease: 'Power1',
                onComplete: () => {
                  this._introActive = false;
                  overlay.destroy();
                  text.destroy();
                  skipHint.destroy();
                  skipArea.destroy();
                  this.input.keyboard?.off('keydown-ESC', cleanup);
                },
              });
            },
          });
        });
      },
    });
  }

  // ── Covenant Sanctuary Zone ────────────────────────────────────────────────

  private placeSanctuaryZone(): void {
    if (this.sanctuaryZones.length >= this.SANCTUARY_MAX_ZONES) {
      this.showScreenMessage('Max 2 Sanctuary Zones active', '#ff8844');
      return;
    }
    if (!this.resources.spendGold(this.SANCTUARY_COST)) {
      this.showScreenMessage('Not enough gold (100)', '#ff4444');
      return;
    }
    // Place at the average position of selected Covenant units
    const covenantUnits = this.unitManager.getAllUnits().filter(
      u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isCovenantUnit
    );
    if (covenantUnits.length === 0) { this.resources.addGold(this.SANCTUARY_COST); return; }

    const cx = covenantUnits.reduce((s, u) => s + u.getPosition().x, 0) / covenantUnits.length;
    const cy = covenantUnits.reduce((s, u) => s + u.getPosition().y, 0) / covenantUnits.length;
    const R = this.SANCTUARY_RADIUS_PX;

    // Permanent golden border circle
    const gfx = this.add.graphics().setDepth(9);
    gfx.lineStyle(2, 0xffd700, 0.6);
    gfx.strokeCircle(cx, cy, R);

    // Pulsing fill (tween-driven)
    const pulseGfx = this.add.graphics().setDepth(8);
    const pulseProxy = { alpha: 0.08 };
    this.tweens.add({
      targets: pulseProxy, alpha: 0.22, duration: 1200,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: () => {
        pulseGfx.clear();
        pulseGfx.fillStyle(0xffd700, pulseProxy.alpha);
        pulseGfx.fillCircle(cx, cy, R);
      },
    });

    const hpLabel = this.add.text(cx, cy - R - 8, `\u2665 ${this.SANCTUARY_MAX_HP}`, {
      fontSize: '10px', color: '#ffd700', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(20).setScrollFactor(1);

    this.sanctuaryZones.push({
      worldX: cx, worldY: cy, radius: R,
      hp: this.SANCTUARY_MAX_HP, maxHp: this.SANCTUARY_MAX_HP,
      gfx, pulseGfx, pulseProxy, hpLabel,
    });
    this.spawnFloatingText(cx, cy - 24, '\u2728 Sanctuary Zone', '#ffd700');
  }

  private updateSanctuaryZones(delta: number): void {
    if (this.sanctuaryZones.length === 0) return;
    this._sanctuaryHealAccum += delta;
    const doHeal = this._sanctuaryHealAccum >= this.SANCTUARY_HEAL_INTERVAL_MS;
    if (doHeal) this._sanctuaryHealAccum -= this.SANCTUARY_HEAL_INTERVAL_MS;

    for (let i = this.sanctuaryZones.length - 1; i >= 0; i--) {
      const z = this.sanctuaryZones[i];

      // Enemy units inside the zone chip away at it (5 DPS per unit)
      const enemiesInZone = this.unitManager.getLivingUnits().filter(u =>
        u.faction === 'enemy' && Math.hypot(u.getPosition().x - z.worldX, u.getPosition().y - z.worldY) <= z.radius
      );
      z.hp -= enemiesInZone.length * 5 * (delta / 1000);

      // Heal friendly units inside zone each second
      if (doHeal) {
        this.unitManager.getLivingUnits()
          .filter(u => u.faction === 'player'
            && Math.hypot(u.getPosition().x - z.worldX, u.getPosition().y - z.worldY) <= z.radius)
          .forEach(u => {
            const healed = Math.min(this.SANCTUARY_HEAL_AMOUNT, u.maxHealth - u.health);
            if (healed > 0) {
              u.health += healed;
              const { x, y } = u.getPosition();
              this.spawnFloatingText(x, y - 14, `+${healed}`, '#ffd700');
            }
          });
      }

      // Update HP label
      z.hpLabel.setText(`\u2665 ${Math.max(0, Math.ceil(z.hp))}`);

      if (z.hp <= 0) {
        // Kill via proxy (tween targets pulseProxy, not pulseGfx — killTweensOf(pulseGfx) is a no-op)
        this.tweens.killTweensOf(z.pulseProxy);
        z.gfx.destroy();
        z.pulseGfx.destroy();
        z.hpLabel.destroy();
        this.spawnFloatingText(z.worldX, z.worldY - 20, 'Sanctuary destroyed!', '#ff4444');
        this.sanctuaryZones.splice(i, 1);
      }
    }
  }

  // ── Alert / notification banners ───────────────────────────────────────────

  /** Slide-in banner at bottom-right (above minimap). Stacks with previous banners. */
  private showAlertBanner(text: string, color: string): void {
    const { width, height } = this.scale;
    const bannerX = width - 10;
    const bannerY = height - 148; // above the 128px minimap + margin
    const banner = this.add.text(bannerX, bannerY, text, {
      fontSize: '13px', color, stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#00000099',
      padding: { x: 10, y: 6 },
    }).setScrollFactor(0).setDepth(9990).setOrigin(1, 0.5);
    banner.setX(width + 200); // off-screen start
    this.tweens.add({ targets: banner, x: bannerX, duration: 220, ease: 'Power2' });
    this.tweens.add({
      targets: banner, alpha: 0, delay: 2600, duration: 800,
      onComplete: () => banner.destroy(),
    });
  }

  /** Briefly flash a world-space arrow pointing from screen center toward the event source. */
  private showDirectionArrow(worldX: number, worldY: number, color: number): void {
    const cam = this.cameras.main;
    const screenCX = cam.width / 2;
    const screenCY = cam.height / 2;
    const camCX = cam.scrollX + screenCX / cam.zoom;
    const camCY = cam.scrollY + screenCY / cam.zoom;
    const dx = worldX - camCX;
    const dy = worldY - camCY;
    const angle = Math.atan2(dy, dx);
    const R = 80;
    const arrowX = screenCX + Math.cos(angle) * R;
    const arrowY = screenCY + Math.sin(angle) * R;
    const arrow = this.add.text(arrowX, arrowY, '\u25b6', {
      fontSize: '18px', color: `#${color.toString(16).padStart(6, '0')}`,
      stroke: '#000', strokeThickness: 3,
    }).setScrollFactor(0).setDepth(9989)
      .setOrigin(0.5)
      .setRotation(angle);
    this.tweens.add({ targets: arrow, alpha: 0, scaleX: 1.8, scaleY: 1.8, duration: 1200, onComplete: () => arrow.destroy() });
  }

  // ── Fog of War ─────────────────────────────────────────────────────────────

  /**
   * Each frame: build a list of vision sources from living player units and
   * player buildings, then show/hide enemy units and buildings accordingly.
   * Enemy units that are fog-hidden are also excluded from auto-targeting
   * (see CombatSystem — it checks `unit.fogVisible`).
   */
  /**
   * Redraw the fog-of-war overlay graphics.
   * Uses 3 alpha bands per tile (TILE_SIZE² cells) to create a soft feathered edge
   * instead of a hard cut between visible and hidden areas.
   * Batches draws by alpha level to minimise WebGL state changes.
   */
  private updateFogOverlay(sources: Array<{ x: number; y: number; r: number }>): void {
    const { widthInPixels: mapW, heightInPixels: mapH } = this.mapManager.getMapDimensions();
    const TS = TILE_SIZE;
    const FEATHER = this.FOG_FEATHER_PX;

    this.fogOverlay.clear();

    // Collect tiles into buckets by alpha using each source's actual radius
    const FULL_ALPHA = 0.72;
    const EDGE_ALPHA = 0.35;
    const fullFogTiles: Array<{ tx: number; ty: number }> = [];
    const edgeTiles:    Array<{ tx: number; ty: number }> = [];

    const tilesW = Math.ceil(mapW / TS);
    const tilesH = Math.ceil(mapH / TS);

    for (let ty = 0; ty < tilesH; ty++) {
      for (let tx = 0; tx < tilesW; tx++) {
        const wx = tx * TS + TS / 2;
        const wy = ty * TS + TS / 2;

        // Check against each source's radius to determine fog band
        // Use squared distances for the inner check to avoid sqrt when possible
        let category = 2; // 0=clear, 1=edge, 2=full fog
        for (const s of sources) {
          const dx = wx - s.x; const dy = wy - s.y;
          const dSq = dx * dx + dy * dy;
          const innerR = s.r - FEATHER;
          if (innerR > 0 && dSq <= innerR * innerR) { category = 0; break; }
          const outerR = s.r + FEATHER;
          if (dSq <= outerR * outerR) category = Math.min(category, 1);
        }

        if (category === 1) edgeTiles.push({ tx, ty });
        else if (category === 2) fullFogTiles.push({ tx, ty });
      }
    }

    // Draw full fog tiles in one batch
    if (fullFogTiles.length > 0) {
      this.fogOverlay.fillStyle(0x000820, FULL_ALPHA);
      for (const { tx, ty } of fullFogTiles) {
        this.fogOverlay.fillRect(tx * TS, ty * TS, TS, TS);
      }
    }

    // Draw edge (feather) tiles in one batch
    if (edgeTiles.length > 0) {
      this.fogOverlay.fillStyle(0x000820, EDGE_ALPHA);
      for (const { tx, ty } of edgeTiles) {
        this.fogOverlay.fillRect(tx * TS, ty * TS, TS, TS);
      }
    }
  }

  private updateFogVisibility(): void {
    // Collect vision sources with both rSq (for unit/building vis checks) and r (for fog overlay)
    const sources: { x: number; y: number; rSq: number; r: number }[] = [];

    for (const u of this.unitManager.getLivingUnits()) {
      if (u.faction !== 'player' || u.isGarrisoned) continue;
      const { x, y } = u.getPosition();
      const r = this.FOG_UNIT_SIGHT_PX;
      sources.push({ x, y, rSq: r * r, r });
    }

    for (const b of this.buildingManager.getBuildings()) {
      if (b.faction !== 'player' || b.isDestroyed()) continue;
      const { x, y } = b.getWorldCenter();
      const r = this.FOG_BUILDING_SIGHT_PX;
      sources.push({ x, y, rSq: r * r, r });
    }

    // Architects Scanner Sweep temporary vision sources
    for (const sweep of this._scannerSweepSources) {
      sources.push({ x: sweep.x, y: sweep.y, rSq: sweep.r * sweep.r, r: sweep.r });
    }

    // Update fog overlay every 4 frames (less frequent than unit visibility)
    if (this._frameCount % 4 === 0) {
      this.updateFogOverlay(sources);
    }

    const isVisible = (wx: number, wy: number): boolean => {
      for (const s of sources) {
        const dx = wx - s.x;
        const dy = wy - s.y;
        if (dx * dx + dy * dy <= s.rSq) return true;
      }
      return false;
    };

    // Enemy units — track first-sight for "Enemy Spotted!" alert
    for (const u of this.unitManager.getLivingUnits()) {
      if (u.faction !== 'enemy') continue;
      const { x, y } = u.getPosition();
      const wasVisible = u.fogVisible;
      u.applyFogVisibility(isVisible(x, y));
      if (u.fogVisible && !wasVisible && !this.knownEnemyFogIds.has(u.id)) {
        this.knownEnemyFogIds.add(u.id);
        const now = this.time.now;
        if (now - this.lastEnemySpottedAlertMs >= this.ALERT_COOLDOWN_MS) {
          this.lastEnemySpottedAlertMs = now;
          this.showAlertBanner('\u25cf Enemy Spotted!', '#ffaa44');
        }
      }
    }

    // Enemy buildings — with fog-memory: previously-scouted buildings persist
    // as grey semi-transparent ghosts when out of current vision range.
    for (const b of this.buildingManager.getBuildings()) {
      if (b.faction !== 'enemy' || b.isDestroyed()) continue;
      const { x, y } = b.getWorldCenter();
      const visible = isVisible(x, y);
      if (visible) b.hasBeenSeen = true;
      b.setFogVisible(visible);
      if (!visible) b.setFogMemory(b.hasBeenSeen);
    }
  }

  /**
   * Show a "×N" count badge at the world-space centre of the selected group
   * when 2+ units are selected. Tracks the group as units move.
   */
  private updateSelectionBadge(): void {
    const selected = Array.from(this.unitManager.selectedUnits).filter(u => u.isAlive());
    const count = selected.length;

    if (count < 2) {
      this._selectionBadge?.setVisible(false);
      return;
    }

    // Compute average world-space position of selected units
    let sumX = 0; let sumY = 0;
    for (const u of selected) { const p = u.getPosition(); sumX += p.x; sumY += p.y; }
    const worldX = sumX / count;
    const worldY = sumY / count;

    // Convert world → screen space
    const cam = this.cameras.main;
    const screenX = (worldX - cam.scrollX) * cam.zoom;
    const screenY = (worldY - cam.scrollY) * cam.zoom;

    if (!this._selectionBadge) {
      this._selectionBadge = this.add.text(0, 0, '', {
        fontSize: '13px', color: '#00ff88',
        stroke: '#000000', strokeThickness: 3,
        backgroundColor: '#00000099', padding: { x: 5, y: 2 },
        fontStyle: 'bold',
      }).setScrollFactor(0).setDepth(9991).setOrigin(0.5, 1);
    }

    this._selectionBadge.setText(`×${count}`)
      .setPosition(screenX, screenY - 22)
      .setVisible(true);
  }

  /** Screen-space message that floats up from the top-centre (not affected by camera scroll). */
  private showScreenMessage(msg: string, colour: string): void {
    const { width } = this.scale;
    const t = this.add.text(width / 2, 52, msg, {
      fontSize: '13px', color: colour, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9998);
    this.tweens.add({
      targets: t, y: 32, alpha: 0, duration: 1400, ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }

  /** Update pulsing selection rings to match the current selectedBuildings array. */
  private updateBuildingSelectionRings(): void {
    // Drop any destroyed buildings from the selection first
    const before = this.selectedBuildings.length;
    this.selectedBuildings = this.selectedBuildings.filter(b => !b.isDestroyed());
    if (this.selectedBuildings.length < before) {
      // Refresh production panel: hide if empty, otherwise show surviving buildings.
      this.productionPanel.hide();
      if (this.selectedBuildings.length > 0) {
        this.productionPanel.showMulti(this.selectedBuildings);
      }
    }
    const currentIds = new Set(this.selectedBuildings.map(b => b.id));

    // Remove rings for deselected buildings
    this._buildingSelectionRings.forEach(({ gfx, tween }, id) => {
      if (!currentIds.has(id)) {
        tween.stop();
        tween.destroy();
        gfx.destroy();
        this._buildingSelectionRings.delete(id);
      }
    });

    // Add rings for newly selected buildings
    this.selectedBuildings.forEach(building => {
      if (this._buildingSelectionRings.has(building.id)) return;
      const { x, y } = building.getWorldCenter();
      const r = Math.max(building.def.tileWidth, building.def.tileHeight) * 16 + 8;
      const gfx = this.add.graphics().setDepth(12);
      const drawRing = (alpha: number) => {
        gfx.clear();
        gfx.lineStyle(2, 0xffffff, alpha);
        gfx.strokeCircle(x, y, r);
      };
      drawRing(0.5);
      const proxy = { alpha: 0.2 };
      const tween = this.tweens.add({
        targets: proxy,
        alpha: 0.8,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: () => drawRing(proxy.alpha),
      });
      this._buildingSelectionRings.set(building.id, { gfx, tween });
    });
  }

  private spawnFloatingText(wx: number, wy: number, text: string, colour: string): void {
    const t = this.add.text(wx, wy, text, {
      fontSize: '13px', color: colour, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(60);
    this.tweens.add({
      targets: t, y: wy - 36, alpha: 0, duration: 1400, ease: 'Power1',
      onComplete: () => t.destroy(),
    });
  }

  // ── Kill feed ─────────────────────────────────────────────────────────────

  private addKillFeedEntry(label: string, isPlayerKill: boolean): void {
    const W = this.scale.width;
    const colour = isPlayerKill ? '#44ff88' : '#ff4444';
    // Cap at 5 entries — remove oldest first
    while (this._killFeed.length >= 5) {
      const oldest = this._killFeed.shift()!;
      oldest.text.destroy();
    }
    const t = this.add.text(W - 10, 60, label, {
      fontSize: '11px', color: colour,
      stroke: '#000000', strokeThickness: 2,
      backgroundColor: '#00000099',
      padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(9993);
    this._killFeed.push({ text: t, remainingMs: 3000 });
    this.repositionKillFeed();
  }

  private repositionKillFeed(): void {
    this._killFeed.forEach((entry, i) => {
      entry.text.setY(60 + i * 18);
    });
  }

  // ── Move order lines ──────────────────────────────────────────────────────

  private showMoveOrderLines(worldX: number, worldY: number): void {
    // Clear any previous lines
    if (this._moveOrderGfx) {
      this.tweens.killTweensOf(this._moveOrderGfx);
      this._moveOrderGfx.destroy();
      this._moveOrderGfx = null;
    }
    const selected = this.unitManager.getAllUnits()
      .filter(u => u.isSelected && u.isAlive() && u.faction === 'player');
    if (selected.length === 0) return;

    const gfx = this.add.graphics().setDepth(18);
    gfx.lineStyle(1, 0xffffff, 0.7);
    selected.forEach(u => {
      const { x, y } = u.getPosition();
      gfx.beginPath();
      gfx.moveTo(x, y);
      gfx.lineTo(worldX, worldY);
      gfx.strokePath();
    });
    // Small target dot
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillCircle(worldX, worldY, 3);

    this._moveOrderGfx = gfx;
    this.tweens.add({
      targets: gfx, alpha: 0, duration: 800, ease: 'Linear',
      onComplete: () => {
        gfx.destroy();
        if (this._moveOrderGfx === gfx) this._moveOrderGfx = null;
      },
    });
  }

  // ── Rain effect ───────────────────────────────────────────────────────────

  private startRainEffect(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const ANGLE_SIN = Math.sin(0.35);
    const ANGLE_COS = Math.cos(0.35);

    const spawnDrop = () => {
      const startX = Math.random() * (W + 80) - 40;
      const len    = 8 + Math.random() * 10;
      const alpha  = 0.3 + Math.random() * 0.35;
      const gfx    = this.add.graphics()
        .setScrollFactor(0)
        .setDepth(9998)
        .setAlpha(alpha);
      gfx.lineStyle(1, 0xccddff, 1);
      gfx.beginPath();
      gfx.moveTo(0, 0);
      gfx.lineTo(ANGLE_SIN * len, ANGLE_COS * len);
      gfx.strokePath();
      gfx.setPosition(startX, -10);

      const speed    = 380 + Math.random() * 180;
      const dist     = H + 20;
      const duration = (dist / speed) * 1000;
      this.tweens.add({
        targets: gfx,
        x: startX + ANGLE_SIN * dist,
        y: H + 10,
        duration,
        ease: 'Linear',
        onComplete: () => gfx.destroy(),
      });
    };

    this._rainEmitter = this.time.addEvent({ delay: 28, callback: spawnDrop, repeat: -1 });
  }

  private stopRainEffect(): void {
    if (this._rainEmitter) {
      this._rainEmitter.remove();
      this._rainEmitter = null;
    }
    // After rain stops, trigger 30-second wind gust effect
    this.startWindGustEffect();
  }

  private startWindGustEffect(): void {
    if (this._windGustEmitter) return; // already running
    const { width: W, height: H } = this.scale;

    const spawnParticle = () => {
      const gfx = this.add.graphics().setScrollFactor(0).setDepth(18);
      const startX = -8 + Math.random() * (W + 16);
      const startY = Math.random() * H;
      const speed  = 300 + Math.random() * 200; // 300–500 px/s
      const vDrift = (Math.random() - 0.5) * 40; // slight vertical drift
      const W2 = W + 20;
      const duration = (W2 / speed) * 1000;
      gfx.fillStyle(0xffffff, 0.75);
      gfx.fillRect(startX, startY, 2, 2);
      this.tweens.add({
        targets: { x: startX, y: startY },
        x: startX + W + 20,
        y: startY + vDrift,
        duration,
        ease: 'Linear',
        onUpdate: (tween) => {
          const t = tween.getValue() as any;
          gfx.clear();
          gfx.fillStyle(0xffffff, 0.6 * (1 - tween.progress));
          const nx = startX + (W + 20) * tween.progress;
          const ny = startY + vDrift * tween.progress;
          gfx.fillRect(nx, ny, 2, 2);
        },
        onComplete: () => gfx.destroy(),
      });
    };

    this._windGustEmitter = this.time.addEvent({ delay: 18, callback: spawnParticle, repeat: -1 });
    // Stop after 30 seconds
    this.time.delayedCall(30000 / this.gameSpeed, () => this.stopWindGustEffect());
  }

  private stopWindGustEffect(): void {
    if (this._windGustEmitter) {
      this._windGustEmitter.remove();
      this._windGustEmitter = null;
    }
  }

  // ── Pause & speed ─────────────────────────────────────────────────────────

  private togglePause(): void {
    if (this.gameOver) return;
    if (this.isMultiplayer) return; // pausing one client while the other runs causes divergence
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      const { width, height } = this.scale;
      this.pauseOverlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.45)
        .setScrollFactor(0).setDepth(9500).setOrigin(0.5);
      this.pauseLabel = this.add.text(width / 2, height / 2, 'PAUSED', {
        fontSize: '64px', color: '#ffffff', stroke: '#000', strokeThickness: 6, fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(9501);
      this.add.text(width / 2, height / 2 + 56, 'SPACE to resume  ·  + / - to change speed', {
        fontSize: '14px', color: '#aaaaaa', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(9501).setName('pauseHint');
    } else {
      this.pauseOverlay?.destroy(); this.pauseOverlay = null;
      this.pauseLabel?.destroy();   this.pauseLabel   = null;
      // Destroy the hint text by name
      this.children.getByName('pauseHint')?.destroy();
    }
  }

  private static readonly SPEED_STEPS = [0.5, 1, 1.5, 2];

  private stepGameSpeed(dir: 1 | -1): void {
    if (this.isMultiplayer) return; // speed changes only affect local simulation — disabled in MP
    const steps = GameScene.SPEED_STEPS;
    const idx = steps.indexOf(this.gameSpeed);
    const next = idx === -1
      ? 1
      : Math.max(0, Math.min(steps.length - 1, idx + dir));
    this.setGameSpeed(steps[next]);
  }

  private setGameSpeed(speed: number): void {
    this.gameSpeed = speed;
    const label = speed === 1 ? '1× speed' : speed < 1 ? `${speed}× (slow)` : `${speed}× (fast)`;
    this.showScreenMessage(label, speed === 1 ? '#ffffff' : speed > 1 ? '#ffcc44' : '#88aaff');
  }

  /** Check if all enemy units and buildings have been destroyed (Annihilation win). */
  private checkAnnihilationWin(): void {
    const enemyUnitsAlive = this.unitManager.getLivingUnits().some(u => u.faction === 'enemy');
    const enemyBuildingsAlive = this.buildingManager.getBuildings().some(b => b.faction === 'enemy');
    if (!enemyUnitsAlive && !enemyBuildingsAlive) {
      this.endGame(true);
    }
  }

  private endGame(won: boolean): void {
    this.gameOver = true;
    this.enemyAI.destroy();

    // In multiplayer, broadcast the result so the opponent's screen also ends.
    // Only the winner sends this (to avoid double-broadcast when both simulationsreach the same conclusion).
    if (this.isMultiplayer && won) {
      const net = NetworkManager.instance;
      net.sendGameOver(net.sessionId);
    }

    // Save replay event log to localStorage (only for real games, not already-replaying)
    if (!this._replayMode && this._replayEventLog.length > 0) {
      try {
        localStorage.setItem('sibling_wars_replay', JSON.stringify(this._replayEventLog));
        localStorage.setItem('sibling_wars_replay_meta', JSON.stringify({
          race: this.race, enemyRace: this.enemyRace,
          difficulty: this.difficulty, winCondition: this.winCondition, won,
        }));
      } catch { /* localStorage full or unavailable */ }
    }

    // Compute elapsed time
    const elapsedMs = this.time.now - this.stats.startTimeMs;
    const totalSec  = Math.floor(elapsedMs / 1000);
    const minutes   = Math.floor(totalSec / 60);
    const seconds   = totalSec % 60;
    const timeStr   = `${minutes}:${String(seconds).padStart(2, '0')}`;

    if (won) {
      this.checkAchievement('fast_win',  elapsedMs < 5 * 60 * 1000);
      this.checkAchievement('no_losses', this.stats.unitsLost === 0);
    }

    // ── Battle Report pre-screen (5 seconds before win/lose screen) ────────────
    this.showBattleReportPreScreen(won, timeStr, () => {
      this.cameras.main.fadeOut(600, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.showEndScreen(won, timeStr);
      });
    });
  }

  /** Compute S/A/B/C/D letter grade from kill/death ratio and gold efficiency. */
  private computeBattleGrade(): { grade: string; color: string; desc: string } {
    const kills     = this.stats.enemiesKilled;
    const deaths    = Math.max(1, this.stats.unitsLost);
    const goldSpent = Math.max(1, this.stats.goldSpent);
    const kd        = kills / deaths;
    const goldEff   = (kills / goldSpent) * 1000; // kills per 1000g

    let grade: string;
    let color: string;
    let desc: string;
    if (kd >= 4 && goldEff >= 30) {
      grade = 'S'; color = '#ffdd44'; desc = 'Flawless Conquest';
    } else if (kd >= 2.5 || (kd >= 2 && goldEff >= 20)) {
      grade = 'A'; color = '#88ff88'; desc = 'Decisive Victory';
    } else if (kd >= 1.2 || kills >= 10) {
      grade = 'B'; color = '#88ccff'; desc = 'Solid Performance';
    } else if (kd >= 0.6 || kills >= 4) {
      grade = 'C'; color = '#ffaa44'; desc = 'Average Engagement';
    } else {
      grade = 'D'; color = '#ff5555'; desc = 'Pyrrhic Struggle';
    }
    return { grade, color, desc };
  }

  /** Show a "BATTLE REPORT" card before the win/lose screen.
   *  Has a 5-second auto-advance countdown AND interactive Play Again / Main Menu buttons. */
  private showBattleReportPreScreen(won: boolean, timeStr: string, onDone: () => void): void {
    const { width, height } = this.scale;
    const cx   = width / 2;
    const D    = 9800;
    const AUTO_MS = 7000;

    // Race accent colour
    const raceAccent = getRaceTint(this.race);
    const hexAccent  = '#' + raceAccent.toString(16).padStart(6, '0');

    // ── Full-screen backdrop ───────────────────────────────────────────────────
    const bg = this.add.rectangle(0, 0, width, height, 0x000000, 0.88)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D);

    // ── Main panel ─────────────────────────────────────────────────────────────
    const PW = 480; const PH = 370;
    const PX = cx - PW / 2; const PY = height / 2 - PH / 2 - 20;

    const gfx = this.add.graphics().setScrollFactor(0).setDepth(D + 1);
    // Background
    gfx.fillStyle(0x060b14, 0.97);
    gfx.fillRoundedRect(PX, PY, PW, PH, 14);
    // Gold outer border
    gfx.lineStyle(2, 0xbb9900, 0.9);
    gfx.strokeRoundedRect(PX, PY, PW, PH, 14);
    // Race-accent inner border (offset 4px inward)
    gfx.lineStyle(1, raceAccent, 0.4);
    gfx.strokeRoundedRect(PX + 4, PY + 4, PW - 8, PH - 8, 11);
    // Header divider
    gfx.lineStyle(1, 0x1e3050, 1);
    gfx.beginPath();
    gfx.moveTo(PX + 20, PY + 50); gfx.lineTo(PX + PW - 20, PY + 50);
    gfx.strokePath();
    // Grade divider (vertical, right column)
    const GRADE_COL_X = PX + PW - 120;
    gfx.lineStyle(1, 0x1e3050, 0.8);
    gfx.beginPath();
    gfx.moveTo(GRADE_COL_X, PY + 50); gfx.lineTo(GRADE_COL_X, PY + PH - 80);
    gfx.strokePath();

    // ── Header ─────────────────────────────────────────────────────────────────
    const allObjs: Phaser.GameObjects.GameObject[] = [bg, gfx];

    const header = this.add.text(cx - 40, PY + 16, '⚑  BATTLE REPORT', {
      fontSize: '16px', color: hexAccent,
      stroke: '#000', strokeThickness: 2, fontStyle: 'bold', letterSpacing: 4,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 2);
    allObjs.push(header);

    const outcomeLabel = this.add.text(PX + PW - 20, PY + 16, won ? '✓ WON' : '✗ LOST', {
      fontSize: '13px', color: won ? '#44ff88' : '#ff4444',
      stroke: '#000', strokeThickness: 2, fontStyle: 'bold',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2);
    allObjs.push(outcomeLabel);

    // ── Stats rows ─────────────────────────────────────────────────────────────
    const COL_L = PX + 24; const COL_R = GRADE_COL_X - 12;
    const rows: Array<[string, string, string]> = [
      ['Units Trained',        String(this.stats.unitsTrained),       '#aaddff'],
      ['Units Lost',           String(this.stats.unitsLost),          '#5588ff'],
      ['Enemy Kills',          String(this.stats.enemiesKilled),      '#ff8844'],
      ['Buildings Built',      String(this.stats.buildingsBuilt),     '#88ffcc'],
      ['Gold Spent',           `${this.stats.goldSpent}g`,            '#ffd700'],
      ['Time Elapsed',         timeStr,                               '#aaaaaa'],
    ];
    const ROW_H = 28;
    rows.forEach(([label, value, color], i) => {
      const ry = PY + 60 + i * ROW_H;
      const lt = this.add.text(COL_L, ry, label, {
        fontSize: '12px', color: '#6677aa', stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(D + 2);
      const rv = this.add.text(COL_R, ry, value, {
        fontSize: '13px', color, stroke: '#000', strokeThickness: 2, fontStyle: 'bold',
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2);
      allObjs.push(lt, rv);
    });

    // ── Letter grade (right column) ────────────────────────────────────────────
    const { grade, color: gradeColor, desc: gradeDesc } = this.computeBattleGrade();
    const gradeX = GRADE_COL_X + (PX + PW - GRADE_COL_X) / 2;
    const gradeY = PY + 100;

    const gradeLbl = this.add.text(gradeX, gradeY - 14, 'RATING', {
      fontSize: '9px', color: '#556677', stroke: '#000', strokeThickness: 1, letterSpacing: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 2);

    const gradeTxt = this.add.text(gradeX, gradeY + 12, grade, {
      fontSize: '64px', color: gradeColor,
      stroke: '#000000', strokeThickness: 6, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 2);

    const gradeDescTxt = this.add.text(gradeX, gradeY + 86, gradeDesc, {
      fontSize: '9px', color: gradeColor,
      stroke: '#000', strokeThickness: 1, align: 'center',
      wordWrap: { width: 100 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 2);

    // Kill/death ratio line
    const kd = (this.stats.enemiesKilled / Math.max(1, this.stats.unitsLost)).toFixed(1);
    const kdTxt = this.add.text(gradeX, gradeY + 112, `K/D  ${kd}`, {
      fontSize: '10px', color: '#778899', stroke: '#000', strokeThickness: 1,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 2);

    allObjs.push(gradeLbl, gradeTxt, gradeDescTxt, kdTxt);

    // ── Buttons: Play Again | Main Menu ────────────────────────────────────────
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      allObjs.forEach(o => { try { o.destroy(); } catch { /* already gone */ } });
      onDone();
    };

    const BTN_Y  = PY + PH - 56;
    const BTN_W  = 160; const BTN_H = 34;
    const BTN_GAP = 16;
    const BTN1_X = cx - BTN_W - BTN_GAP / 2;
    const BTN2_X = cx + BTN_GAP / 2;

    const makeBtn = (bx: number, label: string, fillIdle: number, fillHover: number,
                     borderIdle: number, borderHover: number, textColor: string,
                     cb: () => void) => {
      const btnGfx = this.add.graphics().setScrollFactor(0).setDepth(D + 2);
      allObjs.push(btnGfx);
      const draw = (hover: boolean) => {
        btnGfx.clear();
        btnGfx.fillStyle(hover ? fillHover : fillIdle, 1);
        btnGfx.fillRoundedRect(bx, BTN_Y, BTN_W, BTN_H, 8);
        btnGfx.lineStyle(2, hover ? borderHover : borderIdle, 1);
        btnGfx.strokeRoundedRect(bx, BTN_Y, BTN_W, BTN_H, 8);
      };
      draw(false);
      const txt = this.add.text(bx + BTN_W / 2, BTN_Y + BTN_H / 2, label, {
        fontSize: '13px', color: textColor, stroke: '#000', strokeThickness: 2, fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 3);
      allObjs.push(txt);
      const hit = this.add.rectangle(bx + BTN_W / 2, BTN_Y + BTN_H / 2, BTN_W, BTN_H, 0, 0)
        .setScrollFactor(0).setDepth(D + 4).setInteractive().setOrigin(0.5);
      allObjs.push(hit);
      hit.on('pointerover',  () => { draw(true);  txt.setColor('#ffffff'); });
      hit.on('pointerout',   () => { draw(false); txt.setColor(textColor); });
      hit.on('pointerdown',  () => cb());
    };

    makeBtn(BTN1_X, 'PLAY AGAIN',  0x0e200e, 0x1e3a1e, 0x336633, 0x66ff88, '#88ffaa',
      () => { dismiss(); this.time.delayedCall(10, () => this.scene.start('MenuScene')); });
    makeBtn(BTN2_X, 'MAIN MENU',   0x0e1520, 0x1a2a40, 0x224466, 0x4488cc, '#88aaff',
      () => { dismiss(); this.time.delayedCall(10, () => this.scene.start('MenuScene')); });

    // ── Countdown bar (auto-advance) ───────────────────────────────────────────
    const barBg = this.add.rectangle(PX + 20, PY + PH - 14, PW - 40, 5, 0x1a1a2a, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(D + 2);
    const bar = this.add.rectangle(PX + 20, PY + PH - 14, PW - 40, 5, raceAccent, 0.6)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(D + 3);
    allObjs.push(barBg, bar);

    this.tweens.add({ targets: bar, width: 0, duration: AUTO_MS, ease: 'Linear' });
    this.time.delayedCall(AUTO_MS, dismiss);

    // ── Grade pulse tween ──────────────────────────────────────────────────────
    this.tweens.add({
      targets: gradeTxt, scaleX: 1.06, scaleY: 1.06,
      yoyo: true, repeat: -1, duration: 900, ease: 'Sine.easeInOut',
    });
  }

  private showEndScreen(won: boolean, timeStr: string): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const D  = 501;

    const hexCss = (n: number) => '#' + n.toString(16).padStart(6, '0');
    const raceNames: Record<string, string> = {
      architects: 'Architects', covenant: 'Covenant',
      bulwark: 'Bulwark',       unseen: 'Unseen',
    };
    const playerRaceName = raceNames[this.race]    ?? this.race;
    const enemyRaceName  = raceNames[this.enemyRace] ?? this.enemyRace;
    const playerColor    = hexCss(getRaceTint(this.race));
    const enemyColor     = hexCss(getRaceTint(this.enemyRace));
    const diffLabel: Record<string, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
    const wcLabel:   Record<string, string> = { hq: 'HQ Destroy', annihilation: 'Annihilation', survival: 'Survival' };

    // ── Full-screen tinted backdrop ───────────────────────────────────────────
    const bgTint = won ? 0x010d05 : 0x0d0101;
    this.add.rectangle(0, 0, width, height, bgTint, 0.97)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(500);

    this.add.rectangle(0, 0, width, 4, getRaceTint(this.race), 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D + 2);

    // ── VICTORY / DEFEAT headline ─────────────────────────────────────────────
    const outcomeColor = won ? '#44ff88' : '#ff4444';
    this.add.text(cx, 52, won ? 'VICTORY' : 'DEFEAT', {
      fontSize: '64px', color: outcomeColor,
      stroke: '#000000', strokeThickness: 6, fontStyle: 'bold',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D);

    const subtitle = won
      ? (this.winCondition === 'annihilation' ? 'All enemy forces have been annihilated.'
        : this.winCondition === 'survival'    ? 'You survived the onslaught!'
        : 'The enemy stronghold has fallen.')
      : 'Your HQ has been destroyed.';
    this.add.text(cx, 92, subtitle, {
      fontSize: '15px', color: '#aaaaaa', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D);

    // ── "BATTLE REPORT" label ─────────────────────────────────────────────────
    this.add.text(cx, 122, 'BATTLE REPORT', {
      fontSize: '11px', color: playerColor,
      stroke: '#000', strokeThickness: 2, fontStyle: 'bold', letterSpacing: 4,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D);

    // ── Main report panel ─────────────────────────────────────────────────────
    const PW = 460; const PH = 292;
    const PX = cx - PW / 2; const PY = 142;

    const gfx = this.add.graphics().setScrollFactor(0).setDepth(D);
    gfx.fillStyle(0x060e18, 0.92);
    gfx.fillRoundedRect(PX, PY, PW, PH, 12);
    gfx.lineStyle(2, getRaceTint(this.race), 0.6);
    gfx.strokeRoundedRect(PX, PY, PW, PH, 12);
    gfx.lineStyle(1, 0x1e3050, 0.8);
    gfx.beginPath();
    gfx.moveTo(PX + 16, PY + 108); gfx.lineTo(PX + PW - 16, PY + 108);
    gfx.strokePath();

    const COL_L = PX + 22; const COL_R = PX + PW - 22; const ROW_H = 26;
    const addRow = (label: string, value: string, color: string, yOffset: number) => {
      this.add.text(COL_L, PY + yOffset, label, {
        fontSize: '12px', color: '#777788', stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(D + 1);
      this.add.text(COL_R, PY + yOffset, value, {
        fontSize: '12px', color, stroke: '#000', strokeThickness: 2,
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1);
    };

    let y = 14;
    addRow('Your Race',       playerRaceName,                    playerColor,  y); y += ROW_H;
    addRow('Enemy Race',      enemyRaceName,                     enemyColor,   y); y += ROW_H;
    addRow('Difficulty',      diffLabel[this.difficulty] ?? '?', '#ccaa55',    y); y += ROW_H;
    addRow('Win Condition',   wcLabel[this.winCondition] ?? '?', '#88aacc',    y); y += ROW_H;

    y = 122;
    addRow('Time Elapsed',        timeStr,                              '#aaaaaa', y); y += ROW_H;
    addRow('Enemies Destroyed',   String(this.stats.enemiesKilled),    '#ff8844', y); y += ROW_H;
    addRow('Friendly Units Lost', String(this.stats.unitsLost),        '#4488ff', y); y += ROW_H;
    addRow('Buildings Lost',      String(this.stats.buildingsLost),    '#cc6644', y); y += ROW_H;
    addRow('Gold Spent',          `${this.stats.goldSpent}g`,          '#ffd700', y); y += ROW_H;
    addRow('Upgrades Researched', String(this.purchasedUpgrades.size), '#88ddff', y);

    // ── Achievement medals ────────────────────────────────────────────────────
    const unlocked = this.achievements.filter(a => a.unlocked);
    const MEDAL_SECTION_Y = PY + PH + 12;

    if (unlocked.length > 0) {
      this.add.text(cx, MEDAL_SECTION_Y, 'MEDALS EARNED', {
        fontSize: '10px', color: playerColor,
        stroke: '#000', strokeThickness: 1, letterSpacing: 3,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D);

      const MEDAL_W = 66; const MEDAL_H = 44; const gap = 8;
      const totalW = unlocked.length * MEDAL_W + (unlocked.length - 1) * gap;
      let mx = cx - totalW / 2;
      unlocked.forEach(a => {
        const mgfx = this.add.graphics().setScrollFactor(0).setDepth(D);
        mgfx.fillStyle(0x1a1200, 0.9);
        mgfx.fillRoundedRect(mx, MEDAL_SECTION_Y + 16, MEDAL_W, MEDAL_H, 6);
        mgfx.lineStyle(1.5, 0xbb9900, 0.75);
        mgfx.strokeRoundedRect(mx, MEDAL_SECTION_Y + 16, MEDAL_W, MEDAL_H, 6);
        this.add.text(mx + MEDAL_W / 2, MEDAL_SECTION_Y + 22, a.icon, {
          fontSize: '14px', color: '#ffdd44',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 1);
        this.add.text(mx + MEDAL_W / 2, MEDAL_SECTION_Y + 41, a.label.split(' (')[0], {
          fontSize: '6px', color: '#ccbb55', stroke: '#000', strokeThickness: 1,
          wordWrap: { width: MEDAL_W - 6 }, align: 'center',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 1);
        mx += MEDAL_W + gap;
      });
    }

    // ── Play Again button ─────────────────────────────────────────────────────
    const btnY = unlocked.length > 0 ? MEDAL_SECTION_Y + 76 : MEDAL_SECTION_Y + 16;
    const BTN_W = 180; const BTN_H = 36;

    const btnGfx = this.add.graphics().setScrollFactor(0).setDepth(D);
    const drawBtn = (hover: boolean) => {
      btnGfx.clear();
      btnGfx.fillStyle(hover ? 0x1e3a1e : 0x0e200e, 1);
      btnGfx.fillRoundedRect(cx - BTN_W / 2, btnY, BTN_W, BTN_H, 8);
      btnGfx.lineStyle(2, hover ? 0x66ff88 : 0x336633, 1);
      btnGfx.strokeRoundedRect(cx - BTN_W / 2, btnY, BTN_W, BTN_H, 8);
    };
    drawBtn(false);
    const btnTxt = this.add.text(cx, btnY + BTN_H / 2, 'PLAY AGAIN', {
      fontSize: '16px', color: '#88ffaa',
      stroke: '#000', strokeThickness: 3, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);
    const hitArea = this.add.rectangle(cx, btnY + BTN_H / 2, BTN_W, BTN_H, 0, 0)
      .setScrollFactor(0).setDepth(D + 2).setInteractive().setOrigin(0.5);
    hitArea.on('pointerover',  () => { drawBtn(true);  btnTxt.setColor('#ccffdd'); });
    hitArea.on('pointerout',   () => { drawBtn(false); btnTxt.setColor('#88ffaa'); });
    hitArea.on('pointerdown',  () => this.scene.start('MenuScene'));

    // ── View Replay button (only if replay data exists and not already replaying)
    const hasReplayData = !this._replayMode && this._replayEventLog.length > 0;
    if (hasReplayData) {
      const rBtnY = btnY + BTN_H + 10;
      const rGfx  = this.add.graphics().setScrollFactor(0).setDepth(D);
      const drawRBtn = (hover: boolean) => {
        rGfx.clear();
        rGfx.fillStyle(hover ? 0x1a2a40 : 0x0a1420, 1);
        rGfx.fillRoundedRect(cx - BTN_W / 2, rBtnY, BTN_W, BTN_H, 8);
        rGfx.lineStyle(2, hover ? 0x66aaff : 0x224466, 1);
        rGfx.strokeRoundedRect(cx - BTN_W / 2, rBtnY, BTN_W, BTN_H, 8);
      };
      drawRBtn(false);
      const rTxt = this.add.text(cx, rBtnY + BTN_H / 2, '⏪ VIEW REPLAY', {
        fontSize: '13px', color: '#88aaff',
        stroke: '#000', strokeThickness: 3, fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);
      const rHit = this.add.rectangle(cx, rBtnY + BTN_H / 2, BTN_W, BTN_H, 0, 0)
        .setScrollFactor(0).setDepth(D + 2).setInteractive().setOrigin(0.5);
      rHit.on('pointerover',  () => { drawRBtn(true);  rTxt.setColor('#aaccff'); });
      rHit.on('pointerout',   () => { drawRBtn(false); rTxt.setColor('#88aaff'); });
      rHit.on('pointerdown',  () => {
        this.scene.start('GameScene', {
          race: this.race, difficulty: this.difficulty,
          winCondition: this.winCondition, replay: true,
        });
      });
    }

    this.cameras.main.fadeIn(400);
  }

  // ── Replay ───────────────────────────────────────────────────────────────

  /** Execute any replay events whose timestamp has been reached. */
  private processReplayEvents(): void {
    while (this._replayEventIdx < this._replayEventLog.length) {
      const ev = this._replayEventLog[this._replayEventIdx];
      if (ev.t > this.gameElapsedMs) break;
      this._replayEventIdx++;

      if (ev.type === 'move' && ev.tileX !== undefined && ev.tileY !== undefined) {
        const playerUnits = this.unitManager.getAllUnits()
          .filter(u => u.faction === 'player' && !u.isWorker && u.isAlive());
        if (playerUnits.length > 0) {
          // selectedUnits Set (not isSelected flag) is what moveSelectedUnits reads.
          playerUnits.forEach(u => this.unitManager.selectedUnits.add(u));
          this.unitManager.moveSelectedUnits(ev.tileX, ev.tileY);
          playerUnits.forEach(u => this.unitManager.selectedUnits.delete(u));
        }
      } else if (ev.type === 'attack_move' && ev.tileX !== undefined && ev.tileY !== undefined) {
        const playerUnits = this.unitManager.getAllUnits()
          .filter(u => u.faction === 'player' && !u.isWorker && u.isAlive());
        if (playerUnits.length > 0) {
          playerUnits.forEach(u => this.unitManager.selectedUnits.add(u));
          this.unitManager.attackMoveSelectedUnits(ev.tileX, ev.tileY);
          playerUnits.forEach(u => this.unitManager.selectedUnits.delete(u));
        }
      } else if (ev.type === 'train' && ev.tileX !== undefined && ev.tileY !== undefined && ev.unitTypeId) {
        const stats = RACE_COMBAT_STATS[this.race];
        if (ev.unitTypeId === 'worker') {
          this.unitManager.spawnWorker(ev.tileX, ev.tileY);
        } else {
          this.unitManager.spawnUnit(ev.tileX, ev.tileY, stats, ev.unitTypeId);
        }
      } else if (ev.type === 'build' && ev.defId && ev.tileX !== undefined && ev.tileY !== undefined) {
        const allDefs = getBuildingsForRace(this.race);
        const def = allDefs.find(d => d.id === ev.defId);
        if (def) this.buildingManager.placeBuilding(def, ev.tileX!, ev.tileY!, true, 'player');
      }
    }
  }

  // ── Screen vignette ───────────────────────────────────────────────────────

  /** Draws a subtle dark gradient at each screen edge to hint camera panning. */
  private createEdgeVignette(): void {
    const { width, height } = this.scale;
    const gfx = this.add.graphics().setScrollFactor(0).setDepth(18); // just below fog
    const VSIZE = 40; // gradient width in pixels

    // Each edge: a rect filled with a colour that goes from near-black to transparent
    // Phaser Graphics doesn't support gradients directly, so we draw layered rects with
    // decreasing alpha.
    const STEPS = 8;
    for (let s = 0; s < STEPS; s++) {
      const a = (1 - s / STEPS) * 0.18; // max 0.18 alpha at edge, 0 at interior
      gfx.fillStyle(0x000000, a);
      const t = Math.round((s / STEPS) * VSIZE);
      gfx.fillRect(t, t, width - t * 2, VSIZE - t);               // top
      gfx.fillRect(t, height - VSIZE + t, width - t * 2, VSIZE - t); // bottom
      gfx.fillRect(t, t, VSIZE - t, height - t * 2);               // left
      gfx.fillRect(width - VSIZE + t, t, VSIZE - t, height - t * 2); // right
    }
  }

  // ── Hotkey help overlay ───────────────────────────────────────────────────

  private toggleHelpOverlay(): void {
    if (this._helpOverlayVisible) {
      this._helpOverlay?.destroy();
      this._helpOverlay = null;
      this._helpOverlayVisible = false;
    } else {
      this._helpOverlayVisible = true;
      this._helpOverlay = this.buildHelpOverlay();
    }
  }

  private buildHelpOverlay(): Phaser.GameObjects.Container {
    const { width, height } = this.scale;
    const D = 9990;
    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(D);

    // Semi-transparent backdrop
    const bg = this.add.rectangle(0, 0, width, height, 0x000000, 0.78).setOrigin(0, 0);
    container.add(bg);

    // Panel
    const PW = 560; const PH = 400;
    const PX = (width - PW) / 2; const PY = (height - PH) / 2;
    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x060e18, 0.96);
    panelBg.fillRoundedRect(PX, PY, PW, PH, 12);
    panelBg.lineStyle(2, 0x2244aa, 0.9);
    panelBg.strokeRoundedRect(PX, PY, PW, PH, 12);
    container.add(panelBg);

    // Header
    const header = this.add.text(width / 2, PY + 18, '⌨  KEYBOARD SHORTCUTS  [F1 / ESC to close]', {
      fontSize: '13px', color: '#88aacc', stroke: '#000', strokeThickness: 2,
      fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5, 0);
    container.add(header);

    // Divider
    const divGfx = this.add.graphics();
    divGfx.lineStyle(1, 0x1e3050, 1);
    divGfx.beginPath();
    divGfx.moveTo(PX + 16, PY + 42); divGfx.lineTo(PX + PW - 16, PY + 42);
    divGfx.strokePath();
    container.add(divGfx);

    // Two-column shortcut grid
    const shortcuts: Array<[string, string]> = [
      // Left column
      ['Right-click',         'Move selected units'],
      ['A → Right-click',     'Attack-Move'],
      ['P → Right-click',     'Patrol to point'],
      ['R',                   'Retreat to base'],
      ['G / V / H',           'Stances: Aggro / Def / Hold'],
      ['C',                   'Unit ability'],
      ['E',                   'Unit 2nd ability'],
      ['B',                   'Stealth (Unseen)'],
      ['T',                   'Toggle Siege Mode'],
      ['F2 → Right-click',    'Assassinate (Unseen)'],
      ['F3 → Right-click',    'Divine Wrath (Covenant)'],
      ['N',                   'Iron Bastion wall (Bulwark)'],
      // Right column
      ['Ctrl+1-9',            'Assign control group'],
      ['1-9',                 'Recall control group'],
      ['Double-tap 1-9',      'Centre camera on group'],
      ['Space',               'Pause / Unpause'],
      ['+ / - / 0',           'Game speed up / down / reset'],
      ['F',                   'Cycle idle workers'],
      ['Tab (hold)',           'Stats overlay'],
      ['F2-F4',               'Camera bookmark recall'],
      ['Alt+F2-F4',           'Save camera bookmark'],
    ];

    const COL_W = PW / 2 - 20;
    const ROW_H = 19;
    const COL1X = PX + 18;
    const COL2X = PX + PW / 2 + 10;
    const START_Y = PY + 54;

    const half = Math.ceil(shortcuts.length / 2);
    shortcuts.forEach(([key, desc], i) => {
      const col = i < half ? 0 : 1;
      const row = i < half ? i : i - half;
      const x = col === 0 ? COL1X : COL2X;
      const y = START_Y + row * ROW_H;

      const keyTxt = this.add.text(x, y, key, {
        fontSize: '11px', color: '#ffcc44', stroke: '#000', strokeThickness: 2,
        fontStyle: 'bold',
      }).setOrigin(0, 0);
      const descTxt = this.add.text(x + COL_W * 0.44, y, desc, {
        fontSize: '11px', color: '#aabbcc', stroke: '#000', strokeThickness: 1,
      }).setOrigin(0, 0);
      container.add([keyTxt, descTxt]);
    });

    // Close on backdrop click
    bg.setInteractive();
    bg.on('pointerdown', () => this.toggleHelpOverlay());

    // ESC key also closes
    const escHandler = () => {
      if (this._helpOverlayVisible) this.toggleHelpOverlay();
    };
    this.input.keyboard!.once('keydown-ESC', escHandler);

    return container;
  }

  // ── Obstacle avoidance repellers ──────────────────────────────────────────

  /**
   * Mirror the hardcoded rock/tree/pond positions from spawnEnvironmentalProps
   * into UnitManager as world-space repeller circles. Moving units are nudged
   * away from these each frame, preventing them from visually walking through
   * the obstacle art.
   */
  private createHeightZones(): void {
    const g = this.add.graphics().setDepth(2);
    // 4 elevated plateau zones — deliberately away from bases and resource nodes
    const zones: Array<{ tx: number; ty: number; tw: number; th: number; label: string }> = [
      { tx: 12, ty:  3, tw: 7, th: 5, label: 'Northern Ridge' },
      { tx: 32, ty:  6, tw: 6, th: 4, label: 'Eastern Bluff'  },
      { tx:  5, ty: 26, tw: 6, th: 5, label: 'Western Cliffs' },
      { tx: 33, ty: 25, tw: 7, th: 5, label: 'Southern Heights'},
    ];
    for (const z of zones) {
      const wx = z.tx * TILE_SIZE;
      const wy = z.ty * TILE_SIZE;
      const ww = z.tw * TILE_SIZE;
      const wh = z.th * TILE_SIZE;
      // Slightly lighter plateau fill
      g.fillStyle(0xc8b87a, 0.18);
      g.fillRect(wx, wy, ww, wh);
      // Thin border
      g.lineStyle(1.5, 0xd4c080, 0.55);
      g.strokeRect(wx, wy, ww, wh);
      // Cliff ledge shadow — dark 3px line along the bottom edge of each elevated tile
      g.lineStyle(3, 0x000000, 0.4);
      g.lineBetween(wx, wy + wh, wx + ww, wy + wh);
      // Small label
      this.add.text(wx + ww / 2, wy + 4, `▲ ${z.label}`, {
        fontSize: '8px', color: '#d4c080', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 0).setDepth(3);
      this.heightZones.push({ rect: new Phaser.Geom.Rectangle(wx, wy, ww, wh), label: z.label });
    }
  }

  /** Returns true if the given world-space position is inside any height zone. */
  private isOnHighGround(worldX: number, worldY: number): boolean {
    for (const z of this.heightZones) {
      if (z.rect.contains(worldX, worldY)) return true;
    }
    return false;
  }

  private setupObstacleRepellers(): void {
    const repellers: Array<{ x: number; y: number; radius: number }> = [];

    // Use the same jittered positions computed in spawnEnvironmentalProps
    this._terrainRocks.forEach(({ x, y }) => {
      repellers.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2, radius: 20 });
    });

    this._terrainTrees.forEach(({ x, y }) => {
      repellers.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2, radius: 24 });
    });

    // Ponds — repel from their ellipse centres with a radius slightly larger than each pond's semi-major axis
    this._terrainPonds.forEach(({ cx, cy, rx }) => {
      repellers.push({ x: cx, y: cy, radius: rx + 14 });
    });

    this._terrainRepellers = repellers;
    this.unitManager.setObstacleRepellers(repellers);
  }

  /** Refresh building repellers — called every 30 frames so newly placed buildings push units. */
  private refreshBuildingRepellers(): void {
    const buildingReps: Array<{ x: number; y: number; radius: number }> = [];
    for (const b of this.buildingManager.getBuildings()) {
      const { x, y } = b.getWorldCenter();
      // Radius = half the diagonal of the building footprint + a small buffer
      const hw = (b.def.tileWidth  * TILE_SIZE) / 2;
      const hh = (b.def.tileHeight * TILE_SIZE) / 2;
      const radius = Math.sqrt(hw * hw + hh * hh) + 4;
      buildingReps.push({ x, y, radius });
    }
    this.unitManager.setBuildingRepellers(buildingReps);
  }

  // ── Unseen Shade Spire ─────────────────────────────────────────────────────

  /**
   * Spawn the expanding dark zone overlay for a newly placed Shade Spire.
   * The zone grows from 0 → maxRadius over 30 seconds, then holds.
   */
  private createShadeSpireZone(building: Building): void {
    const { x, y } = building.getWorldCenter();
    const MAX_RADIUS = 200; // ~6.25 tiles

    // Dark semi-transparent filled circle, starts invisible and scales up
    const zone = this.add.circle(x, y, MAX_RADIUS, 0x220033, 0.38).setDepth(3.8).setScale(0);

    // Outer ring for visual definition
    const ring = this.add.arc(x, y, MAX_RADIUS, 0, 360, false, 0x8800cc, 0)
      .setDepth(3.9).setStrokeStyle(2, 0x9911cc, 0.7).setScale(0);

    // Scale both from 0 → 1 over 30 s (i.e., zone fully expanded)
    this.tweens.add({ targets: [zone, ring], scale: 1, duration: 30000, ease: 'Power1' });

    // Pulsing glow on the ring
    this.tweens.add({
      targets: ring,
      strokeAlpha: { from: 0.3, to: 0.75 },
      duration: 1400,
      yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Pulsing fill alpha
    this.tweens.add({
      targets: zone,
      alpha: { from: 0.25, to: 0.50 },
      duration: 1800,
      yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.shadeSpires.push({ building, zoneCircle: zone, zoneRing: ring, maxRadius: MAX_RADIUS });
    this.spawnFloatingText(x, y - 40, '🌑 Shade Spire active', '#bb44ee');
  }

  /**
   * Each frame: reset zone-effect fields on all units, then re-apply effects
   * for units inside active shade zones.
   */
  private updateShadeZones(): void {
    // Reset zone multipliers — ensures units outside zones return to baseline
    for (const u of this.unitManager.getLivingUnits()) {
      u.moveSpeedMultiplier = 1.0;
      u.zoneArmorBonus      = 0;
    }

    // Prune destroyed spires and apply zone effects
    this.shadeSpires = this.shadeSpires.filter(spire => {
      if (spire.building.isDestroyed()) {
        this.tweens.killTweensOf(spire.zoneCircle);
        this.tweens.killTweensOf(spire.zoneRing);
        spire.zoneCircle.destroy();
        spire.zoneRing.destroy();
        return false;
      }

      const actualRadius = spire.zoneCircle.scaleX * spire.maxRadius;
      if (actualRadius < 1) return true; // still expanding from 0

      const { x: cx, y: cy } = spire.building.getWorldCenter();

      for (const u of this.unitManager.getLivingUnits()) {
        const { x, y } = u.getPosition();
        if (Math.hypot(x - cx, y - cy) > actualRadius) continue;

        if (u.faction === 'player') {
          // Unseen player units inside the zone: faster + tougher
          u.moveSpeedMultiplier = 1.2;
          u.zoneArmorBonus      = 2;
        } else {
          // Enemies inside the zone: slowed
          u.moveSpeedMultiplier = Math.min(u.moveSpeedMultiplier, 0.85);
        }
      }
      return true;
    });
  }

  // ── Architects Colossus — thermal beam ────────────────────────────────────

  /**
   * Fire a sweeping thermal beam from the Colossus toward (and through) the
   * primary target.  Hits every living unit within BEAM_WIDTH of the line.
   */
  private executeColossusBeam(caster: import('@/units/Unit').Unit, primaryTarget: import('@/units/Unit').Unit): void {
    const BEAM_WIDTH    = 28;  // perpendicular hit radius (px)
    const BEAM_LENGTH   = 320; // total beam length from caster
    const BEAM_DAMAGE   = caster.attackDamage;

    const { x: cx, y: cy } = caster.getPosition();
    const { x: tx, y: ty } = primaryTarget.getPosition();

    // Direction vector (unit)
    const rawDx = tx - cx;
    const rawDy = ty - cy;
    const rawLen = Math.hypot(rawDx, rawDy) || 1;
    const dirX = rawDx / rawLen;
    const dirY = rawDy / rawLen;

    // Beam end point
    const endX = cx + dirX * BEAM_LENGTH;
    const endY = cy + dirY * BEAM_LENGTH;

    // Hit every unit in the line (project unit position onto the beam segment)
    const hits: import('@/units/Unit').Unit[] = [];
    this.unitManager.getLivingUnits().forEach(u => {
      if (u.faction === caster.faction) return; // only enemies
      if (u === caster) return;
      const { x: ux, y: uy } = u.getPosition();
      // Scalar projection of (u − caster) onto beam direction
      const t = (ux - cx) * dirX + (uy - cy) * dirY;
      if (t < 0 || t > BEAM_LENGTH) return; // outside segment
      const perpX = (ux - cx) - t * dirX;
      const perpY = (uy - cy) - t * dirY;
      if (Math.hypot(perpX, perpY) <= BEAM_WIDTH) hits.push(u);
    });

    hits.forEach(u => {
      const killed = u.takeDamage(BEAM_DAMAGE);
      if (killed) caster.recordKill();
    });

    // ── Visual: bright orange-red line that sweeps ────────────────────────────
    const gfx = this.add.graphics().setDepth(35);
    // Outer glow
    gfx.lineStyle(14, 0xff3300, 0.28);
    gfx.beginPath(); gfx.moveTo(cx, cy); gfx.lineTo(endX, endY); gfx.strokePath();
    // Mid beam
    gfx.lineStyle(6, 0xff6600, 0.75);
    gfx.beginPath(); gfx.moveTo(cx, cy); gfx.lineTo(endX, endY); gfx.strokePath();
    // Core white-hot centre
    gfx.lineStyle(2, 0xffffff, 0.95);
    gfx.beginPath(); gfx.moveTo(cx, cy); gfx.lineTo(endX, endY); gfx.strokePath();

    // Muzzle flash on Colossus
    const muzzle = this.add.arc(cx, cy, 12, 0, 360, false, 0xff8800, 0.85).setDepth(36);
    this.tweens.add({ targets: muzzle, alpha: 0, scale: 3, duration: 220, ease: 'Power2', onComplete: () => muzzle.destroy() });

    // Fade out beam
    this.tweens.add({
      targets: gfx, alpha: 0, duration: 350, ease: 'Power2',
      onComplete: () => gfx.destroy(),
    });
  }

  // ── Bulwark Siege Crawler — splash damage ─────────────────────────────────

  private executeSiegeSplash(caster: import('@/units/Unit').Unit, targetX: number, targetY: number): void {
    const SPLASH_RADIUS = 90;
    const SPLASH_DAMAGE = Math.round(caster.attackDamage * 0.55);

    this.unitManager.getLivingUnits().forEach(u => {
      if (u.faction === caster.faction) return;
      if (u.isStealthed) return;
      const { x, y } = u.getPosition();
      const dist = Math.hypot(x - targetX, y - targetY);
      if (dist > 0 && dist <= SPLASH_RADIUS) {
        u.takeDamage(SPLASH_DAMAGE);
      }
    });

    // Orange ring visual
    const ring = this.add.arc(targetX, targetY, 8, 0, 360, false, 0xff6600, 0.5).setDepth(30);
    this.tweens.add({
      targets: ring,
      scaleX: SPLASH_RADIUS / 8, scaleY: SPLASH_RADIUS / 8,
      alpha: 0, duration: 420, ease: 'Power2',
      onComplete: () => ring.destroy(),
    });
  }

  // ── Idle workers ───────────────────────────────────────────────────────────

  /**
   * Returns all living player workers that have no task:
   *   - not garrisoned
   *   - miningState === 'idle' (no active mine assignment)
   *   - not moving (state === 'idle')
   */
  private getIdleWorkers(): import('@/units/WorkerUnit').WorkerUnit[] {
    return this.unitManager.getAllUnits()
      .filter(u => u.isAlive() && u.isWorker && u.faction === 'player' && !u.isGarrisoned)
      .map(u => u as import('@/units/WorkerUnit').WorkerUnit)
      .filter(w => w.miningState === 'idle' && !w.isMoving());
  }

  /** Select and pan to the next idle worker, cycling through the list. */
  private selectNextIdleWorker(): void {
    const idle = this.getIdleWorkers();
    if (idle.length === 0) return;
    this._idleWorkerCycleIdx = this._idleWorkerCycleIdx % idle.length;
    const worker = idle[this._idleWorkerCycleIdx];
    this._idleWorkerCycleIdx++;
    this.unitManager.deselectAll();
    worker.setSelected(true);
    this.unitManager.selectedUnits.add(worker);
    const { x, y } = worker.getPosition();
    this.cameras.main.pan(x, y, 280, 'Power2');
  }

  // ── Covenant Wellspring ────────────────────────────────────────────────────

  /**
   * Tick juice income from all active player Wellspring buildings (+5/s each).
   * Shows a visual pulse every 4 seconds per wellspring.
   */
  private updateCovenantWellspring(delta: number): void {
    const wellsprings = this.buildingManager.getBuildings()
      .filter(b => b.faction === 'player' && b.def.id === 'wellspring' && !b.isDestroyed());
    if (wellsprings.length === 0) return;

    // Accumulate fractional juice across frames
    this._wellspringJuiceAccum += 5 * wellsprings.length * (delta / 1000);
    if (this._wellspringJuiceAccum >= 1) {
      const add = Math.floor(this._wellspringJuiceAccum);
      this._wellspringJuiceAccum -= add;
      this.resources.addJuice(add);
    }

    // Visual pulse every 4 s
    this._wellspringVisualTimer += delta;
    if (this._wellspringVisualTimer >= 4000) {
      this._wellspringVisualTimer = 0;
      wellsprings.forEach(w => {
        const { x, y } = w.getWorldCenter();
        const pulse = this.add.circle(x, y, 18, 0xcc88ff, 0.45).setDepth(6);
        this.tweens.add({
          targets: pulse, alpha: 0, scaleX: 3.5, scaleY: 3.5,
          duration: 800, ease: 'Power2',
          onComplete: () => pulse.destroy(),
        });
        this.spawnFloatingText(x, y - 28, '+5 juice', '#cc88ff');
      });
    }
  }

  // ── Detector reveal ───────────────────────────────────────────────────────

  private updateDetectorReveal(): void {
    const allUnits = this.unitManager.getLivingUnits();
    const detectors = allUnits.filter(u => u.isDetector && u.faction === 'player');
    const stealthedEnemies = allUnits.filter(u => u.faction === 'enemy' && u.isStealthed);

    // Update detector ring positions
    detectors.forEach(d => d.updateDetectorRing());

    // Reset detection state
    stealthedEnemies.forEach(enemy => {
      const wasDetected = enemy.detectedByDetector;
      const nowDetected = detectors.some(d => {
        const dx = d.getPosition().x - enemy.getPosition().x;
        const dy = d.getPosition().y - enemy.getPosition().y;
        return (dx * dx + dy * dy) <= d.DETECTION_RADIUS_PX * d.DETECTION_RADIUS_PX;
      });
      enemy.detectedByDetector = nowDetected;
      if (wasDetected !== nowDetected) {
        // Transition: fully reveal or re-cloak
        if (nowDetected) {
          enemy.sprite.setAlpha(1.0);
          enemy.setDetectedVisual(true);
        } else {
          enemy.sprite.setAlpha(0.15);
          enemy.setDetectedVisual(false);
        }
      }
    });

    // Clear detection on units that are no longer stealthed
    allUnits.forEach(u => {
      if (!u.isStealthed && u.detectedByDetector) {
        u.detectedByDetector = false;
        u.setDetectedVisual(false);
      }
    });
  }

  // ── Ambient & environment ──────────────────────────────────────────────────

  /** Drifting dust motes across the entire map for atmospheric depth. */
  private createAmbientParticles(): void {
    const { widthInPixels, heightInPixels } = this.mapManager.getMapDimensions();
    const spawnDot = () => {
      const x = Math.random() * widthInPixels;
      const y = Math.random() * heightInPixels;
      const size = 0.7 + Math.random() * 1.3;
      const alpha = 0.07 + Math.random() * 0.1;
      const dot = this.add.circle(x, y, size, 0xffffff, alpha).setDepth(1);
      const driftX = (Math.random() - 0.5) * 55;
      const driftY = -22 - Math.random() * 30;
      const duration = 7000 + Math.random() * 9000;
      this.tweens.add({
        targets: dot, x: x + driftX, y: y + driftY, alpha: 0,
        duration, ease: 'Linear',
        onComplete: () => { dot.destroy(); spawnDot(); },
      });
    };
    for (let i = 0; i < 45; i++) {
      this.time.delayedCall(Math.random() * 10000, spawnDot);
    }
  }

  /**
   * Scatter decorative environmental props (rocks, trees, water patches) across
   * safe areas of the map that don't overlap with bases or resource nodes.
   */
  private spawnEnvironmentalProps(): void {
    const g = this.add.graphics().setDepth(3);

    /**
     * Jitter a tile coordinate within ±jitter tiles but clamped to map bounds
     * and to safe zones (min 7 tiles from player base, min 7 tiles from enemy base).
     */
    const jitter = (tx: number, ty: number, amount = 1): { x: number; y: number } => {
      const ox = Math.floor(Math.random() * (amount * 2 + 1)) - amount;
      const oy = Math.floor(Math.random() * (amount * 2 + 1)) - amount;
      const nx = Math.max(1, Math.min(48, tx + ox));
      const ny = Math.max(1, Math.min(38, ty + oy));
      return { x: nx, y: ny };
    };

    // ── Rock clusters ─────────────────────────────────────────────────────────
    const rockBase = [
      // Top-centre corridor (safe gap between player base and contested zone)
      { x: 22, y: 3 }, { x: 23, y: 4 }, { x: 21, y: 5 },
      { x: 30, y: 4 }, { x: 31, y: 3 }, { x: 29, y: 5 },
      // Left margin (far from all resource nodes)
      { x: 3, y: 18 }, { x: 4, y: 17 }, { x: 2, y: 20 },
      // Right margin
      { x: 47, y: 12 }, { x: 48, y: 13 }, { x: 46, y: 14 },
      // Lower-left
      { x: 14, y: 33 }, { x: 15, y: 34 }, { x: 13, y: 35 },
      // Lower-right (away from enemy expansion at 34-36, 26-29)
      { x: 45, y: 23 }, { x: 46, y: 22 },
    ];
    this._terrainRocks = rockBase.map(t => jitter(t.x, t.y, 1));
    const rockTiles = this._terrainRocks;

    rockTiles.forEach(({ x, y }) => {
      // Mark tile as impassable in pathfinding grid
      this.pathfinder.blockTile(x, y);
      const wx = x * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 10;
      const wy = y * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 10;
      const sz = 4 + Math.random() * 6;
      g.fillStyle(0x000000, 0.18);
      g.fillEllipse(wx + 2, wy + 3, sz * 2.2, sz * 1.1);
      g.fillStyle(0x556644, 0.85);
      g.fillEllipse(wx, wy, sz * 2, sz * 1.3);
      g.fillStyle(0x778866, 0.55);
      g.fillEllipse(wx - sz * 0.25, wy - sz * 0.3, sz * 1.0, sz * 0.65);
    });

    // ── Tree clusters ─────────────────────────────────────────────────────────
    const treeBase = [
      // Between player base and first expansion — gap kept at (27,6) for pathing
      { x: 26, y: 6 }, { x: 28, y: 6 }, { x: 27, y: 5 },
      // Left edge, mid-map
      { x: 5, y: 14 }, { x: 6, y: 15 }, { x: 5, y: 16 },
      // Right edge, upper
      { x: 43, y: 9 }, { x: 44, y: 8 }, { x: 44, y: 10 },
      // Lower-left
      { x: 8, y: 28 }, { x: 9, y: 29 }, { x: 10, y: 28 },
      // Lower-centre (safe from enemy expansion)
      { x: 11, y: 36 }, { x: 12, y: 37 }, { x: 13, y: 36 },
    ];
    this._terrainTrees = treeBase.map(t => jitter(t.x, t.y, 1));
    const treeTiles = this._terrainTrees;

    treeTiles.forEach(({ x, y }) => {
      // Mark tile as impassable in pathfinding grid
      this.pathfinder.blockTile(x, y);
      const wx = x * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 7;
      const wy = y * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 7;
      const sz = 7 + Math.random() * 5;
      // Drop shadow
      g.fillStyle(0x000000, 0.15);
      g.fillEllipse(wx + 4, wy + 6, sz * 2.4, sz * 0.9);
      // Trunk
      g.fillStyle(0x3d2b0e, 0.9);
      g.fillRect(wx - 2, wy, 4, sz * 0.8);
      // Canopy layers — three overlapping circles for volume
      g.fillStyle(0x1d4a1d, 0.9);
      g.fillCircle(wx, wy - sz * 0.3, sz);
      g.fillStyle(0x265c26, 0.75);
      g.fillCircle(wx - sz * 0.3, wy - sz * 0.5, sz * 0.7);
      g.fillStyle(0x2e7a2e, 0.6);
      g.fillCircle(wx + sz * 0.2, wy - sz * 0.65, sz * 0.55);
    });

    // ── Water / pond patches ──────────────────────────────────────────────────
    // Placed in neutral corridors with no resource nodes nearby.
    // Centre tiles are jittered ±1 tile each game so the map looks slightly different.
    const pondBases = [
      { tx: 23, ty: 14, rx: 55, ry: 34 },
      { tx: 46, ty: 20, rx: 46, ry: 28 },
      { tx:  7, ty: 26, rx: 42, ry: 26 },
    ];
    this._terrainPonds = pondBases.map(p => {
      const { x: jx, y: jy } = jitter(p.tx, p.ty, 1);
      return { cx: jx * TILE_SIZE, cy: jy * TILE_SIZE, rx: p.rx, ry: p.ry };
    });
    const ponds = this._terrainPonds;

    // Block the tile footprint of each pond ellipse
    ponds.forEach(({ cx, cy, rx, ry }) => {
      const tileRX = Math.ceil(rx / TILE_SIZE);
      const tileRY = Math.ceil(ry / TILE_SIZE);
      const centerTX = Math.floor(cx / TILE_SIZE);
      const centerTY = Math.floor(cy / TILE_SIZE);
      for (let dy = -tileRY; dy <= tileRY; dy++) {
        for (let dx = -tileRX; dx <= tileRX; dx++) {
          // Pixel-accurate ellipse containment: only block tiles whose centre lies within the visual ellipse
          if ((dx * dx * TILE_SIZE * TILE_SIZE) / (rx * rx) + (dy * dy * TILE_SIZE * TILE_SIZE) / (ry * ry) <= 1) {
            const tx = centerTX + dx;
            const ty = centerTY + dy;
            if (tx >= 1 && ty >= 1 && tx < 49 && ty < 39) {
              this.pathfinder.blockTile(tx, ty);
            }
          }
        }
      }
    });

    ponds.forEach(({ cx, cy, rx, ry }) => {
      g.fillStyle(0x1a3a5c, 0.52);
      g.fillEllipse(cx, cy, rx * 2, ry * 2);
      g.fillStyle(0x2255aa, 0.28);
      g.fillEllipse(cx - rx * 0.2, cy - ry * 0.25, rx * 0.8, ry * 0.5);
      // Static light glint
      g.fillStyle(0x88bbff, 0.22);
      g.fillEllipse(cx - rx * 0.15, cy - ry * 0.22, rx * 0.35, ry * 0.2);
    });

    // Animated shimmer on each pond
    ponds.forEach(({ cx, cy, rx, ry }) => {
      const shimmer = this.add.ellipse(cx - rx * 0.15, cy - ry * 0.22, rx * 0.35, ry * 0.22, 0x88bbff, 0.22).setDepth(3.5);
      this.tweens.add({
        targets: shimmer,
        alpha: { from: 0.08, to: 0.38 },
        x: { from: cx - rx * 0.15, to: cx - rx * 0.04 },
        duration: 2400 + Math.random() * 1000,
        yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });

    // ── Energy crystal formations (near resource nodes) ───────────────────────
    const crystalOffsets = [
      { dx: -2, dy: -1 }, { dx: 2, dy: -2 }, { dx: -1, dy: 2 },
      { dx: 3, dy: 1 }, { dx: -3, dy: 0 },
    ];
    const resourcePositions = [
      ...GOLD_POSITIONS.slice(2, 8),  // mid-map gold nodes
      ...JUICE_POSITIONS.slice(1, 4), // mid-map juice nodes
    ];
    resourcePositions.forEach(pos => {
      const offset = crystalOffsets[Math.floor(Math.random() * crystalOffsets.length)];
      const tx = pos.x + offset.dx;
      const ty = pos.y + offset.dy;
      if (tx < 1 || ty < 1 || tx > 48 || ty > 38) return;
      const wx = tx * TILE_SIZE + TILE_SIZE / 2;
      const wy = ty * TILE_SIZE + TILE_SIZE / 2;
      // Draw a small cluster of cyan crystal shards
      for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) {
        const ox = (Math.random() - 0.5) * 12;
        const oy = (Math.random() - 0.5) * 12;
        const cw2 = 3 + Math.random() * 3;
        const ch2 = 7 + Math.random() * 8;
        g.fillStyle(0x00ffee, 0.5);
        g.fillRect(wx + ox - cw2 / 2, wy + oy - ch2, cw2, ch2);
        g.fillStyle(0x88ffff, 0.25);
        g.fillRect(wx + ox - cw2 / 2, wy + oy - ch2, cw2 * 0.5, ch2 * 0.4);
      }
      // Animated glow
      const glow = this.add.ellipse(wx, wy, 18, 10, 0x00ffee, 0.25).setDepth(3.2);
      this.tweens.add({
        targets: glow, alpha: { from: 0.1, to: 0.5 }, scaleX: { from: 0.8, to: 1.3 },
        duration: 1200 + Math.random() * 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    });

    // ── Ancient ruin markers ──────────────────────────────────────────────────
    const ruinPositions = [
      { tx: 18, ty: 19 }, { tx: 33, ty: 14 }, { tx: 8, ty: 30 },
    ];
    ruinPositions.forEach(({ tx, ty }) => {
      const { x: jx, y: jy } = jitter(tx, ty, 2);
      const wx = jx * TILE_SIZE + TILE_SIZE / 2;
      const wy = jy * TILE_SIZE + TILE_SIZE / 2;
      const sz = TILE_SIZE * (1.5 + Math.random() * 0.5);
      // Faded square outlines suggesting collapsed walls
      g.lineStyle(1.5, 0x887755, 0.35);
      g.strokeRect(wx - sz / 2, wy - sz / 2, sz, sz);
      g.lineStyle(1, 0x887755, 0.2);
      g.strokeRect(wx - sz * 0.6, wy - sz * 0.6, sz * 1.2, sz * 1.2);
      // Corner rubble dots
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][];
      corners.forEach(([cx2, cy2]) => {
        g.fillStyle(0x665544, 0.45);
        g.fillCircle(wx + cx2 * sz * 0.45, wy + cy2 * sz * 0.45, 2 + Math.random() * 2);
      });
    });
  }

  // ── Scene lifecycle ────────────────────────────────────────────────────────

  /** Clean up NetworkManager listeners and room connection when leaving this scene. */
  shutdown(): void {
    if (this.isMultiplayer) {
      const net = NetworkManager.instance;
      net.offAllEvents();
      net.disconnect();
    }
  }

  // ── Game loop ──────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.gameOver) return;

    this._frameCount++;

    // ── Gold income rate (sliding 10s window, recomputed every second) ────────
    this._incomeTickAccum += delta;
    if (this._incomeTickAccum >= 1000) {
      this._incomeTickAccum -= 1000;
      const now = this.time.now;
      const cutoff = now - 10000;
      // Purge entries older than 10 s
      this.goldIncomeHistory = this.goldIncomeHistory.filter(e => e.time >= cutoff);
      const tenSecTotal = this.goldIncomeHistory.reduce((s, e) => s + e.amount, 0);
      this.goldIncomePerMin = tenSecTotal * 6; // ×6 to extrapolate 10 s → 1 min
    }

    // Always handle camera and UI regardless of pause
    this.inputHandler.update(delta);
    this.updateSelectionBadge();
    this.hud.update(
      this.unitManager.getSelectedCount(),
      this.unitManager.hasOnlyWorkers(),
      this.supplyUsed,
      this.buildingManager.getTotalSupply() + this.bonusSupply,
      this.buildingPlacement.isPlacing(),
      this.unitManager.getControlGroupCounts(),
      this.unitManager.getSelectedStance(),
      this.unitManager.getSelectedAbilityInfo(),
      this.isPaused,
      this.gameSpeed,
      this.unitManager.getSelectedEAbilityInfo(),
      this.unitManager.attackBonus,
      this.unitManager.armorBonus,
      this.unitManager.getSelectionComposition(),
      this.goldIncomePerMin,
      this.difficulty,
      this._idleWorkerCount,
      delta,
      this.winCondition,
      this.winCondition === 'survival' ? this.survivalMsRemaining : undefined,
      this.gameElapsedMs,
      this._idleMilitaryCount,
      this._computeSupplyAlmostFull(),
    );

    // ── Command card ─────────────────────────────────────────────────────────
    const unitCount = this.unitManager.getSelectedCount();
    const buildingOpen = this.productionPanel.getActiveBuilding() !== null;
    if (unitCount > 0 && !buildingOpen) {
      const siegeCrawlers = this.unitManager.getAllUnits()
        .filter(u => u.isSelected && u.isAlive() && u.unitTypeId === 'siege_crawler');
      this.commandCard.show({
        isWorkerOnly:   this.unitManager.hasOnlyWorkers(),
        race:           this.race,
        abilityInfo:    this.unitManager.getSelectedAbilityInfo(),
        eAbilityInfo:   this.unitManager.getSelectedEAbilityInfo(),
        rAbilityInfo:   this.unitManager.getSelectedRAbilityInfo(),
        hasBAbility:    this.race === 'unseen' && this.unitManager.getSelectedPhantoms().length > 0,
        bAbilityLocked: !this.unitManager.isAbilityUnlocked('unlock_stealth'),
        hasSiegeCrawler: siegeCrawlers.length > 0,
        siegeActive:    siegeCrawlers.some(u => u.siegeModeActive),
      });
    } else {
      this.commandCard.hide();
    }

    // ── Unit portrait panel ───────────────────────────────────────────────────
    // Only shown when exactly one unit is selected; hidden otherwise.
    if (unitCount === 1 && !buildingOpen) {
      this.portraitPanel.update(this.unitManager.getSingleSelectedUnit());
    } else {
      this.portraitPanel.hide();
    }
    // ── Detector reveal (every 6 frames) ──────────────────────────────────────
    if (this._frameCount % 6 === 0) {
      this.updateDetectorReveal();
    }

    // Minimap redraws every 3 frames — unit dots lag by ~50 ms at 60 fps, imperceptible
    if (this._frameCount % 3 === 0) {
      this.minimap.update(
        this.unitManager.getAllUnits(),
        this.buildingManager.getBuildings(),
        {
          terrainRocks:    this._terrainRocks,
          terrainTrees:    this._terrainTrees,
          resourceNodes:   this.resourceNodes.map(n => ({
            tileX: n.tileX, tileY: n.tileY,
            type: n.type as 'gold' | 'juice',
            isDepleted: () => n.isDepleted(),
          })),
          neutralOutposts: this._neutralOutpostTiles,
        },
        this.game.loop.delta,
      );
    }
    this.buildMenu.update();
    // Keep playerBuildingIds current so ProductionPanel can gate tech requirements
    this.productionPanel.playerBuildingIds = new Set(
      this.buildingManager.getBuildings()
        .filter(b => b.faction === 'player')
        .map(b => b.def.id)
    );
    this.productionPanel.update();

    // Tick game clock only when unpaused
    if (!this.isPaused) this.gameElapsedMs += delta;

    // ── Kill feed: tick timers, fade and remove expired entries ───────────────
    {
      let changed = false;
      this._killFeed = this._killFeed.filter(entry => {
        entry.remainingMs -= delta;
        if (entry.remainingMs <= 600) {
          entry.text.setAlpha(Math.max(0, entry.remainingMs / 600));
        }
        if (entry.remainingMs <= 0) {
          entry.text.destroy();
          changed = true;
          return false;
        }
        return true;
      });
      if (changed) this.repositionKillFeed();
    }

    // ── Replay event processing ───────────────────────────────────────────────
    if (this._replayMode && !this.isPaused) {
      this.processReplayEvents();
    }

    // Intro overlay is playing — block all game-logic updates
    if (this._introActive) return;

    if (this.isPaused) return;

    const d = delta * this.gameSpeed;

    // ── Rain effect: start at 3 min, auto-stop after 2 min (5 min total) ─────
    if (!this._rainStarted && this.gameElapsedMs >= 180000) {
      this._rainStarted = true;
      this.startRainEffect();
      // Stop after 2 more minutes
      this.time.delayedCall(120000 / this.gameSpeed, () => this.stopRainEffect());
    }

    // ── Hero respawn timers ───────────────────────────────────────────────────
    this.heroRespawnTimers.forEach((ms, race) => {
      const remaining = Math.max(0, ms - d);
      if (remaining <= 0) this.heroRespawnTimers.delete(race);
      else this.heroRespawnTimers.set(race, remaining);
    });
    // Update respawn label
    if (this.heroRespawnTimers.size > 0 && this.heroRespawnLabel) {
      const parts: string[] = [];
      this.heroRespawnTimers.forEach((ms) => {
        parts.push(`♛ Hero respawn: ${Math.ceil(ms / 1000)}s`);
      });
      this.heroRespawnLabel.setText(parts.join('  ')).setVisible(true);
    } else if (this.heroRespawnLabel) {
      this.heroRespawnLabel.setVisible(false);
    }

    // ── AI dynamic difficulty — pass player state ─────────────────────────────
    const playerUnitCount = this.unitManager.getAllUnits().filter(u => u.faction === 'player' && u.isAlive() && !u.isWorker).length;
    this.enemyAI.playerUnitCount = playerUnitCount;
    this.enemyAI.playerGold = this.resources.getGold();
    this.enemyAI.playerIdleMs = this.gameElapsedMs - this.lastPlayerActionMs;
    this.enemyAI.playerRangedUnitCount = this.unitManager.getAllUnits()
      .filter(u => u.faction === 'player' && u.isAlive() && !u.isWorker && u.attackRangePx > 80).length;
    this.enemyAI.playerMeleeUnitCount = this.unitManager.getAllUnits()
      .filter(u => u.faction === 'player' && u.isAlive() && !u.isWorker && u.attackRangePx <= 80).length;

    this.unitManager.update(d);
    this.buildingManager.update(d);
    this.buildingPlacement.update();
    this.enemyAI.update(d);
    this._updateIronBastionWalls(d);
    this.updateHQPassives(d);
    this.updateDevoteeHeal(d);
    this.updateShadeZones();
    if (this.race === 'covenant') this.updateCovenantWellspring(d);
    if (this.race === 'covenant') this.updateSanctuaryZones(d);
    this.tickWorkerMining(d);
    this.updateIdleMilitaryTracking(d);

    // Architects Reconstruction Protocol — beam + HP repair
    if (this.race === 'architects') {
      this.updateReconstructionProtocol(d);
    }

    // Architects pylon power — every 4 frames
    if (this._frameCount % 4 === 0) {
      this.updatePylonPower();
    }

    // Architects Sentinel Turret attacks
    this.updateSentinelTurrets(d);

    // Overcharge turret cooldowns per unit
    this._overchargeTurretCooldowns.forEach((ms, id) => {
      if (ms > 0) this._overchargeTurretCooldowns.set(id, Math.max(0, ms - d));
    });

    // Deploy Drone timers
    this.updateDrones(d);

    // War Cry cooldowns + buff timers
    this.updateWarCry(d);

    // Aegis Shield cooldowns + shield duration timers
    this.updateAegisShields(d);

    // EMP Pulse cooldowns
    this._empPulseCooldowns.forEach((ms, id) => {
      if (ms > 0) this._empPulseCooldowns.set(id, Math.max(0, ms - d));
    });

    // Architects Structural Analysis passive repair
    if (this.race === 'architects') {
      this.updateStructuralAnalysis(d);
      this.updateScannerSweep(d);
    }

    // Camera shake: check if 5+ units died within the last 2 seconds
    const now2 = this.gameElapsedMs;
    this._recentUnitDeathTimes = this._recentUnitDeathTimes.filter(t => now2 - t < 2000);

    // Unseen Void Gate portals
    if (this.race === 'unseen') this.updateVoidGates(d);

    this.combatSystem.update(d, this.unitManager.getLivingUnits(), this.buildingManager.getBuildings());
    this.unitManager.removeDeadUnits();

    // ── Win condition checks ──────────────────────────────────────────────────
    if (!this.gameOver) {
      if (this.winCondition === 'survival') {
        this.survivalMsRemaining -= d;
        if (this.survivalMsRemaining <= 0) {
          this.survivalMsRemaining = 0;
          this.endGame(true);
        }
      } else if (this.winCondition === 'annihilation') {
        // Also check after unit kills (done in checkAnnihilationWin triggered by enemy death)
        if (this._frameCount % 60 === 0) this.checkAnnihilationWin();
      }
    }

    // ── Periodic achievement checks ───────────────────────────────────────────
    if (this._frameCount % 120 === 0) {
      // Economist: accumulate 1000 gold at once
      this.checkAchievement('economist', this.resources.getGold() >= 1000);
      // Turtle: survive 10 minutes without losing a building
      this.checkAchievement('turtle', this.gameElapsedMs >= 600000 && this.stats.buildingsLost === 0);
    }

    // Idle worker count — used by HUD indicator and F-key cycling
    this._idleWorkerCount = this.getIdleWorkers().length;

    // Refresh building repellers so new buildings steer units around them
    if (this._frameCount % 30 === 0) {
      this.refreshBuildingRepellers();
      // Prune destroyed buildings from selectedBuildings (covers mid-game destruction)
      this.updateBuildingSelectionRings();
    }

    // Fog-of-war runs every 2 frames — halves O(n·m) cost with no visible effect
    if (this._frameCount % 2 === 0) {
      this.updateFogVisibility();
    }

    // Height zone — update isOnHighGround for all living units each frame
    this.unitManager.getAllUnits().forEach(u => {
      if (u.isAlive()) {
        const { x, y } = u.getPosition();
        u.isOnHighGround = this.isOnHighGround(x, y);
      }
    });

    // Auto-show build menu when worker(s) selected
    if (this.unitManager.hasOnlyWorkers() && this.unitManager.getSelectedCount() > 0) {
      this.buildMenu.show();
    } else if (!this.buildingPlacement.isPlacing()) {
      this.buildMenu.hide();
    }

    // ── Shield Wall passive (Bulwark): adjacency check every 500ms ────────────
    if (this.race === 'bulwark') {
      this._shieldWallAccum += d;
      if (this._shieldWallAccum >= this.SHIELD_WALL_CHECK_INTERVAL_MS) {
        this._shieldWallAccum = 0;
        this.updateShieldWallPassive();
      }
    }

    // ── Void Rift update (Unseen) ─────────────────────────────────────────────
    if (this.race === 'unseen' && this._voidRifts.length > 0) {
      this.updateVoidRifts(d);
    }

    // ── Unit tooltip hover ────────────────────────────────────────────────────
    this.updateUnitTooltip(d);
  }

  // ── Shield Wall passive adjacency ─────────────────────────────────────────
  private updateShieldWallPassive(): void {
    const playerUnits = this.unitManager.getLivingUnits().filter(u => u.faction === 'player');
    for (const u of playerUnits) {
      const { x, y } = u.getPosition();
      let nearby = 0;
      for (const other of playerUnits) {
        if (other === u) continue;
        const { x: ox, y: oy } = other.getPosition();
        if (Math.hypot(x - ox, y - oy) <= this.SHIELD_WALL_ADJ_PX) nearby++;
      }
      u.setShieldWallPassive(nearby >= 2); // self + 2 others = 3 total
    }
  }

  // ── Void Rift update ──────────────────────────────────────────────────────
  private updateVoidRifts(delta: number): void {
    const enemies = this.unitManager.getLivingUnits().filter(u => u.faction === 'enemy');

    // Tick slow timers — reset speed each frame, apply slow if timer active
    this.unitManager.getLivingUnits().forEach(u => {
      const slow = this._voidRiftSlowedUnits.get(u.id);
      if (slow !== undefined) {
        const remaining = slow - delta;
        if (remaining <= 0) {
          this._voidRiftSlowedUnits.delete(u.id);
        } else {
          this._voidRiftSlowedUnits.set(u.id, remaining);
          u.moveSpeedMultiplier = Math.min(u.moveSpeedMultiplier, 1 - this.VOID_RIFT_SLOW_PCT);
        }
      }
    });

    this._voidRifts = this._voidRifts.filter(rift => {
      rift.timer -= delta;
      rift.spinAngle += delta * 0.004;

      // Redraw swirling purple vortex
      rift.gfx.clear();
      const alpha = Math.min(1, rift.timer / 1000);
      rift.gfx.lineStyle(3, 0xaa22ff, alpha * 0.9);
      rift.gfx.beginPath();
      rift.gfx.arc(rift.x, rift.y, 18, rift.spinAngle, rift.spinAngle + Math.PI * 1.4);
      rift.gfx.strokePath();
      rift.gfx.lineStyle(2, 0xdd88ff, alpha * 0.6);
      rift.gfx.beginPath();
      rift.gfx.arc(rift.x, rift.y, 10, rift.spinAngle + Math.PI, rift.spinAngle + Math.PI * 2.2);
      rift.gfx.strokePath();
      rift.gfx.lineStyle(2, 0x6600cc, alpha * 0.5);
      rift.gfx.beginPath();
      rift.gfx.arc(rift.x, rift.y, 26, rift.spinAngle + 0.5, rift.spinAngle + Math.PI * 0.9);
      rift.gfx.strokePath();

      // Check enemy proximity
      for (const enemy of enemies) {
        if (rift.hitUnitIds.has(enemy.id)) continue;
        const { x: ex, y: ey } = enemy.getPosition();
        if (Math.hypot(ex - rift.x, ey - rift.y) <= this.VOID_RIFT_RADIUS_PX) {
          rift.hitUnitIds.add(enemy.id);
          enemy.takeDamage(this.VOID_RIFT_DAMAGE);
          this.spawnFloatingText(ex, ey - 20, `-${this.VOID_RIFT_DAMAGE}`, '#cc44ff');
          this._voidRiftSlowedUnits.set(enemy.id, this.VOID_RIFT_SLOW_MS);
        }
      }

      if (rift.timer <= 0) {
        rift.gfx.destroy();
        return false;
      }
      return true;
    });
  }

  // ── Unit tooltip helpers ──────────────────────────────────────────────────
  private _hideTooltip(): void {
    if (this._tooltipContainer) {
      this._tooltipContainer.destroy();
      this._tooltipContainer = null;
    }
    this._tooltipShowTimer = 0;
  }

  private _showTooltip(unit: import('@/units/Unit').Unit): void {
    this._hideTooltip();
    const { x: wx, y: wy } = unit.getPosition();
    // Convert world to screen
    const cam = this.cameras.main;
    const sx = (wx - cam.scrollX) * cam.zoom;
    const sy = (wy - cam.scrollY) * cam.zoom - 38;

    const name = (unit.unitTypeId || 'Unit').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const hpText = `HP: ${Math.ceil(unit.health)}/${unit.maxHealth}`;
    const stanceText = `Stance: ${(unit as any).stance ?? 'aggressive'}`;
    const lines = [name, hpText, stanceText];

    const padX = 8; const padY = 5; const lineH = 14;
    const bgW = 110; const bgH = lines.length * lineH + padY * 2;

    const bg = this.add.rectangle(0, 0, bgW, bgH, 0x111122, 0.82).setOrigin(0.5, 1);
    const texts = lines.map((line, i) =>
      this.add.text(0, -bgH + padY + lineH * i + lineH / 2, line, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5, 0.5)
    );

    this._tooltipContainer = this.add.container(sx, sy, [bg, ...texts])
      .setDepth(500).setScrollFactor(0);
    this._tooltipShowTimer = this.TOOLTIP_AUTO_HIDE_MS;
  }

  private updateUnitTooltip(delta: number): void {
    if (this._tooltipHoverUnit) {
      this._tooltipHoverTimer += delta;
      if (this._tooltipHoverTimer >= this.TOOLTIP_SHOW_DELAY_MS && !this._tooltipContainer) {
        this._showTooltip(this._tooltipHoverUnit);
      }
    }
    if (this._tooltipContainer) {
      this._tooltipShowTimer -= delta;
      if (this._tooltipShowTimer <= 0) {
        this._hideTooltip();
        this._tooltipHoverUnit = null;
        this._tooltipHoverTimer = 0;
        return;
      }
      // Update position to follow unit
      if (this._tooltipHoverUnit?.isAlive()) {
        const { x: wx, y: wy } = this._tooltipHoverUnit.getPosition();
        const cam = this.cameras.main;
        const sx = (wx - cam.scrollX) * cam.zoom;
        const sy = (wy - cam.scrollY) * cam.zoom - 38;
        this._tooltipContainer.setPosition(sx, sy);
      }
    }
  }

  // ── Deploy Drone update ────────────────────────────────────────────────────

  private updateDrones(delta: number): void {
    // Tick cooldowns
    this._droneCooldowns.forEach((ms, id) => {
      if (ms > 0) this._droneCooldowns.set(id, Math.max(0, ms - delta));
    });

    // Tick drone lifetimes
    const expired: string[] = [];
    this._droneTimers.forEach((entry, droneId) => {
      entry.remainingMs -= delta;
      if (entry.remainingMs <= 0) expired.push(droneId);
    });

    for (const droneId of expired) {
      this._droneTimers.delete(droneId);
      const droneUnit = this.unitManager.getUnitById(droneId);
      if (droneUnit && droneUnit.isAlive()) {
        const { x, y } = droneUnit.getPosition();
        // Puff visual
        const puff = this.add.arc(x, y, 16, 0, 360, false, 0x88ddff, 0.7).setDepth(25);
        this.tweens.add({
          targets: puff, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 400,
          onComplete: () => puff.destroy(),
        });
        this.spawnFloatingText(x, y - 20, '💨 Drone expired', '#88ddff');
        droneUnit.takeDamage(9999); // force-kill
      }
    }
  }

  // ── War Cry update ─────────────────────────────────────────────────────────

  private _computeSupplyAlmostFull(): boolean {
    const supplyCap = this.buildingManager.getTotalSupply() + this.bonusSupply;
    if (supplyCap <= 0) return false;
    const pct = this.supplyUsed / supplyCap;
    // Dismiss conditions: supply dropped below 80%, or supply building just built
    const recentSupplyBuilt = this.gameElapsedMs - this._lastSupplyBuildingBuiltMs < 30000;
    if (pct < 0.8 || recentSupplyBuilt) {
      this._supplyAlmostFullVisible = false;
      return false;
    }
    // Trigger: supply at 90%+ with no recent supply building
    if (pct >= 0.9) this._supplyAlmostFullVisible = true;
    // Latch: stay visible between 80-89% once triggered
    return this._supplyAlmostFullVisible;
  }

  private updateWarCry(delta: number): void {
    // Tick War Cry cooldowns per unit
    this._warCryCooldowns.forEach((ms, id) => {
      if (ms > 0) this._warCryCooldowns.set(id, Math.max(0, ms - delta));
    });

    // Tick active buffs — remove when expired
    const toRemove: string[] = [];
    this._warCryBuffs.forEach((ms, id) => {
      const remaining = ms - delta;
      if (remaining <= 0) {
        toRemove.push(id);
      } else {
        this._warCryBuffs.set(id, remaining);
      }
    });
    for (const id of toRemove) {
      this._warCryBuffs.delete(id);
      const unit = this.unitManager.getUnitById(id);
      if (unit && unit.isAlive()) {
        unit.attackSpeedMultiplier = Math.max(1.0, (unit.attackSpeedMultiplier ?? 1.0) / 1.25);
      }
    }
  }

  // ── Aegis Shield update ────────────────────────────────────────────────────

  private updateAegisShields(delta: number): void {
    // Tick shield cooldowns
    this._aegisShieldCooldowns.forEach((ms, id) => {
      if (ms > 0) this._aegisShieldCooldowns.set(id, Math.max(0, ms - delta));
    });
    // Tick active shields
    const toRemove: string[] = [];
    this._aegisShields.forEach((shield, targetId) => {
      shield.remainingMs -= delta;
      shield.phaseMs     += delta;
      if (shield.remainingMs <= 0) {
        toRemove.push(targetId);
        return;
      }
      // Get current position (units move; buildings are static)
      let px = shield.staticX;
      let py = shield.staticY;
      if (shield.isUnit) {
        const unit = this.unitManager.getUnitById(targetId);
        if (!unit || !unit.isAlive()) { toRemove.push(targetId); return; }
        const pos = unit.getPosition();
        px = pos.x; py = pos.y;
      }
      // Pulsing alpha: 0.4 → 1.0 at ~400ms period
      const alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(shield.phaseMs * 0.016));
      shield.gfx.clear();
      shield.gfx.lineStyle(2.5, 0xffd700, alpha);
      const r = 24;
      shield.gfx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const hx = px + r * Math.cos(angle);
        const hy = py + r * Math.sin(angle);
        if (i === 0) shield.gfx.moveTo(hx, hy); else shield.gfx.lineTo(hx, hy);
      }
      shield.gfx.closePath();
      shield.gfx.strokePath();
    });
    for (const id of toRemove) {
      const shield = this._aegisShields.get(id);
      if (shield) shield.gfx.destroy();
      this._aegisShields.delete(id);
      // Clear the shield flag from the target
      const unit = this.unitManager.getUnitById(id);
      if (unit) { unit.isAegisShielded = false; continue; }
      const bld = this.buildingManager.getBuildings().find(b => b.id === id);
      if (bld) bld.isAegisShielded = false;
    }
  }

  // ── Architects Structural Analysis passive repair ──────────────────────────

  private updateStructuralAnalysis(delta: number): void {
    const REPAIR_RANGE = 150;
    const REPAIR_RATE = 3; // HP per second
    const MAX_HP_PCT  = 0.8; // only repair buildings below 80% HP

    if (!this._structuralAnalysisGfx) {
      this._structuralAnalysisGfx = this.add.graphics().setDepth(16);
    }
    const gfx = this._structuralAnalysisGfx;
    gfx.clear();

    this._structAnalysisAccum += delta;
    const repairAmount = (REPAIR_RATE * this._structAnalysisAccum) / 1000;

    const playerUnits = this.unitManager.getLivingUnits().filter(u => u.faction === 'player' && !u.isWorker);
    const damagedBuildings = this.buildingManager.getBuildings().filter(b =>
      b.faction === 'player' && !b.isDestroyed() && b.health < b.def.maxHealth * MAX_HP_PCT
    );

    let anyRepair = false;
    playerUnits.forEach(unit => {
      const { x: ux, y: uy } = unit.getPosition();
      // Find nearest damaged building in range
      let nearest: typeof damagedBuildings[0] | null = null;
      let nearestDist = REPAIR_RANGE + 1;
      damagedBuildings.forEach(b => {
        const { x: bx, y: by } = b.getWorldCenter();
        const dist = Math.hypot(bx - ux, by - uy);
        if (dist <= REPAIR_RANGE && dist < nearestDist) { nearestDist = dist; nearest = b; }
      });
      if (!nearest) return;
      const b = nearest as typeof damagedBuildings[0];
      const { x: bx, y: by } = b.getWorldCenter();
      // Apply repair
      if (this._structAnalysisAccum >= 1000 / REPAIR_RATE) {
        b.heal(repairAmount);
        anyRepair = true;
      }
      // Draw blue dotted line
      gfx.lineStyle(1.5, 0x4488ff, 0.55);
      const dx = bx - ux;
      const dy = by - uy;
      const len = Math.sqrt(dx * dx + dy * dy);
      const dashLen = 6;
      const gapLen  = 5;
      const totalUnit = dashLen + gapLen;
      const segments = Math.floor(len / totalUnit);
      for (let s = 0; s < segments; s++) {
        const t0 = (s * totalUnit) / len;
        const t1 = (s * totalUnit + dashLen) / len;
        gfx.lineBetween(ux + dx * t0, uy + dy * t0, ux + dx * t1, uy + dy * t1);
      }
    });

    if (anyRepair) this._structAnalysisAccum = 0;
  }

  // ── Architects Scanner Sweep ───────────────────────────────────────────────

  private updateScannerSweep(delta: number): void {
    // Tick down active sweep sources
    this._scannerSweepSources = this._scannerSweepSources.filter(s => {
      s.remainingMs -= delta;
      return s.remainingMs > 0;
    });

    // Accumulate toward next sweep (every 45s)
    this._scannerSweepTimer += delta;
    if (this._scannerSweepTimer >= 45000) {
      this._scannerSweepTimer = 0;
      this.triggerScannerSweep();
    }
  }

  private triggerScannerSweep(): void {
    // Pick a random world position (avoid map edges)
    const wx = (4 + Math.random() * 42) * TILE_SIZE;
    const wy = (4 + Math.random() * 32) * TILE_SIZE;
    const SWEEP_RADIUS = 200;

    // Add as a temporary vision source for 5 seconds
    this._scannerSweepSources.push({ x: wx, y: wy, r: SWEEP_RADIUS, remainingMs: 5000 });

    // Sonar ping visual: expanding circle
    const ping = this.add.arc(wx, wy, 4, 0, 360, false, 0x00ffff, 0)
      .setDepth(20).setStrokeStyle(2, 0x00ffff, 0.9);
    this.tweens.add({
      targets: ping,
      scaleX: SWEEP_RADIUS / 4,
      scaleY: SWEEP_RADIUS / 4,
      alpha: 0,
      duration: 1200,
      ease: 'Power2',
      onComplete: () => ping.destroy(),
    });

    // Second slower ring for layered effect
    const ping2 = this.add.arc(wx, wy, 4, 0, 360, false, 0x00ccff, 0)
      .setDepth(20).setStrokeStyle(1.5, 0x00ccff, 0.5);
    this.tweens.add({
      targets: ping2,
      scaleX: SWEEP_RADIUS / 3,
      scaleY: SWEEP_RADIUS / 3,
      alpha: 0,
      duration: 2000,
      delay: 300,
      ease: 'Power2',
      onComplete: () => ping2.destroy(),
    });

    // HUD notification
    this.showAlertBanner('📡 Scanner sweep active', '#00ccff');
  }

  // ── Global Upgrade Panel ───────────────────────────────────────────────────

  private toggleUpgradePanel(): void {
    if (this._upgradePanelVisible) {
      this._upgradePanel?.setVisible(false);
      this._upgradePanelVisible = false;
    } else {
      if (!this._upgradePanel) this.buildUpgradePanel();
      this.refreshUpgradePanel();
      this._upgradePanel!.setVisible(true);
      this._upgradePanelVisible = true;
    }
  }

  private buildUpgradePanel(): void {
    const W = this.scale.width;
    const PW = 300; const PH = 260;
    const PX = W / 2 - PW / 2; const PY = 42;
    const DEPTH = 9900;

    const container = this.add.container(PX, PY).setDepth(DEPTH).setScrollFactor(0);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x06101e, 0.95);
    bg.fillRoundedRect(0, 0, PW, PH, 10);
    bg.lineStyle(1, 0x335577, 1);
    bg.strokeRoundedRect(0, 0, PW, PH, 10);
    container.add(bg);

    // Title
    const title = this.add.text(PW / 2, 12, '⬡ Global Upgrades  [U]', {
      fontSize: '12px', color: '#88ccff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0);
    container.add(title);

    // Close button
    const closeBtn = this.add.text(PW - 10, 6, '✕', {
      fontSize: '14px', color: '#ff6666', stroke: '#000', strokeThickness: 2,
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => this.toggleUpgradePanel());
    container.add(closeBtn);

    // Separator
    const sep = this.add.graphics();
    sep.lineStyle(1, 0x223344, 1);
    sep.lineBetween(10, 28, PW - 10, 28);
    container.add(sep);

    container.setData('panelBg', bg);
    this._upgradePanel = container;

    // ESC closes panel (piggyback on existing ESC handler)
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this._upgradePanelVisible) this.toggleUpgradePanel();
    });
  }

  private refreshUpgradePanel(): void {
    const container = this._upgradePanel!;
    // Remove all dynamic children (indices >= 4); bg(0)/title(1)/close(2)/sep(3) stay
    const toDestroy = (container.list as Phaser.GameObjects.GameObject[]).slice(4);
    toDestroy.forEach(obj => {
      container.remove(obj, false);
      obj.destroy();
    });

    const PW = 300;
    const TIERS = [
      { label: 'Attack', ids: ['panel_attack_1','panel_attack_2','panel_attack_3'], costs: [150,250,400] },
      { label: 'Armor',  ids: ['panel_armor_1', 'panel_armor_2', 'panel_armor_3'],  costs: [150,250,400] },
      { label: 'Speed',  ids: ['panel_speed_1', 'panel_speed_2'],                   costs: [150,250] },
      { label: 'Bldg HP',ids: ['panel_bldghp_1','panel_bldghp_2'],                  costs: [150,250] },
    ];

    TIERS.forEach((track, row) => {
      const rowY = 38 + row * 54;
      const trackLabel = this.add.text(12, rowY, track.label + ':', {
        fontSize: '11px', color: '#aaccee', stroke: '#000', strokeThickness: 2,
      });
      container.add(trackLabel);

      track.ids.forEach((id, tier) => {
        const purchased = this._panelUpgrades.has(id);
        const prevPurchased = tier === 0 || this._panelUpgrades.has(track.ids[tier - 1]);
        const cost = track.costs[tier];
        const canAfford = this.resources.getGold() >= cost;
        const available = !purchased && prevPurchased;
        const btnX = 12 + tier * 90; const btnY = rowY + 16;
        const btnW = 82; const btnH = 28;

        const btnBg = this.add.graphics();
        let bgColor = 0x223344;
        if (purchased) bgColor = 0x224422;
        else if (available && canAfford) bgColor = 0x334455;
        else if (available) bgColor = 0x2a2a1a;
        btnBg.fillStyle(bgColor, 0.9);
        btnBg.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
        btnBg.lineStyle(1, purchased ? 0x44aa44 : (available ? 0x445566 : 0x222233), 1);
        btnBg.strokeRoundedRect(btnX, btnY, btnW, btnH, 5);
        container.add(btnBg);

        const tierLabel = purchased ? `✓ Tier ${tier + 1}` : `Tier ${tier + 1}`;
        const costLabel = purchased ? '' : ` ${cost}g`;
        const btnText = this.add.text(btnX + btnW / 2, btnY + 7, tierLabel, {
          fontSize: '10px', color: purchased ? '#44ff88' : (available ? '#ffffff' : '#667788'),
          stroke: '#000', strokeThickness: 1,
        }).setOrigin(0.5, 0);
        container.add(btnText);

        if (!purchased && costLabel) {
          const costText = this.add.text(btnX + btnW / 2, btnY + 17, costLabel, {
            fontSize: '9px', color: canAfford ? '#ffd700' : '#aa6633',
            stroke: '#000', strokeThickness: 1,
          }).setOrigin(0.5, 0);
          container.add(costText);
        }

        if (available) {
          // Hit area using zone
          const zone = this.add.zone(btnX, btnY, btnW, btnH).setOrigin(0).setInteractive({ useHandCursor: canAfford });
          if (canAfford) {
            zone.on('pointerdown', () => {
              this.buyPanelUpgrade(id, cost, track.label, tier + 1);
            });
          }
          container.add(zone);
        }
      });
    });
  }

  private buyPanelUpgrade(id: string, cost: number, trackLabel: string, tier: number): void {
    if (!this.resources.spend(cost, 0)) return;
    this._panelUpgrades.add(id);

    if (id.includes('attack')) {
      this.unitManager.attackBonus += 3;
      this.unitManager.applyUpgradeToAll(3, 0);
      if (this.isMultiplayer) NetworkManager.instance.sendCommand({ type: 'upgrade', upgradeType: 'attack', delta: 3 });
      const { x, y } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.spawnFloatingText(x, y - 40, `⚔ Attack +3 (Tier ${tier})`, '#ffaa44');
    } else if (id.includes('armor')) {
      this.unitManager.armorBonus += 3;
      this.unitManager.applyUpgradeToAll(0, 3);
      if (this.isMultiplayer) NetworkManager.instance.sendCommand({ type: 'upgrade', upgradeType: 'armor', delta: 3 });
      const { x, y } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.spawnFloatingText(x, y - 40, `🛡 Armor +3 (Tier ${tier})`, '#44aaff');
    } else if (id.includes('speed')) {
      this._speedUpgradeTier++;
      // Apply +20% base speed to all living player units
      const speedAdd = 30; // UNIT_SPEED * 0.2 = 30
      this.unitManager.getLivingUnits().forEach(u => {
        if (u.faction !== 'player' || u.isWorker) return;
        (u as any).speed = ((u as any).speed ?? 150) + speedAdd;
        (u as any)._baseSpeed = ((u as any)._baseSpeed ?? 150) + speedAdd;
      });
      this.unitManager.speedBonus += speedAdd;
      if (this.isMultiplayer) NetworkManager.instance.sendCommand({ type: 'upgrade', upgradeType: 'speed', delta: speedAdd });
      const { x, y } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.spawnFloatingText(x, y - 40, `🏃 Speed +20% (Tier ${tier})`, '#44ffcc');
    } else if (id.includes('bldghp')) {
      this._buildingHpUpgradeTier++;
      // Apply +2 armor to all living player buildings
      this.buildingManager.getBuildings()
        .filter(b => b.faction === 'player' && !b.isDestroyed())
        .forEach(b => { b.armorBonus = (b.armorBonus ?? 0) + 2; });
      if (this.isMultiplayer) NetworkManager.instance.sendCommand({ type: 'upgrade', upgradeType: 'bldghp', delta: 2 });
      const { x, y } = this.playerHQ?.getWorldCenter() ?? { x: 400, y: 300 };
      this.spawnFloatingText(x, y - 40, `🏛 Building Armor +2 (Tier ${tier})`, '#ffccaa');
    }

    // Rebuild panel to reflect new state
    this.refreshUpgradePanel();
  }
}
