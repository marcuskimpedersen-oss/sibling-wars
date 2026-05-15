import EasyStar from 'easystarjs';
import { PathStep } from '@/types';

export class PathfinderService {
  private easystar: EasyStar.js;
  private gridCols: number;
  private gridRows: number;
  private terrainGrid: number[][];

  constructor(grid: number[][]) {
    this.easystar = new EasyStar.js();
    this.easystar.setGrid(grid);
    this.easystar.setAcceptableTiles([0]);
    this.easystar.enableDiagonals();
    this.easystar.disableCornerCutting();
    (this.easystar as any).setIterationsPerCalculation(500);
    this.gridRows = grid.length;
    this.gridCols = grid[0]?.length ?? 0;
    this.terrainGrid = grid;
  }

  /** Returns true if the tile is passable terrain (not rock/wall). */
  isTileWalkable(x: number, y: number): boolean {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.gridCols || yi >= this.gridRows) return false;
    return this.terrainGrid[yi][xi] === 0;
  }

  private clamp(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(this.gridCols - 1, Math.floor(x))),
      y: Math.max(0, Math.min(this.gridRows - 1, Math.floor(y))),
    };
  }

  findPath(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    onFound: (path: PathStep[] | null) => void
  ): void {
    const from = this.clamp(fromX, fromY);
    const to   = this.clamp(toX, toY);
    this.easystar.findPath(from.x, from.y, to.x, to.y, onFound);
  }

  /** Must be called every frame to resolve pending path requests. */
  calculate(): void {
    this.easystar.calculate();
  }

  /** @deprecated Use blockTile / unblockTile for hard obstacles. */
  updateTile(x: number, y: number, walkable: boolean): void {
    if (walkable) {
      this.easystar.stopAvoidingAdditionalPoint(x, y);
    } else {
      this.easystar.avoidAdditionalPoint(x, y);
    }
  }

  /**
   * Permanently block a tile so EasyStar treats it as impassable.
   * Used for buildings, rocks, trees, and water that units must path around.
   */
  blockTile(x: number, y: number): void {
    this.easystar.avoidAdditionalPoint(x, y);
  }

  /** Re-open a previously blocked tile (e.g. when a building is destroyed). */
  unblockTile(x: number, y: number): void {
    this.easystar.stopAvoidingAdditionalPoint(x, y);
  }
}
