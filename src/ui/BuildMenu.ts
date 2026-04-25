import Phaser from 'phaser';
import { BuildingDef, MINE_DEF, JUICE_COLLECTOR_DEF } from '@/buildings/definitions';
import { ResourceManager } from '@/economy/ResourceManager';
import { ResourceNode } from '@/economy/ResourceNode';

const BTN_SIZE  = 72;
const PADDING   = 14;
const GAP       = 10;
const LABEL_H   = 36;
const DOCK_RADIUS = 16;

export class BuildMenu {
  private scene: Phaser.Scene;
  private resources: ResourceManager;
  private raceBuildings: BuildingDef[];
  private resourceNodes: ResourceNode[];

  private objects: Phaser.GameObjects.GameObject[] = [];
  private lastGold = -1;

  onBuildSelected: ((def: BuildingDef) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    resources: ResourceManager,
    raceBuildings: BuildingDef[],
    resourceNodes: ResourceNode[]
  ) {
    this.scene = scene;
    this.resources = resources;
    this.raceBuildings = raceBuildings;
    this.resourceNodes = resourceNodes;
    this.draw();
  }

  update(): void {
    const g = this.resources.getGold();
    if (g !== this.lastGold) { this.lastGold = g; this.draw(); }
  }

  // No-ops — dock is always visible and active
  show(): void {}
  hide(): void {}

  private clear(): void {
    this.objects.forEach(o => (o as Phaser.GameObjects.GameObject & { destroy(): void }).destroy());
    this.objects = [];
  }

  private push<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private text(x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.push(
      this.scene.add.text(x, y, str, style).setScrollFactor(0).setDepth(202)
    );
  }

  private hasNode(type: 'gold' | 'juice'): boolean {
    return this.resourceNodes.some(n => n.type === type && !n.isDepleted());
  }

  private draw(): void {
    this.clear();

    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    // Show all non-HQ race buildings + generic resource buildings
    const raceSpecific = this.raceBuildings.filter(d => !d.isHQ);
    const defs: BuildingDef[] = [...raceSpecific, MINE_DEF, JUICE_COLLECTOR_DEF];

    const dockW = defs.length * BTN_SIZE + (defs.length - 1) * GAP + PADDING * 2;
    const dockH = BTN_SIZE + LABEL_H + PADDING * 2;
    const dockX = Math.floor((W - dockW) / 2);
    const dockY = H - dockH - 10;

    // ── Dock background ──────────────────────────────────────────────────────
    const bg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(200));
    bg.fillStyle(0x080e1c, 0.90);
    bg.fillRoundedRect(dockX, dockY, dockW, dockH, DOCK_RADIUS);
    bg.lineStyle(1.5, 0x1e3050, 1);
    bg.strokeRoundedRect(dockX, dockY, dockW, dockH, DOCK_RADIUS);

    // ── Buttons ──────────────────────────────────────────────────────────────
    defs.forEach((def, i) => {
      const bx = dockX + PADDING + i * (BTN_SIZE + GAP);
      const by = dockY + PADDING;

      const gold = this.resources.getGold();
      const canAfford = gold >= def.goldCost;
      let nodeOk = true;
      if (def.resourceType === 'gold')  nodeOk = this.hasNode('gold');
      if (def.resourceType === 'juice') nodeOk = this.hasNode('juice');

      const enabled = canAfford && nodeOk;

      const accentCol = def.resourceType === 'gold'
        ? 0xffdd44 : def.resourceType === 'juice'
        ? 0xcc88ff : 0x4488ff;

      // Icon backing
      const iconGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(201));
      const drawIcon = (hover: boolean) => {
        iconGfx.clear();
        iconGfx.fillStyle(hover ? 0x1a3450 : (enabled ? 0x0e1e30 : 0x0a0a0a), 1);
        iconGfx.fillRoundedRect(bx, by, BTN_SIZE, BTN_SIZE, 8);
        if (enabled) {
          iconGfx.lineStyle(hover ? 2.5 : 1.5, accentCol, hover ? 1 : 0.65);
          iconGfx.strokeRoundedRect(bx, by, BTN_SIZE, BTN_SIZE, 8);
        } else {
          iconGfx.lineStyle(1, 0x222222, 1);
          iconGfx.strokeRoundedRect(bx, by, BTN_SIZE, BTN_SIZE, 8);
        }
      };
      drawIcon(false);

      // Building texture icon
      const img = this.push(
        this.scene.add.image(bx + BTN_SIZE / 2, by + BTN_SIZE / 2, def.textureKey)
          .setScrollFactor(0).setDepth(202)
          .setDisplaySize(52, 52)
          .setAlpha(enabled ? 1 : 0.25)
      );
      if (enabled && def.tint && def.tint !== 0xffffff) img.setTint(def.tint);

      // Name label
      this.text(bx + BTN_SIZE / 2, by + BTN_SIZE + 4, def.name, {
        fontSize: '9px', color: enabled ? '#c8d8f0' : '#2a3a4a',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5, 0);

      // Cost label
      const costColor = canAfford ? '#ffd700' : '#7a3333';
      this.text(bx + BTN_SIZE / 2, by + BTN_SIZE + 18, `${def.goldCost} gold`, {
        fontSize: '8px', color: costColor,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5, 0);

      // Invisible hit area + interaction
      if (enabled) {
        const hit = this.push(
          this.scene.add.rectangle(bx + BTN_SIZE / 2, by + BTN_SIZE / 2, BTN_SIZE, BTN_SIZE, 0, 0)
            .setScrollFactor(0).setDepth(203).setInteractive().setOrigin(0.5)
        );
        hit.on('pointerover',  () => { drawIcon(true);  img.setDisplaySize(58, 58); });
        hit.on('pointerout',   () => { drawIcon(false); img.setDisplaySize(52, 52); });
        hit.on('pointerdown',
          (_pointer: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
            event.stopPropagation();
            this.onBuildSelected?.(def);
          });
      }
    });
  }
}
