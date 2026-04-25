import Phaser from 'phaser';
import { Building } from '@/buildings/Building';
import { ProducedUnitDef } from '@/buildings/definitions';
import { ResourceManager } from '@/economy/ResourceManager';

export class ProductionPanel {
  private scene: Phaser.Scene;
  private resources: ResourceManager;
  private activeBuilding: Building | null = null;
  /** All buildings in the current multi-selection (including activeBuilding). */
  private activeBuildings: Building[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  private lastGold = -1;
  private visible = false;
  private shrineRedrawCounter = 0;

  onUnitQueued: ((unitDef: ProducedUnitDef, building: Building) => void) | null = null;
  onShrineActivated: ((building: Building) => void) | null = null;
  onEjectWorkers: ((building: Building) => void) | null = null;

  /** Upgrade IDs that have already been purchased (injected by GameScene) */
  purchasedUpgrades: Set<string> = new Set();

  /** Set of player building def IDs currently on the map (injected by GameScene each frame). */
  playerBuildingIds: Set<string> = new Set();

  /** Returns current supply usage; injected by GameScene for cap enforcement. */
  getSupply: (() => { used: number; cap: number }) | null = null;

  /**
   * Returns null if a hero can be trained, or a string reason if blocked.
   * Injected by GameScene. Checked before hero unit buttons are enabled.
   */
  getHeroBlock: (() => string | null) | null = null;

  constructor(scene: Phaser.Scene, resources: ResourceManager) {
    this.scene = scene;
    this.resources = resources;
  }

  show(building: Building): void {
    this.showMulti([building]);
  }

  /** Show panel for one or more buildings of the same type. */
  showMulti(buildings: Building[]): void {
    if (buildings.length === 0) return;
    this.activeBuildings.forEach(b => b.highlight(false));
    this.activeBuildings = [...buildings];
    this.activeBuilding = buildings[0];
    this.visible = true;
    this.lastGold = -1;
    this.shrineRedrawCounter = 0;
    this.activeBuildings.forEach(b => b.highlight(true));
    this.draw();
  }

  hide(): void {
    this.activeBuildings.forEach(b => b.highlight(false));
    this.activeBuildings = [];
    this.activeBuilding = null;
    this.visible = false;
    this.clear();
  }

  getActiveBuilding(): Building | null {
    return this.activeBuilding;
  }

  update(): void {
    if (!this.visible) return;
    if (this.activeBuilding?.def.isShrine) {
      this.shrineRedrawCounter++;
      if (this.shrineRedrawCounter >= 10) { this.shrineRedrawCounter = 0; this.draw(); }
      return;
    }
    const g = this.resources.getGold();
    if (g !== this.lastGold) { this.lastGold = g; this.draw(); }
  }

  private clear(): void {
    this.objects.forEach(o => (o as Phaser.GameObjects.GameObject & { destroy(): void }).destroy());
    this.objects = [];
  }

  private push<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private draw(): void {
    this.clear();
    if (!this.activeBuilding) return;

    const def = this.activeBuilding.def;

    if (def.isShrine) { this.drawShrinePanel(); return; }
    if (def.id === 'mine') { this.drawMinePanel(); return; }
    if (!def.produces || def.produces.length === 0) return;

    // Unpowered Architects building — add warning banner to panel
    const unpowered = def.requiresPower && !this.activeBuilding.isPowered;

    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const cols = Math.min(def.produces.length, 4);
    const BTN_W = 76;
    const BTN_H = 52;
    const GAP = 8;
    const PAD = 10;
    // Queue row constants
    const Q_SLOTS = 5;
    const Q_SZ = 22;
    const Q_GAP = 5;
    const queueSnapshot = this.activeBuilding.getQueueSnapshot();
    const hasQueue = queueSnapshot.length > 0;
    const QUEUE_ROW_H = hasQueue ? Q_SZ + 8 : 0;
    const panelW = Math.max(
      cols * BTN_W + (cols - 1) * GAP + PAD * 2,
      Q_SLOTS * (Q_SZ + Q_GAP) + PAD * 2
    );
    const panelH = BTN_H + 50 + QUEUE_ROW_H;
    const panelX = 10;
    const panelY = H - panelH - 10;

    // Background
    const bg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(200));
    bg.fillStyle(0x06101e, 0.93);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1.5, 0x1e3050, 1);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);

    // Title — show count when multiple buildings are selected
    const bCount = this.activeBuildings.length;
    const queueTotal = this.activeBuildings.reduce((s, b) => s + b.getQueueLength(), 0);
    const titleStr = bCount > 1
      ? `${bCount}\u00d7 ${def.name}  [queued: ${queueTotal}]`
      : `${def.name}  [queue: ${this.activeBuilding.getQueueLength()}]`;
    this.push(
      this.scene.add.text(panelX + PAD, panelY + PAD, titleStr, {
        fontSize: '10px', color: bCount > 1 ? '#ffdd88' : '#8899bb', stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(201)
    );

    // ⚡ Unpowered warning strip
    if (unpowered) {
      this.push(
        this.scene.add.text(panelX + PAD, panelY + PAD + 14, '\u26a1 No power — build a Pylon nearby', {
          fontSize: '9px', color: '#ffaa00', stroke: '#000', strokeThickness: 2,
        }).setScrollFactor(0).setDepth(202)
      );
    }

    def.produces.forEach((unitDef, i) => {
      const bx = panelX + PAD + i * (BTN_W + GAP);
      const by = panelY + 28;
      const isPurchased = unitDef.isUpgrade && this.purchasedUpgrades.has(unitDef.id);
      // Tech prerequisite check — Tier II/III require Tier I/II to be researched first
      const prereqMet = !unitDef.prerequisite || this.purchasedUpgrades.has(unitDef.prerequisite);
      // Building requirement check — unit requires a specific building to be constructed
      const buildingReqMet = !unitDef.requiresBuilding || this.playerBuildingIds.has(unitDef.requiresBuilding);
      // Hero check — only one hero active at a time, 120s respawn on death
      const heroBlock = unitDef.isHero ? (this.getHeroBlock?.() ?? null) : null;
      const heroBlocked = heroBlock !== null;
      const allReqsMet = prereqMet && buildingReqMet && !heroBlocked;
      const canAfford = !isPurchased && allReqsMet
        && this.resources.getGold() >= unitDef.goldCost
        && this.resources.getJuice() >= (unitDef.juiceCost ?? 0);
      const supplyInfo = this.getSupply?.() ?? null;
      const supplyCapped = !unitDef.isUpgrade && supplyInfo !== null &&
        (supplyInfo.used + unitDef.supplyUsed > supplyInfo.cap);
      const enabled = canAfford && !isPurchased && !supplyCapped && allReqsMet;
      const isLocked = !isPurchased && !allReqsMet;

      // Determine lock tooltip text
      let lockReqName = '';
      if (heroBlocked) {
        lockReqName = heroBlock ?? '';
      } else if (!prereqMet) {
        const prereqDef = unitDef.prerequisite
          ? def.produces?.find(p => p.id === unitDef.prerequisite)
          : null;
        lockReqName = prereqDef?.name ?? '';
      } else if (!buildingReqMet) {
        lockReqName = unitDef.requiresBuildingName ?? unitDef.requiresBuilding ?? '';
      }

      const btnGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(201));
      const drawBtn = (hover: boolean) => {
        btnGfx.clear();
        const col = isPurchased ? 0x112211 : isLocked ? 0x0c0c14 : enabled ? (hover ? 0x1a3450 : 0x0e1e2e) : 0x0d0808;
        btnGfx.fillStyle(col, 1);
        btnGfx.fillRoundedRect(bx, by, BTN_W, BTN_H, 6);
        const border = isPurchased ? 0x224422 : isLocked ? 0x2a2a44 : enabled ? (hover ? 0x5599ff : 0x2255aa) : 0x331111;
        btnGfx.lineStyle(1.5, border, 1);
        btnGfx.strokeRoundedRect(bx, by, BTN_W, BTN_H, 6);
        // Lock icon overlay
        if (isLocked) {
          btnGfx.fillStyle(0x4444aa, 0.18);
          btnGfx.fillRoundedRect(bx, by, BTN_W, BTN_H, 6);
        }
      };
      drawBtn(false);

      const nameCol = isPurchased ? '#44aa44' : isLocked ? '#555577' : enabled ? '#ddeeff' : '#443333';
      this.push(this.scene.add.text(bx + BTN_W / 2, by + 5, unitDef.name, {
        fontSize: '9px', color: nameCol, stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0));

      // Lock symbol + req name (replaces cost line when locked)
      if (isLocked) {
        this.push(this.scene.add.text(bx + BTN_W / 2, by + 19, '\uD83D\uDD12', {
          fontSize: '10px', color: '#556688', stroke: '#000', strokeThickness: 1,
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0));
        if (lockReqName) {
          this.push(this.scene.add.text(bx + BTN_W / 2, by + 33, `Req: ${lockReqName}`, {
            fontSize: '7px', color: '#445566', stroke: '#000', strokeThickness: 1,
            wordWrap: { width: BTN_W - 4 },
          }).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0));
        }
      } else {
        const costText = isPurchased ? 'Done' : supplyCapped ? 'Supply!' : `${unitDef.goldCost}g`;
        const costCol = isPurchased ? '#44aa44' : supplyCapped ? '#ff4444' : canAfford ? '#ffd700' : '#664444';
        this.push(this.scene.add.text(bx + BTN_W / 2, by + 19, costText, {
          fontSize: '9px', color: costCol, stroke: '#000', strokeThickness: 2,
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0));

        if (unitDef.juiceCost) {
          const juiceAfford = this.resources.getJuice() >= unitDef.juiceCost;
          this.push(this.scene.add.text(bx + BTN_W / 2, by + 29, `+${unitDef.juiceCost}j`, {
            fontSize: '8px', color: juiceAfford ? '#cc88ff' : '#664466', stroke: '#000', strokeThickness: 2,
          }).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0));
        }

        this.push(this.scene.add.text(bx + BTN_W / 2, by + (unitDef.juiceCost ? 39 : 32), `${(unitDef.productionMs / 1000).toFixed(0)}s`, {
          fontSize: '9px', color: '#667788', stroke: '#000', strokeThickness: 2,
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0));
      }

      if (enabled) {
        const hit = this.push(
          this.scene.add.rectangle(bx + BTN_W / 2, by + BTN_H / 2, BTN_W, BTN_H, 0, 0)
            .setScrollFactor(0).setDepth(203).setInteractive().setOrigin(0.5)
        );
        hit.on('pointerover',  () => drawBtn(true));
        hit.on('pointerout',   () => drawBtn(false));
        hit.on('pointerdown', (_pointer: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          // Queue in all selected buildings (each costs full gold + juice)
          const buildingsToQueue = this.activeBuildings.filter(b => !b.isDestroyed());
          const totalGold  = unitDef.goldCost  * buildingsToQueue.length;
          const totalJuice = (unitDef.juiceCost ?? 0) * buildingsToQueue.length;
          if (this.resources.spend(totalGold, totalJuice)) {
            buildingsToQueue.forEach(b => {
              b.queueUnit(unitDef);
              this.onUnitQueued?.(unitDef, b);
            });
            this.draw();
          }
        });
      }
    });

    // ── Queue display ────────────────────────────────────────────────────────
    if (hasQueue) {
      const qRowY = panelY + 28 + BTN_H + 6;
      for (let qi = 0; qi < Q_SLOTS; qi++) {
        const qx = panelX + PAD + qi * (Q_SZ + Q_GAP);
        const qy = qRowY;
        const entry = queueSnapshot[qi];

        const slotGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(202));
        slotGfx.fillStyle(0x0a1520, 1);
        slotGfx.fillRoundedRect(qx, qy, Q_SZ, Q_SZ, 4);
        slotGfx.lineStyle(1, entry ? 0x2244aa : 0x1a2030, 1);
        slotGfx.strokeRoundedRect(qx, qy, Q_SZ, Q_SZ, 4);

        if (entry) {
          // Progress arc (only for item 0)
          if (qi === 0 && entry.progress > 0) {
            const cx = qx + Q_SZ / 2;
            const cy = qy + Q_SZ / 2;
            const r  = Q_SZ / 2 - 2;
            // Grey bg arc
            slotGfx.lineStyle(2, 0x333344, 1);
            slotGfx.beginPath();
            slotGfx.arc(cx, cy, r, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(270), false);
            slotGfx.strokePath();
            // Coloured progress arc
            slotGfx.lineStyle(2, 0x44aaff, 1);
            slotGfx.beginPath();
            slotGfx.arc(
              cx, cy, r,
              Phaser.Math.DegToRad(-90),
              Phaser.Math.DegToRad(-90 + 360 * entry.progress),
              false
            );
            slotGfx.strokePath();
          }
          // Unit initial
          const initial = entry.unitDef.name[0].toUpperCase();
          this.push(this.scene.add.text(qx + Q_SZ / 2, qy + Q_SZ / 2, initial, {
            fontSize: '10px', color: qi === 0 ? '#88ccff' : '#5577aa',
            stroke: '#000', strokeThickness: 2,
          }).setScrollFactor(0).setDepth(203).setOrigin(0.5));

          // Click to cancel
          const hitQ = this.push(
            this.scene.add.rectangle(qx + Q_SZ / 2, qy + Q_SZ / 2, Q_SZ, Q_SZ, 0, 0)
              .setScrollFactor(0).setDepth(204).setInteractive().setOrigin(0.5)
          );
          hitQ.on('pointerover', () => {
            slotGfx.fillStyle(0x331111, 0.6);
            slotGfx.fillRoundedRect(qx, qy, Q_SZ, Q_SZ, 4);
          });
          hitQ.on('pointerout', () => {
            slotGfx.fillStyle(0x0a1520, 1);
            slotGfx.fillRoundedRect(qx, qy, Q_SZ, Q_SZ, 4);
          });
          const capturedIdx = qi;
          hitQ.on('pointerdown', (_p: unknown, _lx: unknown, _ly: unknown, ev: Phaser.Types.Input.EventData) => {
            ev.stopPropagation();
            const refund = this.activeBuilding!.cancelQueueItem(capturedIdx);
            if (refund > 0) {
              this.resources.addGold(refund);
              // Also reverse the supply increment for non-upgrade units
              const cancelledDef = queueSnapshot[capturedIdx]?.unitDef;
              if (cancelledDef && !cancelledDef.isUpgrade) {
                this.onUnitQueued?.(cancelledDef, this.activeBuilding!);
                // Signal cancellation via negative supply — handled by caller
                // We emit a custom event instead
                this.scene.events.emit('production:cancelled', cancelledDef);
              }
            }
            this.draw();
          });
        }
      }
    }

  }

  private drawMinePanel(): void {
    const building = this.activeBuilding!;
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const panelW = 220;
    const panelH = 86;
    const panelX = 10;
    const panelY = H - panelH - 10;
    const pad = 12;

    const bg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(200));
    bg.fillStyle(0x06101e, 0.93);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1.5, 0x1e3050, 1);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);

    const garrison = building.garrisonCount;
    const max = building.garrisonMax;
    this.push(this.scene.add.text(panelX + pad, panelY + pad,
      `Mine  [⛏ ${garrison}/${max} workers]`, {
        fontSize: '10px', color: '#8899bb', stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(201));

    this.push(this.scene.add.text(panelX + pad, panelY + pad + 14,
      `Collection rate: ${(1 + garrison * 0.3).toFixed(1)}x`, {
        fontSize: '9px', color: '#556677', stroke: '#000', strokeThickness: 1,
      }).setScrollFactor(0).setDepth(201));

    // Eject button
    const btnX = panelX + pad;
    const btnY = panelY + panelH - 34;
    const btnW = panelW - pad * 2;
    const btnH = 24;
    const canEject = garrison > 0;

    const btnGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(201));
    const drawBtn = (hover: boolean) => {
      btnGfx.clear();
      const col = canEject ? (hover ? 0x3a2010 : 0x221008) : 0x0a0a0a;
      btnGfx.fillStyle(col, 1);
      btnGfx.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
      btnGfx.lineStyle(1.5, canEject ? (hover ? 0xff9944 : 0xaa5522) : 0x222222, 1);
      btnGfx.strokeRoundedRect(btnX, btnY, btnW, btnH, 5);
    };
    drawBtn(false);

    const label = canEject ? `Eject ${garrison} worker${garrison > 1 ? 's' : ''}` : 'No workers inside';
    this.push(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2, label, {
      fontSize: '9px', color: canEject ? '#ffaa66' : '#334455', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5));

    if (canEject) {
      const hit = this.push(
        this.scene.add.rectangle(btnX + btnW / 2, btnY + btnH / 2, btnW, btnH, 0, 0)
          .setScrollFactor(0).setDepth(203).setInteractive().setOrigin(0.5)
      );
      hit.on('pointerover',  () => drawBtn(true));
      hit.on('pointerout',   () => drawBtn(false));
      hit.on('pointerdown', (_pointer: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.onEjectWorkers?.(building);
        this.draw(); // refresh garrison count
      });
    }

  }

  private drawShrinePanel(): void {
    const building = this.activeBuilding!;
    const def = building.def;
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const panelW = 280;
    const panelH = 110;
    const panelX = 10;
    const panelY = H - panelH - 10;
    const pad = 12;

    const bg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(200));
    bg.fillStyle(0x06101e, 0.93);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1.5, 0x1e3050, 1);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);

    this.push(this.scene.add.text(panelX + pad, panelY + pad, def.name, {
      fontSize: '10px', color: '#8899bb', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(201));

    this.push(this.scene.add.text(panelX + pad, panelY + pad + 14, def.description ?? '', {
      fontSize: '8px', color: '#556677', stroke: '#000', strokeThickness: 1,
      wordWrap: { width: panelW - pad * 2 },
    }).setScrollFactor(0).setDepth(201));

    const ready = building.isAbilityReady();
    const cooldownPct = building.getAbilityCooldownPct();

    // Activate button
    const btnX = panelX + pad;
    const btnY = panelY + panelH - 36;
    const btnW = panelW - pad * 2;
    const btnH = 26;

    const btnGfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(201));
    const drawBtn = (hover: boolean) => {
      btnGfx.clear();
      if (ready) {
        btnGfx.fillStyle(hover ? 0x2a4a20 : 0x1a3010, 1);
        btnGfx.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
        btnGfx.lineStyle(1.5, hover ? 0x66ff44 : 0x44bb22, 1);
        btnGfx.strokeRoundedRect(btnX, btnY, btnW, btnH, 5);
      } else {
        btnGfx.fillStyle(0x0a0a0a, 1);
        btnGfx.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
        btnGfx.lineStyle(1, 0x223322, 1);
        btnGfx.strokeRoundedRect(btnX, btnY, btnW, btnH, 5);
        // Cooldown fill
        if (cooldownPct > 0) {
          const fillW = (1 - cooldownPct) * btnW;
          btnGfx.fillStyle(0x1a3010, 1);
          btnGfx.fillRoundedRect(btnX, btnY, fillW, btnH, 5);
        }
      }
    };
    drawBtn(false);

    const abilityLabel = ready ? `ACTIVATE — ${def.passiveLabel ?? 'Ability'}` : `${def.passiveLabel ?? 'Ability'} — Cooldown`;
    const abilityCol = ready ? '#88ff66' : '#445544';
    this.push(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2, abilityLabel, {
      fontSize: '9px', color: abilityCol, stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5));

    if (ready) {
      const hit = this.push(
        this.scene.add.rectangle(btnX + btnW / 2, btnY + btnH / 2, btnW, btnH, 0, 0)
          .setScrollFactor(0).setDepth(203).setInteractive().setOrigin(0.5)
      );
      hit.on('pointerover',  () => drawBtn(true));
      hit.on('pointerout',   () => drawBtn(false));
      hit.on('pointerdown', (_pointer: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.onShrineActivated?.(building);
        this.draw(); // refresh to show cooldown
      });
    }

    building.highlight(true);
  }
}
