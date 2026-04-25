import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.load.tilemapTiledJSON('map', 'assets/tilemaps/map.json');
    this.load.image('tileset', 'assets/tilesets/tileset.png');
    this.load.image('unit', 'assets/units/unit.png');
    this.load.image('worker', 'assets/units/worker.png');
    this.load.image('gold', 'assets/units/gold.png');
    this.load.image('juice', 'assets/units/juice.png');
    this.load.image('enemy_unit', 'assets/units/enemy_unit.png');
    this.load.image('building_hq', 'assets/units/building_hq.png');
    this.load.image('building_barracks', 'assets/units/building_barracks.png');
    this.load.image('building_mine', 'assets/units/building_mine.png');
    this.load.image('building_juice', 'assets/units/building_juice.png');
    this.load.image('building_house', 'assets/units/building_house.png');
  }

  create(): void {
    this.generateUnitTextures();
    this.scene.start('MenuScene');
  }

  private generateUnitTextures(): void {
    const S = 24; // sprite size in px
    const C = S / 2;

    const g = this.make.graphics({ add: false });

    const bake = (key: string, draw: (gfx: Phaser.GameObjects.Graphics) => void) => {
      g.clear();
      draw(g);
      g.generateTexture(key, S, S);
    };

    // ── Rifleman: circle with a centre dot (scope reticule) ─────────────────
    bake('unit_rifleman', gfx => {
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokeCircle(C, C, 9);
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 3);
    });

    // ── Arc Trooper: hexagon (tech/energy feel) ──────────────────────────────
    bake('unit_arc_trooper', gfx => {
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.25);
      const r = 9;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
      }
      gfx.fillPoints(pts, true);
      gfx.strokePoints(pts, true);
      // centre dot
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 2.5);
    });

    // ── Devotee: circle with cross (healer) ──────────────────────────────────
    bake('unit_devotee', gfx => {
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokeCircle(C, C, 9);
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.lineBetween(C, C - 6, C, C + 6);
      gfx.lineBetween(C - 6, C, C + 6, C);
    });

    // ── Crusader: solid diamond (heavy melee) ────────────────────────────────
    bake('unit_crusader', gfx => {
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.3);
      const pts = [
        { x: C,     y: C - 10 },
        { x: C + 8, y: C      },
        { x: C,     y: C + 10 },
        { x: C - 8, y: C      },
      ];
      gfx.fillPoints(pts, true);
      gfx.strokePoints(pts, true);
    });

    // ── Ironclad: rounded square (heavy armour) ──────────────────────────────
    bake('unit_ironclad', gfx => {
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.2);
      gfx.fillRoundedRect(C - 8, C - 8, 16, 16, 3);
      gfx.strokeRoundedRect(C - 8, C - 8, 16, 16, 3);
    });

    // ── Demolisher: large thick square (siege) ───────────────────────────────
    bake('unit_demolisher', gfx => {
      gfx.lineStyle(3, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.15);
      gfx.fillRect(C - 10, C - 10, 20, 20);
      gfx.strokeRect(C - 10, C - 10, 20, 20);
      // inner cross to suggest a battering-ram
      gfx.lineStyle(1.5, 0xffffff, 0.6);
      gfx.lineBetween(C - 5, C, C + 5, C);
      gfx.lineBetween(C, C - 5, C, C + 5);
    });

    // ── Phantom: right-pointing triangle (fast/agile) ────────────────────────
    bake('unit_phantom', gfx => {
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.25);
      const pts = [
        { x: C + 10, y: C      },
        { x: C - 7,  y: C - 9  },
        { x: C - 7,  y: C + 9  },
      ];
      gfx.fillPoints(pts, true);
      gfx.strokePoints(pts, true);
    });

    // ── Shadow Reaper: narrow downward diamond (assassin) ────────────────────
    bake('unit_shadow_reaper', gfx => {
      gfx.lineStyle(1.5, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.2);
      const pts = [
        { x: C,     y: C - 11 },
        { x: C + 5, y: C      },
        { x: C,     y: C + 11 },
        { x: C - 5, y: C      },
      ];
      gfx.fillPoints(pts, true);
      gfx.strokePoints(pts, true);
    });

    // ── Siege Crawler: wide flat rectangle (siege mode widget) ───────────────
    bake('unit_siege_crawler', gfx => {
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.fillStyle(0xffffff, 0.2);
      gfx.fillRoundedRect(C - 10, C - 6, 20, 12, 2);
      gfx.strokeRoundedRect(C - 10, C - 6, 20, 12, 2);
      // turret circle on top
      gfx.fillStyle(0xffffff, 0.5);
      gfx.fillCircle(C, C, 3);
    });

    g.destroy();
  }
}
