declare module 'easystarjs' {
  namespace EasyStar {
    class js {
      setGrid(grid: number[][]): void;
      setAcceptableTiles(tiles: number[]): void;
      enableDiagonals(): void;
      disableCornerCutting(): void;
      findPath(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        callback: (path: Array<{ x: number; y: number }> | null) => void
      ): void;
      calculate(): void;
      /**
       * Set how many A* iterations EasyStar will process per calculate() call.
       * Default is 1, which spreads long paths across many frames and causes
       * visible hesitation before a unit starts moving.  A high value (e.g. 500)
       * resolves almost all paths in the same frame they are requested.
       */
      setIterationsPerUpdate(iterations: number): void;
      setAdditionalPointCost(x: number, y: number, cost: number): void;
      /** Permanently mark a tile as impassable (units will path around it). */
      avoidAdditionalPoint(x: number, y: number): void;
      /** Un-mark a tile previously marked with avoidAdditionalPoint. */
      stopAvoidingAdditionalPoint(x: number, y: number): void;
    }
  }
  export = EasyStar;
}
