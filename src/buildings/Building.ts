import Phaser from 'phaser';
import { BuildingDef, ProducedUnitDef } from './definitions';
import { TILE_SIZE, Faction, MINE_COLLECTION_MS, MINE_COLLECTION_AMOUNT, JUICE_COLLECTION_MS, JUICE_COLLECTION_AMOUNT } from '@/constants';
import { ResourceNode } from '@/economy/ResourceNode';
import { ResourceManager } from '@/economy/ResourceManager';

interface QueueEntry {
  unitDef: ProducedUnitDef;
  elapsed: number;
}

export class Building {
  readonly def: BuildingDef;
  readonly tileX: number;
  readonly tileY: number;
  readonly id: string;
  readonly faction: Faction;

  private sprite: Phaser.GameObjects.Image;
  private healthBar: Phaser.GameObjects.Rectangle;
  private healthBarBg: Phaser.GameObjects.Rectangle;
  private scene: Phaser.Scene;

  health: number;
  private destroyed = false;
  private productionQueue: QueueEntry[] = [];
  private progressBar: Phaser.GameObjects.Rectangle | null = null;
  private progressBarBg: Phaser.GameObjects.Rectangle | null = null;

  // Auto-collection (Mine / Juice Collector)
  private linkedNode: ResourceNode | null = null;
  private linkedResources: ResourceManager | null = null;
  private collectionTimer: number = 0;

  // Worker garrison (mines accept up to 10 workers to boost collection rate)
  garrisonCount: number = 0;
  readonly garrisonMax: number = 0;
  private garrisonLabel: Phaser.GameObjects.Text | null = null;

  // Shrine ability cooldown
  private shrineAbilityCooldownRemaining: number = 0;

  // Disabled / hacked state
  private disabledRemaining: number = 0;
  private hackedVisuals: Phaser.GameObjects.GameObject[] = [];

  /** Flat damage reduction applied when this building takes a hit (Bulwark Fortify). */
  armorBonus: number = 0;
  /** True while protected by an Aegis Shield — cannot take damage. */
  isAegisShielded: boolean = false;
  /** Whether this building is currently cloaked (Unseen Cloak Field). */
  private isCloaked = false;

  /**
   * Fog-of-war visibility — set externally by GameScene each frame.
   * When false, the building's sprites are hidden and it cannot be auto-targeted.
   */
  fogVisible: boolean = true;

  /**
   * True once this enemy building has been seen by the player at least once.
   * Used by GameScene to decide whether to show a fog-memory ghost.
   */
  hasBeenSeen: boolean = false;
  /** True while a semi-transparent fog-memory ghost is being shown. */
  private fogMemoryShown: boolean = false;

  // Damage smoke
  private smokeActive = false;
  private smokeTimerEvent: Phaser.Time.TimerEvent | null = null;

  // Finn (Bulwark) construction delay — building is unusable until fully built
  private constructionRemaining: number = 0;
  private constructionSite: Phaser.GameObjects.Graphics | null = null;
  private constructionBar: Phaser.GameObjects.Rectangle | null = null;
  private constructionBarBg: Phaser.GameObjects.Rectangle | null = null;

  // ── Architects Pylon Power Grid ────────────────────────────────────────────
  /**
   * For Architects buildings with `requiresPower`: set externally by GameScene
   * each frame. When false, production is suspended and an ⚡ indicator shown.
   */
  isPowered: boolean = true;
  private unpoweredLabel: Phaser.GameObjects.Text | null = null;
  /** Pulsing ring drawn for Pylon buildings (and architects HQ). */
  private pylonRingGfx: Phaser.GameObjects.Graphics | null = null;

  onUnitProduced: ((unitDef: ProducedUnitDef, spawnTileX: number, spawnTileY: number) => void) | null = null;
  onDestroyed: (() => void) | null = null;
  onCollectionTick: ((amount: number, worldX: number, worldY: number) => void) | null = null;

  constructor(scene: Phaser.Scene, def: BuildingDef, tileX: number, tileY: number, id: string, faction: Faction = 'player') {
    this.faction = faction;
    this.scene = scene;
    this.def = def;
    this.tileX = tileX;
    this.tileY = tileY;
    this.id = id;
    this.health = def.maxHealth;

    // Garrison support for mines
    if (def.id === 'mine') {
      (this as { garrisonMax: number }).garrisonMax = 10;
    }

    // Built-in armor (e.g. Bulwark wall segments)
    if (def.baseArmor) {
      this.armorBonus = def.baseArmor;
    }

    // Centre the sprite on the building footprint
    const worldX = (tileX + def.tileWidth / 2) * TILE_SIZE;
    const worldY = (tileY + def.tileHeight / 2) * TILE_SIZE;

    const spriteW = def.tileWidth * TILE_SIZE;
    const spriteH = def.tileHeight * TILE_SIZE;

    this.sprite = scene.add.image(worldX, worldY, def.textureKey);
    this.sprite.setDisplaySize(spriteW, spriteH);
    this.sprite.setTint(def.tint);
    this.sprite.setDepth(8);
    this.sprite.setInteractive();
    this.sprite.on('pointerdown', (_pointer: unknown, _lx: unknown, _ly: unknown, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      scene.events.emit('building:clicked', this);
    });

    // Wall segment: draw a thick border + crosshatch to distinguish from regular buildings
    if (def.isWall) {
      const wallGfx = scene.add.graphics().setDepth(9);
      wallGfx.lineStyle(2, 0xffa060, 0.9);
      wallGfx.strokeRect(worldX - spriteW / 2 + 1, worldY - spriteH / 2 + 1, spriteW - 2, spriteH - 2);
      // Horizontal mortar lines
      const rows = def.tileHeight + 1;
      for (let r = 1; r < rows; r++) {
        const ly = worldY - spriteH / 2 + r * (spriteH / rows);
        wallGfx.lineStyle(1, 0x884422, 0.6);
        wallGfx.beginPath();
        wallGfx.moveTo(worldX - spriteW / 2 + 2, ly);
        wallGfx.lineTo(worldX + spriteW / 2 - 2, ly);
        wallGfx.strokePath();
      }
      // Vertical mortar lines per row
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2 === 0) ? 0.25 : 0.75;
        const lx = worldX - spriteW / 2 + offset * spriteW;
        const y0 = worldY - spriteH / 2 + r * (spriteH / rows);
        const y1 = worldY - spriteH / 2 + (r + 1) * (spriteH / rows);
        wallGfx.lineStyle(1, 0x884422, 0.6);
        wallGfx.beginPath();
        wallGfx.moveTo(lx, y0 + 1);
        wallGfx.lineTo(lx, y1 - 1);
        wallGfx.strokePath();
      }
      // Armor badge
      scene.add.text(worldX, worldY, `🛡${def.baseArmor ?? 0}`, {
        fontSize: '9px', color: '#ffcc88', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(11);
    }

    // Health bar — always visible
    this.healthBarBg = scene.add.rectangle(worldX, worldY - spriteH / 2 - 6, spriteW, 4, 0x333333).setDepth(9);
    this.healthBar   = scene.add.rectangle(worldX - spriteW / 2, worldY - spriteH / 2 - 6, spriteW, 4, 0x44ff44)
      .setOrigin(0, 0.5).setDepth(10);
    // Always show health bars for buildings
    this.healthBarBg.setVisible(true);
    this.healthBar.setVisible(true);

    // Passive label
    if (def.passiveLabel) {
      scene.add.text(worldX, worldY - spriteH / 2 - 14, def.passiveLabel, {
        fontSize: '9px', color: '#ffee88', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(11);
    }

    // Production progress bar (hidden until producing)
    if (def.produces && def.produces.length > 0) {
      this.progressBarBg = scene.add.rectangle(worldX, worldY + spriteH / 2 + 6, spriteW, 5, 0x333333).setDepth(9).setVisible(false);
      this.progressBar   = scene.add.rectangle(worldX - spriteW / 2, worldY + spriteH / 2 + 6, 0, 5, 0x4488ff)
        .setOrigin(0, 0.5).setDepth(10).setVisible(false);
    }

    // Garrison label for mines
    if (def.id === 'mine') {
      this.garrisonLabel = scene.add.text(worldX, worldY + 4, '', {
        fontSize: '11px', color: '#ffdd44', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(12);
    }

    // Construction placement animation (all non-HQ buildings)
    if (!def.isHQ) {
      this.startPlacementAnimation();
    }

    // Pylon power-field ring (Architects Pylon + HQ)
    if (def.isPylon && def.pylonRangePx) {
      const range = def.pylonRangePx;
      const ringGfx = scene.add.graphics().setDepth(4);
      const tintR = (def.tint >> 16) & 0xff;
      const tintG = (def.tint >>  8) & 0xff;
      const tintB =  def.tint        & 0xff;
      const drawRing = (alpha: number) => {
        ringGfx.clear();
        ringGfx.lineStyle(1.5, def.tint, alpha);
        ringGfx.strokeCircle(worldX, worldY, range);
        // Subtle inner fill
        ringGfx.fillStyle((tintR << 16) | (tintG << 8) | tintB, alpha * 0.05);
        ringGfx.fillCircle(worldX, worldY, range);
      };
      drawRing(0.25);
      scene.tweens.add({
        targets: { alpha: 0.25 },
        alpha: 0.6,
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: (tween) => { drawRing(tween.getValue() as number); },
      });
      this.pylonRingGfx = ringGfx;
    }

    // ⚡ unpowered indicator (Architects buildings with requiresPower)
    if (def.requiresPower) {
      this.unpoweredLabel = scene.add.text(worldX, worldY - spriteH / 2 - 24, '', {
        fontSize: '14px', color: '#ffee44', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(13).setVisible(false);
    }
  }

  linkResourceNode(node: ResourceNode, resources: ResourceManager): void {
    this.linkedNode = node;
    this.linkedResources = resources;
    this.collectionTimer = 0;
  }

  getLinkedNode(): ResourceNode | null { return this.linkedNode; }

  queueUnit(unitDef: ProducedUnitDef): void {
    this.productionQueue.push({ unitDef, elapsed: 0 });
    this.progressBar?.setVisible(true);
    this.progressBarBg?.setVisible(true);
  }

  update(delta: number): void {
    // Tick down shrine cooldown
    if (this.shrineAbilityCooldownRemaining > 0) {
      this.shrineAbilityCooldownRemaining = Math.max(0, this.shrineAbilityCooldownRemaining - delta);
    }

    // Tick down disabled/hacked state
    if (this.disabledRemaining > 0) {
      this.disabledRemaining = Math.max(0, this.disabledRemaining - delta);
    }

    // Finn construction delay
    if (this.constructionRemaining > 0) {
      const barW = this.def.tileWidth * TILE_SIZE;
      this.constructionRemaining = Math.max(0, this.constructionRemaining - delta);
      if (this.constructionBar) {
        const pct = 1 - this.constructionRemaining / this._constructionTotal;
        this.constructionBar.width = barW * pct;
      }
      if (this.constructionRemaining === 0) {
        this.constructionSite?.destroy();
        this.constructionBar?.destroy();
        this.constructionBarBg?.destroy();
        this.constructionSite = null;
        this.constructionBar = null;
        this.constructionBarBg = null;
        this.sprite.setAlpha(1);
      } else {
        return; // not usable yet
      }
    }

    // Auto-collection for Mine / Juice Collector
    if (this.linkedNode && this.linkedResources && !this.linkedNode.isDepleted() && this.def.resourceType && !this.isDisabled()) {
      const intervalMs = this.def.resourceType === 'gold' ? MINE_COLLECTION_MS : JUICE_COLLECTION_MS;
      const amount     = this.def.resourceType === 'gold' ? MINE_COLLECTION_AMOUNT : JUICE_COLLECTION_AMOUNT;
      // Each garrisoned worker adds +30% speed
      const garrisonMult = 1 + this.garrisonCount * 0.3;
      const effectiveInterval = intervalMs / garrisonMult;
      this.collectionTimer += delta;
      if (this.collectionTimer >= effectiveInterval) {
        this.collectionTimer = 0;
        const taken = this.linkedNode.harvest(amount);
        if (this.def.resourceType === 'gold') this.linkedResources.addGold(taken);
        else                                   this.linkedResources.addJuice(taken);
        const { x, y } = this.getWorldCenter();
        this.onCollectionTick?.(taken, x, y);
      }
    }

    // Architects power gate: pause production when unpowered
    if (this.def.requiresPower && !this.isPowered) return;

    if (this.productionQueue.length === 0 || this.isDisabled()) return;

    const current = this.productionQueue[0];
    current.elapsed += delta;

    const progress = Math.min(current.elapsed / current.unitDef.productionMs, 1);
    const spriteW = this.def.tileWidth * TILE_SIZE;
    if (this.progressBar) {
      this.progressBar.width = spriteW * progress;
    }

    if (current.elapsed >= current.unitDef.productionMs) {
      this.productionQueue.shift();
      const spawnTileX = this.tileX + Math.floor(this.def.tileWidth / 2);
      const spawnTileY = this.tileY + this.def.tileHeight + 1;
      // Green check flash above building when training completes
      const { x: bx, y: by } = this.getWorldCenter();
      this.scene.events.emit('sound:buildingComplete', bx, by);
      this.onUnitProduced?.(current.unitDef, spawnTileX, spawnTileY);

      if (this.productionQueue.length === 0) {
        this.progressBar?.setVisible(false);
        this.progressBarBg?.setVisible(false);
        if (this.progressBar) this.progressBar.width = 0;
      }
    }
  }

  getQueueLength(): number {
    return this.productionQueue.length;
  }

  getCurrentProduction(): QueueEntry | null {
    return this.productionQueue[0] ?? null;
  }

  /**
   * Returns a snapshot of the full production queue for UI rendering.
   * Each entry includes the unit def and how much progress [0..1] has been made.
   */
  getQueueSnapshot(): { unitDef: ProducedUnitDef; progress: number }[] {
    return this.productionQueue.map((entry, i) => ({
      unitDef: entry.unitDef,
      progress: i === 0 ? Math.min(entry.elapsed / entry.unitDef.productionMs, 1) : 0,
    }));
  }

  /**
   * Cancel the queue item at the given index (0 = currently building).
   * Refunds 75% of the gold cost. Returns the refunded amount, or 0 if invalid.
   */
  cancelQueueItem(index: number): number {
    if (index < 0 || index >= this.productionQueue.length) return 0;
    const entry = this.productionQueue[index];
    this.productionQueue.splice(index, 1);
    if (this.productionQueue.length === 0) {
      this.progressBar?.setVisible(false);
      this.progressBarBg?.setVisible(false);
      if (this.progressBar) this.progressBar.width = 0;
    }
    return Math.floor(entry.unitDef.goldCost * 0.75);
  }

  getWorldCenter(): { x: number; y: number } {
    return {
      x: (this.tileX + this.def.tileWidth / 2) * TILE_SIZE,
      y: (this.tileY + this.def.tileHeight / 2) * TILE_SIZE,
    };
  }

  /** Restore HP (Structural Analysis passive repair). Clamps to maxHealth. */
  heal(amount: number): void {
    if (this.destroyed) return;
    this.health = Math.min(this.def.maxHealth, this.health + amount);
    const pct = this.health / this.def.maxHealth;
    const spriteW = this.def.tileWidth * TILE_SIZE;
    this.healthBar.width = spriteW * pct;
    this.healthBar.setFillStyle(pct > 0.6 ? 0x44ff44 : pct > 0.3 ? 0xffcc00 : 0xff4444);
    // If smoke was active but we healed above 50%, stop it
    if (this.smokeActive && pct >= 0.5) {
      this.smokeActive = false;
      this.smokeTimerEvent?.destroy();
      this.smokeTimerEvent = null;
    }
  }

  /** Returns true if the building was just destroyed. */
  takeDamage(amount: number): boolean {
    if (this.destroyed) return false;
    // Aegis Shield: completely invulnerable for duration
    if (this.isAegisShielded) return false;
    const effective = Math.max(1, amount - this.armorBonus);
    this.health = Math.max(0, this.health - effective);
    const pct = this.health / this.def.maxHealth;
    // Notify the scene when a player building is under attack
    if (this.faction === 'player') {
      const { x, y } = this.getWorldCenter();
      this.scene.events.emit('player:underAttack', x, y);
    }
    const spriteW = this.def.tileWidth * TILE_SIZE;
    this.healthBar.width = spriteW * pct;
    this.healthBar.setFillStyle(pct > 0.6 ? 0x44ff44 : pct > 0.3 ? 0xffcc00 : 0xff4444);
    if (this.fogVisible) {
      this.healthBarBg.setVisible(true);
      this.healthBar.setVisible(true);
    }
    // Always update bar width/colour regardless of fog

    // Trigger damage smoke when health drops below 50% for the first time
    if (!this.smokeActive && this.health > 0 && this.health / this.def.maxHealth < 0.5) {
      this.smokeActive = true;
      this.startDamageSmoke();
    }

    if (this.health <= 0) {
      this.destroyed = true;
      this.smokeTimerEvent?.destroy();
      this.smokeTimerEvent = null;
      this.sprite.setTint(0x444444).setAlpha(0.5);
      this.scene.tweens.add({ targets: this.sprite, alpha: 0, duration: 800 });
      this.healthBarBg.setVisible(false);
      this.healthBar.setVisible(false);
      this.progressBar?.setVisible(false);
      this.progressBarBg?.setVisible(false);

      // Destruction debris burst
      const { x, y } = this.getWorldCenter();
      const w = this.def.tileWidth * TILE_SIZE;
      const h = this.def.tileHeight * TILE_SIZE;
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 20 + Math.random() * (w * 0.6);
        const bx = x + Math.cos(angle) * dist;
        const by = y + Math.sin(angle) * dist;
        const r = 2 + Math.random() * 4;
        const debris = this.scene.add.circle(x, y, r, this.def.tint, 0.9).setDepth(25);
        this.scene.tweens.add({
          targets: debris, x: bx, y: by, alpha: 0, scale: 0.2,
          duration: 400 + Math.random() * 300, ease: 'Power2',
          onComplete: () => debris.destroy(),
        });
      }
      // Smoke clouds on destruction
      for (let i = 0; i < 5; i++) {
        const sx = x + (Math.random() - 0.5) * w;
        const sy = y + (Math.random() - 0.5) * h;
        const cloud = this.scene.add.circle(sx, sy, 8 + Math.random() * 8, 0x444444, 0.7).setDepth(24);
        this.scene.tweens.add({
          targets: cloud, y: sy - 45, alpha: 0, scaleX: 3.5, scaleY: 3.5,
          duration: 900 + Math.random() * 400, ease: 'Power1',
          onComplete: () => cloud.destroy(),
        });
      }

      this.rallyMarker?.destroy();
      this.rallyMarker = null;
      this.onDestroyed?.();
      return true;
    }
    return false;
  }

  private startDamageSmoke(): void {
    const { x, y } = this.getWorldCenter();
    const w = this.def.tileWidth * TILE_SIZE;
    const h = this.def.tileHeight * TILE_SIZE;
    this.smokeTimerEvent = this.scene.time.addEvent({
      delay: 550,
      loop: true,
      callback: () => {
        if (this.destroyed) {
          this.smokeTimerEvent?.destroy();
          this.smokeTimerEvent = null;
          return;
        }
        const sx = x + (Math.random() - 0.5) * w * 0.7;
        const sy = y - h * 0.1 + (Math.random() - 0.5) * h * 0.4;
        const r = 3 + Math.random() * 5;
        const smoke = this.scene.add.circle(sx, sy, r, 0x555555, 0.5).setDepth(20);
        this.scene.tweens.add({
          targets: smoke, y: sy - 28 - Math.random() * 18,
          alpha: 0, scaleX: 2.2, scaleY: 2.2,
          duration: 1100 + Math.random() * 500, ease: 'Power1',
          onComplete: () => smoke.destroy(),
        });
      },
    });
  }

  // ── Garrison ─────────────────────────────────────────────────────────────

  garrisonWorker(): boolean {
    if (this.garrisonMax === 0 || this.garrisonCount >= this.garrisonMax) return false;
    this.garrisonCount++;
    this.garrisonLabel?.setText(`⛏ ${this.garrisonCount}/${this.garrisonMax}`);
    return true;
  }

  ejectAllWorkers(): void {
    this.garrisonCount = 0;
    this.garrisonLabel?.setText('');
  }

  // ── Shrine ability ────────────────────────────────────────────────────────

  isAbilityReady(): boolean {
    return this.def.isShrine === true && this.shrineAbilityCooldownRemaining <= 0;
  }

  activateAbility(): void {
    this.shrineAbilityCooldownRemaining = this.def.abilityCooldownMs ?? 0;
  }

  /** Returns 0–1 (1 = full cooldown, 0 = ready). */
  getAbilityCooldownPct(): number {
    if (!this.def.abilityCooldownMs) return 0;
    return this.shrineAbilityCooldownRemaining / this.def.abilityCooldownMs;
  }

  // ── Hack / disable ────────────────────────────────────────────────────────

  hack(durationMs: number): void {
    if (this.disabledRemaining > 0) return; // already hacked
    this.disabledRemaining = durationMs;
    const { x, y } = this.getWorldCenter();
    const w = this.def.tileWidth * TILE_SIZE;
    const h = this.def.tileHeight * TILE_SIZE;

    const gfx = this.scene.add.graphics().setDepth(15);
    gfx.fillStyle(0xff2244, 0.3);
    gfx.fillRect(x - w / 2, y - h / 2, w, h);
    gfx.lineStyle(2, 0xff2244, 0.9);
    gfx.strokeRect(x - w / 2, y - h / 2, w, h);
    this.hackedVisuals.push(gfx);

    const txt = this.scene.add.text(x, y, 'HACKED', {
      fontSize: '11px', color: '#ff4466', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(16);
    this.hackedVisuals.push(txt);

    this.scene.time.delayedCall(durationMs, () => {
      this.hackedVisuals.forEach(v => (v as Phaser.GameObjects.GameObject & { destroy(): void }).destroy());
      this.hackedVisuals = [];
    });
  }

  isDisabled(): boolean { return this.disabledRemaining > 0; }

  // ── Architects power grid ─────────────────────────────────────────────────

  /**
   * Called by GameScene each frame for Architects buildings that requiresPower.
   * Shows/hides the ⚡ indicator and pauses the production bar tint.
   */
  setPowered(powered: boolean): void {
    if (this.isPowered === powered) return;
    this.isPowered = powered;
    if (this.unpoweredLabel) {
      this.unpoweredLabel.setText(powered ? '' : '⚡');
      this.unpoweredLabel.setVisible(!powered);
    }
    // Tint the sprite orange when unpowered to make it visually obvious
    if (this.def.requiresPower) {
      this.sprite.setTint(powered ? this.def.tint : 0xff8800);
    }
  }

  // ── Placement animation ───────────────────────────────────────────────────

  private startPlacementAnimation(): void {
    const { x, y } = this.getWorldCenter();
    const w = this.def.tileWidth * TILE_SIZE;
    const h = this.def.tileHeight * TILE_SIZE;
    const ANIM_MS = 2000;

    // Sprite fades in
    this.sprite.setAlpha(0.2);
    this.scene.tweens.add({
      targets: this.sprite, alpha: 1, duration: ANIM_MS, ease: 'Linear',
    });

    // Scaffolding grid overlay
    const scaffoldGfx = this.scene.add.graphics().setDepth(12);
    const cols = this.def.tileWidth * 2;
    const rows = this.def.tileHeight * 2;
    const cw = w / cols;
    const ch = h / rows;
    scaffoldGfx.lineStyle(1, 0xffffff, 0.7);
    scaffoldGfx.strokeRect(x - w / 2, y - h / 2, w, h);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rx = x - w / 2 + c * cw + cw * 0.15;
        const ry = y - h / 2 + r * ch + ch * 0.15;
        scaffoldGfx.fillStyle(0xffffff, 0.55);
        scaffoldGfx.fillRect(rx, ry, cw * 0.28, ch * 0.28);
      }
    }
    this.scene.tweens.add({
      targets: scaffoldGfx, alpha: 0, delay: ANIM_MS * 0.55, duration: ANIM_MS * 0.45, ease: 'Linear',
      onComplete: () => scaffoldGfx.destroy(),
    });

    // Construction progress bar
    const barBg  = this.scene.add.rectangle(x, y + h / 2 + 14, w, 4, 0x333333).setDepth(14);
    const barFill = this.scene.add.rectangle(x - w / 2, y + h / 2 + 14, 0, 4, 0x44ff88).setOrigin(0, 0.5).setDepth(15);
    this.scene.tweens.add({ targets: barFill, width: w, duration: ANIM_MS, ease: 'Linear' });
    this.scene.time.delayedCall(ANIM_MS + 50, () => { barBg.destroy(); barFill.destroy(); });
  }

  // ── Finn construction delay ───────────────────────────────────────────────

  beginConstruction(durationMs: number): void {
    // Kill placement animation so they don't fight over alpha
    this.scene.tweens.killTweensOf(this.sprite);
    this.constructionRemaining = durationMs;
    this.sprite.setAlpha(0.5);
    const { x, y } = this.getWorldCenter();
    const w = this.def.tileWidth * TILE_SIZE;
    const h = this.def.tileHeight * TILE_SIZE;

    this.constructionSite = this.scene.add.graphics().setDepth(15);
    this.constructionSite.lineStyle(2, 0xdd7744, 0.8);
    this.constructionSite.strokeRect(x - w / 2, y - h / 2, w, h);

    this.constructionBarBg = this.scene.add.rectangle(x, y + h / 2 + 8, w, 5, 0x333333).setDepth(15);
    this.constructionBar   = this.scene.add.rectangle(x - w / 2, y + h / 2 + 8, 0, 5, 0xdd7744)
      .setOrigin(0, 0.5).setDepth(16);

    // Animate the bar based on delta — handled in update()
    this._constructionTotal = durationMs;
  }

  private _constructionTotal: number = 1;

  // ── Rally point ───────────────────────────────────────────────────────────

  private rallyTile: { tileX: number; tileY: number } | null = null;
  private rallyMarker: Phaser.GameObjects.Text | null = null;

  /** Set (or move) the rally point flag. Pass null to clear it. */
  setRallyTile(tileX: number, tileY: number): void {
    this.rallyTile = { tileX, tileY };
    this.rallyMarker?.destroy();
    const wx = (tileX + 0.5) * TILE_SIZE;
    const wy = (tileY + 0.5) * TILE_SIZE;
    this.rallyMarker = this.scene.add.text(wx, wy, '⚑', {
      fontSize: '18px', color: '#44ff88', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(7);
  }

  getRallyTile(): { tileX: number; tileY: number } | null {
    return this.rallyTile;
  }

  /** Toggle the Unseen cloaking visual — HQ fades out when no enemies are nearby. */
  cloakField(cloaked: boolean): void {
    if (this.destroyed || this.isCloaked === cloaked) return;
    this.isCloaked = cloaked;
    this.sprite.setAlpha(cloaked ? 0.25 : 1);
  }

  isDestroyed(): boolean { return this.destroyed; }
  getHealth(): number    { return this.health; }

  /** Restore a small amount of HP (Reconstruction Protocol repair). */
  repairHp(amount: number): void {
    if (this.destroyed) return;
    this.health = Math.min(this.def.maxHealth, this.health + amount);
    const pct = this.health / this.def.maxHealth;
    const spriteW = this.def.tileWidth * TILE_SIZE;
    this.healthBar.width = spriteW * pct;
    this.healthBar.setFillStyle(pct > 0.6 ? 0x44ff44 : pct > 0.3 ? 0xffcc00 : 0xff4444);
  }

  /** Instantly restore this building to full HP (used by Prime Construct hero). */
  repairToFull(): void {
    if (this.destroyed) return;
    this.health = this.def.maxHealth;
    this.smokeActive = false;
    this.smokeTimerEvent?.destroy();
    this.smokeTimerEvent = null;
    const spriteW = this.def.tileWidth * TILE_SIZE;
    this.healthBar.width = spriteW;
    this.healthBar.setFillStyle(0x44ff44);
    // Keep bars visible for player buildings
    if (this.faction !== 'player') {
      this.healthBarBg.setVisible(false);
      this.healthBar.setVisible(false);
    }
  }

  /**
   * Fog-of-war: show or hide this building's visuals.
   * Health bars are kept hidden while fogged even if the building takes damage.
   */
  setFogVisible(visible: boolean): void {
    if (this.destroyed) return;
    const wasVisible = this.fogVisible;
    this.fogVisible = visible;

    if (!visible) {
      if (this.fogMemoryShown) return; // memory ghost takes over the visual
      // Kill any fade-in tween and hide immediately.
      this.scene.tweens.killTweensOf(this.sprite);
      this.sprite.setVisible(false).setAlpha(1); // reset alpha so next reveal fades in correctly
      // Keep HP bars visible for player buildings; hide for enemy buildings
      if (this.faction !== 'player') {
        this.healthBarBg.setVisible(false);
        this.healthBar.setVisible(false);
      }
    } else {
      // Clear any active memory ghost and restore normal tint
      if (this.fogMemoryShown) {
        this.fogMemoryShown = false;
        this.sprite.setTint(this.def.tint).setAlpha(1.0);
      }
      if (!wasVisible) {
        // Building just entered vision range — fade sprite in.
        this.scene.tweens.killTweensOf(this.sprite);
        this.sprite.setAlpha(0).setVisible(true);
        this.scene.tweens.add({
          targets: this.sprite,
          alpha: 1,
          duration: 300,
          ease: 'Power1',
        });
      }
    }
  }

  /**
   * Show or hide this building as a semi-transparent grey fog-memory ghost.
   * Called by GameScene when the building is out of current vision but was
   * previously scouted — SC2-style "last seen" memory.
   */
  setFogMemory(show: boolean): void {
    if (this.destroyed) return;
    if (this.fogMemoryShown === show) return;
    this.fogMemoryShown = show;
    if (show) {
      // Ghostly grey silhouette — player knows it was here
      this.scene.tweens.killTweensOf(this.sprite);
      this.sprite.setVisible(true).setAlpha(0.28).setTint(0x888888);
      this.healthBarBg.setVisible(false);
      this.healthBar.setVisible(false);
    } else {
      // Revert tint so that the next setFogVisible(true) fade-in looks correct
      this.sprite.setTint(this.def.tint).setAlpha(1.0);
      if (!this.fogVisible) {
        this.sprite.setVisible(false);
      }
    }
  }

  highlight(on: boolean): void {
    if (this.destroyed) return;
    this.sprite.setAlpha(on ? 1 : 0.85);
    if (on) this.sprite.setTint(this.def.tint | 0x222222);
    else     this.sprite.setTint(this.def.tint);
  }
}
