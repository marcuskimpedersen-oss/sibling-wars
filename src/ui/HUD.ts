import Phaser from 'phaser';
import { ResourceManager } from '@/economy/ResourceManager';
import { UnitStance } from '@/units/Unit';

/**
 * Slim full-width resource bar at the very top of the screen (SC2-style),
 * plus a compact secondary panel below-left for unit/game-state info.
 */
export class HUD {
  private scene: Phaser.Scene;
  private resources: ResourceManager;

  // Top bar elements
  private topBar!: Phaser.GameObjects.Graphics;
  private goldText!: Phaser.GameObjects.Text;
  private incomeText!: Phaser.GameObjects.Text;
  private juiceText!: Phaser.GameObjects.Text;
  private supplyText!: Phaser.GameObjects.Text;
  private difficultyText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private upgradeBadges!: Phaser.GameObjects.Text;

  // Secondary info panel (unit-context, below top bar)
  private secBg!: Phaser.GameObjects.Graphics;
  private groupBadges: Phaser.GameObjects.Text[] = [];
  private stanceText!: Phaser.GameObjects.Text;
  private abilityText!: Phaser.GameObjects.Text;
  private eAbilityText!: Phaser.GameObjects.Text;

  // Placement mode hint (centered, above everything)
  private modeText!: Phaser.GameObjects.Text;

  // Selection composition bar (bottom-centre)
  private selBarBg!: Phaser.GameObjects.Graphics;
  private selBarTexts: Phaser.GameObjects.Text[] = [];

  // Enemy upgrade notification
  private enemyUpgradeLabel: Phaser.GameObjects.Text | null = null;

  // Win condition label
  private winConditionText!: Phaser.GameObjects.Text;

  // Game clock
  private clockText!: Phaser.GameObjects.Text;

  // Idle worker indicator
  private idleWorkerBtn!: Phaser.GameObjects.Text;
  private _idleWorkerFlashTimer = 0;

  // Idle military indicator
  private idleMilitaryBtn!: Phaser.GameObjects.Text;
  private _idleMilitaryFlashTimer = 0;

  // Supply almost full callout
  private supplyCalloutLabel!: Phaser.GameObjects.Text;
  private _supplyCalloutFlashTimer = 0;

  private static readonly BAR_H  = 36;   // top resource bar height
  private static readonly DEPTH  = 300;

  // Persistent upgrades row (secondary panel row 4)
  private upgradesRowText!: Phaser.GameObjects.Text;

  // secondary panel geometry (populated in build())
  private secX = 8;
  private secY = 0;
  private secW = 234;
  private secH = 0;

  // Gold sparkle tracking
  private _lastGold = 0;
  private _sparkleParticles: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, resources: ResourceManager) {
    this.scene = scene;
    this.resources = resources;
    this.build();
  }

  private build(): void {
    const { BAR_H, DEPTH } = HUD;
    const W = this.scene.scale.width;

    // ── Top resource bar ─────────────────────────────────────────────────────
    this.topBar = this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.topBar.fillStyle(0x06101e, 0.94);
    this.topBar.fillRect(0, 0, W, BAR_H);
    this.topBar.lineStyle(1, 0x1e3050, 1);
    this.topBar.lineBetween(0, BAR_H, W, BAR_H);

    const textStyle = (color: string): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontSize: '13px', color, stroke: '#000', strokeThickness: 2,
    });

    const midY = BAR_H / 2;

    // Gold
    this.scene.add.text(14, midY, '\u2b21', textStyle('#ffd700'))
      .setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);
    this.goldText = this.scene.add.text(30, midY, '', textStyle('#ffd700'))
      .setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);

    // Income rate — small text right after gold value (dynamic position set in update)
    this.incomeText = this.scene.add.text(72, midY, '', {
      fontSize: '10px', color: '#aa9933', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);

    // Juice
    this.scene.add.text(144, midY, '\u25c8', textStyle('#cc88ff'))
      .setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);
    this.juiceText = this.scene.add.text(160, midY, '', textStyle('#cc88ff'))
      .setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);

    // Population
    this.scene.add.text(260, midY, '\u25b2', { fontSize: '11px', color: '#88ccff' })
      .setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);
    this.supplyText = this.scene.add.text(274, midY, '', textStyle('#88ccff'))
      .setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);

    // Difficulty label — right of supply
    this.difficultyText = this.scene.add.text(350, midY, '', {
      fontSize: '10px', color: '#446688', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);

    // Win condition label — right of difficulty
    this.winConditionText = this.scene.add.text(430, midY, '', {
      fontSize: '10px', color: '#887755', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);

    // Game clock — right-centre, left of speed indicator
    this.clockText = this.scene.add.text(W / 2 - 60, midY, '00:00', {
      fontSize: '12px', color: '#557799', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(1, 0.5);

    // Speed / pause — centred in the bar
    this.speedText = this.scene.add.text(W / 2, midY, '', {
      fontSize: '11px', color: '#445566', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0.5, 0.5);

    // Upgrade badges — right-aligned
    this.upgradeBadges = this.scene.add.text(W - 12, midY, '', {
      fontSize: '11px', color: '#ffaa44', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(1, 0.5);

    // Idle worker button — left of upgrade badges; hidden when no idle workers
    this.idleWorkerBtn = this.scene.add.text(W - 160, midY, '', {
      fontSize: '12px', color: '#ffd700', stroke: '#000', strokeThickness: 2,
      backgroundColor: '#332200aa', padding: { x: 5, y: 2 },
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    this.idleWorkerBtn.on('pointerdown', () => {
      this.scene.events.emit('hud:selectIdleWorker');
    });
    this.idleWorkerBtn.on('pointerover', () => this.idleWorkerBtn.setColor('#ffffff'));
    this.idleWorkerBtn.on('pointerout',  () => this.idleWorkerBtn.setColor('#ffd700'));

    // Idle military button — left of idle worker button
    this.idleMilitaryBtn = this.scene.add.text(W - 310, midY, '', {
      fontSize: '12px', color: '#ffaa44', stroke: '#000', strokeThickness: 2,
      backgroundColor: '#331100aa', padding: { x: 5, y: 2 },
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    this.idleMilitaryBtn.on('pointerdown', () => {
      this.scene.events.emit('hud:selectIdleMilitary');
    });
    this.idleMilitaryBtn.on('pointerover', () => this.idleMilitaryBtn.setColor('#ffffff'));
    this.idleMilitaryBtn.on('pointerout',  () => this.idleMilitaryBtn.setColor('#ffaa44'));

    // ── Supply callout (below supply counter) ────────────────────────────────
    this.supplyCalloutLabel = this.scene.add.text(274, BAR_H + 4, '⚠ Supply almost full', {
      fontSize: '11px', color: '#ffcc44', stroke: '#000', strokeThickness: 2,
      backgroundColor: '#332200bb', padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0).setVisible(false);

    // ── Placement mode hint — centred below top bar ───────────────────────────
    this.modeText = this.scene.add.text(W / 2, BAR_H + 6, '', {
      fontSize: '14px', color: '#ffff88', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH + 1);

    // ── Secondary info panel (control groups, stance, abilities) ─────────────
    // Positioned top-left, just below the top bar
    const SEC_PAD  = 8;
    const ROW_H    = 14;
    const ROWS     = 5;  // groups, stance, c-ability, e-ability, upgrades
    this.secW = 234;
    this.secH = SEC_PAD * 2 + ROWS * ROW_H + (ROWS - 1) * 2;
    this.secX = 8;
    this.secY = BAR_H + 6;

    this.secBg = this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.drawSecBg(false);

    // Control group badges row
    for (let n = 1; n <= 9; n++) {
      const badge = this.scene.add.text(
        this.secX + SEC_PAD + (n - 1) * 24, this.secY + SEC_PAD,
        '',
        { fontSize: '10px', color: '#334455', stroke: '#000', strokeThickness: 2 }
      ).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0);
      this.groupBadges.push(badge);
    }

    // Stance
    this.stanceText = this.scene.add.text(
      this.secX + SEC_PAD, this.secY + SEC_PAD + ROW_H + 2, '', {
        fontSize: '10px', color: '#88aacc', stroke: '#000', strokeThickness: 2,
      }
    ).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0);

    // C-ability
    this.abilityText = this.scene.add.text(
      this.secX + SEC_PAD, this.secY + SEC_PAD + (ROW_H + 2) * 2, '', {
        fontSize: '10px', color: '#ffcc44', stroke: '#000', strokeThickness: 2,
      }
    ).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0);

    // E-ability
    this.eAbilityText = this.scene.add.text(
      this.secX + SEC_PAD, this.secY + SEC_PAD + (ROW_H + 2) * 3, '', {
        fontSize: '10px', color: '#44ffaa', stroke: '#000', strokeThickness: 2,
      }
    ).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0);

    // Upgrades row (attack + armor level circles)
    this.upgradesRowText = this.scene.add.text(
      this.secX + SEC_PAD, this.secY + SEC_PAD + (ROW_H + 2) * 4, '', {
        fontSize: '10px', color: '#ffaa44', stroke: '#000', strokeThickness: 2,
      }
    ).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0);

    // ── Selection composition bar (bottom-centre, hidden until units selected) ──
    this.selBarBg = this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.selBarBg.setVisible(false);
  }

  /** Show/hide the secondary panel background based on whether it has content. */
  private drawSecBg(visible: boolean): void {
    this.secBg.clear();
    if (!visible) return;
    this.secBg.fillStyle(0x06101e, 0.88);
    this.secBg.fillRoundedRect(this.secX, this.secY, this.secW, this.secH, 8);
    this.secBg.lineStyle(1, 0x1e3050, 1);
    this.secBg.strokeRoundedRect(this.secX, this.secY, this.secW, this.secH, 8);
  }

  /** Flash a banner warning that the enemy has upgraded their units. */
  showEnemyUpgrade(type: 'attack' | 'armor', level: number): void {
    this.enemyUpgradeLabel?.destroy();
    const icon  = type === 'attack' ? '\u2694' : '\u25c4';
    const label = type === 'attack' ? 'Enemy upgraded weapons' : 'Enemy upgraded armor';
    const { width } = this.scene.scale;
    this.enemyUpgradeLabel = this.scene.add.text(
      width / 2, HUD.BAR_H + 30,
      `${icon} ${label} +${level}`, {
        fontSize: '12px', color: '#ff8888', stroke: '#000', strokeThickness: 3,
        backgroundColor: '#00000088', padding: { x: 8, y: 4 },
      }
    ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9990);
    this.scene.tweens.add({
      targets: this.enemyUpgradeLabel, alpha: 0, delay: 3000, duration: 800,
      onComplete: () => { this.enemyUpgradeLabel?.destroy(); this.enemyUpgradeLabel = null; },
    });
  }

  update(
    _selectedCount: number,
    _workerOnly: boolean,
    supplyUsed: number,
    supplyCap: number,
    placingMode: boolean,
    controlGroupCounts: Map<number, number> = new Map(),
    stance?: UnitStance | 'mixed' | null,
    abilityInfo?: { type: string; ready: boolean; active: boolean; cooldownSec: number } | null,
    isPaused?: boolean,
    gameSpeed?: number,
    eAbilityInfo?: { type: string; ready: boolean; active: boolean; cooldownSec: number } | null,
    attackBonus?: number,
    armorBonus?: number,
    selComposition?: { total: number; groups: Array<{ label: string; count: number }> } | null,
    incomePerMin?: number,
    difficulty?: string,
    idleWorkerCount?: number,
    frameDelta?: number,
    winCondition?: string,
    survivalMsRemaining?: number,
    gameElapsedMs?: number,
    idleMilitaryCount?: number,
    supplyAlmostFull?: boolean,
  ): void {
    // ── Top bar ───────────────────────────────────────────────────────────────
    const currentGold = this.resources.getGold();
    this.goldText.setText(`${currentGold}`);

    // Gold sparkle when gold increases
    if (currentGold > this._lastGold && this._lastGold > 0) {
      this.triggerGoldSparkle();
    }
    this._lastGold = currentGold;

    // Income rate: "+42/m" right after the gold value — colour-coded
    if (incomePerMin !== undefined && incomePerMin > 0) {
      const incomeColor = incomePerMin > 100 ? '#44ff88' : incomePerMin > 50 ? '#ffcc44' : '#ff5555';
      this.incomeText
        .setX(30 + this.goldText.width + 4)
        .setText(`(+${Math.round(incomePerMin)}/m)`)
        .setColor(incomeColor)
        .setVisible(true);
    } else {
      this.incomeText.setVisible(false);
    }
    this.juiceText.setText(`${this.resources.getJuice()}`);
    this.supplyText.setText(`${supplyUsed} / ${supplyCap}`);

    // Difficulty label
    if (difficulty) {
      const diffColors: Record<string, string> = { easy: '#44aa66', normal: '#446688', hard: '#cc4444' };
      this.difficultyText
        .setText(difficulty.toUpperCase())
        .setColor(diffColors[difficulty] ?? '#446688')
        .setVisible(true);
    } else {
      this.difficultyText.setVisible(false);
    }

    // Win condition label
    if (winCondition) {
      const wcLabels: Record<string, string> = {
        hq: '\u2605 HQ DESTROY',
        annihilation: '\u2620 ANNIHILATION',
        survival: '\u23f1 SURVIVAL',
      };
      let wcLabel = wcLabels[winCondition] ?? winCondition.toUpperCase();
      if (winCondition === 'survival' && survivalMsRemaining !== undefined) {
        const totalSec = Math.max(0, Math.ceil(survivalMsRemaining / 1000));
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        wcLabel += `  ${m}:${String(s).padStart(2, '0')}`;
      }
      const wcColors: Record<string, string> = { hq: '#4488cc', annihilation: '#cc4444', survival: '#44aa66' };
      this.winConditionText
        .setText(wcLabel)
        .setColor(wcColors[winCondition] ?? '#887755')
        .setVisible(true);
    } else {
      this.winConditionText.setVisible(false);
    }

    // Game clock
    if (gameElapsedMs !== undefined) {
      const totalSec = Math.floor(gameElapsedMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      this.clockText.setText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }

    this.modeText.setText(
      placingMode ? 'Left-click to place  \u00b7  Right-click / ESC to cancel' : ''
    );

    // Speed / pause
    if (isPaused) {
      this.speedText.setText('\u23f8 PAUSED  [SPACE]').setColor('#ffdd44');
    } else if (gameSpeed !== undefined && gameSpeed !== 1) {
      const label = gameSpeed < 1
        ? `\u{1F422} ${gameSpeed}\u00d7` : `\u26A1 ${gameSpeed}\u00d7`;
      this.speedText.setText(label).setColor(gameSpeed > 1 ? '#ffcc44' : '#88aaff');
    } else {
      this.speedText.setText('\u25b6 1\u00d7  [SPACE / +/-]').setColor('#334455');
    }

    // Upgrade badges
    const atk = attackBonus ?? 0;
    const arm = armorBonus ?? 0;
    if (atk === 0 && arm === 0) {
      this.upgradeBadges.setText('');
    } else {
      const atkStr = atk > 0 ? `\u2694 +${atk}` : '';
      const armStr = arm > 0 ? `\u25c4 +${arm}` : '';
      const sep = atk > 0 && arm > 0 ? '  ' : '';
      this.upgradeBadges
        .setText(`${atkStr}${sep}${armStr}`)
        .setColor(atk > 6 || arm > 6 ? '#ffff44' : '#ffaa44');
    }

    // ── Idle worker indicator ─────────────────────────────────────────────────
    if (idleWorkerCount && idleWorkerCount > 0) {
      this._idleWorkerFlashTimer += frameDelta ?? 16;
      // Flash on/off every 600 ms
      const flashVisible = Math.floor(this._idleWorkerFlashTimer / 600) % 2 === 0;
      this.idleWorkerBtn
        .setText(`⛏ ${idleWorkerCount} idle  [F]`)
        .setVisible(flashVisible);
    } else {
      this.idleWorkerBtn.setVisible(false);
      this._idleWorkerFlashTimer = 0;
    }

    // ── Idle military indicator ───────────────────────────────────────────────
    if (idleMilitaryCount && idleMilitaryCount >= 3) {
      this._idleMilitaryFlashTimer += frameDelta ?? 16;
      const flashVisible = Math.floor(this._idleMilitaryFlashTimer / 600) % 2 === 0;
      this.idleMilitaryBtn
        .setText(`\u26a0 ${idleMilitaryCount} units idle`)
        .setVisible(flashVisible);
    } else {
      this.idleMilitaryBtn.setVisible(false);
      this._idleMilitaryFlashTimer = 0;
    }

    // ── Supply almost full callout ────────────────────────────────────────────
    if (supplyAlmostFull) {
      this._supplyCalloutFlashTimer += frameDelta ?? 16;
      const flashVisible = Math.floor(this._supplyCalloutFlashTimer / 500) % 2 === 0;
      this.supplyCalloutLabel.setVisible(flashVisible);
    } else {
      this.supplyCalloutLabel.setVisible(false);
      this._supplyCalloutFlashTimer = 0;
    }

    // ── Secondary panel ───────────────────────────────────────────────────────
    // Refresh control group badges
    for (let n = 1; n <= 9; n++) {
      const count = controlGroupCounts.get(n);
      const badge = this.groupBadges[n - 1];
      if (count && count > 0) {
        badge.setText(`[${n}:${count}]`).setColor('#aaddff');
      } else {
        badge.setText(`[${n}]`).setColor('#334455');
      }
    }

    // Stance
    if (!stance) {
      this.stanceText.setText('');
    } else {
      const icons:   Record<string, string> = { aggressive: '\u2694', defensive: '\u25c8', hold: '\u25a0', mixed: '~' };
      const labels:  Record<string, string> = { aggressive: 'Aggressive', defensive: 'Defensive', hold: 'Hold', mixed: 'Mixed' };
      const colours: Record<string, string> = { aggressive: '#ff8844', defensive: '#44aaff', hold: '#44ff88', mixed: '#999999' };
      const s = stance as string;
      this.stanceText
        .setText(`${icons[s] ?? ''} ${labels[s] ?? stance}  [G/V/H]`)
        .setColor(colours[s] ?? '#aaaaaa');
    }

    // C-ability
    if (!abilityInfo) {
      this.abilityText.setText('');
    } else {
      let status: string;
      if (abilityInfo.active)       status = '[Active]';
      else if (abilityInfo.ready)   status = '[C: Ready]';
      else                          status = `[C: ${abilityInfo.cooldownSec}s]`;
      this.abilityText
        .setText(`${abilityInfo.type}  ${status}`)
        .setColor(abilityInfo.active ? '#ffff44' : abilityInfo.ready ? '#44ff88' : '#556677');
    }

    // E-ability
    if (!eAbilityInfo) {
      this.eAbilityText.setText('');
    } else {
      let status: string;
      if (eAbilityInfo.active)      status = '[Active]';
      else if (eAbilityInfo.ready)  status = '[E: Ready]';
      else                          status = `[E: ${eAbilityInfo.cooldownSec}s]`;
      this.eAbilityText
        .setText(`${eAbilityInfo.type}  ${status}`)
        .setColor(eAbilityInfo.ready ? '#44ffaa' : '#335544');
    }

    // Upgrades row — always show when any upgrade has been researched
    const atkLvl = attackBonus ?? 0;
    const armLvl = armorBonus ?? 0;
    const hasUpgrades = atkLvl > 0 || armLvl > 0;
    if (hasUpgrades) {
      const circles = (n: number, max = 3) => {
        const filled = Math.min(max, Math.floor(n / 3));
        return '\u25cf'.repeat(filled) + '\u25cb'.repeat(max - filled);
      };
      const atkStr = `\u2694 ${circles(atkLvl)}`;
      const armStr = `\u25c4 ${circles(armLvl)}`;
      this.upgradesRowText.setText(`${atkStr}   ${armStr}`).setVisible(true);
    } else {
      this.upgradesRowText.setVisible(false);
    }

    // Show/hide secondary panel background based on whether there's unit content or upgrades
    const hasUnitInfo = !!stance || !!abilityInfo || !!eAbilityInfo;
    this.drawSecBg(hasUnitInfo || hasUpgrades);

    // ── Selection composition bar ─────────────────────────────────────────────
    this.updateSelectionBar(selComposition ?? null);
  }

  private triggerGoldSparkle(): void {
    // Spawn a few small gold sparkle stars near the gold counter
    const gx = this.goldText.x;
    const gy = this.goldText.y - 4;
    const depth = HUD.DEPTH + 2;
    for (let i = 0; i < 4; i++) {
      const ox = (Math.random() - 0.5) * 30;
      const oy = (Math.random() - 0.5) * 14;
      const star = this.scene.add.text(gx + ox, gy + oy, '✦', {
        fontSize: '9px', color: '#ffd700',
      }).setScrollFactor(0).setDepth(depth).setOrigin(0.5);
      this.scene.tweens.add({
        targets: star,
        y: gy + oy - 14,
        alpha: 0,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 500 + Math.random() * 200,
        ease: 'Power1',
        onComplete: () => star.destroy(),
      });
    }
  }

  private updateSelectionBar(
    comp: { total: number; groups: Array<{ label: string; count: number }> } | null
  ): void {
    // Recycle old text objects
    for (const t of this.selBarTexts) t.destroy();
    this.selBarTexts = [];
    this.selBarBg.clear();

    if (!comp || comp.total === 0) {
      this.selBarBg.setVisible(false);
      return;
    }

    this.selBarBg.setVisible(true);
    const { width, height } = this.scene.scale;
    const DEPTH = HUD.DEPTH + 1;

    // Build label: "12 selected  ·  Rifleman ×4  ·  Worker ×2"
    const parts: string[] = [`${comp.total} selected`];
    for (const g of comp.groups) parts.push(`${g.label} \u00d7${g.count}`);

    // Approximate panel width using font metrics (~6.4px per char at 11px)
    const rawText = parts.join('   \u00b7   ');
    const approxW = Math.min(rawText.length * 6.4 + 28, width - 40);
    const BAR_H = 22;
    const barX  = Math.round(width / 2 - approxW / 2);
    const barY  = height - 148; // above minimap + margin

    this.selBarBg.fillStyle(0x06101e, 0.88);
    this.selBarBg.fillRoundedRect(barX, barY, approxW, BAR_H, 6);
    this.selBarBg.lineStyle(1, 0x1e3050, 1);
    this.selBarBg.strokeRoundedRect(barX, barY, approxW, BAR_H, 6);

    const midY = barY + BAR_H / 2;
    let curX = barX + 12;

    parts.forEach((part, idx) => {
      const isTotal = idx === 0;
      const t = this.scene.add.text(curX, midY, part, {
        fontSize: '11px',
        color: isTotal ? '#aaddff' : '#cccccc',
        stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(DEPTH).setOrigin(0, 0.5);
      this.selBarTexts.push(t);
      curX += t.width + 2;

      if (idx < parts.length - 1) {
        const sep = this.scene.add.text(curX, midY, '  \u00b7  ', {
          fontSize: '11px', color: '#334455', stroke: '#000', strokeThickness: 1,
        }).setScrollFactor(0).setDepth(DEPTH).setOrigin(0, 0.5);
        this.selBarTexts.push(sep);
        curX += sep.width + 2;
      }
    });
  }
}
