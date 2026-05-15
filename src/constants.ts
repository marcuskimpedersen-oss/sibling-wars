export const TILE_SIZE = 32;
export const MAP_WIDTH_TILES = 50;
export const MAP_HEIGHT_TILES = 40;

export const UNIT_SPEED = 150;
export const WORKER_SPEED = 120;
export const CAMERA_PAN_SPEED = 400;
export const CAMERA_ZOOM_MIN = 0.4;
export const CAMERA_ZOOM_MAX = 2.5;
export const CAMERA_ZOOM_STEP = 0.15;

// Economy
export const HARVEST_TIME_MS = 2000;    // time to harvest one load
export const CARRY_CAPACITY = 5;        // minerals per trip
export const BASE_TILE = { x: 5, y: 5 }; // player starting base tile

// ── Resource node layout ─────────────────────────────────────────────────────
// Each side: main base + expansion 1 (safe) + expansion 2 (contested midmap)

export const GOLD_POSITIONS: Array<{ x: number; y: number; amount: number }> = [
  // Player main base
  { x: 8,  y: 4,  amount: 1500 },
  { x: 10, y: 7,  amount: 1500 },
  // Player expansion 1  (~1/3 toward enemy)
  { x: 16, y: 11, amount: 1500 },
  { x: 18, y: 14, amount: 1500 },
  // Contested midmap — expansion 2 for both sides
  { x: 24, y: 18, amount: 1500 },
  { x: 27, y: 21, amount: 1500 },
  // Enemy expansion 1  (~1/3 from enemy toward player)
  { x: 34, y: 26, amount: 1500 },
  { x: 36, y: 29, amount: 1500 },
  // Enemy main base
  { x: 40, y: 32, amount: 1500 },
  { x: 42, y: 35, amount: 1500 },
];

export const JUICE_POSITIONS: Array<{ x: number; y: number; amount: number }> = [
  // Player main base
  { x: 12, y: 8,  amount: 400 },
  // Player expansion 1
  { x: 20, y: 12, amount: 350 },
  // Contested midmap
  { x: 25, y: 22, amount: 300 },
  // Enemy expansion 1
  { x: 32, y: 24, amount: 350 },
  // Enemy main base
  { x: 38, y: 31, amount: 400 },
];

// Resource collection
export const MINE_COLLECTION_MS = 8000;
export const MINE_COLLECTION_AMOUNT = 10;
export const JUICE_COLLECTION_MS = 10000;
export const JUICE_COLLECTION_AMOUNT = 6;
export const RESOURCE_SNAP_RADIUS_TILES = 3;
export const EDGE_SCROLL_MARGIN = 20;

// Enemy
export const ENEMY_BASE_TILE = { x: 43, y: 34 };

// Combat
export const ENEMY_SPAWN_INTERVAL_MS = 22000;
export const ENEMY_WAVE_SIZE = 2;

export type Faction = 'player' | 'enemy';

export interface CombatStats {
  maxHealth: number;
  attackDamage: number;
  attackRangePx: number;
  attackCooldownMs: number;
}

// Race-specific combat stats for produced units
export const RACE_COMBAT_STATS: Record<Race, CombatStats> = {
  architects: { maxHealth: 80,  attackDamage: 10, attackRangePx: 120, attackCooldownMs: 1400 },
  covenant:   { maxHealth: 110, attackDamage: 8,  attackRangePx: 90,  attackCooldownMs: 1800 },
  bulwark:    { maxHealth: 160, attackDamage: 14, attackRangePx: 50,  attackCooldownMs: 2000 },
  unseen:     { maxHealth: 60,  attackDamage: 16, attackRangePx: 105, attackCooldownMs: 950  },
} as Record<Race, CombatStats>;

export const ENEMY_COMBAT_STATS: CombatStats = {
  maxHealth: 55, attackDamage: 7, attackRangePx: 90, attackCooldownMs: 2100,
};

export const WORKER_COMBAT_STATS: CombatStats = {
  maxHealth: 40, attackDamage: 0, attackRangePx: 0, attackCooldownMs: 9999,
};

// Tiled layer names — must match exactly
export const LAYER_GROUND = 'Ground';
export const LAYER_OBSTACLES = 'Obstacles';

// Walkability values
export const WALKABLE = 0;
export const BLOCKED = 1;

// Races
export const RACES = {
  HUW:    'architects',   // technology
  JONTY:  'covenant',     // altruistic
  FINN:   'bulwark',      // conservative
  MARCUS: 'unseen',       // cunning
} as const;

export type Race = typeof RACES[keyof typeof RACES];

/** Maps each race to its primary combat unit type ID (used by the enemy AI). */
export const RACE_UNIT_TYPES: Record<Race, string> = {
  architects: 'rifleman',
  covenant:   'devotee',
  bulwark:    'ironclad',
  unseen:     'phantom',
};

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Victory condition selected at game start. */
export type WinCondition = 'hq' | 'annihilation' | 'survival';

/** Duration (ms) for the Survival win condition. */
export const SURVIVAL_DURATION_MS = 15 * 60 * 1000; // 15 minutes
