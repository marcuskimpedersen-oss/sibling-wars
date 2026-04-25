import Phaser from 'phaser';
import { Building } from './Building';
import { BuildingDef, ProducedUnitDef } from './definitions';
import { PathfinderService } from '@/pathfinding/PathfinderService';
import { ResourceManager } from '@/economy/ResourceManager';
import { MAP_WIDTH_TILES, MAP_HEIGHT_TILES, Faction } from '@/constants';

export class BuildingManager {
  private buildings: Map<string, Building> = new Map();
  private occupiedTiles: Set<string> = new Set();
  private scene: Phaser.Scene;
  private pathfinder: PathfinderService;
  private resources: ResourceManager;
  private nextId = 0;

  onUnitProduced: ((unitDef: ProducedUnitDef, tileX: number, tileY: number, faction: Faction, building: Building) => void) | null = null;
  onBuildingDestroyed: ((building: Building) => void) | null = null;

  constructor(scene: Phaser.Scene, pathfinder: PathfinderService, resources: ResourceManager) {
    this.scene = scene;
    this.pathfinder = pathfinder;
    this.resources = resources;
  }

  placeBuilding(def: BuildingDef, tileX: number, tileY: number, free = false, faction: Faction = 'player'): Building | null {
    if (!this.isValidPlacement(def, tileX, tileY)) return null;
    if (!free && faction === 'player' && !this.resources.spendGold(def.goldCost)) return null;

    const id = `building_${this.nextId++}`;
    const building = new Building(this.scene, def, tileX, tileY, id, faction);
    building.onUnitProduced = (unitDef, spawnX, spawnY) => {
      this.onUnitProduced?.(unitDef, spawnX, spawnY, faction, building);
    };
    building.onDestroyed = () => {
      // Unblock pathfinder tiles and free occupied slots so new buildings can be placed
      for (let dy = 0; dy < def.tileHeight; dy++) {
        for (let dx = 0; dx < def.tileWidth; dx++) {
          this.occupiedTiles.delete(`${tileX + dx},${tileY + dy}`);
          this.pathfinder.unblockTile(tileX + dx, tileY + dy);
        }
      }
      this.onBuildingDestroyed?.(building);
    };

    this.buildings.set(id, building);

    for (let dy = 0; dy < def.tileHeight; dy++) {
      for (let dx = 0; dx < def.tileWidth; dx++) {
        const key = `${tileX + dx},${tileY + dy}`;
        this.occupiedTiles.add(key);
        this.pathfinder.blockTile(tileX + dx, tileY + dy);
      }
    }

    return building;
  }

  isValidPlacement(def: BuildingDef, tileX: number, tileY: number): boolean {
    if (tileX < 1 || tileY < 1) return false;
    if (tileX + def.tileWidth  > MAP_WIDTH_TILES  - 1) return false;
    if (tileY + def.tileHeight > MAP_HEIGHT_TILES - 1) return false;
    for (let dy = 0; dy < def.tileHeight; dy++) {
      for (let dx = 0; dx < def.tileWidth; dx++) {
        if (this.occupiedTiles.has(`${tileX + dx},${tileY + dy}`)) return false;
      }
    }
    return true;
  }

  getBuildings(): Building[] {
    return Array.from(this.buildings.values()).filter(b => !b.isDestroyed());
  }

  isTileOccupied(tileX: number, tileY: number): boolean {
    return this.occupiedTiles.has(`${tileX},${tileY}`);
  }

  update(delta: number): void {
    this.buildings.forEach(b => { if (!b.isDestroyed()) b.update(delta); });
  }

  getTotalSupply(): number {
    let total = 0;
    this.buildings.forEach(b => { if (!b.isDestroyed()) total += b.def.supplyProvided; });
    return total;
  }
}
