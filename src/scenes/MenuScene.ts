import Phaser from 'phaser';
import { Race, RACES, Difficulty, WinCondition } from '@/constants';

interface RaceCard {
  race: Race;
  name: string;
  sibling: string;
  trait: string;
  description: string;
  colour: number;
  strengths: string[];
}

const RACE_CARDS: RaceCard[] = [
  {
    race: RACES.HUW,
    sibling: 'Huw',
    name: 'The Architects',
    trait: 'Technology',
    description: 'Masters of engineering. Weak early, unstoppable late. Unlock devastating tech upgrades.',
    colour: 0x4488ff,
    strengths: ['Fast production upgrades', 'Overclock ability', 'Powerful late game'],
  },
  {
    race: RACES.JONTY,
    sibling: 'Jonty',
    name: 'The Covenant',
    trait: 'Altruistic',
    description: 'Strength through unity. Healing auras and shared shields keep your army alive.',
    colour: 0x44ff88,
    strengths: ['Healing aura', 'Revive fallen units', 'Strong mid game'],
  },
  {
    race: RACES.FINN,
    sibling: 'Finn',
    name: 'The Bulwark',
    trait: 'Conservative',
    description: 'Slow. Expensive. Unbreakable. Fortify your positions and punish aggression.',
    colour: 0xdd7744,
    strengths: ['Massive unit health', 'Best walls & defences', 'Fortify ability'],
  },
  {
    race: RACES.MARCUS,
    sibling: 'Marcus',
    name: 'The Unseen',
    trait: 'Cunning',
    description: 'You never see them coming. Stealth, sabotage, and speed. Never fight fair.',
    colour: 0xbb44ee,
    strengths: ['Stealth units', 'Building cloak', 'Cheapest & fastest'],
  },
];

export class MenuScene extends Phaser.Scene {
  private selectedDifficulty: Difficulty = 'normal';
  private selectedWinCondition: WinCondition = 'hq';
  private diffBtnGraphics: Phaser.GameObjects.Graphics[] = [];
  private diffBtnTexts: Phaser.GameObjects.Text[] = [];
  private winBtnGraphics: Phaser.GameObjects.Graphics[] = [];
  private winBtnTexts: Phaser.GameObjects.Text[] = [];

  constructor() { super({ key: 'MenuScene' }); }

  create(): void {
    this.selectedDifficulty = 'normal';
    this.selectedWinCondition = 'hq';
    const { width, height } = this.scale;

    // Background
    this.add.rectangle(0, 0, width, height, 0x080818).setOrigin(0, 0);

    // Title
    this.add.text(width / 2, 30, 'SIBLING WARS', {
      fontSize: '42px', color: '#ffffff', stroke: '#4488ff', strokeThickness: 4,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(width / 2, 76, 'Choose your race', {
      fontSize: '16px', color: '#aaaacc',
    }).setOrigin(0.5);

    // ── Difficulty selector ──────────────────────────────────────────────────
    this.add.text(width / 2, 104, 'Difficulty', {
      fontSize: '11px', color: '#556677',
    }).setOrigin(0.5);

    const diffs: { id: Difficulty; label: string; color: number; desc: string }[] = [
      { id: 'easy',   label: 'EASY',   color: 0x44aa66, desc: 'Weaker enemies · Slower waves' },
      { id: 'normal', label: 'NORMAL', color: 0x4488cc, desc: 'Standard challenge' },
      { id: 'hard',   label: 'HARD',   color: 0xcc4444, desc: 'Stronger enemies · Fast waves' },
    ];
    const btnW = 100;
    const btnH = 26;
    const btnGap = 8;
    const totalBtnW = diffs.length * btnW + (diffs.length - 1) * btnGap;
    const btnStartX = width / 2 - totalBtnW / 2;
    const btnY = 118;

    this.diffBtnGraphics = [];
    this.diffBtnTexts = [];
    const descText = this.add.text(width / 2, btnY + btnH + 8, diffs[1].desc, {
      fontSize: '9px', color: '#667788',
    }).setOrigin(0.5);

    diffs.forEach((d, i) => {
      const bx = btnStartX + i * (btnW + btnGap);
      const gfx = this.add.graphics();
      const txt = this.add.text(bx + btnW / 2, btnY + btnH / 2, d.label, {
        fontSize: '11px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      this.diffBtnGraphics.push(gfx);
      this.diffBtnTexts.push(txt);

      const redraw = () => {
        gfx.clear();
        const selected = this.selectedDifficulty === d.id;
        gfx.fillStyle(selected ? d.color : 0x111133, selected ? 0.9 : 0.6);
        gfx.fillRoundedRect(bx, btnY, btnW, btnH, 5);
        gfx.lineStyle(selected ? 2 : 1, d.color, selected ? 1 : 0.5);
        gfx.strokeRoundedRect(bx, btnY, btnW, btnH, 5);
      };
      redraw();

      const hit = this.add.rectangle(bx + btnW / 2, btnY + btnH / 2, btnW, btnH, 0, 0)
        .setInteractive().setOrigin(0.5);
      hit.on('pointerover', () => {
        descText.setText(d.desc).setColor(`#${d.color.toString(16).padStart(6, '0')}`);
      });
      hit.on('pointerout', () => {
        descText.setText(diffs.find(x => x.id === this.selectedDifficulty)?.desc ?? '').setColor('#667788');
      });
      hit.on('pointerdown', () => {
        this.selectedDifficulty = d.id;
        descText.setText(d.desc).setColor('#667788');
        // Redraw all buttons
        diffs.forEach((_, j) => {
          this.diffBtnGraphics[j].clear();
          const sel = this.selectedDifficulty === diffs[j].id;
          this.diffBtnGraphics[j].fillStyle(sel ? diffs[j].color : 0x111133, sel ? 0.9 : 0.6);
          this.diffBtnGraphics[j].fillRoundedRect(btnStartX + j * (btnW + btnGap), btnY, btnW, btnH, 5);
          this.diffBtnGraphics[j].lineStyle(sel ? 2 : 1, diffs[j].color, sel ? 1 : 0.5);
          this.diffBtnGraphics[j].strokeRoundedRect(btnStartX + j * (btnW + btnGap), btnY, btnW, btnH, 5);
        });
      });
      void hit;
    });

    // ── Win condition selector ───────────────────────────────────────────────
    const winY = btnY + btnH + 30;
    this.add.text(width / 2, winY, 'Victory Condition', {
      fontSize: '11px', color: '#556677',
    }).setOrigin(0.5);

    const winConds: { id: WinCondition; label: string; color: number; desc: string }[] = [
      { id: 'hq',          label: 'HQ DESTROY',   color: 0x4488cc, desc: 'Destroy the enemy HQ to win' },
      { id: 'annihilation',label: 'ANNIHILATION',  color: 0xcc4444, desc: 'Destroy ALL enemy units and buildings' },
      { id: 'survival',    label: 'SURVIVAL',      color: 0x44aa66, desc: 'Survive 15 minutes without your HQ being destroyed' },
    ];
    const wBtnW = 110;
    const wBtnH = 26;
    const wBtnGap = 8;
    const wTotalW = winConds.length * wBtnW + (winConds.length - 1) * wBtnGap;
    const wStartX = width / 2 - wTotalW / 2;
    const wBtnY = winY + 14;

    this.winBtnGraphics = [];
    this.winBtnTexts = [];
    const winDescText = this.add.text(width / 2, wBtnY + wBtnH + 8, winConds[0].desc, {
      fontSize: '9px', color: '#667788',
    }).setOrigin(0.5);

    const redrawWinBtns = () => {
      winConds.forEach((wc, j) => {
        this.winBtnGraphics[j].clear();
        const sel = this.selectedWinCondition === wc.id;
        this.winBtnGraphics[j].fillStyle(sel ? wc.color : 0x111133, sel ? 0.9 : 0.6);
        this.winBtnGraphics[j].fillRoundedRect(wStartX + j * (wBtnW + wBtnGap), wBtnY, wBtnW, wBtnH, 5);
        this.winBtnGraphics[j].lineStyle(sel ? 2 : 1, wc.color, sel ? 1 : 0.5);
        this.winBtnGraphics[j].strokeRoundedRect(wStartX + j * (wBtnW + wBtnGap), wBtnY, wBtnW, wBtnH, 5);
      });
    };

    winConds.forEach((wc, i) => {
      const bx = wStartX + i * (wBtnW + wBtnGap);
      const gfx = this.add.graphics();
      const txt = this.add.text(bx + wBtnW / 2, wBtnY + wBtnH / 2, wc.label, {
        fontSize: '10px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      this.winBtnGraphics.push(gfx);
      this.winBtnTexts.push(txt);
      gfx.fillStyle(i === 0 ? wc.color : 0x111133, i === 0 ? 0.9 : 0.6);
      gfx.fillRoundedRect(bx, wBtnY, wBtnW, wBtnH, 5);
      gfx.lineStyle(i === 0 ? 2 : 1, wc.color, i === 0 ? 1 : 0.5);
      gfx.strokeRoundedRect(bx, wBtnY, wBtnW, wBtnH, 5);

      const hit = this.add.rectangle(bx + wBtnW / 2, wBtnY + wBtnH / 2, wBtnW, wBtnH, 0, 0)
        .setInteractive().setOrigin(0.5);
      hit.on('pointerover', () => {
        winDescText.setText(wc.desc).setColor(`#${wc.color.toString(16).padStart(6, '0')}`);
      });
      hit.on('pointerout', () => {
        winDescText.setText(winConds.find(x => x.id === this.selectedWinCondition)?.desc ?? '').setColor('#667788');
      });
      hit.on('pointerdown', () => {
        this.selectedWinCondition = wc.id;
        winDescText.setText(wc.desc).setColor('#667788');
        redrawWinBtns();
      });
      void hit;
    });

    // ── Race cards ───────────────────────────────────────────────────────────
    const cardW = 200;
    const cardH = 270;
    const totalW = RACE_CARDS.length * cardW + (RACE_CARDS.length - 1) * 20;
    const startX = (width - totalW) / 2;
    const cardY = Math.max(wBtnY + wBtnH + 46, height / 2 - cardH / 2 + 10);

    RACE_CARDS.forEach((card, i) => {
      const x = startX + i * (cardW + 20);
      this.createRaceCard(card, x, cardY, cardW, cardH);
    });

    this.add.text(width / 2, height - 38, 'Click a race to begin  —  or', {
      fontSize: '11px', color: '#444466',
    }).setOrigin(0.5);

    // Multiplayer button
    const mpBg = this.add.rectangle(width / 2, height - 18, 160, 24, 0x224488, 0.9).setInteractive();
    this.add.text(width / 2, height - 18, '⚔ MULTIPLAYER', {
      fontSize: '12px', fontStyle: 'bold', color: '#88bbff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    mpBg.on('pointerover', () => mpBg.setFillStyle(0x3366bb, 0.95));
    mpBg.on('pointerout',  () => mpBg.setFillStyle(0x224488, 0.9));
    mpBg.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('LobbyScene');
      });
    });
  }

  private createRaceCard(card: RaceCard, x: number, y: number, w: number, h: number): void {
    const r = 8;
    const hex = card.colour;

    // Card background
    const bg = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x111133, 1)
      .setInteractive()
      .setStrokeStyle(2, hex);

    // Accent bar
    this.add.rectangle(x + w / 2, y + 4, w, 6, hex).setOrigin(0.5, 0);

    // Sibling name
    this.add.text(x + w / 2, y + 18, card.sibling, {
      fontSize: '22px', color: `#${hex.toString(16).padStart(6, '0')}`, fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);

    // Race name
    this.add.text(x + w / 2, y + 44, card.name, {
      fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    // Trait badge
    const badge = this.add.rectangle(x + w / 2, y + 64, 100, 18, hex, 0.3);
    this.add.text(x + w / 2, y + 64, card.trait.toUpperCase(), {
      fontSize: '9px', color: `#${hex.toString(16).padStart(6, '0')}`, stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    void badge; void r;

    // Description
    this.add.text(x + 10, y + 82, card.description, {
      fontSize: '10px', color: '#aaaacc', wordWrap: { width: w - 20 },
    });

    // Strengths
    card.strengths.forEach((s, si) => {
      this.add.text(x + 14, y + 160 + si * 18, `▸ ${s}`, {
        fontSize: '10px', color: '#88ccaa',
      });
    });

    // Hover / click effects
    bg.on('pointerover', () => {
      bg.setFillStyle(0x222244);
      bg.setStrokeStyle(3, hex);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(0x111133);
      bg.setStrokeStyle(2, hex);
    });
    bg.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('GameScene', { race: card.race, difficulty: this.selectedDifficulty, winCondition: this.selectedWinCondition });
      });
    });

    // Play button
    const btnY = y + h - 28;
    const btn = this.add.rectangle(x + w / 2, btnY, w - 20, 26, hex, 0.9)
      .setInteractive();
    this.add.text(x + w / 2, btnY, 'PLAY', {
      fontSize: '13px', color: '#ffffff', fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    btn.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('GameScene', { race: card.race, difficulty: this.selectedDifficulty, winCondition: this.selectedWinCondition });
      });
    });
  }
}
