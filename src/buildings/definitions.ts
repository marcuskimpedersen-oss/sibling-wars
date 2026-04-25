import { Race, CombatStats } from '@/constants';

export interface ProducedUnitDef {
  id: string;
  name: string;
  goldCost: number;
  /** Optional juice component of the training cost. */
  juiceCost?: number;
  productionMs: number;
  supplyUsed: number;
  textureKey: string;
  speed: number;
  description: string;
  /** If true, completing this "unit" applies a unit upgrade instead of spawning */
  isUpgrade?: boolean;
  /**
   * ID of another ProducedUnitDef that must be completed (in purchasedUpgrades)
   * before this item can be queued. Used for Tier II / III gating.
   */
  prerequisite?: string;
  /**
   * Building ID that must exist in the player's built buildings before this
   * unit can be trained. E.g. siege_crawler requires a garrison_post.
   * ProductionPanel checks against the live set of player building IDs.
   */
  requiresBuilding?: string;
  /** Display name for the requiresBuilding — shown in the lock tooltip. */
  requiresBuildingName?: string;
  /**
   * When true, this is a Hero unit — only one can be active at a time per race.
   * If the hero dies, a 120s respawn timer must expire before a new one can be trained.
   */
  isHero?: boolean;
  /** When true, this unit can detect and reveal cloaked/stealthed enemy units nearby. */
  isDetector?: boolean;
  /**
   * Optional custom combat stats for this unit type.
   * When present, overrides the default race combat stats in GameScene.onUnitProduced.
   */
  combatStats?: CombatStats;
}

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  textureKey: string;
  tileWidth: number;
  tileHeight: number;
  goldCost: number;
  maxHealth: number;
  supplyProvided: number;
  isHQ: boolean;
  tint: number;
  produces?: ProducedUnitDef[];
  /** Race-specific passive ability label */
  passiveLabel?: string;
  /** If set, this building auto-collects this resource type when linked to a node */
  resourceType?: 'gold' | 'juice';
  /** True for shrine buildings — shows ability panel instead of production */
  isShrine?: boolean;
  /** Cooldown for shrine ability in ms */
  abilityCooldownMs?: number;
  /**
   * Architects only: this building emits a power field that activates
   * nearby buildings with requiresPower. Radius in world-pixels.
   */
  isPylon?: boolean;
  pylonRangePx?: number;
  /**
   * Architects only: this building only produces units / advances upgrades
   * when it is within range of a powered Pylon (or the HQ).
   */
  requiresPower?: boolean;
  /**
   * Bulwark wall segment — impassable barrier. Exempt from 3-tile clearance rule
   * so walls can be placed tight against buildings to seal a choke point.
   */
  isWall?: boolean;
  /** Built-in armor value applied to this building on construction. */
  baseArmor?: number;
  /**
   * Architects Sentinel Turret: auto-attacks the nearest enemy within range.
   * Handled by GameScene.updateSentinelTurrets().
   */
  isTurret?: boolean;
  turretRangePx?: number;
  turretCooldownMs?: number;
  turretDamage?: number;
  /**
   * Bulwark Garrison Post: acts as a forward rally point.
   * Bulwark combat units produced from any Garrison automatically march here.
   */
  isGarrisonPost?: boolean;
  /**
   * Unseen Void Gate: creates one half of a wormhole pair.
   * When two Void Gates are placed, units walking within 32px of one
   * are instantly teleported to emerge from the other.
   * Max 2 active Void Gates at a time.
   */
  isVoidGate?: boolean;
}

// ── Generic buildings (race-neutral) ─────────────────────────────────────────

export const MINE_DEF: BuildingDef = {
  id: 'mine',
  name: 'Mine',
  description: 'Auto-collects gold from a nearby gold node. Must be placed within 3 tiles.',
  textureKey: 'building_mine',
  tileWidth: 2, tileHeight: 2,
  goldCost: 100,
  maxHealth: 450,
  supplyProvided: 0,
  isHQ: false,
  tint: 0xffffff,
  resourceType: 'gold',
};

export const JUICE_COLLECTOR_DEF: BuildingDef = {
  id: 'juice_collector',
  name: 'Juice Collector',
  description: 'Auto-collects juice from a nearby geyser. Must be placed within 3 tiles.',
  textureKey: 'building_juice',
  tileWidth: 2, tileHeight: 2,
  goldCost: 80,
  maxHealth: 405,
  supplyProvided: 0,
  isHQ: false,
  tint: 0xffffff,
  resourceType: 'juice',
};

const RACE_TINTS: Record<Race, number> = {
  architects: 0x4488ff,
  covenant:   0x44ff88,
  bulwark:    0xdd7744,
  unseen:     0xbb44ee,
};

export interface ShrineDef {
  id: string;
  name: string;           // named after a sibling's partner/family member
  abilityName: string;
  description: string;
  goldCost: number;
  cooldownMs: number;
}

export const RACE_SHRINES: Record<Race, ShrineDef> = {
  architects: {
    id: 'shrine_hope',
    name: "Hope's Forge",
    abilityName: 'Hope',
    description: 'Reduces all building costs by 40% for 30 seconds.',
    goldCost: 200,
    cooldownMs: 90_000,
  },
  covenant: {
    id: 'shrine_ellie',
    name: "Ellie's Oracle",
    abilityName: 'Ellie',
    description: 'Hacks an enemy building — disabling it and revealing the map around it for 20s.',
    goldCost: 200,
    cooldownMs: 120_000,
  },
  bulwark: {
    id: 'shrine_anna',
    name: "Anna's Census",
    abilityName: 'Anna',
    description: 'Increases population cap by +20 permanently.',
    goldCost: 200,
    cooldownMs: 180_000,
  },
  unseen: {
    id: 'shrine_olivia',
    name: "Olivia's Ordinance",
    abilityName: 'Olivia',
    description: 'Calls in an entirely unnecessary bunker-buster bomb on a target tile. Overkill guaranteed.',
    goldCost: 200,
    cooldownMs: 150_000,
  },
};

// ── Race-specific academies (research unit upgrades) ────────────────────────────

const UPGRADE_PRODUCES: ProducedUnitDef[] = [
  { id: 'upgrade_attack_1', name: 'Weapons I',   goldCost: 100, productionMs: 15000, supplyUsed: 0, textureKey: 'unit', speed: 0, description: '+3 attack damage.', isUpgrade: true },
  { id: 'upgrade_attack_2', name: 'Weapons II',  goldCost: 175, productionMs: 22000, supplyUsed: 0, textureKey: 'unit', speed: 0, description: '+3 attack damage.', isUpgrade: true, prerequisite: 'upgrade_attack_1' },
  { id: 'upgrade_attack_3', name: 'Weapons III', goldCost: 250, productionMs: 30000, supplyUsed: 0, textureKey: 'unit', speed: 0, description: '+3 attack damage.', isUpgrade: true, prerequisite: 'upgrade_attack_2' },
  { id: 'upgrade_armor_1',  name: 'Armor I',     goldCost: 100, productionMs: 15000, supplyUsed: 0, textureKey: 'unit', speed: 0, description: '+3 armor (damage reduction).', isUpgrade: true },
  { id: 'upgrade_armor_2',  name: 'Armor II',    goldCost: 175, productionMs: 22000, supplyUsed: 0, textureKey: 'unit', speed: 0, description: '+3 armor (damage reduction).', isUpgrade: true, prerequisite: 'upgrade_armor_1' },
  { id: 'upgrade_armor_3',  name: 'Armor III',   goldCost: 250, productionMs: 30000, supplyUsed: 0, textureKey: 'unit', speed: 0, description: '+3 armor (damage reduction).', isUpgrade: true, prerequisite: 'upgrade_armor_2' },
];

export const RACE_ACADEMIES: Record<Race, BuildingDef> = {
  architects: {
    id: 'research_array', name: 'Research Array',
    description: 'Research weapon and armor upgrades. Requires Pylon power to operate.',
    textureKey: 'building_barracks', tileWidth: 2, tileHeight: 2,
    goldCost: 125, maxHealth: 338, supplyProvided: 0, isHQ: false,
    tint: RACE_TINTS.architects, produces: UPGRADE_PRODUCES,
    requiresPower: true,
  },
  covenant: {
    id: 'sacred_archive', name: 'Sacred Archive',
    description: 'Research weapon and armor upgrades.',
    textureKey: 'building_barracks', tileWidth: 2, tileHeight: 2,
    goldCost: 125, maxHealth: 338, supplyProvided: 0, isHQ: false,
    tint: RACE_TINTS.covenant, produces: UPGRADE_PRODUCES,
  },
  bulwark: {
    id: 'iron_forge', name: 'Iron Forge',
    description: 'Research weapon and armor upgrades.',
    textureKey: 'building_barracks', tileWidth: 2, tileHeight: 2,
    goldCost: 125, maxHealth: 338, supplyProvided: 0, isHQ: false,
    tint: RACE_TINTS.bulwark, produces: UPGRADE_PRODUCES,
  },
  unseen: {
    id: 'shadow_academy', name: 'Shadow Academy',
    description: 'Research weapon and armor upgrades.',
    textureKey: 'building_barracks', tileWidth: 2, tileHeight: 2,
    goldCost: 125, maxHealth: 338, supplyProvided: 0, isHQ: false,
    tint: RACE_TINTS.unseen, produces: UPGRADE_PRODUCES,
  },
};

// ── Race-specific housing (each gives +10 supply) ────────────────────────────

export const RACE_HOUSES: Record<Race, BuildingDef> = {
  architects: {
    id: 'habitat_module',
    name: 'Habitat Module',
    description: 'Pressurised living quarters for Architect crews. +10 population.',
    textureKey: 'building_house',
    tileWidth: 2, tileHeight: 2,
    goldCost: 75, maxHealth: 338, supplyProvided: 10,
    isHQ: false, tint: RACE_TINTS.architects,
  },
  covenant: {
    id: 'commune_hall',
    name: 'Commune Hall',
    description: 'A shared dwelling where the Covenant live and pray together. +10 population.',
    textureKey: 'building_house',
    tileWidth: 2, tileHeight: 2,
    goldCost: 75, maxHealth: 338, supplyProvided: 10,
    isHQ: false, tint: RACE_TINTS.covenant,
  },
  bulwark: {
    id: 'fortified_quarters',
    name: 'Fortified Quarters',
    description: 'Thick-walled barracks housing for Bulwark soldiers. +10 population.',
    textureKey: 'building_house',
    tileWidth: 2, tileHeight: 2,
    goldCost: 75, maxHealth: 562, supplyProvided: 10,
    isHQ: false, tint: RACE_TINTS.bulwark,
  },
  unseen: {
    id: 'safe_house',
    name: 'Safe House',
    description: 'An unmarked safehouse. No one knows who lives here. +10 population.',
    textureKey: 'building_house',
    tileWidth: 2, tileHeight: 2,
    goldCost: 75, maxHealth: 270, supplyProvided: 10,
    isHQ: false, tint: RACE_TINTS.unseen,
  },
};

/**
 * Unseen Shade Spire — spreads a dark influence zone outward over 30 seconds.
 * Unseen units inside: +20% move speed, +2 armor.
 * Enemy units inside: −15% move speed.
 */
export const UNSEEN_SHADE_SPIRE_DEF: BuildingDef = {
  id: 'shade_spire',
  name: 'Shade Spire',
  description: 'Spreads dark influence over 30s. Unseen units inside: +20% speed, +2 armor. Enemies inside: −15% speed.',
  textureKey: 'building_house',
  tileWidth: 2, tileHeight: 2,
  goldCost: 125, maxHealth: 270, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.unseen,
  passiveLabel: 'Dark Zone',
};

/**
 * Unseen Void Citadel — late-game production facility.
 * Produces the Void Reaver, a powerful unit that drains enemy HP into juice.
 */
export const UNSEEN_VOID_CITADEL_DEF: BuildingDef = {
  id: 'void_citadel',
  name: 'Void Citadel',
  description: 'Constructs Void Reavers — void-powered hunters that drain enemy HP into juice for the Unseen.',
  textureKey: 'building_barracks',
  tileWidth: 2, tileHeight: 2,
  goldCost: 175, maxHealth: 330, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.unseen,
  produces: [
    {
      id: 'void_reaver',
      name: 'Void Reaver',
      goldCost: 250,
      productionMs: 35000,
      supplyUsed: 2,
      textureKey: 'unit',
      speed: 130,
      description: 'Powerful void hunter. Each hit drains enemy HP and converts it into juice. 130 HP.',
      combatStats: { maxHealth: 130, attackDamage: 22, attackRangePx: 130, attackCooldownMs: 1600 },
      requiresBuilding: 'shade_spire',
      requiresBuildingName: 'Shade Spire',
    },
  ],
};

/**
 * Unseen Void Gate — one half of a wormhole pair.
 * Place two Void Gates anywhere on the map; units walking within 32 px of the
 * entry portal are instantly teleported to emerge from the exit portal.
 * Max 2 active Void Gates at a time. Builder is sacrificed on completion.
 */
export const UNSEEN_VOID_GATE_DEF: BuildingDef = {
  id: 'void_gate',
  name: 'Void Gate',
  description: 'Creates a wormhole. Place two Void Gates — units entering one instantly emerge from the other. Max 2 active. Builder sacrificed.',
  textureKey: 'building_house',
  tileWidth: 1, tileHeight: 1,
  goldCost: 200, maxHealth: 270, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.unseen,
  isVoidGate: true,
  passiveLabel: 'Wormhole',
};

/**
 * Covenant Wellspring — passively generates +5 juice per second,
 * enabling more frequent use of unit abilities.
 */
export const COVENANT_WELLSPRING_DEF: BuildingDef = {
  id: 'wellspring',
  name: 'Wellspring',
  description: 'Sacred font of spiritual energy. Generates +5 juice per second passively.',
  textureKey: 'building_house',
  tileWidth: 2, tileHeight: 2,
  goldCost: 150, maxHealth: 420, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.covenant,
  passiveLabel: 'Juice Fount',
};

/**
 * Bulwark Fortification Wall — impassable barrier that enemies must destroy to pass.
 * Low HP but high built-in armor. Placed like any building; tiles become unwalkable.
 * Exempt from the 3-tile Bulwark clearance rule so walls seal gaps between buildings.
 */
export const BULWARK_WALL_DEF: BuildingDef = {
  id: 'bulwark_wall',
  name: 'Wall Segment',
  description: 'Impassable fortification. Enemies must destroy it to pass. Low HP, high armor.',
  textureKey: 'building_house',
  tileWidth: 2, tileHeight: 1,
  goldCost: 40,
  maxHealth: 180,
  supplyProvided: 0,
  isHQ: false,
  tint: 0xcc6633,
  isWall: true,
  baseArmor: 6,
};

/**
 * Covenant Shrine of Unity — produces the Arbiter support unit.
 * The Arbiter's signature ability is a short-range AoE Stasis that freezes
 * all units (friend and foe) for 4 seconds.
 */
export const COVENANT_SHRINE_OF_UNITY_DEF: BuildingDef = {
  id: 'shrine_of_unity',
  name: 'Shrine of Unity',
  description: 'Trains the Arbiter — a powerful support unit with AoE Stasis. Freezes all units in range for 4 seconds. [E key]',
  textureKey: 'building_barracks',
  tileWidth: 2, tileHeight: 2,
  goldCost: 250, maxHealth: 480, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.covenant,
  passiveLabel: 'Arbiter Bay',
  produces: [
    {
      id: 'arbiter',
      name: 'Arbiter',
      goldCost: 150,
      productionMs: 28000,
      supplyUsed: 2,
      textureKey: 'unit',
      speed: 100,
      description: 'Support unit. Casts AoE Stasis (E) — freezes all units in 160px for 4s. 30s cooldown.',
      combatStats: { maxHealth: 100, attackDamage: 5, attackRangePx: 100, attackCooldownMs: 2200 },
    },
  ],
};

/**
 * Architects Fabrication Hall — late-game production facility.
 * Requires Pylon power to operate. Produces the Colossus.
 */
export const ARCHITECTS_FABRICATION_HALL_DEF: BuildingDef = {
  id: 'fabrication_hall',
  name: 'Fabrication Hall',
  description: 'Constructs the Colossus — a devastating thermal-beam walker. Requires Pylon power.',
  textureKey: 'building_barracks',
  tileWidth: 2, tileHeight: 2,
  goldCost: 200, maxHealth: 525, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.architects,
  requiresPower: true,
  produces: [
    {
      id: 'colossus',
      name: 'Colossus',
      goldCost: 300,
      productionMs: 40000,
      supplyUsed: 3,
      textureKey: 'unit',
      speed: 60,
      description: 'Devastating walker. Fires a sweeping thermal beam that hits ALL units in a line. 200 HP.',
      combatStats: { maxHealth: 200, attackDamage: 20, attackRangePx: 180, attackCooldownMs: 2200 },
      requiresBuilding: 'tech_foundry',
      requiresBuildingName: 'Tech Foundry',
    },
  ],
};

/**
 * Bulwark Siege Crawler — heavy assault unit that can enter Siege Mode (T key).
 * Mobile: normal stats. Siege: immobile, +100% range, +50% dmg, AoE splash.
 * Produced from the Garrison.
 */
export const BULWARK_SIEGE_CRAWLER_UNIT: ProducedUnitDef = {
  id: 'siege_crawler',
  name: 'Siege Crawler',
  goldCost: 175,
  productionMs: 30000,
  supplyUsed: 2,
  textureKey: 'unit',
  speed: 90,
  description: 'Heavy siege unit. Press T to toggle Siege Mode — immobile but +100% range, +50% dmg, AoE splash.',
  combatStats: { maxHealth: 160, attackDamage: 18, attackRangePx: 70, attackCooldownMs: 2400 },
  requiresBuilding: 'garrison_post',
  requiresBuildingName: 'Garrison Post',
};

/**
 * Architects Sentinel Turret — static defensive emplacement.
 * Auto-attacks the nearest visible enemy within 200 px for 15 damage every 2 s.
 * Requires Pylon power to operate. Shows a targeting beam on each shot.
 */
export const ARCHITECTS_SENTINEL_TURRET_DEF: BuildingDef = {
  id: 'sentinel_turret',
  name: 'Sentinel Turret',
  description: 'Auto-attacks enemies within 200px for 15 damage. Fires every 2s. Requires Pylon power.',
  textureKey: 'building_house',
  tileWidth: 1, tileHeight: 1,
  goldCost: 120, maxHealth: 300, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.architects,
  requiresPower: true,
  isTurret: true,
  turretRangePx: 200,
  turretCooldownMs: 2000,
  turretDamage: 15,
  passiveLabel: 'Sentinel',
};

/**
 * Bulwark Garrison Post — forward rally point.
 * Combat units produced from any Bulwark Garrison automatically march to the
 * nearest Garrison Post instead of the barracks rally flag. Lets Bulwark push
 * their front-line forward without manually repositioning every unit.
 */
export const BULWARK_GARRISON_POST_DEF: BuildingDef = {
  id: 'garrison_post',
  name: 'Garrison Post',
  description: 'Forward rally point. Bulwark units from any Garrison auto-march here instead of the barracks rally flag.',
  textureKey: 'building_house',
  tileWidth: 2, tileHeight: 2,
  goldCost: 100, maxHealth: 525, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.bulwark,
  isGarrisonPost: true,
  baseArmor: 2,
  passiveLabel: 'Rally Post',
};

/** Architects power pylon — provides a power field for nearby Architects buildings. */
export const ARCHITECTS_PYLON_DEF: BuildingDef = {
  id: 'pylon',
  name: 'Pylon',
  description: 'Powers nearby Architects buildings in a 240px radius. Tech Foundry and Research Array require power to operate.',
  textureKey: 'building_house',
  tileWidth: 1, tileHeight: 1,
  goldCost: 75, maxHealth: 225, supplyProvided: 0,
  isHQ: false, tint: RACE_TINTS.architects,
  isPylon: true,
  pylonRangePx: 240,
  passiveLabel: 'Power Field',
};

const RACE_BUILDINGS: Record<Race, [BuildingDef, BuildingDef]> = {
  architects: [
    {
      id: 'command_nexus',
      name: 'Command Nexus',
      description: 'Architects HQ. Produces workers. Overclocks nearby units. Also acts as a Pylon.',
      textureKey: 'building_hq',
      tileWidth: 3, tileHeight: 3,
      goldCost: 0, maxHealth: 900, supplyProvided: 10,
      isHQ: true, tint: RACE_TINTS.architects,
      passiveLabel: 'Overclock Aura',
      isPylon: true, pylonRangePx: 240,
      produces: [
        { id: 'worker', name: 'Worker', goldCost: 50, productionMs: 12000, supplyUsed: 1, textureKey: 'worker', speed: 120, description: 'Constructs buildings.' },
        { id: 'prime_construct', name: 'Prime Construct ♛', goldCost: 300, productionMs: 40000, supplyUsed: 2, textureKey: 'unit', speed: 130, description: 'HERO. Instantly repairs a friendly building to full HP [C]. 45s CD. 200 HP. Detects cloaked units. One at a time.', isHero: true, isDetector: true, combatStats: { maxHealth: 200, attackDamage: 12, attackRangePx: 120, attackCooldownMs: 1400 } },
      ],
    },
    {
      id: 'tech_foundry',
      name: 'Tech Foundry',
      description: 'Produces Riflemen and Arc Troopers. Requires Pylon power to operate.',
      textureKey: 'building_barracks',
      tileWidth: 2, tileHeight: 2,
      goldCost: 150, maxHealth: 405, supplyProvided: 0,
      isHQ: false, tint: RACE_TINTS.architects,
      requiresPower: true,
      produces: [
        { id: 'rifleman', name: 'Rifleman', goldCost: 50, productionMs: 14000, supplyUsed: 1, textureKey: 'unit', speed: 150, description: 'Versatile ranged infantry.' },
        { id: 'arc_trooper', name: 'Arc Trooper', goldCost: 160, juiceCost: 80, productionMs: 26000, supplyUsed: 2, textureKey: 'unit', speed: 130, description: 'Electrical shock trooper. Long range, deals bonus damage to buildings. 90 HP.', combatStats: { maxHealth: 90, attackDamage: 22, attackRangePx: 175, attackCooldownMs: 1600 } },
      ],
    },
  ],
  covenant: [
    {
      id: 'sacred_spire',
      name: 'Sacred Spire',
      description: 'Covenant HQ. Healing aura restores nearby units.',
      textureKey: 'building_hq',
      tileWidth: 3, tileHeight: 3,
      goldCost: 0, maxHealth: 1125, supplyProvided: 10,
      isHQ: true, tint: RACE_TINTS.covenant,
      passiveLabel: 'Healing Aura',
      produces: [
        { id: 'worker', name: 'Worker', goldCost: 50, productionMs: 12000, supplyUsed: 1, textureKey: 'worker', speed: 120, description: 'Constructs buildings.' },
        { id: 'high_inquisitor', name: 'High Inquisitor ♛', goldCost: 300, productionMs: 40000, supplyUsed: 2, textureKey: 'unit', speed: 120, description: 'HERO. AoE Smite [C]: 80 damage in radius 80. 45s CD. 250 HP. One at a time.', isHero: true, combatStats: { maxHealth: 250, attackDamage: 15, attackRangePx: 90, attackCooldownMs: 1600 } },
      ],
    },
    {
      id: 'sanctuary',
      name: 'Sanctuary',
      description: 'Produces Devotees and Crusaders.',
      textureKey: 'building_barracks',
      tileWidth: 2, tileHeight: 2,
      goldCost: 150, maxHealth: 495, supplyProvided: 0,
      isHQ: false, tint: RACE_TINTS.covenant,
      produces: [
        { id: 'devotee', name: 'Devotee', goldCost: 55, productionMs: 16000, supplyUsed: 1, textureKey: 'unit', speed: 140, description: 'Support infantry. Heals allies.' },
        { id: 'crusader', name: 'Crusader', goldCost: 150, juiceCost: 70, productionMs: 24000, supplyUsed: 2, textureKey: 'unit', speed: 115, description: 'Heavy melee knight. High health, inspires nearby allies. Excellent at breaching enemy lines. 190 HP.', combatStats: { maxHealth: 190, attackDamage: 22, attackRangePx: 52, attackCooldownMs: 1500 } },
      ],
    },
  ],
  bulwark: [
    {
      id: 'iron_bastion',
      name: 'Iron Bastion',
      description: 'Bulwark HQ. Fortified walls. Enormous health pool.',
      textureKey: 'building_hq',
      tileWidth: 3, tileHeight: 3,
      goldCost: 0, maxHealth: 1800, supplyProvided: 10,
      isHQ: true, tint: RACE_TINTS.bulwark,
      passiveLabel: 'Fortify',
      produces: [
        { id: 'worker', name: 'Worker', goldCost: 50, productionMs: 12000, supplyUsed: 1, textureKey: 'worker', speed: 120, description: 'Constructs buildings.' },
        { id: 'iron_warden', name: 'Iron Warden ♛', goldCost: 300, productionMs: 40000, supplyUsed: 2, textureKey: 'unit', speed: 100, description: 'HERO. Invulnerability Shield [C] for 8s. 60s CD. 350 HP. One at a time.', isHero: true, combatStats: { maxHealth: 350, attackDamage: 18, attackRangePx: 55, attackCooldownMs: 1800 } },
      ],
    },
    {
      id: 'garrison',
      name: 'Garrison',
      description: 'Produces Ironclads, Siege Crawlers, and Demolishers. Heavy infantry, high health.',
      textureKey: 'building_barracks',
      tileWidth: 2, tileHeight: 2,
      goldCost: 175, maxHealth: 675, supplyProvided: 0,
      isHQ: false, tint: RACE_TINTS.bulwark,
      produces: [
        { id: 'ironclad', name: 'Ironclad', goldCost: 75, productionMs: 20000, supplyUsed: 1, textureKey: 'unit', speed: 110, description: 'Heavily armoured. Slow but unstoppable.' },
        BULWARK_SIEGE_CRAWLER_UNIT,
        { id: 'demolisher', name: 'Demolisher', goldCost: 200, juiceCost: 100, productionMs: 32000, supplyUsed: 2, textureKey: 'unit', speed: 75, description: 'Slow walking siege engine. Devastating damage to buildings and clustered units. 240 HP.', combatStats: { maxHealth: 240, attackDamage: 40, attackRangePx: 65, attackCooldownMs: 2800 } },
      ],
    },
  ],
  unseen: [
    {
      id: 'shadow_node',
      name: 'Shadow Node',
      description: 'Unseen HQ. Cloaks when no enemies nearby.',
      textureKey: 'building_hq',
      tileWidth: 3, tileHeight: 3,
      goldCost: 0, maxHealth: 562, supplyProvided: 10,
      isHQ: true, tint: RACE_TINTS.unseen,
      passiveLabel: 'Cloak Field',
      produces: [
        { id: 'worker', name: 'Worker', goldCost: 50, productionMs: 12000, supplyUsed: 1, textureKey: 'worker', speed: 120, description: 'Constructs buildings.' },
        { id: 'void_walker', name: 'Void Walker ♛', goldCost: 300, productionMs: 40000, supplyUsed: 2, textureKey: 'unit', speed: 150, description: 'HERO. Permanently cloaked. Reveal [C]: unmasks all cloaked enemies in r120. 45s CD. 120 HP. One at a time.', isHero: true, combatStats: { maxHealth: 120, attackDamage: 20, attackRangePx: 105, attackCooldownMs: 950 } },
      ],
    },
    {
      id: 'infiltration_den',
      name: 'Infiltration Den',
      description: 'Produces Phantoms and Shadow Reapers. Fast, cheap, stealthy.',
      textureKey: 'building_barracks',
      tileWidth: 2, tileHeight: 2,
      goldCost: 125, maxHealth: 270, supplyProvided: 0,
      isHQ: false, tint: RACE_TINTS.unseen,
      produces: [
        { id: 'phantom', name: 'Phantom', goldCost: 40, productionMs: 15000, supplyUsed: 1, textureKey: 'unit', speed: 180, description: 'Lightning fast. Strikes from shadow.' },
        { id: 'shadow_reaper', name: 'Shadow Reaper', goldCost: 120, juiceCost: 60, productionMs: 22000, supplyUsed: 2, textureKey: 'unit', speed: 160, description: 'Cloaked assassin. Permanently stealthed. Devastating burst damage. 75 HP.', combatStats: { maxHealth: 75, attackDamage: 38, attackRangePx: 90, attackCooldownMs: 2000 } },
      ],
    },
  ],
};

/**
 * Returns all buildable defs for a given race.
 * Architects: [HQ, Barracks, House, Shrine, Academy, Pylon]
 * Others:     [HQ, Barracks, House, Shrine, Academy]
 */
export function getBuildingsForRace(race: Race): BuildingDef[] {
  const shrine = RACE_SHRINES[race];
  const shrineBuildingDef: BuildingDef = {
    id: shrine.id,
    name: shrine.name,
    description: `Shrine ability: ${shrine.abilityName} — ${shrine.description}`,
    textureKey: 'building_barracks',
    tileWidth: 2, tileHeight: 2,
    goldCost: shrine.goldCost,
    maxHealth: 338,
    supplyProvided: 0,
    isHQ: false,
    tint: RACE_TINTS[race],
    passiveLabel: shrine.abilityName,
    isShrine: true,
    abilityCooldownMs: shrine.cooldownMs,
  };
  const base: BuildingDef[] = [...RACE_BUILDINGS[race], RACE_HOUSES[race], shrineBuildingDef, RACE_ACADEMIES[race]];
  if (race === 'architects') { base.push(ARCHITECTS_PYLON_DEF); base.push(ARCHITECTS_FABRICATION_HALL_DEF); base.push(ARCHITECTS_SENTINEL_TURRET_DEF); }
  if (race === 'unseen')     { base.push(UNSEEN_SHADE_SPIRE_DEF); base.push(UNSEEN_VOID_CITADEL_DEF); base.push(UNSEEN_VOID_GATE_DEF); }
  if (race === 'covenant')   { base.push(COVENANT_WELLSPRING_DEF); base.push(COVENANT_SHRINE_OF_UNITY_DEF); }
  if (race === 'bulwark')    { base.push(BULWARK_WALL_DEF); base.push(BULWARK_GARRISON_POST_DEF); }
  return base;
}

export function getRaceTint(race: Race): number {
  return RACE_TINTS[race];
}
