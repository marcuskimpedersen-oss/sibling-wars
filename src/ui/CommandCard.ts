import Phaser from 'phaser';
import { Race } from '@/constants';

export interface CommandCardConfig {
  isWorkerOnly: boolean;
  race: Race;
  abilityInfo:  { type: string; ready: boolean; active: boolean; cooldownSec: number } | null;
  eAbilityInfo: { type: string; ready: boolean; active: boolean; cooldownSec: number } | null;
  rAbilityInfo: { type: string; ready: boolean; active: boolean; cooldownSec: number } | null;
  hasBAbility:  boolean; // Unseen Phantoms selected
  /** True when at least one Bulwark Siege Crawler is selected. */
  hasSiegeCrawler?: boolean;
  /** True when the selected Siege Crawler is currently in siege mode. */
  siegeActive?: boolean;
}

/** A single button definition for the command card grid. */
interface CmdBtn {
  key: string;
  label: string;
  color: string;
  enabled: boolean;
  active?: boolean;
  cooldownSec?: number;
  event: string;
}

const BTN_W = 54;
const BTN_H = 38;
const GAP   = 5;
const PAD   = 8;
const COLS  = 3;
const ROWS  = 3;
const DEPTH = 200;

export class CommandCard {
  private scene: Phaser.Scene;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private isVisible = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get visible(): boolean { return this.isVisible; }

  show(cfg: CommandCardConfig): void {
    this.clear();
    this.isVisible = true;
    this.draw(cfg);
  }

  hide(): void {
    if (!this.isVisible) return;
    this.clear();
    this.isVisible = false;
  }

  private clear(): void {
    for (const o of this.objects) {
      (o as Phaser.GameObjects.GameObject & { destroy(): void }).destroy();
    }
    this.objects = [];
  }

  private push<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    return o;
  }

  private draw(cfg: CommandCardConfig): void {
    const H = this.scene.scale.height;
    const panelW = PAD + COLS * (BTN_W + GAP) - GAP + PAD;
    const panelH = PAD + ROWS * (BTN_H + GAP) - GAP + PAD;
    const panelX = 10;
    const panelY = H - panelH - 10;

    // Panel background
    const bg = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH));
    bg.fillStyle(0x06101e, 0.93);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1.5, 0x1e3050, 1);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);

    const buttons = this.buildButtons(cfg);

    buttons.forEach((btn, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const bx  = panelX + PAD + col * (BTN_W + GAP);
      const by  = panelY + PAD + row * (BTN_H + GAP);
      this.drawButton(btn, bx, by);
    });
  }

  private buildButtons(cfg: CommandCardConfig): CmdBtn[] {
    const { isWorkerOnly, race, abilityInfo, eAbilityInfo, rAbilityInfo, hasBAbility, hasSiegeCrawler, siegeActive } = cfg;

    // Row 1: movement commands
    const row1: CmdBtn[] = [
      {
        key: 'M', label: 'Move',    color: '#88aacc',
        enabled: true,
        event: 'commandcard:move',
      },
      {
        key: 'S', label: 'Stop',    color: '#88aacc',
        enabled: true,
        event: 'input:stopUnits',
      },
      {
        key: 'A', label: 'A-Move',  color: '#ff8844',
        enabled: !isWorkerOnly,
        event: 'input:startAttackMove',
      },
    ];

    // Row 2, slot 0: Holy Nova (R) for Covenant Devotees; Stealth (B) for Unseen Phantoms; else empty
    const bAbility: CmdBtn = race === 'covenant' && rAbilityInfo
      ? {
          key: 'R',
          label: 'Holy Nova',
          color: rAbilityInfo.ready ? '#ffffd0' : '#556655',
          enabled: rAbilityInfo.ready,
          active: false,
          cooldownSec: !rAbilityInfo.ready ? rAbilityInfo.cooldownSec : undefined,
          event: 'input:activateHolyNova',
        }
      : {
          key: 'B',
          label: race === 'unseen' ? 'Stealth' : '—',
          color: hasBAbility ? '#bb44ee' : '#334455',
          enabled: hasBAbility,
          event: 'input:activateStealth',
        };

    let cLabel = '—';
    if (race === 'architects') cLabel = 'Overcharge';
    else if (race === 'bulwark') cLabel = 'Shield Wall';
    const cAbility: CmdBtn = {
      key: 'C',
      label: abilityInfo ? abilityInfo.type : cLabel,
      color: abilityInfo
        ? (abilityInfo.active ? '#ffff44' : abilityInfo.ready ? '#44ff88' : '#556677')
        : '#334455',
      enabled: !!(abilityInfo?.ready),
      active: abilityInfo?.active,
      cooldownSec: !abilityInfo?.ready && abilityInfo ? abilityInfo.cooldownSec : undefined,
      event: 'input:activateAbility',
    };

    let eLabel = '—';
    if (race === 'covenant') eLabel = 'D. Pulse';
    else if (race === 'unseen') eLabel = 'Shad. Step';
    const eAbility: CmdBtn = {
      key: 'E',
      label: eAbilityInfo ? eAbilityInfo.type : eLabel,
      color: eAbilityInfo
        ? (eAbilityInfo.active ? '#ffff44' : eAbilityInfo.ready ? '#44ffaa' : '#446655')
        : '#334455',
      enabled: !!(eAbilityInfo?.ready),
      active: eAbilityInfo?.active,
      cooldownSec: !eAbilityInfo?.ready && eAbilityInfo ? eAbilityInfo.cooldownSec : undefined,
      event: 'input:activateEAbility',
    };

    // Siege Mode toggle (T) — shown in E-slot for Bulwark when Siege Crawlers selected
    const siegeBtn: CmdBtn = {
      key: 'T',
      label: siegeActive ? 'Undeploy' : 'Siege',
      color: siegeActive ? '#ff8800' : '#ffcc44',
      enabled: !!(hasSiegeCrawler),
      active: !!(siegeActive),
      event: 'input:toggleSiegeMode',
    };

    const empty: CmdBtn = { key: '', label: '', color: '#334455', enabled: false, event: '' };

    const patrolBtn: CmdBtn = {
      key: 'P', label: 'Patrol', color: '#44ffcc',
      enabled: !isWorkerOnly,
      event: 'input:startPatrol',
    };

    if (isWorkerOnly) {
      // Workers: just M and S; fill rest with empty slots
      return [
        row1[0], row1[1], empty,
        empty, empty, empty,
        empty, empty, empty,
      ];
    }

    // Bulwark with Siege Crawler: replace E slot with T (Siege toggle)
    const thirdAbility = (race === 'bulwark' && hasSiegeCrawler) ? siegeBtn : eAbility;
    return [...row1, bAbility, cAbility, thirdAbility, patrolBtn, empty, empty];
  }

  private drawButton(btn: CmdBtn, bx: number, by: number): void {
    const isEmpty = btn.key === '';

    const gfx = this.push(this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1));

    const drawBg = (hover: boolean) => {
      gfx.clear();
      if (isEmpty) {
        gfx.fillStyle(0x060c18, 0.5);
        gfx.fillRoundedRect(bx, by, BTN_W, BTN_H, 5);
        return;
      }
      const bgColor = btn.active  ? 0x332200
        : btn.enabled ? (hover ? 0x1a3450 : 0x0e1e2e)
        : 0x0a0a12;
      gfx.fillStyle(bgColor, 1);
      gfx.fillRoundedRect(bx, by, BTN_W, BTN_H, 5);

      const borderColor = btn.active  ? 0xffdd44
        : btn.enabled ? (hover ? 0x5599ff : 0x2255aa)
        : 0x1a1a2e;
      gfx.lineStyle(1.5, borderColor, btn.enabled ? 1 : 0.5);
      gfx.strokeRoundedRect(bx, by, BTN_W, BTN_H, 5);

      // Cooldown overlay
      if (btn.cooldownSec !== undefined && btn.cooldownSec > 0) {
        gfx.fillStyle(0x000000, 0.4);
        gfx.fillRoundedRect(bx, by, BTN_W, BTN_H, 5);
      }
    };
    drawBg(false);

    if (isEmpty) return;

    // Hotkey letter — top-left corner
    if (btn.key) {
      this.push(this.scene.add.text(bx + 4, by + 3, btn.key, {
        fontSize: '10px',
        color: btn.enabled ? '#ffdd66' : '#334455',
        stroke: '#000', strokeThickness: 2,
      }).setScrollFactor(0).setDepth(DEPTH + 2).setOrigin(0, 0));
    }

    // Command label — centered
    this.push(this.scene.add.text(bx + BTN_W / 2, by + BTN_H / 2 - 2, btn.label, {
      fontSize: '8px',
      color: btn.color,
      stroke: '#000', strokeThickness: 2,
      wordWrap: { width: BTN_W - 8 },
      align: 'center',
    }).setScrollFactor(0).setDepth(DEPTH + 2).setOrigin(0.5, 0.5));

    // Status line — bottom (cooldown or state)
    let statusTxt = '';
    let statusCol = '#445566';
    if (btn.active) {
      statusTxt = 'Active';
      statusCol = '#ffdd44';
    } else if (btn.cooldownSec !== undefined && btn.cooldownSec > 0) {
      statusTxt = `${btn.cooldownSec}s`;
      statusCol = '#556677';
    } else if (btn.enabled) {
      statusTxt = 'Ready';
      statusCol = '#446644';
    }

    if (statusTxt) {
      this.push(this.scene.add.text(bx + BTN_W / 2, by + BTN_H - 6, statusTxt, {
        fontSize: '7px', color: statusCol, stroke: '#000', strokeThickness: 1,
      }).setScrollFactor(0).setDepth(DEPTH + 2).setOrigin(0.5, 1));
    }

    // Click handler
    if (btn.enabled && btn.event) {
      const hit = this.push(
        this.scene.add.rectangle(bx + BTN_W / 2, by + BTN_H / 2, BTN_W, BTN_H, 0, 0)
          .setScrollFactor(0).setDepth(DEPTH + 3).setInteractive().setOrigin(0.5)
      );
      hit.on('pointerover',  () => drawBg(true));
      hit.on('pointerout',   () => drawBg(false));
      hit.on('pointerdown', (_p: unknown, _lx: unknown, _ly: unknown, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.scene.events.emit(btn.event);
      });
    } else if (!isEmpty) {
      // Non-clickable hover area still dims on hover for non-ability empty slots
      const hit = this.push(
        this.scene.add.rectangle(bx + BTN_W / 2, by + BTN_H / 2, BTN_W, BTN_H, 0, 0)
          .setScrollFactor(0).setDepth(DEPTH + 3).setInteractive().setOrigin(0.5)
      );
      hit.on('pointerover',  () => drawBg(true));
      hit.on('pointerout',   () => drawBg(false));
      hit.on('pointerdown', (_p: unknown, _lx: unknown, _ly: unknown, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
      });
    }
  }
}
