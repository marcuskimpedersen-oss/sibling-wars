import Phaser from 'phaser';
import { LAYER_GROUND, LAYER_OBSTACLES, TILE_SIZE } from '@/constants';
import { buildGridFromTilemap } from './walkabilityGrid';

export class MapManager {
  private map!: Phaser.Tilemaps.Tilemap;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createMap();
  }

  private createMap(): void {
    this.map = this.scene.make.tilemap({ key: 'map' });
    const tiles = this.map.addTilesetImage('tileset', 'tileset')!;

    this.map.createLayer(LAYER_GROUND, tiles, 0, 0);
    this.map.createLayer(LAYER_OBSTACLES, tiles, 0, 0);
  }

  buildWalkabilityGrid(): number[][] {
    return buildGridFromTilemap(this.map);
  }

  getMapDimensions(): { widthInPixels: number; heightInPixels: number } {
    return {
      widthInPixels: this.map.widthInPixels,
      heightInPixels: this.map.heightInPixels,
    };
  }

  worldToTile(worldX: number, worldY: number): { tileX: number; tileY: number } {
    return {
      tileX: Math.floor(worldX / TILE_SIZE),
      tileY: Math.floor(worldY / TILE_SIZE),
    };
  }

  tileToWorld(tileX: number, tileY: number): { worldX: number; worldY: number } {
    return {
      worldX: tileX * TILE_SIZE + TILE_SIZE / 2,
      worldY: tileY * TILE_SIZE + TILE_SIZE / 2,
    };
  }
}
