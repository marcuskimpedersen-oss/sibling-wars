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
    this.generateBuildingTextures();
    this.scene.start('MenuScene');
  }

  private generateUnitTextures(): void {
    const S = 36;
    const C = S / 2;

    const g = this.make.graphics({ add: false });

    const bake = (key: string, draw: (gfx: Phaser.GameObjects.Graphics) => void) => {
      g.clear();
      draw(g);
      g.generateTexture(key, S, S);
    };

    // Palette notes (all shapes are tinted by faction colour at runtime):
    //   0xffffff fill/stroke → full faction colour (bright highlight)
    //   0xaaaaaa fill        → 67% faction colour (mid-tone body)
    //   0x666666 fill        → 40% faction colour (dark body mass)
    //   0x000000 fill/stroke → always black (maximum contrast)

    // ── Worker: floating utility orb with pickaxe arm ────────────────────────
    bake('unit_worker', gfx => {
      // outer glow ring
      gfx.lineStyle(1, 0xffffff, 0.3);
      gfx.strokeCircle(C, C - 2, 15);
      // main orb body — mid-grey so tint shades it
      gfx.fillStyle(0x999999, 1);
      gfx.fillCircle(C, C - 2, 12);
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokeCircle(C, C - 2, 12);
      // inner darker core
      gfx.fillStyle(0x333333, 1);
      gfx.fillCircle(C, C - 2, 6);
      // bright highlight dot (top-left of orb — gives sphere illusion)
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C - 4, C - 6, 3);
      // pickaxe arm — extends from right of orb
      gfx.lineStyle(2, 0xcccccc, 1);
      gfx.lineBetween(C + 10, C - 2, C + 22, C - 8);
      // pickaxe head (bright T-shape)
      gfx.lineStyle(3, 0xffffff, 1);
      gfx.lineBetween(C + 19, C - 11, C + 25, C - 5);
      // small hover jets at bottom (3 dots)
      gfx.fillStyle(0xffffff, 0.7);
      gfx.fillCircle(C - 5, C + 12, 2);
      gfx.fillCircle(C,     C + 13, 2.5);
      gfx.fillCircle(C + 5, C + 12, 2);
    });

    // ── Rifleman (Architects): armoured soldier with rifle ───────────────────
    bake('unit_rifleman', gfx => {
      // helmet
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, 8, 6);
      // visor slit (black — stays black regardless of tint)
      gfx.fillStyle(0x000000, 0.95);
      gfx.fillRect(C - 5, 8, 10, 3);
      gfx.lineStyle(1, 0xffffff, 0.4);
      gfx.strokeRect(C - 5, 8, 10, 3);
      // body armour — mid-grey for plate mass
      gfx.fillStyle(0x888888, 1);
      gfx.fillRoundedRect(C - 6, 15, 12, 13, 2);
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokeRoundedRect(C - 6, 15, 12, 13, 2);
      // chest plate seam
      gfx.lineStyle(1.5, 0xffffff, 0.5);
      gfx.lineBetween(C, 16, C, 27);
      // shoulder pads
      gfx.fillStyle(0xbbbbbb, 1);
      gfx.fillRoundedRect(C - 10, 15, 5, 6, 1);
      gfx.fillRoundedRect(C + 5, 15, 5, 6, 1);
      // rifle body
      gfx.fillStyle(0x555555, 1);
      gfx.fillRect(C + 5, 17, 8, 4);
      // rifle barrel (bright — prominent weapon)
      gfx.lineStyle(3, 0xffffff, 1);
      gfx.lineBetween(C + 13, 19, C + 20, 14);
      // scope dot
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C + 10, 18, 2);
    });

    // ── Arc Trooper (Architects): energy hexagon ─────────────────────────────
    bake('unit_arc_trooper', gfx => {
      const hexPts = (r: number) => {
        const pts: {x:number;y:number}[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          pts.push({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
        }
        return pts;
      };
      // outer hex — dark fill creates glowing-edge look after tint
      gfx.fillStyle(0x666666, 1);
      gfx.fillPoints(hexPts(14), true);
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokePoints(hexPts(14), true);
      // inner hex panel
      gfx.fillStyle(0x222222, 1);
      gfx.fillPoints(hexPts(7), true);
      gfx.lineStyle(1, 0x888888, 0.8);
      gfx.strokePoints(hexPts(7), true);
      // 6 energy spokes from centre
      gfx.lineStyle(1, 0xffffff, 0.55);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        gfx.lineBetween(C, C, C + 7 * Math.cos(a), C + 7 * Math.sin(a));
      }
      // glowing core
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 3.5);
    });

    // ── Devotee (Covenant): robed healer with halo ───────────────────────────
    bake('unit_devotee', gfx => {
      // halo — bright ring, most prominent feature
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokeCircle(C, 7, 8);
      gfx.lineStyle(1, 0xffffff, 0.35);
      gfx.strokeCircle(C, 7, 10);
      // head
      gfx.fillStyle(0xdddddd, 1);
      gfx.fillCircle(C, 10, 5);
      gfx.lineStyle(1.5, 0xffffff, 1);
      gfx.strokeCircle(C, 10, 5);
      // robe — mid-grey tapered body
      gfx.fillStyle(0x888888, 1);
      gfx.fillTriangle(C - 10, 33, C + 10, 33, C, 16);
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokeTriangle(C - 10, 33, C + 10, 33, C, 16);
      // robe centre seam
      gfx.lineStyle(1, 0xaaaaaa, 0.6);
      gfx.lineBetween(C, 17, C, 30);
      // cross (bold contrast)
      gfx.lineStyle(2.5, 0x000000, 0.85);
      gfx.lineBetween(C, 19, C, 30);
      gfx.lineBetween(C - 5, 23, C + 5, 23);
    });

    // ── Crusader (Covenant): knight with shield ──────────────────────────────
    bake('unit_crusader', gfx => {
      const pts = [
        { x: C,      y: 2  },
        { x: C + 13, y: C  },
        { x: C,      y: 34 },
        { x: C - 13, y: C  },
      ];
      // body fill — shaded diamond
      gfx.fillStyle(0x888888, 1);
      gfx.fillPoints(pts, true);
      // bright edge
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokePoints(pts, true);
      // inner highlight band
      gfx.lineStyle(1.5, 0xffffff, 0.45);
      gfx.lineBetween(C - 5, C - 7, C + 5, C - 7);
      // shoulder pauldrons
      gfx.fillStyle(0xffffff, 0.9);
      gfx.fillCircle(C - 12, C, 3);
      gfx.fillCircle(C + 12, C, 3);
      // cross
      gfx.lineStyle(3, 0x000000, 0.75);
      gfx.lineBetween(C, 8, C, 28);
      gfx.lineBetween(C - 8, C, C + 8, C);
    });

    // ── Ironclad (Bulwark): heavy armoured tank-man ──────────────────────────
    bake('unit_ironclad', gfx => {
      // outer armour — mid-grey body mass
      gfx.fillStyle(0x777777, 1);
      gfx.fillRoundedRect(3, 3, 30, 30, 4);
      gfx.lineStyle(3, 0xffffff, 1);
      gfx.strokeRoundedRect(3, 3, 30, 30, 4);
      // inner recessed panel
      gfx.fillStyle(0x222222, 1);
      gfx.fillRoundedRect(8, 8, 20, 20, 3);
      // glowing visor slit — standout white feature
      gfx.fillStyle(0xffffff, 1);
      gfx.fillRect(9, 13, 18, 5);
      gfx.lineStyle(1, 0x000000, 0.3);
      gfx.strokeRect(9, 13, 18, 5);
      // corner rivets
      gfx.fillStyle(0xffffff, 0.65);
      gfx.fillCircle(6, 6, 2);
      gfx.fillCircle(30, 6, 2);
      gfx.fillCircle(6, 30, 2);
      gfx.fillCircle(30, 30, 2);
      // chest centre line
      gfx.lineStyle(1.5, 0x444444, 1);
      gfx.lineBetween(C, 20, C, 27);
    });

    // ── Demolisher (Bulwark): siege tank ─────────────────────────────────────
    bake('unit_demolisher', gfx => {
      // hull — shaded body
      gfx.fillStyle(0x888888, 1);
      gfx.fillRoundedRect(2, 9, 28, 16, 3);
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokeRoundedRect(2, 9, 28, 16, 3);
      // hull panel line
      gfx.lineStyle(1, 0xffffff, 0.4);
      gfx.lineBetween(16, 10, 16, 24);
      // tracks — very dark
      gfx.fillStyle(0x222222, 1);
      gfx.fillRect(2, 23, 28, 5);
      // track bolts
      gfx.fillStyle(0x666666, 1);
      for (let i = 0; i < 5; i++) gfx.fillCircle(5 + i * 6, 25, 1.5);
      // turret body
      gfx.fillStyle(0x999999, 1);
      gfx.fillCircle(C - 2, C - 1, 7);
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokeCircle(C - 2, C - 1, 7);
      // cannon barrel (bold — distinctive feature)
      gfx.lineStyle(5, 0xffffff, 1);
      gfx.lineBetween(C + 4, C - 2, 35, C - 6);
      // muzzle
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(34, C - 6, 3);
    });

    // ── Phantom (Unseen): cloaked stealth dart ───────────────────────────────
    bake('unit_phantom', gfx => {
      const pts = [
        { x: 34, y: C      },
        { x: 4,  y: C - 13 },
        { x: 10, y: C      },
        { x: 4,  y: C + 13 },
      ];
      // body — slightly grey for cloaked feel
      gfx.fillStyle(0x999999, 1);
      gfx.fillPoints(pts, true);
      // leading edge highlight
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokePoints(pts, true);
      // wing sweep speed lines
      gfx.lineStyle(1.5, 0xffffff, 0.65);
      gfx.lineBetween(10, C, 28, C);
      gfx.lineStyle(1, 0xffffff, 0.35);
      gfx.lineBetween(10, C - 5, 23, C - 5);
      gfx.lineBetween(10, C + 5, 23, C + 5);
      // cockpit — black with targeting dot
      gfx.fillStyle(0x000000, 0.9);
      gfx.fillCircle(22, C, 4.5);
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(22, C, 1.5);
    });

    // ── Shadow Reaper (Unseen): blade assassin ───────────────────────────────
    bake('unit_shadow_reaper', gfx => {
      const pts = [
        { x: C,     y: 1  },
        { x: C + 8, y: C  },
        { x: C,     y: 35 },
        { x: C - 8, y: C  },
      ];
      // blade interior — dark (absorbs light)
      gfx.fillStyle(0x333333, 1);
      gfx.fillPoints(pts, true);
      // bright blade edges
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokePoints(pts, true);
      // centre spine
      gfx.lineStyle(1.5, 0xffffff, 0.75);
      gfx.lineBetween(C, 4, C, 32);
      // crossguard
      gfx.lineStyle(3, 0xffffff, 0.9);
      gfx.lineBetween(C - 7, C, C + 7, C);
      // blade tip glint
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, 5, 2);
    });

    // ── Siege Crawler (Bulwark): wide tracked artillery ──────────────────────
    bake('unit_siege_crawler', gfx => {
      // wide hull
      gfx.fillStyle(0x888888, 1);
      gfx.fillRoundedRect(1, 12, 34, 13, 3);
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokeRoundedRect(1, 12, 34, 13, 3);
      // hull centre panel line
      gfx.lineStyle(1, 0xffffff, 0.4);
      gfx.lineBetween(18, 13, 18, 24);
      // tracks top + bottom
      gfx.fillStyle(0x222222, 1);
      gfx.fillRect(1, 12, 34, 3);
      gfx.fillRect(1, 22, 34, 3);
      // track detail dots
      gfx.fillStyle(0x555555, 1);
      for (let i = 0; i < 6; i++) {
        gfx.fillCircle(3 + i * 6, 13, 1.5);
        gfx.fillCircle(3 + i * 6, 24, 1.5);
      }
      // turret
      gfx.fillStyle(0xaaaaaa, 1);
      gfx.fillCircle(C, C, 6);
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokeCircle(C, C, 6);
      // angled cannon
      gfx.lineStyle(4.5, 0xffffff, 1);
      gfx.lineBetween(C + 5, C - 1, 35, C - 5);
    });

    // ── Prime Construct (Architects hero): double ring + spokes ─────────────
    bake('unit_prime_construct', gfx => {
      // outer ring fill
      gfx.fillStyle(0x555555, 0.6);
      gfx.fillCircle(C, C, 15);
      // outer ring
      gfx.lineStyle(3, 0xffffff, 1);
      gfx.strokeCircle(C, C, 15);
      // mid ring
      gfx.lineStyle(1.5, 0xffffff, 0.7);
      gfx.strokeCircle(C, C, 10);
      // 4 spokes
      gfx.lineStyle(1.5, 0xffffff, 0.6);
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        gfx.lineBetween(C, C, C + 10 * Math.cos(a), C + 10 * Math.sin(a));
      }
      // large hero core
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 5);
      // core halo
      gfx.lineStyle(1.5, 0xffffff, 0.45);
      gfx.strokeCircle(C, C, 7);
    });

    // ── High Inquisitor (Covenant hero): nested diamonds ────────────────────
    bake('unit_high_inquisitor', gfx => {
      // outer diamond
      gfx.fillStyle(0x888888, 1);
      const outerPts = [
        { x: C,  y: 1  },
        { x: 35, y: C  },
        { x: C,  y: 35 },
        { x: 1,  y: C  },
      ];
      gfx.fillPoints(outerPts, true);
      gfx.lineStyle(3, 0xffffff, 1);
      gfx.strokePoints(outerPts, true);
      // inner diamond (nested for hero grandeur)
      gfx.lineStyle(1.5, 0xffffff, 0.6);
      const innerPts = [
        { x: C,     y: 9  },
        { x: C + 9, y: C  },
        { x: C,     y: 27 },
        { x: C - 9, y: C  },
      ];
      gfx.strokePoints(innerPts, true);
      // bold cross
      gfx.lineStyle(3, 0x000000, 0.75);
      gfx.lineBetween(C, 8, C, 28);
      gfx.lineBetween(C - 8, C, C + 8, C);
      // centre gem
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 4);
    });

    // ── Iron Warden (Bulwark hero): fortified tower ──────────────────────────
    bake('unit_iron_warden', gfx => {
      // outer fortress body
      gfx.fillStyle(0x777777, 1);
      gfx.fillRoundedRect(1, 1, 34, 34, 4);
      gfx.lineStyle(3.5, 0xffffff, 1);
      gfx.strokeRoundedRect(1, 1, 34, 34, 4);
      // inner panel
      gfx.fillStyle(0x222222, 1);
      gfx.fillRoundedRect(7, 7, 22, 22, 3);
      gfx.lineStyle(2, 0xffffff, 0.6);
      gfx.strokeRoundedRect(7, 7, 22, 22, 3);
      // battlements (3 merlons on top)
      gfx.fillStyle(0xffffff, 0.9);
      gfx.fillRect(5, 1, 6, 4);
      gfx.fillRect(14, 1, 6, 4);
      gfx.fillRect(23, 1, 6, 4);
      // hero core orb
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 5);
      gfx.lineStyle(1.5, 0xffffff, 0.45);
      gfx.strokeCircle(C, C, 8);
    });

    // ── Void Walker (Unseen hero): large cloaked dart ────────────────────────
    bake('unit_void_walker', gfx => {
      const pts = [
        { x: 35, y: C      },
        { x: 2,  y: C - 15 },
        { x: 8,  y: C      },
        { x: 2,  y: C + 15 },
      ];
      // dark body — deeper shadow than phantom
      gfx.fillStyle(0x444444, 1);
      gfx.fillPoints(pts, true);
      gfx.lineStyle(2.5, 0xffffff, 1);
      gfx.strokePoints(pts, true);
      // speed lines
      gfx.lineStyle(1.5, 0xffffff, 0.65);
      gfx.lineBetween(8, C, 28, C);
      gfx.lineStyle(1, 0xffffff, 0.35);
      gfx.lineBetween(8, C - 6, 22, C - 6);
      gfx.lineBetween(8, C + 6, 22, C + 6);
      // engine pods (hero distinction)
      gfx.fillStyle(0x999999, 0.8);
      gfx.fillCircle(4, C - 9, 3);
      gfx.fillCircle(4, C + 9, 3);
      gfx.lineStyle(1, 0xffffff, 0.5);
      gfx.strokeCircle(4, C - 9, 3);
      gfx.strokeCircle(4, C + 9, 3);
      // cockpit
      gfx.fillStyle(0x000000, 0.9);
      gfx.fillCircle(22, C, 5);
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(22, C, 2.5);
    });

    // ── Arbiter (Architects): 8-point star ───────────────────────────────────
    bake('unit_arbiter', gfx => {
      const starPts: { x: number; y: number }[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const r = i % 2 === 0 ? 15 : 6;
        starPts.push({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
      }
      // star body
      gfx.fillStyle(0x888888, 1);
      gfx.fillPoints(starPts, true);
      gfx.lineStyle(2, 0xffffff, 1);
      gfx.strokePoints(starPts, true);
      // inner ring
      gfx.lineStyle(1.5, 0xffffff, 0.55);
      gfx.strokeCircle(C, C, 6);
      // centre gem
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(C, C, 3.5);
    });

    g.destroy();
  }

  private generateBuildingTextures(): void {
    const g = this.make.graphics({ add: false });

    const bake = (key: string, w: number, h: number, draw: (gfx: Phaser.GameObjects.Graphics) => void) => {
      g.clear();
      draw(g);
      g.generateTexture(key, w, h);
    };

    // ── HQs (3×3 tiles = 96×96 display) ──────────────────────────────────────
    const H = 96, CH = 48;

    // command_nexus (Architects): octagonal high-tech HQ
    bake('building_command_nexus', H, H, g => {
      const oct = (r: number) => { const p = []; for (let i=0;i<8;i++){const a=(Math.PI/4)*i-Math.PI/8;p.push({x:CH+r*Math.cos(a),y:CH+r*Math.sin(a)});}return p;};
      g.fillStyle(0x777777,1); g.fillPoints(oct(44),true);
      g.lineStyle(3,0xffffff,1); g.strokePoints(oct(44),true);
      g.fillStyle(0x222222,1); g.fillPoints(oct(28),true);
      g.lineStyle(1.5,0x888888,0.7); g.strokePoints(oct(28),true);
      // power rings
      g.lineStyle(1.5,0xffffff,0.5); g.strokeCircle(CH,CH,20);
      g.lineStyle(1,0xffffff,0.3); g.strokeCircle(CH,CH,12);
      // 8 spokes
      g.lineStyle(1,0xffffff,0.4);
      for(let i=0;i<8;i++){const a=(Math.PI/4)*i; g.lineBetween(CH+12*Math.cos(a),CH+12*Math.sin(a),CH+26*Math.cos(a),CH+26*Math.sin(a));}
      // core
      g.fillStyle(0xffffff,1); g.fillCircle(CH,CH,6);
      // antenna array (3 spires on top)
      g.lineStyle(2.5,0xffffff,1); g.lineBetween(CH,CH-44,CH,CH-60);
      g.lineStyle(1.5,0xffffff,0.85); g.lineBetween(CH-9,CH-40,CH-9,CH-52); g.lineBetween(CH+9,CH-40,CH+9,CH-52);
      g.fillStyle(0xffffff,0.9); g.fillCircle(CH,CH-60,3); g.fillCircle(CH-9,CH-52,2); g.fillCircle(CH+9,CH-52,2);
      // corner power nodes
      [0,2,4,6].forEach(i=>{const a=(Math.PI/4)*i-Math.PI/8; g.fillStyle(0xffffff,0.75); g.fillCircle(CH+44*Math.cos(a),CH+44*Math.sin(a),4);});
    });

    // sacred_spire (Covenant): Gothic cathedral HQ
    bake('building_sacred_spire', H, H, g => {
      // two side towers
      g.fillStyle(0x999999,1); g.fillRect(4,CH-22,20,H-CH+22); g.fillRect(H-24,CH-22,20,H-CH+22);
      g.lineStyle(2,0xffffff,1); g.strokeRect(4,CH-22,20,H-CH+22); g.strokeRect(H-24,CH-22,20,H-CH+22);
      // pointed tower caps
      g.fillStyle(0xaaaaaa,1); g.fillTriangle(4,CH-22,24,CH-22,14,CH-48); g.fillTriangle(H-24,CH-22,H-4,CH-22,CH,CH-48);
      g.lineStyle(2,0xffffff,1); g.strokeTriangle(4,CH-22,24,CH-22,14,CH-48); g.strokeTriangle(H-24,CH-22,H-4,CH-22,CH,CH-48);
      // main body
      g.fillStyle(0x888888,1); g.fillRect(20,CH+4,56,H-CH-4);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(20,CH+4,56,H-CH-4);
      // tall central spire
      g.fillStyle(0xffffff,0.9); g.fillTriangle(CH-14,CH+4,CH+14,CH+4,CH,CH-66);
      // rose window (circle with spokes)
      g.lineStyle(2,0xffffff,0.9); g.strokeCircle(CH,CH+16,12);
      for(let i=0;i<6;i++){const a=(Math.PI/3)*i; g.lineBetween(CH,CH+16,CH+12*Math.cos(a),CH+16+12*Math.sin(a));}
      // entrance arch
      g.fillStyle(0x111111,1); g.fillRect(CH-10,CH+38,20,20); g.fillCircle(CH,CH+38,10);
      // cross at tower tops
      g.lineStyle(2.5,0x000000,0.8); g.lineBetween(14,CH-48,14,CH-34); g.lineBetween(7,CH-43,21,CH-43);
      g.lineBetween(CH,CH-66,CH,CH-50); g.lineBetween(CH-8,CH-59,CH+8,CH-59);
    });

    // iron_bastion (Bulwark): massive fortress HQ
    bake('building_iron_bastion', H, H, g => {
      // outer thick walls
      g.fillStyle(0x777777,1); g.fillRect(4,4,H-8,H-8);
      g.lineStyle(3.5,0xffffff,1); g.strokeRect(4,4,H-8,H-8);
      // inner courtyard
      g.fillStyle(0x333333,1); g.fillRect(20,20,H-40,H-40);
      // 4 corner towers
      [[8,8],[8,88],[88,8],[88,88]].forEach(([cx,cy])=>{ g.fillStyle(0x999999,1); g.fillCircle(cx,cy,13); g.lineStyle(2,0xffffff,1); g.strokeCircle(cx,cy,13);});
      // battlements across top
      g.fillStyle(0xffffff,0.85); for(let i=0;i<7;i++) g.fillRect(7+i*12,2,8,7);
      // central keep
      g.fillStyle(0x888888,1); g.fillRect(CH-16,CH-20,32,40);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(CH-16,CH-20,32,40);
      // gatehouse entrance arch
      g.fillStyle(0x111111,1); g.fillRect(CH-9,CH+4,18,16); g.fillCircle(CH,CH+4,9);
      // keep battlements
      g.fillStyle(0xffffff,0.8); g.fillRect(CH-16,CH-24,7,6); g.fillRect(CH-7,CH-24,6,6); g.fillRect(CH+1,CH-24,7,6); g.fillRect(CH+9,CH-24,7,6);
    });

    // shadow_node (Unseen): dark diamond HQ
    bake('building_shadow_node', H, H, g => {
      const dPts = [{x:CH,y:4},{x:H-4,y:CH},{x:CH,y:H-4},{x:4,y:CH}];
      g.fillStyle(0x333333,1); g.fillPoints(dPts,true);
      g.lineStyle(3,0xffffff,1); g.strokePoints(dPts,true);
      // inner diamond
      g.lineStyle(1.5,0xffffff,0.45); g.strokePoints([{x:CH,y:22},{x:CH+24,y:CH},{x:CH,y:CH+26},{x:CH-24,y:CH}],true);
      // void eye
      g.fillStyle(0x111111,1); g.fillEllipse(CH,CH,26,18);
      g.lineStyle(2,0xffffff,0.9); g.strokeEllipse(CH,CH,26,18);
      g.fillStyle(0xffffff,1); g.fillEllipse(CH,CH,9,6);
      g.fillStyle(0x000000,1); g.fillCircle(CH,CH,3);
      // void tendrils (jagged lines outward)
      g.lineStyle(1.5,0xffffff,0.4);
      g.lineBetween(CH,CH-30,CH+7,CH-18); g.lineBetween(CH+7,CH-18,CH,CH-6);
      g.lineBetween(CH,CH+30,CH-7,CH+18); g.lineBetween(CH-7,CH+18,CH,CH+6);
      g.lineBetween(CH-30,CH,CH-18,CH+6); g.lineBetween(CH+30,CH,CH+18,CH-6);
    });

    // ── Barracks / Training buildings (2×2 = 64×64) ───────────────────────────
    const B = 64, CB = 32;

    // tech_foundry (Architects): armed deployment bunker
    bake('building_tech_foundry', B, B, g => {
      // main fortified body — wide, angular, low-profile
      g.fillStyle(0x777777,1); g.fillRoundedRect(2,14,60,48,2);
      g.lineStyle(3,0xffffff,1); g.strokeRoundedRect(2,14,60,48,2);
      // angled armour panels on corners (chamfered)
      g.fillStyle(0x888888,1);
      g.fillTriangle(2,14,14,14,2,26);
      g.fillTriangle(62,14,50,14,62,26);
      g.lineStyle(1.5,0xffffff,0.6);
      g.lineBetween(2,14,14,14); g.lineBetween(2,14,2,26);
      g.lineBetween(62,14,50,14); g.lineBetween(62,14,62,26);
      // targeting sensor array on roof centre
      g.fillStyle(0x999999,1); g.fillRect(CB-8,4,16,12);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(CB-8,4,16,12);
      g.lineStyle(1.5,0xffffff,0.7); g.lineBetween(CB,4,CB,14);
      g.fillStyle(0xffffff,1); g.fillCircle(CB,3,3);
      g.lineStyle(1,0xffffff,0.5); g.strokeCircle(CB,3,5);
      // two flanking gun emplacements (squares with barrel lines)
      g.fillStyle(0x666666,1); g.fillRect(6,18,12,10); g.fillRect(46,18,12,10);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(6,18,12,10); g.strokeRect(46,18,12,10);
      g.lineStyle(3,0xffffff,1); g.lineBetween(2,23,6,23); g.lineBetween(58,23,62,23);
      // blast-door entrance — armoured double doors
      g.fillStyle(0x222222,1); g.fillRect(CB-12,42,24,20);
      g.lineStyle(2.5,0xffffff,1); g.strokeRect(CB-12,42,24,20);
      g.lineStyle(2,0xffffff,0.6); g.lineBetween(CB,42,CB,62);
      // door bolts
      g.fillStyle(0xffffff,0.7); g.fillCircle(CB-6,46,2); g.fillCircle(CB+6,46,2); g.fillCircle(CB-6,58,2); g.fillCircle(CB+6,58,2);
      // energy conduit lines on facade
      g.lineStyle(1.5,0xffffff,0.35); g.lineBetween(20,14,20,42); g.lineBetween(44,14,44,42);
    });

    // sanctuary (Covenant): crusader temple-fortress
    bake('building_sanctuary', B, B, g => {
      // thick outer fortress walls
      g.fillStyle(0x888888,1); g.fillRect(4,12,56,50);
      g.lineStyle(3,0xffffff,1); g.strokeRect(4,12,56,50);
      // two flanking defensive towers
      g.fillStyle(0x999999,1); g.fillRect(2,8,14,56); g.fillRect(48,8,14,56);
      g.lineStyle(2,0xffffff,1); g.strokeRect(2,8,14,56); g.strokeRect(48,8,14,56);
      // tower battlements
      g.fillStyle(0xffffff,0.85);
      g.fillRect(2,2,5,8); g.fillRect(9,2,5,8); g.fillRect(48,2,5,8); g.fillRect(55,2,5,8);
      // inner recessed facade
      g.fillStyle(0x777777,1); g.fillRect(16,18,32,44);
      // bold crusader cross — shield-shaped, prominent
      g.lineStyle(4,0xffffff,1); g.lineBetween(CB,20,CB,48); g.lineBetween(CB-12,30,CB+12,30);
      // cross cap (pointed)
      g.fillStyle(0xffffff,0.9); g.fillTriangle(CB-4,20,CB+4,20,CB,12);
      // portcullis gate — arched with grating
      g.fillStyle(0x111111,1); g.fillRect(CB-9,44,18,18); g.fillCircle(CB,44,9);
      g.lineStyle(1.5,0xffffff,0.4);
      g.lineBetween(CB-6,44,CB-6,62); g.lineBetween(CB,44,CB,62); g.lineBetween(CB+6,44,CB+6,62);
      g.lineBetween(CB-9,50,CB+9,50); g.lineBetween(CB-9,56,CB+9,56);
      // tower arrow slits
      g.fillStyle(0x111111,1); g.fillRect(6,26,4,12); g.fillRect(54,26,4,12);
    });

    // garrison (Bulwark): heavy military fortress barracks
    bake('building_garrison', B, B, g => {
      // massive base — thick outer shell
      g.fillStyle(0x777777,1); g.fillRect(2,6,60,56);
      g.lineStyle(3.5,0xffffff,1); g.strokeRect(2,6,60,56);
      // thick inner wall (double-wall feel)
      g.fillStyle(0x555555,1); g.fillRect(8,12,48,44);
      g.lineStyle(1.5,0xffffff,0.45); g.strokeRect(8,12,48,44);
      // heavy battlements (7 bold merlons)
      g.fillStyle(0x888888,1); for(let i=0;i<6;i++){g.fillRect(5+i*10,0,7,8); g.lineStyle(2,0xffffff,0.9); g.strokeRect(5+i*10,0,7,8);}
      // weapon racks on facade (5 vertical lines representing stacked rifles)
      g.lineStyle(2.5,0xffffff,0.7);
      for(let i=0;i<5;i++) g.lineBetween(14+i*8,18,14+i*8,36);
      g.lineStyle(1,0xffffff,0.4); g.lineBetween(10,30,54,30);
      // corner reinforcement plates
      g.fillStyle(0x999999,1); g.fillRect(2,6,8,8); g.fillRect(54,6,8,8); g.fillRect(2,54,8,8); g.fillRect(54,54,8,8);
      // portcullis gate — heavy iron grating
      g.fillStyle(0x1a1a1a,1); g.fillRect(CB-12,40,24,22);
      g.fillStyle(0x111111,1); g.fillCircle(CB,40,12);
      g.lineStyle(3,0xffffff,0.9); g.strokeRect(CB-12,40,24,22); g.strokeCircle(CB,40,12);
      // portcullis grating
      g.lineStyle(2,0xffffff,0.5);
      g.lineBetween(CB-8,40,CB-8,62); g.lineBetween(CB,40,CB,62); g.lineBetween(CB+8,40,CB+8,62);
      g.lineBetween(CB-12,48,CB+12,48); g.lineBetween(CB-12,56,CB+12,56);
    });

    // infiltration_den (Unseen): black ops training compound
    bake('building_infiltration_den', B, B, g => {
      // angular armoured main body — aggressive low profile
      g.fillStyle(0x333333,1);
      g.fillPoints([{x:0,y:12},{x:64,y:12},{x:60,y:62},{x:4,y:62}],true);
      g.lineStyle(2.5,0xffffff,0.9);
      g.strokePoints([{x:0,y:12},{x:64,y:12},{x:60,y:62},{x:4,y:62}],true);
      // angled armour slash across the front (diagonal panel line)
      g.lineStyle(3,0xffffff,0.55); g.lineBetween(0,28,64,20);
      // 4 bold firing slits (wide enough to see clearly)
      g.fillStyle(0x0a0a0a,1);
      for(let i=0;i<4;i++){g.fillRect(8+i*14,32,8,14); g.lineStyle(1.5,0xffffff,0.5); g.strokeRect(8+i*14,32,8,14);}
      // raised armoured entry vestibule (right side — concealed but distinct)
      g.fillStyle(0x444444,1); g.fillRect(44,38,20,24);
      g.lineStyle(2,0xffffff,0.8); g.strokeRect(44,38,20,24);
      // entry door (dark slit door)
      g.fillStyle(0x0a0a0a,1); g.fillRect(50,46,8,16);
      g.lineStyle(1.5,0xffffff,0.6); g.strokeRect(50,46,8,16);
      // shadow ops insignia — bold target/crosshair on facade
      g.lineStyle(2,0xffffff,0.5); g.strokeCircle(20,44,8);
      g.lineStyle(1.5,0xffffff,0.55); g.lineBetween(12,44,28,44); g.lineBetween(20,36,20,52);
      g.fillStyle(0xffffff,0.8); g.fillCircle(20,44,2);
      // roof edge strip
      g.fillStyle(0x222222,1); g.fillRect(0,6,64,8);
      g.lineStyle(1,0xffffff,0.5); g.lineBetween(0,6,64,6);
    });

    // ── Houses (2×2 = 64×64) ──────────────────────────────────────────────────

    // habitat_module (Architects): pressurized dome habitat
    bake('building_habitat_module', B, B, g => {
      // dome
      g.fillStyle(0x777777,1); g.fillCircle(CB,26,22); g.fillRect(CB-22,26,44,8);
      g.lineStyle(2.5,0xffffff,1); g.strokeCircle(CB,26,22);
      // dome ribs
      g.lineStyle(1,0xffffff,0.35); for(let i=-2;i<=2;i++){if(i===0)continue;const x=CB+i*9;const dy=Math.sqrt(Math.max(0,22*22-(i*9)*(i*9)));g.lineBetween(x,26-dy,x,34);}
      // 3 porthole windows
      [CB-12,CB,CB+12].forEach((x,i)=>{
        g.fillStyle(0x111111,1); g.fillCircle(x,18+(i===1?-4:0),5);
        g.lineStyle(1.5,0xffffff,0.9); g.strokeCircle(x,18+(i===1?-4:0),5);
      });
      // connecting base tube
      g.fillStyle(0x888888,1); g.fillRoundedRect(12,34,40,12,3);
      g.lineStyle(2,0xffffff,0.8); g.strokeRoundedRect(12,34,40,12,3);
      // airlock
      g.fillStyle(0x222222,1); g.fillRoundedRect(CB-7,34,14,12,2);
      g.lineStyle(1.5,0xffffff,0.7); g.strokeRoundedRect(CB-7,34,14,12,2);
      // footplate
      g.fillStyle(0x666666,1); g.fillRect(6,46,52,8);
      g.lineStyle(1.5,0xffffff,0.6); g.strokeRect(6,46,52,8);
    });

    // commune_hall (Covenant): stepped pyramid dwelling
    bake('building_commune_hall', B, B, g => {
      // 3 stepped levels
      g.fillStyle(0x888888,1); g.fillRect(6,44,52,18); g.lineStyle(2,0xffffff,1); g.strokeRect(6,44,52,18);
      g.fillStyle(0x999999,1); g.fillRect(12,28,40,18); g.lineStyle(2,0xffffff,1); g.strokeRect(12,28,40,18);
      g.fillStyle(0xaaaaaa,1); g.fillRect(20,14,24,16); g.lineStyle(2,0xffffff,1); g.strokeRect(20,14,24,16);
      // ornamental cap
      g.fillStyle(0xffffff,0.85); g.fillRect(26,8,12,8);
      // arched windows
      g.fillStyle(0x111111,1);
      g.fillRect(CB-4,16,8,10); g.fillCircle(CB,16,4);
      g.fillRect(CB-12,30,8,10); g.fillCircle(CB-8,30,4); g.fillRect(CB+4,30,8,10); g.fillCircle(CB+8,30,4);
      g.fillRect(CB-8,46,16,16); g.fillCircle(CB,46,8);
    });

    // fortified_quarters (Bulwark): thick-walled military housing
    bake('building_fortified_quarters', B, B, g => {
      g.fillStyle(0x666666,1); g.fillRoundedRect(4,10,56,50,3);
      g.lineStyle(3,0xffffff,1); g.strokeRoundedRect(4,10,56,50,3);
      g.lineStyle(1.5,0xffffff,0.4); g.strokeRoundedRect(10,16,44,38,2);
      // arrow slits
      g.fillStyle(0x111111,1); g.fillRect(14,22,10,6); g.fillRect(40,22,10,6);
      g.fillRect(10,36,8,6); g.fillRect(28,36,8,6); g.fillRect(46,36,8,6);
      // door
      g.fillStyle(0x333333,1); g.fillRect(CB-10,44,20,16);
      g.lineStyle(2,0xffffff,0.8); g.strokeRect(CB-10,44,20,16);
      g.lineStyle(1.5,0x666666,1); g.lineBetween(CB-10,52,CB+10,52); g.lineBetween(CB,44,CB,60);
      // battlements
      g.fillStyle(0xffffff,0.75); for(let i=0;i<4;i++) g.fillRect(10+i*13,6,8,6);
    });

    // safe_house (Unseen): deliberately unassuming building
    bake('building_safe_house', B, B, g => {
      g.fillStyle(0x666666,1); g.fillRect(8,14,48,46);
      g.lineStyle(1.5,0x999999,0.7); g.strokeRect(8,14,48,46);
      // plain gabled roof
      g.fillStyle(0x777777,1); g.fillTriangle(4,14,60,14,CB,2);
      g.lineStyle(1.5,0x999999,0.65); g.strokeTriangle(4,14,60,14,CB,2);
      // two plain windows
      g.fillStyle(0x333333,1); g.fillRect(14,22,10,10); g.fillRect(40,22,10,10);
      g.lineStyle(1,0x999999,0.6); g.strokeRect(14,22,10,10); g.strokeRect(40,22,10,10);
      g.lineBetween(19,22,19,32); g.lineBetween(14,27,24,27);
      g.lineBetween(45,22,45,32); g.lineBetween(40,27,50,27);
      // plain door
      g.fillStyle(0x444444,1); g.fillRect(CB-7,42,14,18);
      g.lineStyle(1,0x888888,0.6); g.strokeRect(CB-7,42,14,18);
      // barely-visible shadow insignia
      g.lineStyle(0.8,0xffffff,0.18); g.strokePoints([{x:54,y:30},{x:58,y:36},{x:54,y:42},{x:50,y:36}],true);
    });

    // ── Academies (2×2 = 64×64) ───────────────────────────────────────────────

    // research_array (Architects): satellite dish + antenna
    bake('building_research_array', B, B, g => {
      // base plate
      g.fillStyle(0x777777,1); g.fillRoundedRect(10,52,44,10,2);
      g.lineStyle(2,0xffffff,0.8); g.strokeRoundedRect(10,52,44,10,2);
      // tripod legs
      g.lineStyle(2.5,0xffffff,0.85); g.lineBetween(CB,44,14,62); g.lineBetween(CB,44,CB,62); g.lineBetween(CB,44,50,62);
      // dish (arc)
      g.lineStyle(4,0xffffff,1);
      g.beginPath(); g.arc(CB,42,22,Math.PI+0.25,0-0.25,false); g.strokePath();
      // dish fill
      g.fillStyle(0x888888,0.5);
      g.beginPath(); g.arc(CB,42,22,Math.PI,0,false); g.closePath(); g.fillPath();
      // antenna spike
      g.lineStyle(3,0xffffff,1); g.lineBetween(CB,42,CB,8);
      g.lineStyle(1.5,0xffffff,0.7); g.lineBetween(CB-9,20,CB+9,20); g.lineBetween(CB-6,14,CB+6,14);
      g.fillStyle(0xffffff,1); g.fillCircle(CB,42,5);
      g.fillStyle(0xffffff,0.9); g.fillCircle(CB,7,2.5);
    });

    // sacred_archive (Covenant): domed library
    bake('building_sacred_archive', B, B, g => {
      g.fillStyle(0x888888,1); g.fillRect(6,38,52,24);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(6,38,52,24);
      // dome
      g.fillStyle(0x999999,1); g.fillCircle(CB,38,22);
      g.lineStyle(2.5,0xffffff,1); g.strokeCircle(CB,38,22);
      g.fillStyle(0x888888,1); g.fillRect(6,38,52,8);
      // open book motif
      g.lineStyle(2,0xffffff,0.8); g.lineBetween(CB,42,CB,58);
      g.beginPath(); g.arc(CB-8,50,10,0.3,Math.PI*0.85,false); g.strokePath();
      g.beginPath(); g.arc(CB+8,50,10,Math.PI*0.15,Math.PI*0.7,false); g.strokePath();
      // 3 arched windows
      g.fillStyle(0x111111,1);
      for(let i=0;i<3;i++){const wx=10+i*18; g.fillRect(wx,42,10,14); g.fillCircle(wx+5,42,5);}
      // dome finial
      g.lineStyle(2,0xffffff,1); g.lineBetween(CB,16,CB,6); g.fillStyle(0xffffff,1); g.fillCircle(CB,5,3);
    });

    // iron_forge (Bulwark): industrial forge
    bake('building_iron_forge', B, B, g => {
      g.fillStyle(0x777777,1); g.fillRoundedRect(4,20,56,42,3);
      g.lineStyle(2.5,0xffffff,1); g.strokeRoundedRect(4,20,56,42,3);
      // 3 chimney stacks
      for(let i=0;i<3;i++){
        g.fillStyle(0x888888,1); g.fillRect(12+i*16,4,10,18); g.lineStyle(2,0xffffff,0.9); g.strokeRect(12+i*16,4,10,18);
        g.fillStyle(0x666666,0.7); g.fillCircle(17+i*16,2,6); g.lineStyle(1,0xffffff,0.5); g.strokeCircle(17+i*16,2,6);
      }
      // anvil silhouette
      g.fillStyle(0x333333,1); g.fillRect(CB-12,28,24,6); g.fillRect(CB-8,34,16,4); g.fillRect(CB-5,38,10,6);
      // gear wheel
      g.lineStyle(2,0xffffff,0.7); g.strokeCircle(50,38,8);
      for(let i=0;i<6;i++){const a=(Math.PI/3)*i; g.lineBetween(50+6*Math.cos(a),38+6*Math.sin(a),50+10*Math.cos(a),38+10*Math.sin(a));}
      g.fillStyle(0x333333,1); g.fillCircle(50,38,4);
      // forge entrance
      g.fillStyle(0x111111,1); g.fillRect(CB-10,42,20,20); g.fillCircle(CB,42,10);
      g.lineStyle(1.5,0xffffff,0.8); g.strokeCircle(CB,42,10);
    });

    // shadow_academy (Unseen): dark shadow tower
    bake('building_shadow_academy', B, B, g => {
      g.fillStyle(0x333333,1); g.fillRoundedRect(16,10,32,52,3);
      g.lineStyle(2.5,0xffffff,1); g.strokeRoundedRect(16,10,32,52,3);
      // pointed cap
      g.fillStyle(0x222222,1); g.fillTriangle(14,10,50,10,CB,-8);
      g.lineStyle(2,0xffffff,0.9); g.strokeTriangle(14,10,50,10,CB,-8);
      // spiral arcs
      g.lineStyle(1.5,0xffffff,0.4);
      g.beginPath(); g.arc(CB,24,10,-0.3,Math.PI*0.7,false); g.strokePath();
      g.beginPath(); g.arc(CB,38,10,Math.PI*0.5,Math.PI*1.5,false); g.strokePath();
      g.beginPath(); g.arc(CB,52,10,-0.5,Math.PI*0.6,false); g.strokePath();
      // void eye
      g.fillStyle(0x111111,1); g.fillEllipse(CB,18,14,8);
      g.lineStyle(1.5,0xffffff,0.85); g.strokeEllipse(CB,18,14,8);
      g.fillStyle(0xffffff,0.9); g.fillCircle(CB,18,2.5);
      // shadow aura
      g.lineStyle(1,0xffffff,0.15); g.strokeCircle(CB,B+2,14); g.strokeCircle(CB,B+2,22);
    });

    // ── Shrines (2×2 = 64×64) ─────────────────────────────────────────────────

    // shrine_hope (Architects): tech energy altar
    bake('building_shrine_hope', B, B, g => {
      const hexPts=(cx:number,cy:number,r:number)=>{const p=[];for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6;p.push({x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)});}return p;};
      g.fillStyle(0x666666,1); g.fillPoints(hexPts(CB,CB+6,24),true);
      g.lineStyle(2.5,0xffffff,1); g.strokePoints(hexPts(CB,CB+6,24),true);
      g.fillStyle(0x222222,1); g.fillPoints(hexPts(CB,CB+6,12),true);
      g.lineStyle(2,0xffffff,0.7); g.strokeEllipse(CB,CB+6,48,14);
      g.fillStyle(0xffffff,1); g.fillCircle(CB,CB+6,7);
      g.lineStyle(1.5,0xffffff,0.5); g.strokeCircle(CB,CB+6,12);
      g.lineStyle(2,0xffffff,0.6);
      for(let i=0;i<3;i++){const a=(Math.PI*2/3)*i-Math.PI/2; g.lineBetween(CB+14*Math.cos(a),CB+6+14*Math.sin(a),CB+22*Math.cos(a),CB+6+22*Math.sin(a));}
      g.lineStyle(1,0xffffff,0.4); g.lineBetween(CB-22,8,CB+22,8);
    });

    // shrine_ellie (Covenant): healing oracle chapel
    bake('building_shrine_ellie', B, B, g => {
      g.fillStyle(0x888888,1); g.fillRect(10,34,44,28);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(10,34,44,28);
      g.fillStyle(0x999999,1); g.fillTriangle(8,34,56,34,CB,8);
      g.lineStyle(2,0xffffff,1); g.strokeTriangle(8,34,56,34,CB,8);
      g.lineStyle(2.5,0xffffff,0.85); g.strokeCircle(CB,24,12);
      g.lineStyle(1,0xffffff,0.35); g.strokeCircle(CB,24,17); g.strokeCircle(CB,24,21);
      g.lineStyle(3,0x000000,0.75); g.lineBetween(CB,12,CB,36); g.lineBetween(CB-10,22,CB+10,22);
      g.fillStyle(0xffffff,0.7); g.fillCircle(CB-12,44,3); g.fillCircle(CB,42,4); g.fillCircle(CB+12,44,3);
      g.fillStyle(0x111111,1); g.fillRect(CB-7,48,14,14); g.fillCircle(CB,48,7);
    });

    // shrine_anna (Bulwark): census stone monument
    bake('building_shrine_anna', B, B, g => {
      g.fillStyle(0x777777,1); g.fillRect(6,46,52,16);
      g.lineStyle(2.5,0xffffff,1); g.strokeRect(6,46,52,16);
      g.fillStyle(0x888888,1); g.fillRoundedRect(CB-14,12,28,36,3);
      g.lineStyle(2.5,0xffffff,1); g.strokeRoundedRect(CB-14,12,28,36,3);
      g.lineStyle(1.5,0xffffff,0.6); for(let i=0;i<3;i++) g.lineBetween(CB-8,20+i*10,CB+8,20+i*10);
      g.lineStyle(2,0x000000,0.6); g.lineBetween(CB-6,14,CB+6,42); g.lineBetween(CB+6,14,CB-6,42);
      g.fillStyle(0xffffff,0.8); g.fillRect(CB-16,8,32,6);
      // corner torches
      g.lineStyle(2,0xffffff,0.9); g.lineBetween(8,12,8,48); g.lineBetween(56,12,56,48);
      g.fillStyle(0xffffff,0.9); g.fillCircle(8,10,4); g.fillCircle(56,10,4);
    });

    // shrine_olivia (Unseen): dark ordinance altar
    bake('building_shrine_olivia', B, B, g => {
      g.fillStyle(0x333333,1); g.fillRect(4,42,56,22);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(4,42,56,22);
      g.fillStyle(0x222222,1); g.fillRoundedRect(CB-14,20,28,24,3);
      g.lineStyle(2,0xffffff,0.8); g.strokeRoundedRect(CB-14,20,28,24,3);
      g.fillStyle(0x555555,1); g.fillCircle(CB,28,8);
      g.lineStyle(2,0xffffff,0.9); g.strokeCircle(CB,28,8);
      g.lineStyle(2,0xffffff,0.8); g.lineBetween(CB+4,20,CB+9,10);
      g.fillStyle(0xffffff,1); g.fillCircle(CB+9,9,2.5);
      g.lineStyle(1.5,0xffffff,0.4); g.lineBetween(CB-14,20,CB+14,44); g.lineBetween(CB+14,20,CB-14,44);
      g.lineStyle(1,0xffffff,0.3); g.strokeCircle(CB,56,8); g.lineBetween(CB-8,56,CB+8,56); g.lineBetween(CB,48,CB,64);
    });

    // ── Specialty buildings ────────────────────────────────────────────────────

    // pylon (Architects, 1×1 = 32×32)
    const T = 32, CT = 16;
    bake('building_pylon', T, T, g => {
      g.fillStyle(0x888888,1); g.fillRect(CT-3,6,6,18);
      g.lineStyle(1.5,0xffffff,1); g.strokeRect(CT-3,6,6,18);
      g.fillStyle(0xffffff,1); g.fillCircle(CT,5,5);
      g.lineStyle(1,0xffffff,0.5); g.strokeCircle(CT,5,7);
      g.lineStyle(1.5,0xffffff,0.7); g.strokeEllipse(CT,14,28,8);
      g.lineStyle(1,0xffffff,0.35); g.strokeEllipse(CT,12,22,16);
      g.fillStyle(0x777777,1); g.fillRoundedRect(4,22,24,7,2);
      g.lineStyle(1.5,0xffffff,0.8); g.strokeRoundedRect(4,22,24,7,2);
    });

    // sentinel_turret (Architects, 1×1 = 32×32)
    bake('building_sentinel_turret', T, T, g => {
      g.fillStyle(0x666666,1); g.fillCircle(CT,CT+4,12);
      g.lineStyle(2,0xffffff,0.9); g.strokeCircle(CT,CT+4,12);
      g.fillStyle(0x888888,1); g.fillCircle(CT,CT,8);
      g.lineStyle(2,0xffffff,1); g.strokeCircle(CT,CT,8);
      g.lineStyle(4,0xffffff,1); g.lineBetween(CT+6,CT-1,CT+22,CT-3);
      g.fillStyle(0xffffff,0.9); g.fillCircle(CT+12,CT-1,2.5);
      g.fillStyle(0xffffff,1); g.fillRect(CT+20,CT-4,4,3);
      g.lineStyle(1.5,0xffffff,0.6); g.lineBetween(CT-4,CT-8,CT+2,CT-2);
    });

    // fabrication_hall (Architects, 2×2 = 64×64)
    bake('building_fabrication_hall', B, B, g => {
      g.fillStyle(0x777777,1); g.fillRect(2,14,60,48);
      g.lineStyle(3,0xffffff,1); g.strokeRect(2,14,60,48);
      // barrel-vault roof
      g.fillStyle(0x888888,1); g.fillCircle(CB,14,28); g.fillRect(4,14,56,10);
      // overhead crane
      g.lineStyle(3,0xffffff,1); g.lineBetween(10,20,54,20);
      g.lineStyle(2,0xffffff,0.9); g.lineBetween(38,20,38,32);
      g.beginPath(); g.arc(36,32,2,0,Math.PI,false); g.strokePath();
      // conveyor lines
      g.lineStyle(1,0xffffff,0.3); g.lineBetween(6,30,58,30); g.lineBetween(6,40,58,40); g.lineBetween(6,50,58,50);
      // power conduit
      g.lineStyle(2,0xffffff,0.7); g.lineBetween(6,18,6,62);
      // bay door
      g.fillStyle(0x222222,1); g.fillRect(CB-14,46,28,16);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(CB-14,46,28,16); g.lineBetween(CB,46,CB,62);
      // roof nodes
      g.fillStyle(0xffffff,0.9); g.fillCircle(14,10,3); g.fillCircle(CB,10,3); g.fillCircle(50,10,3);
    });

    // wellspring (Covenant, 2×2 = 64×64)
    bake('building_wellspring', B, B, g => {
      // concentric ripple rings
      g.fillStyle(0x666666,0.45); g.fillCircle(CB,CB+4,26);
      g.lineStyle(3,0xffffff,0.85); g.strokeCircle(CB,CB+4,26);
      g.lineStyle(2,0xffffff,0.55); g.strokeCircle(CB,CB+4,18);
      g.lineStyle(1.5,0xffffff,0.3); g.strokeCircle(CB,CB+4,10);
      // stone column
      g.fillStyle(0x888888,1); g.fillCircle(CB,CB+4,6); g.lineStyle(2,0xffffff,1); g.strokeCircle(CB,CB+4,6);
      // 4 light rays
      g.lineStyle(1.5,0xffffff,0.5);
      for(let i=0;i<4;i++){const a=(Math.PI/2)*i-Math.PI/4; g.lineBetween(CB+8*Math.cos(a),CB+4+8*Math.sin(a),CB+20*Math.cos(a),CB+4+20*Math.sin(a));}
      // healing cross
      g.lineStyle(2,0x000000,0.7); g.lineBetween(CB,CB-2,CB,CB+10); g.lineBetween(CB-5,CB+4,CB+5,CB+4);
      // 4 decorative pillars
      g.fillStyle(0x999999,1); g.fillRect(CB-2,4,4,8); g.fillRect(CB-2,B-12,4,8); g.fillRect(4,CB+2,8,4); g.fillRect(B-12,CB+2,8,4);
    });

    // shrine_of_unity (Covenant, 2×2 = 64×64)
    bake('building_shrine_of_unity', B, B, g => {
      // two pillars
      g.fillStyle(0x888888,1); g.fillRect(8,16,12,46); g.fillRect(44,16,12,46);
      g.lineStyle(2,0xffffff,1); g.strokeRect(8,16,12,46); g.strokeRect(44,16,12,46);
      // arch
      g.lineStyle(3.5,0xffffff,1);
      g.beginPath(); g.arc(CB,22,22,Math.PI,0,false); g.strokePath();
      g.fillStyle(0x777777,1); g.fillRect(8,16,48,8);
      g.lineStyle(3.5,0xffffff,1); g.lineBetween(8,16,56,16); g.lineBetween(8,24,56,24);
      // unity symbol
      g.lineStyle(2,0xffffff,0.85); g.strokeCircle(CB,44,12);
      g.lineStyle(1.5,0x000000,0.8); g.lineBetween(CB,32,CB,56); g.lineBetween(CB-12,44,CB+12,44);
      // capstone
      g.fillStyle(0xffffff,1); g.fillCircle(CB,2,4); g.lineStyle(1,0xffffff,0.5); g.strokeCircle(CB,2,7);
      // pillar capitals
      g.fillStyle(0xffffff,0.8); g.fillRect(6,12,16,5); g.fillRect(42,12,16,5);
    });

    // garrison_post (Bulwark, 2×2 = 64×64)
    bake('building_garrison_post', B, B, g => {
      // base
      g.fillStyle(0x777777,1); g.fillRect(14,44,36,20);
      g.lineStyle(2.5,0xffffff,1); g.strokeRect(14,44,36,20);
      // tower shaft
      g.fillStyle(0x888888,1); g.fillRect(20,12,24,34);
      g.lineStyle(2.5,0xffffff,1); g.strokeRect(20,12,24,34);
      // arrow slits
      g.fillStyle(0x111111,1); g.fillRect(26,20,5,12); g.fillRect(33,20,5,12);
      // battlements
      g.fillStyle(0x999999,1); g.fillRect(18,4,8,10); g.fillRect(28,4,8,10); g.fillRect(38,4,8,10);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(18,4,8,10); g.strokeRect(28,4,8,10); g.strokeRect(38,4,8,10);
      // entrance
      g.fillStyle(0x222222,1); g.fillRect(CB-7,52,14,12); g.fillCircle(CB,52,7);
      // flag
      g.lineStyle(2,0xffffff,1); g.lineBetween(CB,0,CB,6);
      g.fillStyle(0xffffff,0.9); g.fillTriangle(CB,0,CB+10,2,CB,5);
    });

    // shade_spire (Unseen, 2×2 = 64×64)
    bake('building_shade_spire', B, B, g => {
      // shadow aura waves
      g.lineStyle(1,0xffffff,0.12); g.strokeCircle(CB,B,28);
      g.lineStyle(1,0xffffff,0.18); g.strokeCircle(CB,B,20);
      g.lineStyle(1,0xffffff,0.25); g.strokeCircle(CB,B,12);
      // base block
      g.fillStyle(0x333333,1); g.fillRect(CB-12,50,24,14);
      g.lineStyle(2,0xffffff,0.8); g.strokeRect(CB-12,50,24,14);
      // spire shaft
      g.fillStyle(0x222222,1); g.fillRect(CB-6,8,12,44);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(CB-6,8,12,44);
      // tapered tip
      g.fillStyle(0x111111,1); g.fillTriangle(CB-6,8,CB+6,8,CB,-6);
      g.lineStyle(2,0xffffff,1); g.strokeTriangle(CB-6,8,CB+6,8,CB,-6);
      // void tendrils
      g.lineStyle(1.5,0xffffff,0.3);
      g.beginPath(); g.arc(CB-18,28,16,-0.4,Math.PI*0.4,false); g.strokePath();
      g.beginPath(); g.arc(CB+18,38,16,Math.PI*0.6,Math.PI*1.4,false); g.strokePath();
      // energy crackles
      g.lineStyle(1,0xffffff,0.6); g.lineBetween(CB,8,CB-5,16); g.lineBetween(CB,8,CB+5,18);
      // void eye
      g.fillStyle(0x000000,1); g.fillEllipse(CB,30,8,5);
      g.lineStyle(1,0xffffff,0.7); g.strokeEllipse(CB,30,8,5);
      g.fillStyle(0xffffff,0.8); g.fillCircle(CB,30,1.5);
    });

    // void_citadel (Unseen, 2×2 = 64×64)
    bake('building_void_citadel', B, B, g => {
      // dark flanking pylons
      g.fillStyle(0x333333,1); g.fillRect(4,22,14,42); g.fillRect(46,22,14,42);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(4,22,14,42); g.strokeRect(46,22,14,42);
      // pylon energy nodes
      g.fillStyle(0xffffff,1); g.fillCircle(11,22,5); g.fillCircle(53,22,5);
      g.lineStyle(1.5,0xffffff,0.5); g.strokeCircle(11,22,8); g.strokeCircle(53,22,8);
      // portal frame arch
      g.lineStyle(3,0xffffff,1);
      g.lineBetween(18,B,18,22); g.lineBetween(46,B,46,22);
      g.beginPath(); g.arc(CB,22,28,Math.PI,0,false); g.strokePath();
      // void interior
      g.fillStyle(0x111111,1); g.fillRect(18,22,28,42); g.fillCircle(CB,22,14);
      // void energy cross-lines
      g.lineStyle(1,0xffffff,0.22); g.lineBetween(22,30,42,52); g.lineBetween(42,30,22,52); g.lineBetween(CB,22,CB,64);
      // portal energy ring
      g.lineStyle(2,0xffffff,0.45); g.strokeEllipse(CB,CB+4,28,48);
      // top beam
      g.lineStyle(3,0xffffff,0.9); g.lineBetween(11,14,53,14);
    });

    // void_gate (Unseen, 1×1 tile — generated at 64×64 for sharpness, displayed at 32×32)
    bake('building_void_gate', B, B, g => {
      // outer glow ring
      g.lineStyle(3,0xffffff,0.25); g.strokeCircle(CB,CB,28);
      // bold main ring
      g.lineStyle(5,0xffffff,1); g.strokeCircle(CB,CB,22);
      // void interior fill
      g.fillStyle(0x0a0a0a,1); g.fillCircle(CB,CB,20);
      // 4 bold energy nodes at cardinal points
      g.fillStyle(0xffffff,1);
      g.fillCircle(CB,CB-22,4); g.fillCircle(CB,CB+22,4);
      g.fillCircle(CB-22,CB,4); g.fillCircle(CB+22,CB,4);
      // void energy arcs (visible at 64×64 res)
      g.lineStyle(2,0xffffff,0.5);
      g.beginPath(); g.arc(CB,CB,12,0,Math.PI*0.6,false); g.strokePath();
      g.beginPath(); g.arc(CB,CB,12,Math.PI,Math.PI*1.6,false); g.strokePath();
      // 4 bold radial lines from ring inward
      g.lineStyle(2,0xffffff,0.45);
      g.lineBetween(CB,CB-20,CB,CB-10);
      g.lineBetween(CB,CB+20,CB,CB+10);
      g.lineBetween(CB-20,CB,CB-10,CB);
      g.lineBetween(CB+20,CB,CB+10,CB);
      // bright core
      g.fillStyle(0xffffff,1); g.fillCircle(CB,CB,5);
      g.lineStyle(2,0xffffff,0.4); g.strokeCircle(CB,CB,9);
    });

    // bulwark_wall (Bulwark, 1×1 = 32×32)
    bake('building_bulwark_wall', T, T, g => {
      g.fillStyle(0x777777,1); g.fillRect(0,8,T,T-8);
      g.lineStyle(2,0xffffff,0.9); g.strokeRect(0,8,T,T-8);
      // crenellations
      g.fillStyle(0x888888,1); g.fillRect(0,0,8,10); g.fillRect(12,0,8,10); g.fillRect(24,0,8,10);
      g.lineStyle(1.5,0xffffff,0.8); g.strokeRect(0,0,8,10); g.strokeRect(12,0,8,10); g.strokeRect(24,0,8,10);
      // stone block seams
      g.lineStyle(1,0xffffff,0.22); g.lineBetween(0,18,T,18); g.lineBetween(0,26,T,26);
      g.lineBetween(8,10,8,18); g.lineBetween(24,10,24,18);
      g.lineBetween(16,18,16,26); g.lineBetween(0,26,0,T); g.lineBetween(8,26,8,T); g.lineBetween(24,26,24,T);
    });

    g.destroy();
  }
}
