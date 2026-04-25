export interface TileCoord {
  tileX: number;
  tileY: number;
}

export interface WorldCoord {
  worldX: number;
  worldY: number;
}

export interface PathStep {
  x: number;
  y: number;
}

export type UnitState = 'idle' | 'moving';
