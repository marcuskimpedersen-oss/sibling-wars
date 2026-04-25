import Phaser from 'phaser';
import { WALKABLE, BLOCKED, LAYER_OBSTACLES } from '@/constants';

/**
 * Pure function: converts Phaser tilemap -> number[][] walkability grid.
 * 0 = walkable, 1 = blocked.
 */
export function buildGridFromTilemap(map: Phaser.Tilemaps.Tilemap): number[][] {
  const grid: number[][] = [];

  for (let y = 0; y < map.height; y++) {
    grid[y] = [];
    for (let x = 0; x < map.width; x++) {
      const tile = map.getTileAt(x, y, false, LAYER_OBSTACLES);
      grid[y][x] = tile !== null ? BLOCKED : WALKABLE;
    }
  }

  return grid;
}
