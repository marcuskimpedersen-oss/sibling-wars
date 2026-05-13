import Phaser from 'phaser';
import { NetworkManager, NetworkPlayer, LobbyUpdatePayload, GameStartPayload } from '@/network/NetworkManager';
import { Race, RACES, Difficulty, WinCondition } from '@/constants';

// ── Local race display data ───────────────────────────────────────────────────

const RACE_OPTIONS: { id: Race; label: string; color: number }[] = [
  { id: RACES.HUW,    label: 'Architects', color: 0x4488ff },
  { id: RACES.JONTY,  label: 'Covenant',   color: 0x44ff88 },
  { id: RACES.FINN,   label: 'Bulwark',    color: 0xdd7744 },
  { id: RACES.MARCUS, label: 'Unseen',     color: 0xbb44ee },
];

type LobbyView = 'main' | 'create' | 'join' | 'room';

// ── LobbyScene ────────────────────────────────────────────────────────────────

export class LobbyScene extends Phaser.Scene {
  private net!: NetworkManager;
  private view: LobbyView = 'main';

  // Persistent UI
  private statusText!: Phaser.GameObjects.Text;

  // Dynamically replaced per view
  private dynGroup: Phaser.GameObjects.GameObject[] = [];

  // Selections
  private selectedRace: Race = RACES.HUW;
  private selectedDifficulty: Difficulty = 'normal';
  private selectedWinCondition: WinCondition = 'hq';
  private joinInput: string = '';
  private localReady: boolean = false;

  // Room view live data
  private playerRows: Phaser.GameObjects.Text[] = [];
  private codeDisplay!: Phaser.GameObjects.Text | null;
  private waitingText!: Phaser.GameObjects.Text | null;

  constructor() { super({ key: 'LobbyScene' }); }

  create(): void {
    this.net = NetworkManager.instance;
    this.view = 'main';
    this.joinInput = '';
    this.localReady = false;
    this.dynGroup = [];
    this.codeDisplay = null;
    this.waitingText = null;
    this.playerRows = [];

    // Clean up old network listeners from a previous visit
    this.net.offAllEvents();

    const { width, height } = this.scale;

    // Background
    this.add.rectangle(0, 0, width, height, 0x080818).setOrigin(0, 0);

    // Title
    this.add.text(width / 2, 38, 'MULTIPLAYER', {
      fontSize: '36px', color: '#ffffff', stroke: '#4488ff', strokeThickness: 4, fontStyle: 'bold',
    }).setOrigin(0.5);

    // Back button
    const backBg = this.add.rectangle(60, 26, 100, 28, 0x222244).setInteractive();
    const backTxt = this.add.text(60, 26, '← BACK', { fontSize: '12px', color: '#aaaacc' }).setOrigin(0.5);
    backBg.on('pointerover', () => backBg.setFillStyle(0x333366));
    backBg.on('pointerout',  () => backBg.setFillStyle(0x222244));
    backBg.on('pointerdown', () => {
      this.net.disconnect();
      this.net.offAllEvents();
      this.scene.start('MenuScene');
    });
    void backTxt;

    // Status / error line
    this.statusText = this.add.text(width / 2, height - 30, '', {
      fontSize: '13px', color: '#ff4444',
    }).setOrigin(0.5);

    this.renderMain();
  }

  // ── View management ──────────────────────────────────────────────────────────

  private clearDyn(): void {
    this.dynGroup.forEach(o => o.destroy());
    this.dynGroup = [];
    this.playerRows = [];
    this.codeDisplay = null;
    this.waitingText = null;
  }

  private track(...objs: Phaser.GameObjects.GameObject[]): void {
    this.dynGroup.push(...objs);
  }

  // ── Main view ────────────────────────────────────────────────────────────────

  private renderMain(): void {
    this.clearDyn();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2 - 20;

    const createBtn = this.makeButton(cx, cy - 30, 220, 44, 'CREATE ROOM', 0x4488ff);
    createBtn.on('pointerdown', () => {
      this.view = 'create';
      this.renderCreateSettings();
    });

    const joinBtn = this.makeButton(cx, cy + 30, 220, 44, 'JOIN ROOM', 0x44aa66);
    joinBtn.on('pointerdown', () => {
      this.view = 'join';
      this.renderJoin();
    });

    this.track(createBtn, joinBtn);
  }

  // ── Create settings view (difficulty + win condition before creating) ────────

  private renderCreateSettings(): void {
    this.clearDyn();
    const { width, height } = this.scale;
    const cx = width / 2;
    let y = 100;

    const title = this.add.text(cx, y, 'GAME SETTINGS', { fontSize: '18px', color: '#aaaacc' }).setOrigin(0.5);
    y += 40;
    this.track(title);

    // Difficulty
    const diffLabel = this.add.text(cx, y, 'Difficulty', { fontSize: '11px', color: '#556677' }).setOrigin(0.5);
    y += 20;
    this.track(diffLabel);
    const diffs: { id: Difficulty; label: string; color: number }[] = [
      { id: 'easy',   label: 'EASY',   color: 0x44aa66 },
      { id: 'normal', label: 'NORMAL', color: 0x4488cc },
      { id: 'hard',   label: 'HARD',   color: 0xcc4444 },
    ];
    const diffBgs: Phaser.GameObjects.Rectangle[] = [];
    const bw = 90, bh = 26, gap = 8;
    const totalDiff = diffs.length * bw + (diffs.length - 1) * gap;
    diffs.forEach((d, i) => {
      const bx = cx - totalDiff / 2 + i * (bw + gap) + bw / 2;
      const bg = this.add.rectangle(bx, y + bh / 2, bw, bh,
        this.selectedDifficulty === d.id ? d.color : 0x111133,
        this.selectedDifficulty === d.id ? 0.9 : 0.6,
      ).setInteractive();
      const txt = this.add.text(bx, y + bh / 2, d.label, {
        fontSize: '10px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      diffBgs.push(bg);
      bg.on('pointerdown', () => {
        this.selectedDifficulty = d.id;
        diffBgs.forEach((b, j) => {
          b.setFillStyle(this.selectedDifficulty === diffs[j].id ? diffs[j].color : 0x111133,
            this.selectedDifficulty === diffs[j].id ? 0.9 : 0.6);
        });
      });
      this.track(bg, txt);
    });
    y += 44;

    // Win condition
    const winLabel = this.add.text(cx, y, 'Victory Condition', { fontSize: '11px', color: '#556677' }).setOrigin(0.5);
    y += 20;
    this.track(winLabel);
    const wins: { id: WinCondition; label: string; color: number }[] = [
      { id: 'hq',           label: 'HQ DESTROY',  color: 0x4488cc },
      { id: 'annihilation', label: 'ANNIHILATION', color: 0xcc4444 },
      { id: 'survival',     label: 'SURVIVAL',     color: 0x44aa66 },
    ];
    const winBgs: Phaser.GameObjects.Rectangle[] = [];
    const wbw = 100;
    const totalWin = wins.length * wbw + (wins.length - 1) * gap;
    wins.forEach((wc, i) => {
      const bx = cx - totalWin / 2 + i * (wbw + gap) + wbw / 2;
      const bg = this.add.rectangle(bx, y + bh / 2, wbw, bh,
        this.selectedWinCondition === wc.id ? wc.color : 0x111133,
        this.selectedWinCondition === wc.id ? 0.9 : 0.6,
      ).setInteractive();
      const txt = this.add.text(bx, y + bh / 2, wc.label, {
        fontSize: '9px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      winBgs.push(bg);
      bg.on('pointerdown', () => {
        this.selectedWinCondition = wc.id;
        winBgs.forEach((b, j) => {
          b.setFillStyle(this.selectedWinCondition === wins[j].id ? wins[j].color : 0x111133,
            this.selectedWinCondition === wins[j].id ? 0.9 : 0.6);
        });
      });
      this.track(bg, txt);
    });
    y += 54;

    // Race selector
    const raceLabel = this.add.text(cx, y, 'Your Race', { fontSize: '11px', color: '#556677' }).setOrigin(0.5);
    y += 20;
    this.track(raceLabel);
    this.renderRaceButtons(cx, y);
    y += 44;

    // Create button
    const createBtn = this.makeButton(cx, y + 22, 200, 40, 'CREATE ROOM', 0x4488ff);
    createBtn.on('pointerdown', () => this.doCreateRoom());
    this.track(createBtn);
  }

  private doCreateRoom(): void {
    this.statusText.setText('Creating room...');
    this.net.createRoom({
      race:         this.selectedRace,
      difficulty:   this.selectedDifficulty,
      winCondition: this.selectedWinCondition,
    }).then(() => {
      this.statusText.setText('');
      // Listen for lobby updates and game start
      this.net.on('joined', (data) => {
        this.view = 'room';
        this.renderRoom(data.roomCode, data.isHost);
      });
    }).catch((err: unknown) => {
      console.error('[Lobby] createRoom error:', err);
      let msg: string;
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'object' && err !== null) {
        try { msg = JSON.stringify(err); } catch { msg = String(err); }
      } else {
        msg = String(err);
      }
      this.statusText.setText('Failed: ' + msg.substring(0, 80));
    });
  }

  // ── Join view ────────────────────────────────────────────────────────────────

  private renderJoin(): void {
    this.clearDyn();
    const { width, height } = this.scale;
    const cx = width / 2;
    let y = 110;

    const title = this.add.text(cx, y, 'Enter Room Code', { fontSize: '18px', color: '#aaaacc' }).setOrigin(0.5);
    y += 50;
    this.track(title);

    // Input box
    const inputBg = this.add.rectangle(cx, y + 22, 210, 50, 0x111133).setStrokeStyle(2, 0x4488ff);
    this.joinInput = '';
    const inputTxt = this.add.text(cx, y + 22, '_ _ _ _', {
      fontSize: '30px', color: '#4488ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    y += 80;
    this.track(inputBg, inputTxt);

    // Keyboard input
    const keyHandler = (event: KeyboardEvent) => {
      if (this.view !== 'join') return;
      if (event.key === 'Backspace') {
        this.joinInput = this.joinInput.slice(0, -1);
      } else if (event.key.length === 1 && /[a-zA-Z0-9]/.test(event.key) && this.joinInput.length < 4) {
        this.joinInput += event.key.toUpperCase();
      }
      const chars = this.joinInput.split('').concat(Array(4 - this.joinInput.length).fill('_'));
      inputTxt.setText(chars.join(' '));
    };
    this.input.keyboard!.on('keydown', keyHandler);

    // Race selector
    const raceLabel = this.add.text(cx, y, 'Your Race', { fontSize: '11px', color: '#556677' }).setOrigin(0.5);
    y += 20;
    this.track(raceLabel);
    this.renderRaceButtons(cx, y);
    y += 44;

    // Connect button
    const connectBtn = this.makeButton(cx, y + 22, 180, 40, 'CONNECT', 0x44aa66);
    connectBtn.on('pointerdown', () => {
      if (this.joinInput.length < 4) {
        this.statusText.setText('Enter a 4-letter code');
        return;
      }
      this.statusText.setText('Connecting...');
      this.net.joinRoom(this.joinInput, { race: this.selectedRace }).then(() => {
        this.statusText.setText('');
        this.net.on('joined', (data) => {
          this.view = 'room';
          this.renderRoom(data.roomCode, data.isHost);
        });
      }).catch((err: unknown) => {
        const msg = (err instanceof Error) ? err.message : String(err);
        this.statusText.setText('Failed: ' + msg);
      });
    });
    this.track(connectBtn);
  }

  // ── Room view (shared host + joiner) ─────────────────────────────────────────

  private renderRoom(code: string, isHost: boolean): void {
    this.clearDyn();
    const { width, height } = this.scale;
    const cx = width / 2;
    let y = 90;

    // Room code display
    const codeLabel = this.add.text(cx, y, 'ROOM CODE', { fontSize: '13px', color: '#556677' }).setOrigin(0.5);
    y += 24;
    this.codeDisplay = this.add.text(cx, y, code, {
      fontSize: '56px', color: '#4488ff', fontStyle: 'bold', stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5);
    y += 64;
    const shareHint = this.add.text(cx, y, 'Share this code with your friend', {
      fontSize: '11px', color: '#445566',
    }).setOrigin(0.5);
    y += 36;
    this.track(codeLabel, this.codeDisplay, shareHint);

    // Player list area
    const playerHeader = this.add.text(cx, y, 'PLAYERS', { fontSize: '11px', color: '#556677' }).setOrigin(0.5);
    y += 20;
    this.track(playerHeader);
    for (let i = 0; i < 2; i++) {
      const row = this.add.text(cx, y + i * 26, '', { fontSize: '14px', color: '#88ccaa' }).setOrigin(0.5);
      this.playerRows.push(row);
      this.track(row);
    }
    y += 66;

    // Waiting text
    this.waitingText = this.add.text(cx, y, 'Waiting for opponent...', {
      fontSize: '13px', color: '#445566',
    }).setOrigin(0.5);
    y += 40;
    this.track(this.waitingText);

    // Ready button
    const readyBtn = this.makeButton(cx - 70, y + 16, 120, 36, 'READY', 0x44aa66);
    let readyBtnTxt: Phaser.GameObjects.Text | null = null;
    // The makeButton helper adds the text internally — retrieve via tag
    readyBtn.on('pointerdown', () => {
      this.localReady = !this.localReady;
      this.net.setReady();
      readyBtn.setFillStyle(this.localReady ? 0x22cc55 : 0x44aa66, 0.9);
      if (readyBtnTxt) readyBtnTxt.setText(this.localReady ? '✓ READY' : 'READY');
    });
    // Grab the text object (last added)
    const allObjs = this.children.getAll();
    readyBtnTxt = allObjs[allObjs.length - 1] as Phaser.GameObjects.Text;
    this.track(readyBtn);

    // Start button (host only)
    if (isHost) {
      const startBtn = this.makeButton(cx + 70, y + 16, 120, 36, 'START', 0x4488ff);
      startBtn.on('pointerdown', () => {
        this.net.startGame();
        this.statusText.setText('Starting...');
      });
      this.track(startBtn);
    }

    // ── Network event handlers ────────────────────────────────────────────────
    this.net.on('lobby:update', (data: LobbyUpdatePayload) => {
      this.refreshPlayerRows(data.players);
    });

    this.net.on('game:start', (data: GameStartPayload) => {
      const me = data.players.find(p => p.sessionId === this.net.sessionId);
      const them = data.players.find(p => p.sessionId !== this.net.sessionId);
      this.net.offAllEvents();
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('GameScene', {
          race:              me?.race ?? this.selectedRace,
          difficulty:        data.difficulty,
          winCondition:      data.winCondition,
          multiplayer:       true,
          playerIndex:       me?.playerIndex ?? 0,
          opponentRace:      them?.race ?? 'architects',
          mySessionId:       this.net.sessionId,
          isHost:            this.net.isHost,
        });
      });
    });

    this.net.on('player:left', () => {
      this.statusText.setText('Opponent disconnected');
      if (this.waitingText) this.waitingText.setText('Waiting for opponent...').setColor('#445566');
    });

    this.net.on('error', (msg: string) => {
      this.statusText.setText(msg);
    });
  }

  private refreshPlayerRows(players: NetworkPlayer[]): void {
    for (let i = 0; i < 2; i++) {
      const p = players[i];
      if (!this.playerRows[i]) continue;
      if (p && p.name) {
        const crown = p.isHost ? '👑 ' : '';
        const ready = p.isReady ? ' ✓' : '';
        const name  = p.name  || 'Player';
        const race  = p.race  || 'Unknown';
        this.playerRows[i].setText(`${crown}${name}  [${race}]${ready}`);
        this.playerRows[i].setColor(p.isReady ? '#44ff88' : '#88ccaa');
      } else {
        this.playerRows[i].setText('— waiting —').setColor('#333355');
      }
    }

    if (this.waitingText) {
      const allJoined = players.length >= 2;
      const allReady  = players.length >= 2 && players.every(p => p?.isReady);
      if (allReady) {
        this.waitingText.setText('All players ready! Host can start.').setColor('#44ff88');
      } else if (allJoined) {
        this.waitingText.setText('Waiting for players to ready up...').setColor('#888844');
      } else {
        this.waitingText.setText('Waiting for opponent...').setColor('#445566');
      }
    }
  }

  // ── Race selector ────────────────────────────────────────────────────────────

  private raceButtonBgs: Phaser.GameObjects.Rectangle[] = [];

  private renderRaceButtons(cx: number, y: number): void {
    const bw = 110, bh = 30, gap = 8;
    const total = RACE_OPTIONS.length * bw + (RACE_OPTIONS.length - 1) * gap;
    this.raceButtonBgs = [];

    RACE_OPTIONS.forEach((r, i) => {
      const rx = cx - total / 2 + i * (bw + gap) + bw / 2;
      const isSelected = this.selectedRace === r.id;
      const bg = this.add.rectangle(rx, y + bh / 2, bw, bh, r.color, isSelected ? 0.8 : 0.25).setInteractive();
      const txt = this.add.text(rx, y + bh / 2, r.label, {
        fontSize: '11px', fontStyle: 'bold',
        color: `#${r.color.toString(16).padStart(6, '0')}`,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      this.raceButtonBgs.push(bg);
      this.track(bg, txt);

      bg.on('pointerdown', () => {
        this.selectedRace = r.id;
        this.net.updatePlayerInfo({ race: r.id });
        this.raceButtonBgs.forEach((b, j) => {
          b.setFillStyle(RACE_OPTIONS[j].color, this.selectedRace === RACE_OPTIONS[j].id ? 0.8 : 0.25);
        });
      });
      bg.on('pointerover', () => bg.setFillStyle(r.color, 0.55));
      bg.on('pointerout',  () => bg.setFillStyle(r.color, this.selectedRace === r.id ? 0.8 : 0.25));
    });
  }

  // ── Button factory ───────────────────────────────────────────────────────────

  private makeButton(x: number, y: number, w: number, h: number, label: string, color: number): Phaser.GameObjects.Rectangle {
    const bg = this.add.rectangle(x, y, w, h, color, 0.85).setInteractive();
    const txt = this.add.text(x, y, label, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(color, 1));
    bg.on('pointerout',  () => bg.setFillStyle(color, 0.85));
    this.track(bg, txt);
    return bg;
  }
}
